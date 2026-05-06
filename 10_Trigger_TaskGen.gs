const TriggerTaskGen = Object.freeze({
  taskGen: function() {
    return phaseNotImplemented_('Trigger.taskGen');
  },
  cachePrewarm: function() {
    return phaseNotImplemented_('Trigger.cachePrewarm');
  },
});

function triggerTaskGen() {
  return TriggerTaskGen.taskGen();
}

function triggerCachePrewarm() {
  return TriggerTaskGen.cachePrewarm();
}
