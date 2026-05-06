const RootAppointments = Object.freeze({
  get: function(rootApptId) {
    return repoGetByKey_('RootAppointments', rootApptId, 'RootApptID');
  },
  create: function(root) {
    return repoAppend_('RootAppointments', root);
  },
  updateCurrentAppointment: function(rootApptId, apptId, version) {
    return repoUpdateByKey_('RootAppointments', rootApptId, {
      CurrentAPPT_ID: apptId,
      LatestAPPT_ID: apptId,
      LastActivityAt: new Date(),
    }, version, 'RootApptID');
  },
});
