const TriggerMaintenance = Object.freeze({
  urlRepair: function() {
    return triggerUrlRepair_();
  },
  driftCheck: function() {
    return triggerDriftCheck_();
  },
});

function triggerUrlRepair() {
  return executionSafeResponse_(TriggerMaintenance.urlRepair());
}

function triggerDriftCheck() {
  return executionSafeResponse_(TriggerMaintenance.driftCheck());
}

function triggerUrlRepair_() {
  var invalidated = CacheSlices.invalidate([
    CACHE_SLICE.APPOINTMENT_BRIEF,
    CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
    CACHE_SLICE.PAYMENT_SUMMARY,
    CACHE_SLICE.ADMIN_HEALTH,
  ], {
    reason: 'url_repair_tick',
  });
  appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
    functionName: 'Trigger.urlRepair',
    tier: 'B',
    result: invalidated.ok ? 'ok' : 'error',
    message: 'URL repair tick completed',
    target: 'url_repair',
    metadata: {
      invalidated: invalidated.invalidated || [],
    },
  });
  return serviceOk_({
    repaired: 0,
    invalidated: invalidated.invalidated || [],
    message: 'No URL repair rules currently require row mutation.',
  }, null, invalidated.invalidated || []);
}

function triggerDriftCheck_() {
  var report = DriftCheck.run();
  appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
    functionName: 'Trigger.driftCheck',
    tier: 'B',
    result: report.ok ? 'ok' : 'error',
    message: report.ok ? 'Drift check passed' : report.errors.join('; '),
    target: 'drift',
    metadata: {
      checkedAt: report.checkedAt,
      errorCount: report.errors.length,
    },
  });
  return report;
}
