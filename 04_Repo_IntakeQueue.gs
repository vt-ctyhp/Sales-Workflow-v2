const IntakeQueue = Object.freeze({
  enqueue: function(payload) {
    var normalized = IntakeNormalize.normalize(payload || {});
    return repoAppend_('IntakeQueue', {
      IntakeID: repoGeneratedId_('IntakeID'),
      Status: 'queued',
      BookingSource: normalized.bookingSource,
      ExternalBookingId: normalized.externalBookingId,
      Action: normalized.action,
      PayloadHash: IntakeNormalize.payloadHash(normalized),
      PayloadJson: normalized,
      Error: '',
      ResultJson: {},
    });
  },
  markProcessed: function(intakeId, result, version) {
    return repoUpdateByKey_('IntakeQueue', intakeId, {
      Status: 'processed',
      ResultJson: result || {},
      Error: '',
      ProcessedAt: new Date(),
    }, version || null, 'IntakeID');
  },
  markError: function(intakeId, error, version) {
    return repoUpdateByKey_('IntakeQueue', intakeId, {
      Status: 'error',
      Error: error && error.message || String(error || 'unknown_error'),
      ProcessedAt: new Date(),
    }, version || null, 'IntakeID');
  },
  listPending: function(limit) {
    var started = Date.now();
    var rows = (repoReadAll_('IntakeQueue').data || []).filter(function(row) {
      return row.Status === 'queued';
    }).slice(0, Number(limit || 25));
    return repoReadResponse_(rows, null, started);
  },
});
