const ApiPayments = Object.freeze({
  init: function(rootApptId, context) {
    return apiCall_('Api.payments.init', context, function() {
      return PaymentService.init(rootApptId);
    }, { target: rootApptId });
  },
  submit: function(rootApptId, payload, version, context) {
    return apiCall_('Api.payments.submit', context, function() {
      return PaymentService.submit(rootApptId, payload || {}, version);
    }, { target: rootApptId });
  },
  history: function(rootApptId, context) {
    return apiCall_('Api.payments.history', context, function() {
      return DashboardService.paymentHistory(rootApptId);
    }, { target: rootApptId });
  },
  exportPdf: function(paymentId, context) {
    return apiCall_('Api.payments.exportPdf', context, function(user) {
      return DashboardService.paymentExportPdf(paymentId, user);
    }, { target: paymentId });
  },
  reset: function(rootApptId, version, context) {
    return apiCall_('Api.payments.reset', context, function(user) {
      return DashboardService.paymentReset(rootApptId, version, user);
    }, { target: rootApptId });
  },
});
