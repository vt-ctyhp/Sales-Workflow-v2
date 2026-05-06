const TriggerArtifacts = Object.freeze({
  artifacts: function() {
    return artifactProcessTick_(ARTIFACT_TRIGGER_BATCH_SIZE);
  },
});

function triggerArtifacts() {
  return executionSafeResponse_(TriggerArtifacts.artifacts());
}
