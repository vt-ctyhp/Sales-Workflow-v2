const Tasks = Object.freeze({
  get: function(taskId) {
    return phaseNotImplemented_('Tasks.get');
  },
  upsert: function(task) {
    return phaseNotImplemented_('Tasks.upsert');
  },
  complete: function(taskId, fields, version) {
    return phaseNotImplemented_('Tasks.complete');
  },
  appendLog: function(entry) {
    return phaseNotImplemented_('Tasks.appendLog');
  },
});
