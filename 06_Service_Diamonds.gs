const DiamondService = Object.freeze({
  submitProposal: function(rootApptId, payload, version) {
    return diamondSubmitProposal_(rootApptId, payload || {}, version);
  },
  submitOrderApproval: function(stoneIds, version) {
    return diamondSubmitOrderApproval_(stoneIds, version);
  },
  assignInStock: function(stoneId, rootApptId, fields) {
    return diamondAssignInStock_(stoneId, rootApptId, fields || {});
  },
  submitConfirmDelivery: function(stoneIds, version) {
    return diamondSubmitConfirmDelivery_(stoneIds, version);
  },
  submitDecisions: function(rootApptId, decisions, version) {
    return diamondSubmitDecisions_(rootApptId, decisions || [], version);
  },
  bulkMarkReturnInProgress: function(stoneIds) {
    return diamondBulkMarkReturnInProgress_(stoneIds);
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
  var assignments = (payload.stones || []).map(function(stone) {
    return Stones.assign(stone.StoneID || stone.stoneId, rootApptId, mergeObjects_(stone, {
      StoneStatus: 'Proposed',
    }));
  });
  return serviceOk_({
    diamondViewing: dv.data,
    assignments: assignments,
  }, dv.version, serviceCollectInvalidations_(dv, assignments.map(function(row) { return row.invalidated || []; })));
}

function diamondSubmitOrderApproval_(stoneIds, version) {
  var result = Stones.markOrdered(stoneIds, {
    ApprovedVersion: version || '',
  });
  if (!result.ok) {
    return result;
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondAssignInStock_(stoneId, rootApptId, fields) {
  var result = Stones.assign(stoneId, rootApptId, fields);
  if (!result.ok) {
    return result;
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}

function diamondSubmitConfirmDelivery_(stoneIds, version) {
  var result = Stones.markDelivered(stoneIds, {
    ConfirmedVersion: version || '',
  });
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

function diamondBulkMarkReturnInProgress_(stoneIds) {
  var result = Stones.markReturnInProgress(stoneIds);
  if (!result.ok) {
    return result;
  }
  return serviceOk_(result.data, result.version, result.invalidated);
}
