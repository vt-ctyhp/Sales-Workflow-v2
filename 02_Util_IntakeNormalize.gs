const IntakeNormalize = Object.freeze({
  normalize: function(payload) {
    return intakeNormalizePayload_(payload || {});
  },
  payloadHash: function(payload) {
    return sha256Hex_(intakeStableStringify_(payload || {}));
  },
  validate: function(payload) {
    return intakeValidatePayload_(payload || {});
  },
  splitName: function(name) {
    return intakeSplitName_(name);
  },
});

function intakeNormalizePayload_(payload) {
  var customerName = String(payload.customerName || payload.CustomerName || payload.name || '').trim();
  var split = intakeSplitName_(customerName);
  var visitDateTime = payload.visitDateTime || payload.AppointmentStart || payload.start || '';
  var duration = Number(payload.duration || payload.Duration || 60);
  var receivedAt = payload.receivedAt || payload.ReceivedAt || nowIso_();
  return {
    bookingSource: String(payload.bookingSource || payload.BookingSource || BOOKING_SOURCE.MANUAL).trim().toLowerCase(),
    externalBookingId: String(payload.externalBookingId || payload.ExternalBookingId || payload.id || '').trim(),
    externalRescheduledFromId: String(payload.externalRescheduledFromId || payload.ExternalRescheduledFromId || '').trim(),
    action: String(payload.action || payload.Action || 'create').trim().toLowerCase(),
    customerName: customerName,
    firstName: String(payload.firstName || payload.FirstName || split.firstName || '').trim(),
    lastName: String(payload.lastName || payload.LastName || split.lastName || '').trim(),
    email: String(payload.email || payload.Email || payload.customerEmail || '').trim(),
    phone: String(payload.phone || payload.Phone || payload.customerPhone || '').trim(),
    brand: String(payload.brand || payload.Brand || '').trim(),
    visitDateTime: visitDateTime,
    visitType: String(payload.visitType || payload.VisitType || '').trim(),
    duration: duration,
    location: String(payload.location || payload.Location || '').trim(),
    source: String(payload.source || payload.Source || payload.leadSource || '').trim(),
    status: payload.status || payload.Status || null,
    budgetRange: String(payload.budgetRange || payload.BudgetRange || '').trim(),
    diamondType: String(payload.diamondType || payload.DiamondType || '').trim(),
    styleNotes: String(payload.styleNotes || payload.StyleNotes || '').trim(),
    referenceLinks: String(payload.referenceLinks || payload.ReferenceLinks || '').trim(),
    receivedAt: receivedAt,
    rawPayload: payload.rawPayload || payload.RawPayload || payload,
  };
}

function intakeValidatePayload_(payload) {
  var errors = [];
  var source = payload.bookingSource || '';
  if (!source) {
    errors.push('bookingSource is required');
  }
  if (source !== BOOKING_SOURCE.MANUAL && !payload.externalBookingId && payload.action !== 'reschedule') {
    errors.push('externalBookingId is required for non-manual intake');
  }
  if (['create', 'edit', 'reschedule', 'cancel', 'status_change', 'noop'].indexOf(payload.action) === -1) {
    errors.push('unsupported action: ' + payload.action);
  }
  if (['create', 'edit', 'reschedule'].indexOf(payload.action) !== -1 && !payload.customerName && !payload.email && !payload.phone) {
    errors.push('customer identity is required');
  }
  return {
    ok: errors.length === 0,
    errors: errors,
  };
}

function intakeSplitName_(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(function(part) {
    return part;
  });
  if (!parts.length) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function intakeStableStringify_(value) {
  return JSON.stringify(intakeStableValue_(value));
}

function intakeStableValue_(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(intakeStableValue_);
  }
  if (value && typeof value === 'object') {
    var output = {};
    Object.keys(value).sort().forEach(function(key) {
      output[key] = intakeStableValue_(value[key]);
    });
    return output;
  }
  return value;
}
