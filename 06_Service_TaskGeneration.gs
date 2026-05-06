const TaskGen = Object.freeze({
  coreAppointmentTasks: function(appointment, status, artifacts) {
    return phaseNotImplemented_('TaskGen.coreAppointmentTasks');
  },
  postConsultTasks: function(appointment, status, order3d) {
    return phaseNotImplemented_('TaskGen.postConsultTasks');
  },
  diamondTasks: function(appointment, dv, stones) {
    return phaseNotImplemented_('TaskGen.diamondTasks');
  },
  dataCleanupTasks: function(root, customerInfo, status) {
    return phaseNotImplemented_('TaskGen.dataCleanupTasks');
  },
  diff: function(desired, current) {
    return phaseNotImplemented_('TaskGen.diff');
  },
});
