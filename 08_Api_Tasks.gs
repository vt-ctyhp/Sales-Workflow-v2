const ApiTasks = Object.freeze({
  list: function(view) {
    return phaseNotImplemented_('Api.tasks.list');
  },
  detail: function(taskId) {
    return phaseNotImplemented_('Api.tasks.detail');
  },
  complete: function(taskId, payload, version) {
    return phaseNotImplemented_('Api.tasks.complete');
  },
  snooze: function(taskId, until, reason, version) {
    return phaseNotImplemented_('Api.tasks.snooze');
  },
  claim: function(taskId, version) {
    return phaseNotImplemented_('Api.tasks.claim');
  },
  acknowledge: function(taskId, version) {
    return phaseNotImplemented_('Api.tasks.acknowledge');
  },
  logTemplateCopied: function(taskId) {
    return phaseNotImplemented_('Api.tasks.logTemplateCopied');
  },
});
