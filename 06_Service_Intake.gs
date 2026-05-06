const Intake = Object.freeze({
  process: function(payload) {
    return intakeProcess_(payload || {}, true);
  },
  drainQueue: function(limit) {
    return intakeDrainQueue_(limit || 25);
  },
  matchExistingByExternalId: function(source, externalId) {
    var result = Appointments.findByExternalId(source, externalId);
    return result.ok ? result.data : null;
  },
  matchByContact: function(email, phone, brand) {
    return intakeMatchByContact_(email, phone, brand);
  },
  resolveOrCreateRoot: function(payload) {
    return intakeResolveOrCreateRoot_(IntakeNormalize.normalize(payload || {}));
  },
  classifyChange: function(existingEvent, payload) {
    return intakeClassifyChange_(existingEvent || null, IntakeNormalize.normalize(payload || {}));
  },
  shouldInheritOwners: function(payload, priorEvent) {
    return intakeShouldInheritOwners_(IntakeNormalize.normalize(payload || {}), priorEvent || null);
  },
  detectReschedule: function(existingEvent, payload) {
    return intakeClassifyChange_(existingEvent || null, IntakeNormalize.normalize(payload || {})) === 'reschedule';
  },
  classifyAcuityChange: function(existingEvent, payload) {
    return intakeClassifyChange_(existingEvent || null, IntakeNormalize.normalize(payload || {}));
  },
});

function intakeProcess_(payload, enqueue) {
  var normalized = IntakeNormalize.normalize(payload || {});
  var validation = IntakeNormalize.validate(normalized);
  if (!validation.ok) {
    return serviceError_('invalid_intake_payload', { errors: validation.errors });
  }
  var queued = enqueue ? IntakeQueue.enqueue(normalized) : null;
  return DocLock.withUserWriteLock(function() {
    try {
      var result = intakeProcessNormalized_(normalized);
      if (queued && queued.ok) {
        if (result.ok) {
          IntakeQueue.markProcessed(queued.data.IntakeID, result, queued.version);
        } else {
          IntakeQueue.markError(queued.data.IntakeID, result.reason || 'intake_error', queued.version);
        }
        result.intakeId = queued.data.IntakeID;
      }
      return result;
    } catch (err) {
      if (queued && queued.ok) {
        IntakeQueue.markError(queued.data.IntakeID, err, queued.version);
      }
      throw err;
    }
  }, {
    functionName: 'Intake.process',
    target: normalized.bookingSource + ':' + normalized.externalBookingId,
  });
}

function intakeProcessNormalized_(payload) {
  var existing = payload.externalBookingId ? Appointments.findByExternalId(payload.bookingSource, payload.externalBookingId) : { ok: false };
  var action = intakeClassifyChange_(existing.ok ? existing.data : null, payload);
  if (action === 'noop') {
    return serviceOk_({
      action: 'noop',
      rootApptId: existing.data.RootApptID,
      apptId: existing.data.APPT_ID,
    }, existing.version, []);
  }
  if (action === 'create') {
    return intakeApplyCreate_(payload);
  }
  if (action === 'edit') {
    return intakeApplyEdit_(payload, existing);
  }
  if (action === 'reschedule') {
    return intakeApplyReschedule_(payload, existing);
  }
  if (action === 'cancel') {
    return intakeApplyCancel_(payload, existing);
  }
  if (action === 'status_change') {
    return intakeApplyStatusChange_(payload, existing);
  }
  return serviceError_('unsupported_intake_action', { action: action });
}

function intakeApplyCreate_(payload) {
  var root = intakeResolveOrCreateRoot_(payload);
  if (!root.ok) {
    return root;
  }
  var apptId = serviceGeneratedId_('appt_v3');
  var event = Appointments.upsertEvent(intakeEventFromPayload_(payload, root.rootApptId, apptId, {}));
  if (!event.ok) {
    return event;
  }
  var rootUpdate = intakeUpdateRootPointer_(root.rootApptId, apptId);
  var customer = intakeEnsureCustomer_(root.rootApptId, payload, root.isNew);
  var status = intakeEnsureClientStatus_(root.rootApptId);
  return intakeProcessResponse_('create', root.rootApptId, apptId, [event, rootUpdate, customer, status]);
}

function intakeApplyEdit_(payload, existingRead) {
  if (!existingRead || !existingRead.ok) {
    return intakeApplyCreate_(payload);
  }
  var existing = existingRead.data;
  var update = Appointments.upsertEvent(mergeObjects_(existing, intakeEventFromPayload_(payload, existing.RootApptID, existing.APPT_ID, existing), {
    Version: existingRead.version,
  }));
  if (!update.ok) {
    return update;
  }
  var customer = intakeMaybeUpdateCustomerIdentity_(existing.RootApptID, payload);
  return intakeProcessResponse_('edit', existing.RootApptID, existing.APPT_ID, [update, customer]);
}

function intakeApplyReschedule_(payload, existingRead) {
  var prior = payload.externalRescheduledFromId ?
    Appointments.findByExternalId(payload.bookingSource, payload.externalRescheduledFromId) :
    existingRead;
  if (!prior || !prior.ok) {
    return intakeApplyCreate_(payload);
  }
  var alreadyCreated = payload.externalBookingId ? Appointments.findByExternalId(payload.bookingSource, payload.externalBookingId) : { ok: false };
  var newApptId = alreadyCreated.ok ? alreadyCreated.data.APPT_ID : serviceGeneratedId_('appt_v3');
  var rootApptId = prior.data.RootApptID;
  var priorUpdate = Appointments.upsertEvent(mergeObjects_(prior.data, {
    Version: prior.version,
    AppointmentStatus: APPOINTMENT_STATUS.RESCHEDULED,
    RescheduledAt: new Date(),
    RescheduledTo: newApptId,
  }));
  if (!priorUpdate.ok) {
    return priorUpdate;
  }
  var newEventPayload = intakeEventFromPayload_(payload, rootApptId, newApptId, alreadyCreated.ok ? alreadyCreated.data : {});
  var newEvent = alreadyCreated.ok ?
    Appointments.upsertEvent(mergeObjects_(alreadyCreated.data, newEventPayload, {
      Version: alreadyCreated.version,
      RescheduledFrom: prior.data.APPT_ID,
    })) :
    Appointments.upsertEvent(mergeObjects_(newEventPayload, {
      RescheduledFrom: prior.data.APPT_ID,
    }));
  if (!newEvent.ok) {
    return newEvent;
  }
  var rootUpdate = intakeUpdateRootPointer_(rootApptId, newApptId);
  var customer = intakeShouldInheritOwners_(payload, prior.data) ?
    intakeMaybeUpdateCustomerIdentity_(rootApptId, payload) :
    intakeEnsureCustomer_(rootApptId, payload, false);
  return intakeProcessResponse_('reschedule', rootApptId, newApptId, [priorUpdate, newEvent, rootUpdate, customer]);
}

function intakeApplyCancel_(payload, existingRead) {
  if (!existingRead || !existingRead.ok) {
    return serviceError_('intake_event_not_found', {
      source: payload.bookingSource,
      externalBookingId: payload.externalBookingId,
    });
  }
  var canceled = Appointments.upsertEvent(mergeObjects_(existingRead.data, {
    Version: existingRead.version,
    AppointmentStatus: APPOINTMENT_STATUS.CANCELED,
    CanceledAt: new Date(),
  }));
  if (!canceled.ok) {
    return canceled;
  }
  return intakeProcessResponse_('cancel', existingRead.data.RootApptID, existingRead.data.APPT_ID, [canceled]);
}

function intakeApplyStatusChange_(payload, existingRead) {
  if (!existingRead || !existingRead.ok) {
    return serviceError_('intake_event_not_found', {
      source: payload.bookingSource,
      externalBookingId: payload.externalBookingId,
    });
  }
  var status = payload.status || APPOINTMENT_STATUS.ACTIVE;
  var updated = Appointments.upsertEvent(mergeObjects_(existingRead.data, {
    Version: existingRead.version,
    AppointmentStatus: status,
    Outcome: status === APPOINTMENT_STATUS.COMPLETED || status === APPOINTMENT_STATUS.NO_SHOW ? status : existingRead.data.Outcome,
  }));
  if (!updated.ok) {
    return updated;
  }
  return intakeProcessResponse_('status_change', existingRead.data.RootApptID, existingRead.data.APPT_ID, [updated]);
}

function intakeResolveOrCreateRoot_(payload) {
  var existingEvent = payload.externalBookingId ? Appointments.findByExternalId(payload.bookingSource, payload.externalBookingId) : { ok: false };
  if (existingEvent.ok) {
    return { ok: true, rootApptId: existingEvent.data.RootApptID, isNew: false };
  }
  var contactMatch = intakeMatchByContact_(payload.email, payload.phone, payload.brand);
  if (contactMatch) {
    return { ok: true, rootApptId: contactMatch.RootApptID, isNew: false };
  }
  var rootApptId = serviceGeneratedId_('root_v3');
  var created = RootAppointments.create({
    RootApptID: rootApptId,
    CurrentAPPT_ID: '',
    LatestAPPT_ID: '',
    RootLifecycleState: ROOT_LIFECYCLE_STATE.ACTIVE,
    RootVersion: 1,
    FirstBookedAt: intakeDateOrNow_(payload.receivedAt),
    LastActivityAt: new Date(),
    IsActive: true,
  });
  if (!created.ok) {
    return created;
  }
  return { ok: true, rootApptId: rootApptId, isNew: true, root: created.data };
}

function intakeMatchByContact_(email, phone, brand) {
  var emailLower = normalizeEmail_(email);
  var phoneNorm = normalizePhone_(phone);
  var normalizedBrand = String(brand || '').trim();
  if (!emailLower || !phoneNorm || !normalizedBrand) {
    return null;
  }
  var rows = repoReadAll_('CustomerInfo').data || [];
  var matches = rows.filter(function(row) {
    return row.EmailLower === emailLower && row.PhoneNorm === phoneNorm && row.Brand === normalizedBrand;
  });
  return matches.length ? matches[0] : null;
}

function intakeClassifyChange_(existingEvent, payload) {
  var hash = IntakeNormalize.payloadHash(payload);
  if (existingEvent && existingEvent.SourcePayloadHash === hash) {
    return 'noop';
  }
  if (payload.action === 'cancel') {
    return 'cancel';
  }
  if (payload.action === 'status_change') {
    return 'status_change';
  }
  if (payload.action === 'reschedule' || payload.externalRescheduledFromId) {
    return 'reschedule';
  }
  if (!existingEvent) {
    return 'create';
  }
  if (payload.status && payload.status !== existingEvent.AppointmentStatus) {
    return 'status_change';
  }
  return 'edit';
}

function intakeShouldInheritOwners_(payload, priorEvent) {
  return Boolean(priorEvent && priorEvent.RootApptID && (payload.action === 'reschedule' || payload.externalRescheduledFromId));
}

function intakeEventFromPayload_(payload, rootApptId, apptId, existing) {
  var start = intakeDateOrNull_(payload.visitDateTime);
  var end = start ? new Date(start.getTime() + Number(payload.duration || 60) * 60 * 1000) : '';
  var status = payload.status || APPOINTMENT_STATUS.ACTIVE;
  return {
    APPT_ID: apptId,
    RootApptID: rootApptId,
    BookingSource: payload.bookingSource,
    ExternalBookingId: payload.externalBookingId,
    ExternalBookingUrl: existing.ExternalBookingUrl || '',
    SourcePayloadHash: IntakeNormalize.payloadHash(payload),
    SourceMetadataJson: {
      location: payload.location,
      source: payload.source,
      budgetRange: payload.budgetRange,
      diamondType: payload.diamondType,
      styleNotes: payload.styleNotes,
      referenceLinks: payload.referenceLinks,
      receivedAt: payload.receivedAt,
      rawPayload: payload.rawPayload,
    },
    VisitType: payload.visitType,
    Brand: payload.brand,
    AppointmentStatus: status,
    AppointmentStart: start || '',
    AppointmentEnd: end || '',
    AppointmentDate: start || '',
    AppointmentTime: start || '',
    TimeZone: Session.getScriptTimeZone(),
    BookedAt: existing.BookedAt || intakeDateOrNow_(payload.receivedAt),
    CustomerNameRaw: payload.customerName,
    CustomerEmailRaw: payload.email,
    CustomerPhoneRaw: payload.phone,
    EmailLower: normalizeEmail_(payload.email),
    PhoneNorm: normalizePhone_(payload.phone),
    Notes: existing.Notes || '',
  };
}

function intakeEnsureCustomer_(rootApptId, payload, isNew) {
  var existing = CustomerInfo.get(rootApptId);
  if (existing.ok) {
    return intakeMaybeUpdateCustomerIdentity_(rootApptId, payload, existing);
  }
  return CustomerInfo.create({
    RootApptID: rootApptId,
    CustomerName: payload.customerName || [payload.firstName, payload.lastName].join(' ').trim(),
    FirstName: payload.firstName,
    LastName: payload.lastName,
    Phone: payload.phone,
    PhoneNorm: normalizePhone_(payload.phone),
    Email: payload.email,
    EmailLower: normalizeEmail_(payload.email),
    Brand: payload.brand,
    LeadSource: payload.source || payload.bookingSource,
    LeadIdentity: payload.externalBookingId,
    PreferredContactMethod: payload.email ? 'email' : payload.phone ? 'phone' : '',
    Notes: isNew ? 'Created by intake.' : 'Linked by intake.',
  });
}

function intakeMaybeUpdateCustomerIdentity_(rootApptId, payload, existingRead) {
  var existing = existingRead || CustomerInfo.get(rootApptId);
  if (!existing.ok) {
    return intakeEnsureCustomer_(rootApptId, payload, true);
  }
  return CustomerInfo.updateOwners(rootApptId, {
    CustomerName: payload.customerName || existing.data.CustomerName,
    FirstName: payload.firstName || existing.data.FirstName,
    LastName: payload.lastName || existing.data.LastName,
    Phone: payload.phone || existing.data.Phone,
    PhoneNorm: payload.phone ? normalizePhone_(payload.phone) : existing.data.PhoneNorm,
    Email: payload.email || existing.data.Email,
    EmailLower: payload.email ? normalizeEmail_(payload.email) : existing.data.EmailLower,
    Brand: payload.brand || existing.data.Brand,
    LeadSource: payload.source || existing.data.LeadSource,
    LeadIdentity: payload.externalBookingId || existing.data.LeadIdentity,
  }, existing.version);
}

function intakeEnsureClientStatus_(rootApptId) {
  var existing = ClientStatus.get(rootApptId);
  if (existing.ok) {
    return existing;
  }
  return repoAppend_('ClientStatus', {
    RootApptID: rootApptId,
    SalesStage: SALES_STAGE.APPOINTMENT_BOOKED,
    ConversionStatus: 'Open',
    Deadline3DMoveCount: 0,
    Is3DNeeded: false,
    IsWaxNeeded: false,
    Notes: 'Initialized by intake.',
  });
}

function intakeUpdateRootPointer_(rootApptId, apptId) {
  var root = RootAppointments.get(rootApptId);
  if (!root.ok) {
    return root;
  }
  return RootAppointments.updateCurrentAppointment(rootApptId, apptId, root.version);
}

function intakeProcessResponse_(action, rootApptId, apptId, results) {
  var invalidated = serviceCollectInvalidations_.apply(null, results || []);
  return serviceOk_({
    action: action,
    rootApptId: rootApptId,
    apptId: apptId,
  }, null, invalidated);
}

function intakeDrainQueue_(limit) {
  var pending = IntakeQueue.listPending(limit || 25);
  if (!pending.ok) {
    return pending;
  }
  var results = pending.data.map(function(row) {
    var processing = repoUpdateByKey_('IntakeQueue', row.IntakeID, {
      Status: 'processing',
    }, row.Version, 'IntakeID');
    if (!processing.ok) {
      return processing;
    }
    try {
      var result = intakeProcess_(row.PayloadJson, false);
      if (result.ok) {
        IntakeQueue.markProcessed(row.IntakeID, result, processing.version);
      } else {
        IntakeQueue.markError(row.IntakeID, result.reason || 'intake_error', processing.version);
      }
      return result;
    } catch (err) {
      return IntakeQueue.markError(row.IntakeID, err, processing.version);
    }
  });
  return serviceOk_({
    count: results.length,
    results: results,
  }, null, serviceCollectInvalidations_(results));
}

function intakeDateOrNull_(value) {
  if (!value) {
    return null;
  }
  var date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function intakeDateOrNow_(value) {
  return intakeDateOrNull_(value) || new Date();
}
