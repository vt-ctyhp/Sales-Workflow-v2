const ApiDiamonds = Object.freeze({
  inStock: function(filters, context) {
    return apiCall_('Api.diamonds.inStock', context, function() {
      return CacheSlices.diamondInventory(filters || {});
    });
  },
  tracking: function(filters, context) {
    return apiCall_('Api.diamonds.tracking', context, function() {
      return CacheSlices.diamondTracking(filters || {});
    });
  },
  bulkReturnCandidates: function(filters, context) {
    return apiCall_('Api.diamonds.bulkReturnCandidates', context, function() {
      return DiamondService.bulkReturnCandidates(filters || {});
    });
  },
  bulkMarkReturnInProgress: function(stoneIds, notes, version, context) {
    return apiCall_('Api.diamonds.bulkMarkReturnInProgress', context, function() {
      return DiamondService.bulkMarkReturnInProgress(stoneIds || [], notes || '');
    }, { target: (stoneIds || []).join(',') });
  },
  assignInStock: function(stoneId, rootApptId, fields, version, context) {
    return apiCall_('Api.diamonds.assignInStock', context, function() {
      return DiamondService.assignInStock(stoneId, rootApptId, fields || {}, version);
    }, { target: stoneId });
  },
  byRoot: function(rootApptId, context) {
    return apiCall_('Api.diamonds.byRoot', context, function() {
      return CacheSlices.diamondRoot(rootApptId);
    }, { target: rootApptId });
  },
  submitProposal: function(rootApptId, payload, version, context) {
    return apiCall_('Api.diamonds.submitProposal', context, function() {
      return DiamondService.submitProposal(rootApptId, payload || {}, version);
    }, { target: rootApptId });
  },
  submitOrderApproval: function(stoneIds, fields, context) {
    return apiCall_('Api.diamonds.submitOrderApproval', context, function() {
      return DiamondService.submitOrderApproval(stoneIds || [], fields || {});
    }, { target: (stoneIds || []).join(',') });
  },
  submitConfirmDelivery: function(stoneIds, fields, context) {
    return apiCall_('Api.diamonds.submitConfirmDelivery', context, function() {
      return DiamondService.submitConfirmDelivery(stoneIds || [], fields || {});
    }, { target: (stoneIds || []).join(',') });
  },
  submitDecisions: function(rootApptId, decisions, version, context) {
    return apiCall_('Api.diamonds.submitDecisions', context, function() {
      return DiamondService.submitDecisions(rootApptId, decisions || [], version);
    }, { target: rootApptId });
  },
  previewLoupe360Sync: function(fileId, sourceRows, context) {
    if (apiIsContext_(sourceRows)) {
      context = sourceRows;
      sourceRows = [];
    }
    return apiCall_('Api.diamonds.previewLoupe360Sync', context, function() {
      return DiamondService.previewLoupe360Sync(fileId, sourceRows || []);
    }, { target: fileId });
  },
  applyLoupe360Sync: function(syncId, plan, context) {
    if (apiIsContext_(plan)) {
      context = plan;
      plan = null;
    }
    return apiCall_('Api.diamonds.applyLoupe360Sync', context, function() {
      return DiamondService.applyLoupe360Sync(syncId, plan || null);
    }, { target: syncId });
  },
});
