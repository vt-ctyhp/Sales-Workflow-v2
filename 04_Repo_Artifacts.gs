const Artifacts = Object.freeze({
  getByRoot: function(rootApptId) {
    return repoFindMany_('AppointmentArtifacts', { RootApptID: rootApptId });
  },
  registerUpload: function(artifact) {
    return repoAppend_('AppointmentArtifacts', artifact);
  },
  markRequirement: function(rootApptId, apptId, requirementType, fields) {
    var artifactType = requirementType || fields && (fields.ArtifactType || fields.artifactType) || 'recording';
    var existing = (repoFindMany_('AppointmentArtifacts', { RootApptID: rootApptId }).data || []).filter(function(row) {
      return row.APPT_ID === apptId && row.ArtifactType === artifactType && row.WorkflowStage === ARTIFACT_STAGE.REQUIRED;
    })[0];
    var metadata = mergeObjects_({
      required: true,
      requirementType: artifactType,
    }, existing && existing.MetadataJson || {}, fields && fields.MetadataJson || fields && fields.metadata || {});
    var payload = mergeObjects_({
      RootApptID: rootApptId,
      APPT_ID: apptId,
      ArtifactType: artifactType,
      WorkflowStage: ARTIFACT_STAGE.REQUIRED,
      Attempts: 0,
      MetadataJson: metadata,
    }, fields || {}, {
      MetadataJson: metadata,
    });
    if (existing) {
      return Artifacts.update(existing.ArtifactID, payload, existing.Version);
    }
    return Artifacts.registerUpload(payload);
  },
  update: function(artifactId, fields, version) {
    return repoUpdateByKey_('AppointmentArtifacts', artifactId, fields, version, 'ArtifactID');
  },
  markApproved: function(artifactId, fields, version) {
    return repoUpdateByKey_('AppointmentArtifacts', artifactId, mergeObjects_({
      WorkflowStage: ARTIFACT_STAGE.APPROVED,
      ApprovedAt: new Date(),
      ApprovedByEmail: getActiveUserEmail_(),
    }, fields || {}), version, 'ArtifactID');
  },
  markHandoff: function(artifactId, fields, version) {
    return repoUpdateByKey_('AppointmentArtifacts', artifactId, mergeObjects_({
      WorkflowStage: ARTIFACT_STAGE.JOC_HANDOFF,
      JOCHandoffAt: new Date(),
    }, fields || {}), version, 'ArtifactID');
  },
});
