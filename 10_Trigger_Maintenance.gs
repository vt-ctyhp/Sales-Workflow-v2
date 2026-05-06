const TriggerMaintenance = Object.freeze({
  urlRepair: function() {
    return phaseNotImplemented_('Trigger.urlRepair');
  },
  driftCheck: function() {
    return phaseNotImplemented_('Trigger.driftCheck');
  },
});

function triggerUrlRepair() {
  return TriggerMaintenance.urlRepair();
}

function triggerDriftCheck() {
  return TriggerMaintenance.driftCheck();
}
