const TaskCompletion = Object.freeze({
  complete: function(taskId, payload, version, actor) {
    return taskCompletionComplete_(taskId, payload || {}, version, actor);
  },
});

function taskCompletionComplete_(taskId, payload, version, actor) {
  var preflight = Tasks.get(taskId);
  if (!preflight.ok) {
    return preflight;
  }
  var preflightAccess = taskCompletionCanActResponse_(preflight.data, actor);
  if (!preflightAccess.ok) {
    return preflightAccess;
  }
  var preflightValidation = taskCompletionValidate_(preflight.data, payload);
  if (!preflightValidation.ok) {
    return preflightValidation;
  }
  var locked = DocLock.withUserWriteLock(function() {
    var taskRead = Tasks.get(taskId);
    if (!taskRead.ok) {
      return taskRead;
    }
    var task = taskRead.data;
    var access = taskCompletionCanActResponse_(task, actor);
    if (!access.ok) {
      return access;
    }
    var validation = taskCompletionValidate_(task, payload);
    if (!validation.ok) {
      return validation;
    }
    if (version !== undefined && version !== null && Number(version) !== Number(taskRead.version || 0)) {
      return {
        ok: false,
        conflict: true,
        reason: 'version_conflict',
        latest: taskRead.data,
        version: taskRead.version,
        source: 'service',
        ageMs: 0,
      };
    }
    var dispatch = taskCompletionDispatch_(task, payload);
    if (!dispatch.ok) {
      return dispatch;
    }
    var completed = Tasks.complete(taskId, {
      PayloadJson: mergeObjects_(task.PayloadJson || {}, {
        completionPayload: payload,
      }),
    }, taskRead.version, actor);
    if (!completed.ok) {
      return completed;
    }
    var log = serviceTaskLog_(task, 'COMPLETE', task.TaskState, TASK_STATE.COMPLETED, payload.Notes || payload.notes || '', {
      dispatch: dispatch.data,
    }, actor);
    return serviceOk_({
      task: completed.data,
      dispatch: dispatch.data,
      log: log.ok ? log.data : null,
    }, completed.version, serviceCollectInvalidations_(dispatch, completed, log, task.InvalidatesJson || [], [CACHE_SLICE.TASK_LIST, CACHE_SLICE.TASK_DETAIL, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]));
  }, {
    functionName: 'TaskCompletion.complete',
    target: taskId,
  });
  return taskCompletionRunPostCommit_(locked);
}

function taskCompletionCanActResponse_(task, actor) {
  if (Tasks.canActOn(task, actor)) {
    return serviceOk_({ canAct: true }, task && task.Version || null, []);
  }
  var closed = task && [TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) !== -1;
  return {
    ok: false,
    reason: closed ? 'task_closed' : 'forbidden',
    error: {
      code: closed ? 'TASK_CLOSED' : 'FORBIDDEN',
      message: closed ? 'This task is already completed or canceled.' : 'This user cannot complete this task.',
    },
    detail: {
      taskId: task && task.TaskID || '',
      taskType: task && task.TaskType || '',
      taskState: task && task.TaskState || '',
      ownerEmail: task && task.OwnerEmail || '',
      ownerRole: task && task.OwnerRole || '',
      actorEmail: actor && actor.email || '',
      actorRoles: actor && actor.roles || [],
    },
    source: 'service',
    ageMs: 0,
  };
}

function taskCompletionValidate_(task, payload) {
  var type = task && task.TaskType || '';
  var required = [];
  if (type === TASK_TYPE.POST_CONSULT_CLIENT_STATUS) {
    required = taskCompletionMissingFields_(payload, ['SalesStage']);
  } else if (type === TASK_TYPE.START_3D_DESIGN) {
    required = taskCompletionMissingFields_(payload, ['SONumber', 'OdooUrl']);
  } else if (type === TASK_TYPE.RECORD_3D_DEADLINE) {
    required = taskCompletionMissingFields_(payload, ['Deadline3D']);
  } else if (type === TASK_TYPE.REQUEST_WAX_PRINT) {
    required = taskCompletionMissingFields_(payload, ['RequestStatus', 'AdminDeadline']);
  } else if (type === TASK_TYPE.UPDATE_WAX_REQUEST) {
    required = taskCompletionMissingFields_(payload, ['RequestStatus']);
  } else if (type === TASK_TYPE.APPOINTMENT_DAY_CHECKLIST) {
    required = taskCompletionMissingAny_(payload, ['Outcome', 'artifactRequirements', 'requirements']);
  } else if (type === TASK_TYPE.APPROVE_RECAP_MESSAGE || type === TASK_TYPE.SEND_FINAL_RECAP) {
    required = taskCompletionMissingArtifact_(task, payload);
  } else if (type === TASK_TYPE.PROPOSE_DIAMONDS) {
    required = taskCompletionArrayLength_(payload.stones) || taskCompletionStoneIds_(payload).length ? [] : ['stoneIds'];
  } else if (type === TASK_TYPE.ORDER_DIAMONDS) {
    required = taskCompletionStoneIds_(payload).length ? [] : ['stoneIds'];
  } else if (type === TASK_TYPE.TRACK_DIAMONDS) {
    required = taskCompletionStoneIds_(payload).length ? taskCompletionMissingAny_(payload, ['TrackingETA', 'TrackingStatus', 'Carrier', 'TrackingNumber', 'TrackingUrl']) : ['stoneIds'];
  } else if (type === TASK_TYPE.CONFIRM_DIAMOND_DELIVERY) {
    required = taskCompletionStoneIds_(payload).length ? taskCompletionMissingFields_(payload, ['MemoDate']) : ['stoneIds'];
  } else if (type === TASK_TYPE.RECORD_DIAMOND_DECISIONS) {
    required = taskCompletionValidDecisions_(payload.decisions) ? [] : ['decisions'];
  } else if (type === TASK_TYPE.RETURN_DIAMONDS) {
    required = taskCompletionStoneIds_(payload).length ? [] : ['stoneIds'];
  }
  if (!required.length) {
    return serviceOk_({ valid: true }, null, []);
  }
  return {
    ok: false,
    reason: 'validation_failed',
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Missing required completion field' + (required.length === 1 ? '' : 's') + ': ' + required.join(', '),
    },
    detail: {
      taskId: task && task.TaskID || '',
      taskType: type,
      missing: required,
    },
    source: 'service',
    ageMs: 0,
  };
}

function taskCompletionMissingFields_(payload, fields) {
  return (fields || []).filter(function(field) {
    return !taskCompletionHasValue_(taskCompletionPayloadValue_(payload, field));
  });
}

function taskCompletionMissingAny_(payload, fields) {
  return (fields || []).some(function(field) {
    return taskCompletionHasValue_(taskCompletionPayloadValue_(payload, field));
  }) ? [] : fields || [];
}

function taskCompletionMissingArtifact_(task, payload) {
  if (taskCompletionHasValue_(taskCompletionPayloadValue_(payload, 'ArtifactID')) || task && task.PayloadJson && task.PayloadJson.artifactId) {
    return [];
  }
  return ['ArtifactID'];
}

function taskCompletionStoneIds_(payload) {
  var ids = payload && (payload.stoneIds || payload.StoneIDs || payload.certNos || payload.CertNos) || [];
  if (!Array.isArray(ids)) {
    ids = [ids];
  }
  return ids.filter(function(id) {
    return taskCompletionHasValue_(id);
  });
}

function taskCompletionArrayLength_(value) {
  return Array.isArray(value) && value.length > 0;
}

function taskCompletionValidDecisions_(decisions) {
  return Array.isArray(decisions) && decisions.some(function(decision) {
    return taskCompletionHasValue_(decision && (decision.CertNo || decision.StoneID || decision.stoneId || decision.certNo)) &&
      taskCompletionHasValue_(decision && (decision.Decision || decision.decision));
  });
}

function taskCompletionHasValue_(value) {
  if (Array.isArray(value)) {
    return value.filter(taskCompletionHasValue_).length > 0;
  }
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function taskCompletionPayloadValue_(payload, field) {
  var aliases = {
    SalesStage: ['SalesStage', 'salesStage'],
    NextSteps: ['NextSteps', 'nextSteps'],
    SONumber: ['SONumber', 'soNumber'],
    OdooUrl: ['OdooUrl', 'odooUrl'],
    DesignRequest: ['DesignRequest', 'designRequest'],
    Deadline3D: ['Deadline3D', 'deadline3D'],
    Deadline3DMoveReason: ['Deadline3DMoveReason', 'reason'],
    RequestStatus: ['RequestStatus', 'requestStatus'],
    AdminDeadline: ['AdminDeadline', 'adminDeadline'],
    RequestUrl: ['RequestUrl', 'requestUrl'],
    Notes: ['Notes', 'notes'],
    Outcome: ['Outcome', 'outcome'],
    ArtifactID: ['ArtifactID', 'artifactId'],
    TrackingETA: ['TrackingETA', 'eta', 'ETA'],
    TrackingStatus: ['TrackingStatus', 'trackingStatus', 'status'],
    Carrier: ['Carrier', 'carrier'],
    TrackingNumber: ['TrackingNumber', 'trackingNumber'],
    TrackingUrl: ['TrackingUrl', 'trackingUrl', 'url'],
    MemoDate: ['MemoDate', 'memoDate'],
    ReturnNotes: ['ReturnNotes', 'notes'],
  };
  var names = aliases[field] || [field];
  for (var i = 0; i < names.length; i += 1) {
    if (payload && payload[names[i]] !== undefined) {
      return payload[names[i]];
    }
    if (payload && payload.fields && payload.fields[names[i]] !== undefined) {
      return payload.fields[names[i]];
    }
  }
  return undefined;
}

function taskCompletionDispatch_(task, payload) {
  var type = task.TaskType;
  if (type === TASK_TYPE.POST_CONSULT_CLIENT_STATUS) {
    return taskCompletionStatus_(task, payload);
  }
  if (type === TASK_TYPE.START_3D_DESIGN) {
    return taskCompletionStart3D_(task, payload);
  }
  if (type === TASK_TYPE.RECORD_3D_DEADLINE) {
    return taskCompletionDeadline_(task, payload);
  }
  if (type === TASK_TYPE.REQUEST_WAX_PRINT) {
    return taskCompletionRequestWax_(task, payload);
  }
  if (type === TASK_TYPE.UPDATE_WAX_REQUEST) {
    return taskCompletionUpdateWax_(task, payload);
  }
  if (type === TASK_TYPE.APPOINTMENT_DAY_CHECKLIST) {
    return taskCompletionAppointmentChecklist_(task, payload);
  }
  if (type === TASK_TYPE.APPROVE_RECAP_MESSAGE) {
    return taskCompletionApproveRecap_(task, payload);
  }
  if (type === TASK_TYPE.SEND_FINAL_RECAP) {
    return taskCompletionFinalRecap_(task, payload);
  }
  if (taskCompletionIsDiamondTask_(type)) {
    return taskCompletionDiamond_(task, payload);
  }
  return serviceOk_({
    taskType: type,
    action: 'complete_only',
  }, null, []);
}

function taskCompletionStatus_(task, payload) {
  var status = ClientStatus.get(task.RootApptID);
  if (!status.ok) {
    return status;
  }
  var updated = ClientStatus.update(task.RootApptID, {
    SalesStage: payload.SalesStage || payload.salesStage || SALES_STAGE.CONSULT_COMPLETE,
    NextSteps: payload.NextSteps || payload.nextSteps || status.data.NextSteps || '',
  }, payload.statusVersion || status.version);
  if (!updated.ok) {
    return updated;
  }
  ClientStatus.appendHistory({
    RootApptID: task.RootApptID,
    Source: 'TaskCompletion.complete',
    FieldName: 'SalesStage',
    OldValue: status.data.SalesStage || '',
    NewValue: updated.data.SalesStage,
    ChangeReason: 'Task completion',
    MetadataJson: { taskId: task.TaskID },
  });
  return serviceOk_(updated.data, updated.version, updated.invalidated);
}

function taskCompletionStart3D_(task, payload) {
  var order = Order3D.get(task.RootApptID);
  var result = order.ok ?
    Order3D.update(task.RootApptID, {
      SONumber: payload.SONumber || payload.soNumber || order.data.SONumber || '',
      OdooUrl: payload.OdooUrl || payload.odooUrl || order.data.OdooUrl || '',
      DesignRequest: payload.DesignRequest || payload.designRequest || order.data.DesignRequest || '',
      Current3DState: 'Started',
    }, payload.orderVersion || order.version) :
    repoAppend_('Order3D', {
      RootApptID: task.RootApptID,
      SONumber: payload.SONumber || payload.soNumber || '',
      OdooUrl: payload.OdooUrl || payload.odooUrl || '',
      DesignRequest: payload.DesignRequest || payload.designRequest || '',
      Current3DState: 'Started',
      RevisionCount: 0,
    });
  if (!result.ok) {
    return result;
  }
  Order3D.appendHistory({
    RootApptID: task.RootApptID,
    Source: 'TaskCompletion.complete',
    EventType: TASK_TYPE.START_3D_DESIGN,
    SONumber: result.data.SONumber,
    NewValue: result.data.Current3DState,
    MetadataJson: { taskId: task.TaskID },
  });
  return serviceOk_(result.data, result.version, result.invalidated);
}

function taskCompletionDeadline_(task, payload) {
  var status = ClientStatus.get(task.RootApptID);
  if (!status.ok) {
    return status;
  }
  var updated = ClientStatus.updateDeadline(task.RootApptID, {
    Deadline3D: payload.Deadline3D || payload.deadline3D,
    Deadline3DOriginal: status.data.Deadline3DOriginal || payload.Deadline3D || payload.deadline3D,
    Deadline3DMoveCount: Number(status.data.Deadline3DMoveCount || 0) + 1,
    Deadline3DMoveReason: payload.Deadline3DMoveReason || payload.reason || 'Task completion',
  }, payload.statusVersion || status.version);
  return updated.ok ? serviceOk_(updated.data, updated.version, updated.invalidated) : updated;
}

function taskCompletionRequestWax_(task, payload) {
  var created = Wax.create({
    RootApptID: task.RootApptID,
    RequestStatus: payload.RequestStatus || 'Requested',
    AdminDeadline: payload.AdminDeadline || payload.adminDeadline || '',
    RequestUrl: payload.RequestUrl || payload.requestUrl || '',
    RequestedAt: new Date(),
    Notes: payload.Notes || payload.notes || '',
  });
  return created.ok ? serviceOk_(created.data, created.version, created.invalidated) : created;
}

function taskCompletionUpdateWax_(task, payload) {
  var waxId = payload.WaxRequestID || payload.waxRequestId || (task.PayloadJson || {}).waxRequestId;
  var current = waxId ? repoGetByKey_('WaxRequests', waxId, 'WaxRequestID') : Wax.getLatestByRoot(task.RootApptID);
  if (!current.ok) {
    return current;
  }
  var updated = Wax.update(current.data.WaxRequestID, {
    RequestStatus: payload.RequestStatus || payload.requestStatus || current.data.RequestStatus,
    AdminDeadline: payload.AdminDeadline || payload.adminDeadline || current.data.AdminDeadline,
    RequestUrl: payload.RequestUrl || payload.requestUrl || current.data.RequestUrl,
    Notes: payload.Notes || payload.notes || current.data.Notes || '',
  }, payload.waxVersion || current.version);
  return updated.ok ? serviceOk_(updated.data, updated.version, updated.invalidated) : updated;
}

function taskCompletionAppointmentChecklist_(task, payload) {
  var outcome = payload.outcome || payload.Outcome || APPOINTMENT_STATUS.COMPLETED;
  var result = Appointments.recordOutcome(task.APPT_ID, outcome);
  if (!result.ok) {
    return result;
  }
  var requirements = taskCompletionArtifactRequirements_(task, payload);
  var failedRequirement = requirements.filter(function(requirement) {
    return !requirement.ok;
  })[0];
  if (failedRequirement) {
    return failedRequirement;
  }
  return serviceOk_({
    appointment: result.data,
    requirements: requirements,
  }, result.version, serviceCollectInvalidations_(result, requirements.map(function(requirement) {
    return requirement.invalidated || [];
  })));
}

function taskCompletionApproveRecap_(task, payload) {
  var artifactId = payload.ArtifactID || payload.artifactId || (task.PayloadJson || {}).artifactId;
  if (!artifactId) {
    return serviceError_('missing_artifact_id');
  }
  var artifact = Artifacts.getByRoot(task.RootApptID).data.filter(function(row) {
    return row.ArtifactID === artifactId;
  })[0];
  var approved = Artifacts.markApproved(artifactId, {}, payload.artifactVersion || artifact && artifact.Version || null);
  return approved.ok ? serviceOk_(approved.data, approved.version, approved.invalidated) : approved;
}

function taskCompletionFinalRecap_(task, payload) {
  var artifactId = payload.ArtifactID || payload.artifactId || (task.PayloadJson || {}).artifactId;
  if (!artifactId) {
    return serviceError_('missing_artifact_id');
  }
  var artifact = Artifacts.getByRoot(task.RootApptID).data.filter(function(row) {
    return row.ArtifactID === artifactId;
  })[0];
  var handoff = Artifacts.markHandoff(artifactId, {}, payload.artifactVersion || artifact && artifact.Version || null);
  return handoff.ok ? serviceOk_(handoff.data, handoff.version, handoff.invalidated) : handoff;
}

function taskCompletionDiamond_(task, payload) {
  var stoneIds = taskCompletionStoneIds_(payload);
  if (task.TaskType === TASK_TYPE.PROPOSE_DIAMONDS) {
    return DiamondService.submitProposal(task.RootApptID, mergeObjects_(payload, {
      stones: payload.stones || taskCompletionStoneIds_(payload).map(function(stoneId) {
        return { CertNo: stoneId };
      }),
    }), payload.diamondViewingVersion || null);
  }
  if (task.TaskType === TASK_TYPE.ORDER_DIAMONDS) {
    return DiamondService.submitOrderApproval(stoneIds, mergeObjects_(payload.fields || {}, {
      rejectedStoneIds: payload.rejectedStoneIds || payload.rejectedCertNos || payload.rejectedStoneIDs || [],
    }));
  }
  if (task.TaskType === TASK_TYPE.TRACK_DIAMONDS) {
    var tracking = Stones.updateTracking(stoneIds, payload.fields || payload);
    return tracking.ok ? serviceOk_({
      stones: tracking.data,
      tracker: null,
      trackerLogPending: {
        rootApptId: task.RootApptID,
        eventType: TASK_TYPE.TRACK_DIAMONDS,
        notes: payload.Notes || payload.notes || '',
        stoneIds: stoneIds,
      },
    }, tracking.version, serviceCollectInvalidations_(tracking)) : tracking;
  }
  if (task.TaskType === TASK_TYPE.CONFIRM_DIAMOND_DELIVERY) {
    return Stones.markDelivered(stoneIds, payload.fields || payload);
  }
  if (task.TaskType === TASK_TYPE.RECORD_DIAMOND_DECISIONS) {
    return Stones.recordDecisions(task.RootApptID, payload.decisions || []);
  }
  if (task.TaskType === TASK_TYPE.RETURN_DIAMONDS) {
    return Stones.markReturnInProgress(stoneIds, payload.ReturnNotes || payload.notes || '');
  }
  return serviceOk_({
    taskType: task.TaskType,
    acknowledged: true,
  }, null, []);
}

function taskCompletionRunPostCommit_(result) {
  if (!result || !result.ok || !result.data || !result.data.dispatch || !result.data.dispatch.trackerLogPending) {
    return result;
  }
  var pending = result.data.dispatch.trackerLogPending;
  try {
    var trackerLog = Tracker.appendLog(pending.rootApptId, {
      EventType: pending.eventType,
      Notes: pending.notes || '',
      StoneIDs: (pending.stoneIds || []).join(','),
    });
    result.data.dispatch.tracker = trackerLog.ok ? trackerLog.data : null;
    if (!trackerLog.ok) {
      result.data.dispatch.trackerWarning = trackerLog.reason || 'tracker_log_failed';
    }
  } catch (err) {
    result.data.dispatch.trackerWarning = err.message || String(err);
  }
  delete result.data.dispatch.trackerLogPending;
  return result;
}

function taskCompletionArtifactRequirements_(task, payload) {
  var raw = payload.artifactRequirements || payload.requirements || [];
  if (!raw) {
    return [];
  }
  if (!Array.isArray(raw)) {
    raw = [raw];
  }
  return raw.map(function(requirement) {
    var fields = typeof requirement === 'string' ? {
      ArtifactType: requirement,
    } : requirement || {};
    var type = fields.ArtifactType || fields.artifactType || fields.type || 'recording';
    return Artifacts.markRequirement(task.RootApptID, task.APPT_ID, type, mergeObjects_(fields, {
      TaskID: task.TaskID,
    }));
  });
}

function taskCompletionIsDiamondTask_(taskType) {
  return [
    TASK_TYPE.PROPOSE_DIAMONDS,
    TASK_TYPE.PREPARE_DV_QUOTATION,
    TASK_TYPE.ORDER_DIAMONDS,
    TASK_TYPE.TRACK_DIAMONDS,
    TASK_TYPE.CONFIRM_DIAMOND_DELIVERY,
    TASK_TYPE.ACK_DIAMONDS_ORDERED_ASSIGNED_REP,
    TASK_TYPE.ACK_DIAMONDS_ORDERED_JOC,
    TASK_TYPE.RECORD_DIAMOND_DECISIONS,
    TASK_TYPE.RETURN_DIAMONDS,
    TASK_TYPE.REVIEW_DIAMOND_ETA_ASSIGNED_REP,
    TASK_TYPE.REVIEW_DIAMOND_ETA_JOC,
  ].indexOf(taskType) !== -1;
}
