const ApiDiamonds = Object.freeze({
  inStock: function(filters) {
    return phaseNotImplemented_('Api.diamonds.inStock');
  },
  tracking: function() {
    return phaseNotImplemented_('Api.diamonds.tracking');
  },
  bulkReturnCandidates: function() {
    return phaseNotImplemented_('Api.diamonds.bulkReturnCandidates');
  },
  bulkMarkReturnInProgress: function(stoneIds, version) {
    return phaseNotImplemented_('Api.diamonds.bulkMarkReturnInProgress');
  },
  assignInStock: function(stoneId, rootApptId, version) {
    return phaseNotImplemented_('Api.diamonds.assignInStock');
  },
  submitProposal: function(rootApptId, payload, version) {
    return phaseNotImplemented_('Api.diamonds.submitProposal');
  },
  submitOrderApproval: function(stoneIds, version) {
    return phaseNotImplemented_('Api.diamonds.submitOrderApproval');
  },
  submitConfirmDelivery: function(stoneIds, version) {
    return phaseNotImplemented_('Api.diamonds.submitConfirmDelivery');
  },
  submitDecisions: function(rootApptId, decisions, version) {
    return phaseNotImplemented_('Api.diamonds.submitDecisions');
  },
  previewLoupe360Sync: function(fileId) {
    return phaseNotImplemented_('Api.diamonds.previewLoupe360Sync');
  },
  applyLoupe360Sync: function(fileId, plan) {
    return phaseNotImplemented_('Api.diamonds.applyLoupe360Sync');
  },
});
