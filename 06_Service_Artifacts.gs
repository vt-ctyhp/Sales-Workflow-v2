const ArtifactService = Object.freeze({
  uploadFolder: function(taskId, artifactType) {
    return artifactUploadFolder_(taskId, artifactType);
  },
  syncDriveUploads: function(taskId) {
    return artifactSyncDriveUploads_(taskId);
  },
  processTick: function() {
    return artifactProcessTick_();
  },
});

function artifactUploadFolder_(taskId, artifactType) {
  var task = Tasks.get(taskId);
  if (!task.ok) {
    return task;
  }
  var folder = DriveExt.ensureFolder(task.data.RootApptID || '', 'Artifacts ' + (task.data.RootApptID || taskId));
  if (!folder.ok) {
    return folder;
  }
  return serviceOk_({
    taskId: taskId,
    artifactType: artifactType,
    folderId: folder.data.FolderID,
    folderUrl: folder.data.Url,
  }, null, []);
}

function artifactSyncDriveUploads_(taskId) {
  var task = Tasks.get(taskId);
  if (!task.ok) {
    return task;
  }
  var folder = artifactUploadFolder_(taskId, 'recording');
  if (!folder.ok) {
    return folder;
  }
  var files = DriveExt.listNewFiles(folder.data.folderId, null);
  if (!files.ok) {
    return files;
  }
  var existing = Artifacts.getByRoot(task.data.RootApptID);
  var existingByFile = {};
  if (existing.ok) {
    existing.data.forEach(function(artifact) {
      existingByFile[artifact.DriveFileId] = true;
    });
  }
  var registered = files.data.filter(function(file) {
    return !existingByFile[file.FileID];
  }).map(function(file) {
    return Artifacts.registerUpload({
      RootApptID: task.data.RootApptID,
      APPT_ID: task.data.APPT_ID,
      TaskID: taskId,
      ArtifactType: 'recording',
      WorkflowStage: ARTIFACT_STAGE.UPLOADED,
      DriveFileId: file.FileID,
      DriveFileUrl: file.Url,
      DriveFolderId: folder.data.folderId,
      Attempts: 0,
      MetadataJson: {
        fileName: file.Name,
      },
    });
  });
  return serviceOk_({
    taskId: taskId,
    registered: registered,
    count: registered.length,
  }, null, [CACHE_SLICE.APPOINTMENT_BRIEF, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
}

function artifactProcessTick_() {
  var rows = repoReadAll_('AppointmentArtifacts');
  if (!rows.ok) {
    return rows;
  }
  var processed = [];
  var failures = [];
  rows.data.forEach(function(artifact) {
    if ([ARTIFACT_STAGE.UPLOADED, ARTIFACT_STAGE.TRANSCRIPTION_QUEUED, ARTIFACT_STAGE.TRANSCRIBING, ARTIFACT_STAGE.TRANSCRIPT_READY].indexOf(artifact.WorkflowStage) === -1) {
      return;
    }
    var result = artifactProcessOne_(artifact);
    processed.push(result);
    if (!result.ok) {
      failures.push(result);
    }
  });
  return serviceOk_({
    processed: processed.length,
    failures: failures,
    results: processed,
  }, null, [CACHE_SLICE.APPOINTMENT_BRIEF, CACHE_SLICE.CUSTOMER_ROOT_DETAIL, CACHE_SLICE.TASK_LIST]);
}

function artifactProcessOne_(artifact) {
  try {
    if (artifact.WorkflowStage === ARTIFACT_STAGE.UPLOADED) {
      var started = AssemblyAI.startTranscription(artifact.DriveFileId);
      if (!started.ok) {
        return artifactProcessFailure_(artifact, started.reason || 'transcription_start_failed');
      }
      return Artifacts.update(artifact.ArtifactID, {
        WorkflowStage: ARTIFACT_STAGE.TRANSCRIPTION_QUEUED,
        TranscriptId: started.data.TranscriptID,
        MetadataJson: mergeObjects_(artifact.MetadataJson || {}, {
          transcriptionStartedAt: new Date(),
        }),
      }, artifact.Version);
    }
    if (artifact.WorkflowStage === ARTIFACT_STAGE.TRANSCRIPTION_QUEUED || artifact.WorkflowStage === ARTIFACT_STAGE.TRANSCRIBING) {
      var polled = AssemblyAI.pollTranscription(artifact.TranscriptId);
      if (!polled.ok) {
        return artifactProcessFailure_(artifact, polled.reason || 'transcription_poll_failed');
      }
      if (polled.data.Status !== 'completed') {
        return Artifacts.update(artifact.ArtifactID, {
          WorkflowStage: ARTIFACT_STAGE.TRANSCRIBING,
          MetadataJson: mergeObjects_(artifact.MetadataJson || {}, {
            transcriptStatus: polled.data.Status,
          }),
        }, artifact.Version);
      }
      return Artifacts.update(artifact.ArtifactID, {
        WorkflowStage: ARTIFACT_STAGE.TRANSCRIPT_READY,
        TranscriptDocUrl: 'https://docs.google.com/document/d/' + polled.data.TranscriptID,
        MetadataJson: mergeObjects_(artifact.MetadataJson || {}, {
          transcriptText: polled.data.Text,
        }),
      }, artifact.Version);
    }
    if (artifact.WorkflowStage === ARTIFACT_STAGE.TRANSCRIPT_READY) {
      var customer = CustomerInfo.get(artifact.RootApptID);
      var summary = OpenAIExt.summarizeTranscript((artifact.MetadataJson || {}).transcriptText || '', customer.ok ? customer.data : {});
      if (!summary.ok) {
        return artifactProcessFailure_(artifact, summary.reason || 'summary_failed');
      }
      return Artifacts.update(artifact.ArtifactID, {
        WorkflowStage: ARTIFACT_STAGE.SUMMARY_READY,
        SummaryDocUrl: 'https://docs.google.com/document/d/' + artifact.ArtifactID + '_summary',
        SummaryJsonFileId: artifact.ArtifactID + '_summary_json',
        MetadataJson: mergeObjects_(artifact.MetadataJson || {}, {
          summary: summary.data,
        }),
      }, artifact.Version);
    }
    return serviceOk_(artifact, artifact.Version, []);
  } catch (err) {
    return artifactProcessFailure_(artifact, err.message);
  }
}

function artifactProcessFailure_(artifact, reason) {
  var attempts = Number(artifact.Attempts || 0) + 1;
  return Artifacts.update(artifact.ArtifactID, {
    Attempts: attempts,
    LastError: reason,
    WorkflowStage: attempts >= 3 ? ARTIFACT_STAGE.MANUAL_REVIEW : artifact.WorkflowStage,
  }, artifact.Version);
}
