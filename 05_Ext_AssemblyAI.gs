const AssemblyAI = Object.freeze({
  startTranscription: function(driveFileId) {
    var transcript = {
      TranscriptID: extGeneratedId_('transcript'),
      DriveFileID: driveFileId,
      Status: 'queued',
      CreatedAt: extNow_(),
      PollCount: 0,
      Text: '',
    };
    extAppendRow_('assemblyAiTranscripts', transcript);
    return extMutationResponse_(transcript, []);
  },
  pollTranscription: function(transcriptId) {
    var updated = extUpdateRows_('assemblyAiTranscripts', function(row) {
      return row.TranscriptID === transcriptId;
    }, function(row) {
      var pollCount = Number(row.PollCount || 0) + 1;
      return mergeObjects_(row, {
        PollCount: pollCount,
        Status: pollCount >= 1 ? 'completed' : 'processing',
        Text: pollCount >= 1 ? 'Phase 3 sample transcript for ' + row.DriveFileID : row.Text,
        UpdatedAt: extNow_(),
      });
    });
    return updated.length ? extResponse_(updated[0], null) : extNotFound_();
  },
});
