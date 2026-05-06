const ApiDiagnostics = Object.freeze({
  benchmarks: function(context) {
    return apiCall_('Api.diag.benchmarks', context, function() {
      return Benchmarks.run();
    });
  },
  driftReport: function(context) {
    return apiCall_('Api.diag.driftReport', context, function() {
      return DriftCheck.run();
    });
  },
  opsLog: function(filters, context) {
    return apiCall_('Api.diag.opsLog', context, function() {
      return DashboardService.opsLog(filters || {});
    });
  },
  triggerStatus: function(context) {
    return apiCall_('Api.diag.triggerStatus', context, function() {
      return SetupTriggers.listTriggers();
    });
  },
  logClientTiming: function(payload, context) {
    return apiCall_('Api.diag.logClientTiming', context, function(user) {
      return diagnosticsLogClientTiming_(payload || {}, user);
    });
  },
});

function diagnosticsLogClientTiming_(payload, user) {
  var metrics = payload.metrics || payload;
  var result = OpsLog.append({
    FunctionName: 'Client.timing',
    Tier: 'UI',
    Result: 'ok',
    Message: payload.view ? 'Client timing for ' + payload.view : 'Client timing',
    Target: payload.view || '',
    ActorEmail: user && user.email || '',
    MetadataJson: {
      view: payload.view || '',
      route: payload.route || '',
      metrics: metrics || {},
      userAgent: payload.userAgent || '',
    },
  });
  return result.ok ? serviceOk_({
    logged: true,
    opsLogId: result.data && result.data.OpsLogID || '',
  }, result.version, []) : result;
}
