const DiamondService = Object.freeze({
  submitProposal: function(rootApptId, payload, version) {
    return diamondSubmitProposal_(rootApptId, payload || {}, version);
  },
  submitOrderApproval: function(stoneIds, fields) {
    return diamondSubmitOrderApproval_(stoneIds, fields || {});
  },
  assignInStock: function(stoneId, rootApptId, fields, version) {
    return diamondAssignInStock_(stoneId, rootApptId, fields || {}, version);
  },
  submitConfirmDelivery: function(stoneIds, fields) {
    return diamondSubmitConfirmDelivery_(stoneIds, fields || {});
  },
  submitDecisions: function(rootApptId, decisions, version) {
    return diamondSubmitDecisions_(rootApptId, decisions || [], version);
  },
  bulkReturnCandidates: function(filters) {
    return Stones.list(mergeObjects_({
      returnEligible: true,
    }, filters || {}));
  },
  bulkMarkReturnInProgress: function(stoneIds, notes) {
    return diamondBulkMarkReturnInProgress_(stoneIds, notes);
  },
  previewLoupe360Sync: function(fileId, sourceRows) {
    return Stones.previewLoupe360Sync(fileId, sourceRows || []);
  },
  applyLoupe360Sync: function(syncId, plan) {
    return diamondApplyLoupe360Sync_(syncId, plan || null);
  },
});

function diamondSubmitProposal_(rootApptId, payload, version) {
  var dv = DiamondViewing.update(rootApptId, {
    WorkflowState: 'Proposal Submitted',
    LookingForSummary: payload.LookingForSummary || payload.lookingForSummary || '',
    VarietyStrategy: payload.VarietyStrategy || payload.varietyStrategy || '',
    LastProposalAt: new Date(),
  }, version);
  if (!dv.ok) {
    return dv;
  }
  var assignments = Stones.upsertProposed(rootApptId, payload.stones || [], null);
  return serviceOk_({
    diamondViewing: dv.data,
    assignments: assignments,
  }, dv.version, serviceCollectInvalidations_(dv, assignments));
}

function diamondSubmitOrderApproval_(stoneIds, fields) {
  var result = Stones.markOrdered(stoneIds, fields || {});
  if (!result.ok) {
    return result;
  }
  var rejected = [];
  var rejectedIds = (fields && (fields.rejectedStoneIds || fields.rejectedCertNos || fields.rejectedStoneIDs)) || [];
  if (rejectedIds && rejectedIds.length) {
    var rejectedResult = Stones.markNotApproved(rejectedIds, fields || {});
    if (!rejectedResult.ok) {
      return rejectedResult;
    }
    rejected = rejectedResult.data.updated || [];
    return serviceOk_({
      ordered: result.data,
      rejected: rejected,
    }, result.version, serviceCollectInvalidations_(result, rejectedResult));
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondAssignInStock_(stoneId, rootApptId, fields, version) {
  var result = Stones.assignInStock(stoneId, rootApptId, fields, version);
  if (!result.ok) {
    return result;
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondSubmitConfirmDelivery_(stoneIds, fields) {
  var result = Stones.markDelivered(stoneIds, fields || {});
  if (!result.ok) {
    return result;
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondSubmitDecisions_(rootApptId, decisions, version) {
  var stones = Stones.recordDecisions(rootApptId, decisions);
  if (!stones.ok) {
    return stones;
  }
  var dv = DiamondViewing.get(rootApptId);
  var dvUpdate = dv.ok ? DiamondViewing.update(rootApptId, {
    WorkflowState: 'Decisions Recorded',
    DecisionsRecordedAt: new Date(),
  }, version || dv.version) : { ok: true, invalidated: [] };
  if (!dvUpdate.ok) {
    return dvUpdate;
  }
  return serviceOk_({
    stones: stones.data,
    diamondViewing: dvUpdate.data || null,
  }, dvUpdate.version || null, serviceCollectInvalidations_(stones, dvUpdate));
}

function diamondBulkMarkReturnInProgress_(stoneIds, notes) {
  var result = Stones.markReturnInProgress(stoneIds, notes);
  if (!result.ok) {
    return result;
  }
  var logs = diamondAppendBulkReturnLogs_(result.data.updated || [], notes);
  return serviceOk_(mergeObjects_(result.data, {
    taskLogs: logs,
  }), result.version, serviceCollectInvalidations_(result, logs.map(function(log) {
    return log.invalidated || [];
  })));
}

function diamondApplyLoupe360Sync_(syncId, plan) {
  var result = Stones.applyLoupe360Sync(syncId, plan || null);
  if (!result.ok) {
    return result;
  }
  var sync = result.data && result.data.sync || {};
  return serviceOk_(mergeObjects_(result.data || {}, {
    syncId: sync.SyncID || syncId || '',
    sourceRows: Number(sync.SourceRows || 0),
    matched: Number(sync.Matched || 0),
    updated: Number(sync.Updated || 0),
    appended: Number(sync.Appended || 0),
    skipped: Number(sync.Skipped || 0),
    conflicts: sync.ConflictsJson || [],
  }), result.version || null, result.invalidated || []);
}

function diamondAppendBulkReturnLogs_(updates, notes) {
  return (updates || []).map(function(update) {
    var stone = update && update.data || {};
    return Tasks.appendLog({
      TaskID: 'bulk_return_' + (stone.CertNo || serviceGeneratedId_('stone')),
      RootApptID: stone.AssignedRootApptID || '',
      EventType: TASK_TYPE.RETURN_DIAMONDS,
      OldState: '',
      NewState: 'Return In Progress',
      Notes: typeof notes === 'string' ? notes : notes && (notes.notes || notes.ReturnNotes) || '',
      MetadataJson: {
        bulkReturn: true,
        certNo: stone.CertNo || '',
      },
    });
  });
}
