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
});
