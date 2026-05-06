const ApiAdmin = Object.freeze({
  dashboard: function(filters) {
    return phaseNotImplemented_('Api.admin.dashboard');
  },
  assignOwners: function(rootApptId, advisor, joc, version) {
    return phaseNotImplemented_('Api.admin.assignOwners');
  },
  reassignTask: function(taskId, toUser, version) {
    return phaseNotImplemented_('Api.admin.reassignTask');
  },
  blockTask: function(taskId, reason, version) {
    return phaseNotImplemented_('Api.admin.blockTask');
  },
  unblockTask: function(taskId, version) {
    return phaseNotImplemented_('Api.admin.unblockTask');
  },
});
