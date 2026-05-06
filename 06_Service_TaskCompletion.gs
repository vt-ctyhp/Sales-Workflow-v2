const TaskCompletion = Object.freeze({
  complete: function(taskId, payload, version) {
    return taskCompletionComplete_(taskId, payload || {}, version);
  },
});

function taskCompletionComplete_(taskId, payload, version) {
  return DocLock.withUserWriteLock(function() {
    var taskRead = Tasks.get(taskId);
    if (!taskRead.ok) {
      return taskRead;
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
    var task = taskRead.data;
    var dispatch = taskCompletionDispatch_(task, payload);
    if (!dispatch.ok) {
      return dispatch;
    }
    var completed = Tasks.complete(taskId, {
      PayloadJson: mergeObjects_(task.PayloadJson || {}, {
        completionPayload: payload,
      }),
    }, taskRead.version);
    if (!completed.ok) {
      return completed;
    }
    var log = serviceTaskLog_(task, 'COMPLETE', task.TaskState, TASK_STATE.COMPLETED, payload.notes || '', {
      dispatch: dispatch.data,
    });
    return serviceOk_({
      task: completed.data,
      dispatch: dispatch.data,
      log: log.ok ? log.data : null,
    }, completed.version, serviceCollectInvalidations_(dispatch, completed, log, task.InvalidatesJson || [], [CACHE_SLICE.TASK_LIST, CACHE_SLICE.TASK_DETAIL, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]));
  }, {
    functionName: 'TaskCompletion.complete',
    target: taskId,
  });
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
    Deadline3DMoveReason: payload.reason || payload.Deadline3DMoveReason || 'Task completion',
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
    Notes: payload.notes || '',
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
    Notes: payload.notes || current.data.Notes || '',
  }, payload.waxVersion || current.version);
  return updated.ok ? serviceOk_(updated.data, updated.version, updated.invalidated) : updated;
}

function taskCompletionAppointmentChecklist_(task, payload) {
  var outcome = payload.outcome || payload.Outcome || APPOINTMENT_STATUS.COMPLETED;
  var result = Appointments.recordOutcome(task.APPT_ID, outcome);
  return result.ok ? serviceOk_(result.data, result.version, result.invalidated) : result;
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
  var stoneIds = payload.stoneIds || payload.StoneIDs || payload.certNos || payload.CertNos || [];
  if (task.TaskType === TASK_TYPE.PROPOSE_DIAMONDS) {
    return DiamondService.submitProposal(task.RootApptID, payload, payload.diamondViewingVersion || null);
  }
  if (task.TaskType === TASK_TYPE.ORDER_DIAMONDS) {
    return Stones.markOrdered(stoneIds, payload.fields || {});
  }
  if (task.TaskType === TASK_TYPE.TRACK_DIAMONDS) {
    var tracking = Stones.updateTracking(stoneIds, payload.fields || payload);
    var trackerLog = Tracker.appendLog(task.RootApptID, {
      EventType: TASK_TYPE.TRACK_DIAMONDS,
      Notes: payload.notes || '',
      StoneIDs: stoneIds.join(','),
    });
    return tracking.ok ? serviceOk_({
      stones: tracking.data,
      tracker: trackerLog.ok ? trackerLog.data : null,
    }, tracking.version, serviceCollectInvalidations_(tracking, trackerLog)) : tracking;
  }
  if (task.TaskType === TASK_TYPE.CONFIRM_DIAMOND_DELIVERY) {
    return Stones.markDelivered(stoneIds, payload.fields || payload);
  }
  if (task.TaskType === TASK_TYPE.RECORD_DIAMOND_DECISIONS) {
    return Stones.recordDecisions(task.RootApptID, payload.decisions || []);
  }
  if (task.TaskType === TASK_TYPE.RETURN_DIAMONDS) {
    return Stones.markReturnInProgress(stoneIds, payload.notes || payload.ReturnNotes || '');
  }
  return serviceOk_({
    taskType: task.TaskType,
    acknowledged: true,
  }, null, []);
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
