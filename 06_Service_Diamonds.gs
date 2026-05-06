const DiamondService = Object.freeze({
  submitProposal: function(rootApptId, payload, version) {
    return diamondSubmitProposal_(rootApptId, payload || {}, version);
  },
  submitOrderApproval: function(stoneIds, fields) {
    return diamondSubmitOrderApproval_(stoneIds, fields || {});
  },
  assignInStock: function(stoneId, rootApptId, fields) {
    return diamondAssignInStock_(stoneId, rootApptId, fields || {});
  },
  submitConfirmDelivery: function(stoneIds, fields) {
    return diamondSubmitConfirmDelivery_(stoneIds, fields || {});
  },
  submitDecisions: function(rootApptId, decisions, version) {
    return diamondSubmitDecisions_(rootApptId, decisions || [], version);
  },
  bulkMarkReturnInProgress: function(stoneIds, notes) {
    return diamondBulkMarkReturnInProgress_(stoneIds, notes);
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
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondAssignInStock_(stoneId, rootApptId, fields) {
  var result = Stones.assignInStock(stoneId, rootApptId, fields);
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
  return serviceOk_(result.data, result.version, result.invalidated);
}
