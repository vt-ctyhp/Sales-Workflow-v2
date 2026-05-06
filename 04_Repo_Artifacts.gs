const Artifacts = Object.freeze({
  getByRoot: function(rootApptId) {
    return repoFindMany_('AppointmentArtifacts', { RootApptID: rootApptId });
  },
  registerUpload: function(artifact) {
    return repoAppend_('AppointmentArtifacts', artifact);
  },
  markApproved: function(artifactId, fields, version) {
    return repoUpdateByKey_('AppointmentArtifacts', artifactId, mergeObjects_({
      WorkflowStage: ARTIFACT_STAGE.APPROVED,
      ApprovedAt: new Date(),
      ApprovedByEmail: getActiveUserEmail_(),
    }, fields || {}), version, 'ArtifactID');
  },
});
