const ApiArtifacts = Object.freeze({
  uploadFolder: function(taskId, artifactType, context) {
    return apiCall_('Api.artifacts.uploadFolder', context, function() {
      return ArtifactService.uploadFolder(taskId, artifactType);
    }, { target: taskId });
  },
  syncDriveUploads: function(taskId, context) {
    return apiCall_('Api.artifacts.syncDriveUploads', context, function() {
      return ArtifactService.syncDriveUploads(taskId);
    }, { target: taskId });
  },
  getBrief: function(rootApptId, context) {
    return apiCall_('Api.artifacts.getBrief', context, function() {
      return DashboardService.artifactBrief(rootApptId);
    }, { target: rootApptId });
  },
});
