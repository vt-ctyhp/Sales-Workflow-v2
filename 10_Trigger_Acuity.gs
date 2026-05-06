const TriggerAcuity = Object.freeze({
  acuityPoll: function() {
    return phaseNotImplemented_('Trigger.acuityPoll');
  },
  acuityLabelSync: function() {
    return phaseNotImplemented_('Trigger.acuityLabelSync');
  },
});

function triggerAcuityPoll() {
  return TriggerAcuity.acuityPoll();
}

function triggerAcuityLabelSync() {
  return TriggerAcuity.acuityLabelSync();
}
