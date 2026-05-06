const TriggerTaskGen = Object.freeze({
  taskGen: function() {
    return TaskGen.runTick(TASK_GEN_TRIGGER_BATCH_SIZE);
  },
  cachePrewarm: function() {
    return CacheSlices.prewarm();
  },
});

function triggerTaskGen() {
  return executionSafeResponse_(TriggerTaskGen.taskGen());
}

function triggerCachePrewarm() {
  return executionSafeResponse_(TriggerTaskGen.cachePrewarm());
}
