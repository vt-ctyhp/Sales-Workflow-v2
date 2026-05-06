const DashboardService = Object.freeze({
  taskSnooze: function(taskId, until, reason, version, actor) {
    return dashboardTaskUpdate_(taskId, {
      TaskState: TASK_STATE.SNOOZED,
      SnoozedUntil: until || '',
      SnoozeReason: reason || '',
    }, version, 'SNOOZE', reason || '', {}, actor);
  },
  taskClaim: function(taskId, version, actor) {
    return dashboardTaskUpdate_(taskId, {
      TaskState: TASK_STATE.CLAIMED,
      ClaimedByEmail: actor && actor.email || getActiveUserEmail_(),
      ClaimedAt: new Date(),
    }, version, 'CLAIM', '', {}, actor);
  },
  taskAcknowledge: function(taskId, version, actor) {
    return dashboardTaskUpdate_(taskId, {
      TaskState: TASK_STATE.COMPLETED,
      CompletedAt: new Date(),
      CompletedByEmail: actor && actor.email || getActiveUserEmail_(),
    }, version, 'ACKNOWLEDGE', '', { acknowledged: true }, actor);
  },
  taskLogTemplateCopied: function(taskId, actor) {
    return dashboardTaskLogTemplateCopied_(taskId, actor);
  },
  customerUpdateStatus: function(rootApptId, fields, version, actor) {
    return dashboardCustomerUpdateStatus_(rootApptId, fields || {}, version, actor);
  },
  customerUpdateDeadline: function(rootApptId, fields, version, actor) {
    return dashboardCustomerUpdateDeadline_(rootApptId, fields || {}, version, actor);
  },
  customerSubmit3DRevision: function(rootApptId, payload, version, actor) {
    return dashboardCustomerSubmit3DRevision_(rootApptId, payload || {}, version, actor);
  },
  customerRequestWax: function(rootApptId, payload, version, actor) {
    return dashboardCustomerRequestWax_(rootApptId, payload || {}, version, actor);
  },
  customerStartOrder: function(rootApptId, payload, version, actor) {
    return dashboardCustomerStartOrder_(rootApptId, payload || {}, version, actor);
  },
  adminAssignOwners: function(rootApptId, advisor, joc, version, actor) {
    return dashboardAdminAssignOwners_(rootApptId, advisor, joc, version, actor);
  },
  adminReassignTask: function(taskId, toUser, version, actor) {
    return dashboardAdminReassignTask_(taskId, toUser, version, actor);
  },
  adminBlockTask: function(taskId, reason, version, actor) {
    return dashboardTaskUpdate_(taskId, {
      TaskState: TASK_STATE.BLOCKED,
      BlockReason: reason || '',
    }, version, 'BLOCK', reason || '', {}, actor);
  },
  adminUnblockTask: function(taskId, version, actor) {
    return dashboardTaskUpdate_(taskId, {
      TaskState: TASK_STATE.OPEN,
      BlockReason: '',
    }, version, 'UNBLOCK', '', {}, actor);
  },
  schedulesList: function() {
    return Schedules.list();
  },
  schedulesSave: function(rows, actor) {
    return dashboardUserWrite_('DashboardService.schedulesSave', 'RosterSchedule', function() {
      return Schedules.save(rows || []);
    }, actor);
  },
  schedulesUpsertChange: function(row, actor) {
    return dashboardUserWrite_('DashboardService.schedulesUpsertChange', row && row.ScheduleChangeID || 'ScheduleChanges', function() {
      return Schedules.upsertChange(row || {});
    }, actor);
  },
  schedulesDeleteChange: function(id, actor) {
    return dashboardSchedulesDeleteChange_(id, actor);
  },
  usersList: function() {
    var users = repoReadAll_('Users');
    if (!users.ok) {
      return users;
    }
    return serviceOk_(users.data.map(function(user) {
      return AuthService.publicUser(user);
    }), users.version || null, []);
  },
  usersUpsert: function(user, actor) {
    return dashboardUsersUpsert_(user || {}, actor);
  },
  paymentHistory: function(rootApptId) {
    return Ledger.getByRoot(rootApptId);
  },
  paymentExportPdf: function(paymentId, actor) {
    return dashboardPaymentExportPdf_(paymentId, actor);
  },
  paymentReset: function(rootApptId, version, actor) {
    return dashboardUserWrite_('DashboardService.paymentReset', rootApptId, function() {
      return serviceOk_({
        rootApptId: rootApptId,
        resetAt: new Date(),
        summary: Ledger.summary(rootApptId).data,
      }, version || null, [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
    }, actor);
  },
  artifactBrief: function(rootApptId) {
    return dashboardArtifactBrief_(rootApptId);
  },
  opsLog: function(filters) {
    return OpsLog.list(filters || {});
  },
  logApiOperation: function(apiName, actorEmail, result, options, started) {
    return dashboardLogApiOperation_(apiName, actorEmail, result, options || {}, started);
  },
});

function dashboardUserWrite_(functionName, target, callback, actor) {
  return DocLock.withUserWriteLock(callback, {
    functionName: functionName,
    target: target || '',
    metadata: {
      actorEmail: actor && actor.email || '',
    },
  });
}

function dashboardTaskUpdate_(taskId, fields, version, eventType, notes, metadata, actor) {
  return dashboardUserWrite_('DashboardService.taskUpdate', taskId, function() {
    var taskRead = Tasks.get(taskId);
    if (!taskRead.ok) {
      return taskRead;
    }
    var task = taskRead.data;
    if (!Tasks.canActOn(task, actor)) {
      return serviceError_([TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) !== -1 ? 'task_closed' : 'forbidden', {
        taskId: taskId,
        taskType: task.TaskType || '',
        taskState: task.TaskState || '',
      });
    }
    if (eventType === 'ACKNOWLEDGE' && dashboardTaskRequiresCompletion_(task.TaskType)) {
      return serviceError_('completion_required', {
        taskId: taskId,
        taskType: task.TaskType || '',
      });
    }
    var updated = repoUpdateByKey_('TaskQueue', taskId, fields || {}, version, 'TaskID');
    if (!updated.ok) {
      return updated;
    }
    var log = Tasks.appendLog({
      TaskID: taskId,
      RootApptID: task.RootApptID,
      EventType: eventType,
      OldState: task.TaskState || '',
      NewState: updated.data.TaskState || task.TaskState || '',
      Notes: notes || '',
      ActorEmail: actor && actor.email || getActiveUserEmail_(),
      MetadataJson: metadata || {},
    });
    return serviceOk_({
      task: updated.data,
      log: log.ok ? log.data : null,
    }, updated.version, serviceCollectInvalidations_(updated, log, [
      CACHE_SLICE.TASK_LIST,
      CACHE_SLICE.TASK_DETAIL,
      CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
    ]));
  }, actor);
}

function dashboardTaskRequiresCompletion_(taskType) {
  return [
    TASK_TYPE.POST_CONSULT_CLIENT_STATUS,
    TASK_TYPE.START_3D_DESIGN,
    TASK_TYPE.RECORD_3D_DEADLINE,
    TASK_TYPE.REQUEST_WAX_PRINT,
    TASK_TYPE.UPDATE_WAX_REQUEST,
    TASK_TYPE.APPOINTMENT_DAY_CHECKLIST,
    TASK_TYPE.APPROVE_RECAP_MESSAGE,
    TASK_TYPE.SEND_FINAL_RECAP,
    TASK_TYPE.PROPOSE_DIAMONDS,
    TASK_TYPE.ORDER_DIAMONDS,
    TASK_TYPE.TRACK_DIAMONDS,
    TASK_TYPE.CONFIRM_DIAMOND_DELIVERY,
    TASK_TYPE.RECORD_DIAMOND_DECISIONS,
    TASK_TYPE.RETURN_DIAMONDS,
  ].indexOf(taskType) !== -1;
}

function dashboardTaskLogTemplateCopied_(taskId, actor) {
  return dashboardUserWrite_('DashboardService.taskLogTemplateCopied', taskId, function() {
    var task = Tasks.get(taskId);
    if (!task.ok) {
      return task;
    }
    var log = Tasks.appendLog({
      TaskID: taskId,
      RootApptID: task.data.RootApptID,
      EventType: 'TEMPLATE_COPIED',
      OldState: task.data.TaskState || '',
      NewState: task.data.TaskState || '',
      ActorEmail: actor && actor.email || getActiveUserEmail_(),
      MetadataJson: {
        templateKey: task.data.TemplateKey || '',
      },
    });
    return serviceOk_({
      task: task.data,
      log: log.ok ? log.data : null,
    }, task.version, serviceCollectInvalidations_(log));
  }, actor);
}

function dashboardCustomerUpdateStatus_(rootApptId, fields, version, actor) {
  return dashboardUserWrite_('DashboardService.customerUpdateStatus', rootApptId, function() {
    var current = ClientStatus.get(rootApptId);
    var payload = mergeObjects_(fields || {});
    if (!payload.SalesStage && payload.salesStage) payload.SalesStage = payload.salesStage;
    if (!payload.NextSteps && payload.nextSteps) payload.NextSteps = payload.nextSteps;
    if (!current.ok) {
      payload = mergeObjects_({
        RootApptID: rootApptId,
        SalesStage: payload.SalesStage || SALES_STAGE.NEW_LEAD,
      }, payload);
      var created = repoAppend_('ClientStatus', payload);
      dashboardAppendStatusHistory_(rootApptId, 'SalesStage', '', created.data.SalesStage || '', 'Created by dashboard status update', {}, actor);
      return serviceOk_({
        status: created.data,
      }, created.version, created.invalidated);
    }
    var updated = ClientStatus.update(rootApptId, payload, version);
    if (!updated.ok) {
      return updated;
    }
    dashboardAppendChangedStatusFields_(rootApptId, current.data, updated.data, payload, 'Dashboard status update', actor);
    return serviceOk_({
      status: updated.data,
    }, updated.version, updated.invalidated);
  }, actor);
}

function dashboardCustomerUpdateDeadline_(rootApptId, fields, version, actor) {
  return dashboardUserWrite_('DashboardService.customerUpdateDeadline', rootApptId, function() {
    var current = ClientStatus.get(rootApptId);
    var payload = mergeObjects_(fields || {});
    if (!payload.Deadline3D && payload.deadline3D) payload.Deadline3D = payload.deadline3D;
    if (!payload.Deadline3DMoveReason && payload.reason) payload.Deadline3DMoveReason = payload.reason;
    if (!current.ok) {
      var created = repoAppend_('ClientStatus', mergeObjects_({
        RootApptID: rootApptId,
        SalesStage: SALES_STAGE.NEW_LEAD,
        Deadline3DMoveCount: 1,
        Deadline3DOriginal: payload.Deadline3D || '',
      }, payload, {
        Deadline3DUpdatedAt: new Date(),
      }));
      dashboardAppendStatusHistory_(rootApptId, 'Deadline3D', '', created.data.Deadline3D || '', 'Created by dashboard deadline update', {}, actor);
      return serviceOk_({
        status: created.data,
      }, created.version, created.invalidated);
    }
    var updated = ClientStatus.updateDeadline(rootApptId, mergeObjects_({
      Deadline3DOriginal: current.data.Deadline3DOriginal || payload.Deadline3D || '',
      Deadline3DMoveCount: Number(current.data.Deadline3DMoveCount || 0) + 1,
    }, payload), version);
    if (!updated.ok) {
      return updated;
    }
    dashboardAppendStatusHistory_(rootApptId, 'Deadline3D', current.data.Deadline3D || '', updated.data.Deadline3D || '', payload.Deadline3DMoveReason || 'Dashboard deadline update', {}, actor);
    return serviceOk_({
      status: updated.data,
    }, updated.version, updated.invalidated);
  }, actor);
}

function dashboardCustomerSubmit3DRevision_(rootApptId, payload, version, actor) {
  return dashboardUserWrite_('DashboardService.customerSubmit3DRevision', rootApptId, function() {
    var current = Order3D.get(rootApptId);
    var fields = mergeObjects_(payload || {}, {
      Current3DState: payload.Current3DState || payload.current3DState || 'Revision Requested',
      LastRevisionAt: new Date(),
      RevisionCount: Number(current.ok ? current.data.RevisionCount || 0 : 0) + 1,
    });
    if (payload.revisionRequest && !fields.DesignRequest) {
      fields.DesignRequest = payload.revisionRequest;
    }
    var result = current.ok ?
      Order3D.update(rootApptId, fields, version) :
      repoAppend_('Order3D', mergeObjects_({
        RootApptID: rootApptId,
      }, fields));
    if (!result.ok) {
      return result;
    }
    var history = Order3D.appendHistory({
      RootApptID: rootApptId,
      Source: 'DashboardService.customerSubmit3DRevision',
      EventType: '3D_REVISION_REQUESTED',
      SONumber: result.data.SONumber || '',
      OldValue: current.ok ? current.data.Current3DState || '' : '',
      NewValue: result.data.Current3DState || '',
      RevisionRequest: payload.RevisionRequest || payload.revisionRequest || payload.DesignRequest || '',
      ActorEmail: actor && actor.email || getActiveUserEmail_(),
      MetadataJson: {
        revisionCount: result.data.RevisionCount || 0,
      },
    });
    return serviceOk_({
      order3d: result.data,
      history: history.ok ? history.data : null,
    }, result.version, serviceCollectInvalidations_(result, history));
  }, actor);
}

function dashboardCustomerRequestWax_(rootApptId, payload, version, actor) {
  return dashboardUserWrite_('DashboardService.customerRequestWax', rootApptId, function() {
    var created = Wax.create(mergeObjects_(payload || {}, {
      RootApptID: rootApptId,
      RequestStatus: payload.RequestStatus || payload.requestStatus || 'Requested',
      AdminDeadline: payload.AdminDeadline || payload.adminDeadline || '',
      RequestUrl: payload.RequestUrl || payload.requestUrl || '',
      RequestedAt: new Date(),
      Notes: payload.Notes || payload.notes || '',
    }));
    return created.ok ? serviceOk_({
      wax: created.data,
    }, created.version, created.invalidated) : created;
  }, actor);
}

function dashboardCustomerStartOrder_(rootApptId, payload, version, actor) {
  return dashboardUserWrite_('DashboardService.customerStartOrder', rootApptId, function() {
    var current = Order3D.get(rootApptId);
    var fields = mergeObjects_(payload || {}, {
      SONumber: payload.SONumber || payload.soNumber || current.ok && current.data.SONumber || '',
      OdooUrl: payload.OdooUrl || payload.odooUrl || current.ok && current.data.OdooUrl || '',
      DesignRequest: payload.DesignRequest || payload.designRequest || current.ok && current.data.DesignRequest || '',
      Current3DState: payload.Current3DState || payload.current3DState || 'Started',
    });
    var result = current.ok ?
      Order3D.update(rootApptId, fields, version) :
      repoAppend_('Order3D', mergeObjects_({
        RootApptID: rootApptId,
        RevisionCount: 0,
      }, fields));
    if (!result.ok) {
      return result;
    }
    var history = Order3D.appendHistory({
      RootApptID: rootApptId,
      Source: 'DashboardService.customerStartOrder',
      EventType: TASK_TYPE.START_3D_DESIGN,
      SONumber: result.data.SONumber,
      OldValue: current.ok ? current.data.Current3DState || '' : '',
      NewValue: result.data.Current3DState || '',
      ActorEmail: actor && actor.email || getActiveUserEmail_(),
      MetadataJson: {},
    });
    return serviceOk_({
      order3d: result.data,
      history: history.ok ? history.data : null,
    }, result.version, serviceCollectInvalidations_(result, history));
  }, actor);
}

function dashboardAdminAssignOwners_(rootApptId, advisor, joc, version, actor) {
  return dashboardUserWrite_('DashboardService.adminAssignOwners', rootApptId, function() {
    var fields = {};
    var advisorUser = dashboardNormalizeUserRef_(advisor);
    var jocUser = dashboardNormalizeUserRef_(joc);
    if (advisorUser.email || advisorUser.name) {
      fields.ClientAdvisorEmail = advisorUser.email;
      fields.ClientAdvisorName = advisorUser.name;
    }
    if (jocUser.email || jocUser.name) {
      fields.JOCOwnerEmail = jocUser.email;
      fields.JOCOwnerName = jocUser.name;
    }
    var updated = CustomerInfo.updateOwners(rootApptId, fields, version);
    return updated.ok ? serviceOk_({
      customer: updated.data,
    }, updated.version, updated.invalidated) : updated;
  }, actor);
}

function dashboardAdminReassignTask_(taskId, toUser, version, actor) {
  return dashboardUserWrite_('DashboardService.adminReassignTask', taskId, function() {
    var task = Tasks.get(taskId);
    if (!task.ok) {
      return task;
    }
    var user = dashboardNormalizeUserRef_(toUser);
    var fields = {
      OwnerEmail: user.email || task.data.OwnerEmail || '',
      OwnerName: user.name || task.data.OwnerName || '',
      OwnerRole: toUser && toUser.role || toUser && toUser.OwnerRole || task.data.OwnerRole || '',
    };
    var updated = repoUpdateByKey_('TaskQueue', taskId, fields, version, 'TaskID');
    if (!updated.ok) {
      return updated;
    }
    var log = Tasks.appendLog({
      TaskID: taskId,
      RootApptID: task.data.RootApptID,
      EventType: 'REASSIGN',
      OldState: task.data.TaskState || '',
      NewState: updated.data.TaskState || '',
      Notes: 'Task reassigned',
      ActorEmail: actor && actor.email || getActiveUserEmail_(),
      MetadataJson: {
        fromEmail: task.data.OwnerEmail || '',
        toEmail: fields.OwnerEmail || '',
        toRole: fields.OwnerRole || '',
      },
    });
    return serviceOk_({
      task: updated.data,
      log: log.ok ? log.data : null,
    }, updated.version, serviceCollectInvalidations_(updated, log));
  }, actor);
}

function dashboardSchedulesDeleteChange_(id, actor) {
  return serviceError_('append_only_delete_disabled', {
    scheduleChangeId: id || '',
    message: 'Schedule changes are append-only. Add a reversing availability change instead of deleting the row.',
  });
}

function dashboardUsersUpsert_(user, actor) {
  return dashboardUserWrite_('DashboardService.usersUpsert', user && user.Email || user && user.email || 'Users', function() {
    var email = normalizeEmail_(user.Email || user.email);
    var existing = email ? Users.getByEmail(email) : { ok: false };
    var password = user.Password || user.password;
    var payload = mergeObjects_(existing.ok ? existing.data : {}, user, {
      Email: email,
      Name: user.Name || user.name || existing.ok && existing.data.Name || '',
      RolesCsv: user.RolesCsv || authRolesToCsv_(user.roles || user.Roles || existing.ok && existing.data.RolesCsv || []),
      Active: user.Active !== undefined ? user.Active : user.active !== undefined ? user.active : existing.ok ? existing.data.Active : true,
      UpdatedByEmail: actor && actor.email || getActiveUserEmail_(),
    });
    delete payload.Password;
    delete payload.password;
    if (password) {
      payload.PasswordSalt = payload.PasswordSalt || Utilities.getUuid();
      payload.PasswordHash = AuthService.hashPassword(password, payload.PasswordSalt);
    }
    if (existing.ok && !payload.Version) {
      payload.Version = existing.version;
    }
    var upserted = Users.upsert(payload);
    return upserted.ok ? serviceOk_(AuthService.publicUser(upserted.data), upserted.version, upserted.invalidated) : upserted;
  }, actor);
}

function dashboardPaymentExportPdf_(paymentId, actor) {
  return dashboardUserWrite_('DashboardService.paymentExportPdf', paymentId, function() {
    var rows = extReadStore_('ledger');
    var payment = rows.filter(function(row) {
      return row.PaymentID === paymentId;
    })[0];
    if (!payment) {
      return repoNotFoundResponse_(Date.now());
    }
    var invoiceUrl = payment.InvoiceUrl || 'https://docs.google.com/document/d/invoice_' + paymentId;
    var receiptUrl = payment.ReceiptUrl || 'https://docs.google.com/document/d/receipt_' + paymentId;
    var linked = Ledger.linkDocs(paymentId, invoiceUrl, receiptUrl);
    if (!linked.ok) {
      return linked;
    }
    return serviceOk_({
      paymentId: paymentId,
      invoiceUrl: invoiceUrl,
      receiptUrl: receiptUrl,
      ledger: linked.data,
    }, linked.version || null, [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
  }, actor);
}

function dashboardArtifactBrief_(rootApptId) {
  var detail = CustomerDetailCache.build(rootApptId, 'standard');
  if (!detail.ok) {
    return detail;
  }
  return serviceOk_({
    rootApptId: rootApptId,
    aiBrief: detail.data.sections.aiBrief || null,
    artifacts: detail.data.sections.appointmentLinks || {},
  }, detail.version, []);
}

function dashboardLogApiOperation_(apiName, actorEmail, result, options, started) {
  try {
    if (!dashboardIsWriteApi_(apiName)) {
      return { ok: true, skipped: true };
    }
    return OpsLog.append({
      FunctionName: apiName,
      Tier: 'API',
      Result: result && result.ok ? 'ok' : 'error',
      Message: result && result.ok ? 'API mutation completed' : (result && result.reason || 'API mutation failed'),
      LockWaitMs: result && result.lockWaitMs || '',
      LockHoldMs: result && result.lockHoldMs || '',
      Target: options.target || '',
      ActorEmail: actorEmail || '',
      MetadataJson: {
        apiName: apiName,
        ageMs: Date.now() - (started || Date.now()),
        reason: result && result.reason || '',
        version: result && result.version || null,
        invalidated: result && result.invalidated || [],
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'ops_log_failed',
      detail: err.message,
    };
  }
}

function dashboardIsWriteApi_(apiName) {
  return [
    'Api.tasks.complete',
    'Api.tasks.snooze',
    'Api.tasks.claim',
    'Api.tasks.acknowledge',
    'Api.tasks.logTemplateCopied',
    'Api.customers.updateStatus',
    'Api.customers.updateDeadline',
    'Api.customers.submit3DRevision',
    'Api.customers.requestWax',
    'Api.customers.startOrder',
    'Api.admin.assignOwners',
    'Api.admin.reassignTask',
    'Api.admin.blockTask',
    'Api.admin.unblockTask',
    'Api.schedules.save',
    'Api.schedules.upsertChange',
    'Api.schedules.deleteChange',
    'Api.users.upsert',
    'Api.diamonds.bulkMarkReturnInProgress',
    'Api.diamonds.assignInStock',
    'Api.diamonds.submitProposal',
    'Api.diamonds.submitOrderApproval',
    'Api.diamonds.submitConfirmDelivery',
    'Api.diamonds.submitDecisions',
    'Api.diamonds.applyLoupe360Sync',
    'Api.payments.submit',
    'Api.payments.regenerateDoc',
    'Api.payments.submitCombo',
    'Api.payments.exportPdf',
    'Api.payments.reset',
    'Api.payments.adminVoid',
    'Api.artifacts.uploadFolder',
    'Api.artifacts.syncDriveUploads',
    'Api.intake.injectTest',
    'Api.intake.manualBooking',
    'Api.intake.runTestScenarios',
  ].indexOf(apiName) !== -1;
}

function dashboardNormalizeUserRef_(value) {
  if (typeof value === 'string') {
    return {
      email: normalizeEmail_(value),
      name: '',
    };
  }
  return {
    email: normalizeEmail_(value && (value.email || value.Email || value.OwnerEmail)),
    name: value && (value.name || value.Name || value.OwnerName) || '',
  };
}

function dashboardAppendChangedStatusFields_(rootApptId, oldRow, newRow, fields, reason, actor) {
  Object.keys(fields || {}).forEach(function(fieldName) {
    if (repoComparable_(oldRow[fieldName]) === repoComparable_(newRow[fieldName])) {
      return;
    }
    dashboardAppendStatusHistory_(rootApptId, fieldName, oldRow[fieldName] || '', newRow[fieldName] || '', reason, {}, actor);
  });
}

function dashboardAppendStatusHistory_(rootApptId, fieldName, oldValue, newValue, reason, metadata, actor) {
  return ClientStatus.appendHistory({
    RootApptID: rootApptId,
    Source: 'DashboardService',
    FieldName: fieldName,
    OldValue: oldValue,
    NewValue: newValue,
    ChangeReason: reason || '',
    ActorEmail: actor && actor.email || getActiveUserEmail_(),
    MetadataJson: metadata || {},
  });
}
