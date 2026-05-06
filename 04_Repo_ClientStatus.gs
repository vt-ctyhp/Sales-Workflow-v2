const ClientStatus = Object.freeze({
  get: function(rootApptId) {
    return phaseNotImplemented_('ClientStatus.get');
  },
  update: function(rootApptId, fields, version) {
    return phaseNotImplemented_('ClientStatus.update');
  },
  updateDeadline: function(rootApptId, fields, version) {
    return phaseNotImplemented_('ClientStatus.updateDeadline');
  },
  appendHistory: function(entry) {
    return phaseNotImplemented_('ClientStatus.appendHistory');
  },
});
