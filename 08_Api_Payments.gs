const ApiPayments = Object.freeze({
  init: function(rootApptId, context) {
    return apiCall_('Api.payments.init', context, function() {
      return PaymentService.init(rootApptId);
    }, { target: rootApptId });
  },
  validatePrerequisites: function(rootApptId, docType, payload, context) {
    if (apiIsContext_(payload) && context === undefined) {
      context = payload;
      payload = {};
    }
    return apiCall_('Api.payments.validatePrerequisites', context, function() {
      return PaymentService.validatePrerequisites(rootApptId, docType, payload || {});
    }, { target: rootApptId });
  },
  submit: function(rootApptId, payload, version, context) {
    return apiCall_('Api.payments.submit', context, function(user) {
      return PaymentService.submit(rootApptId, payload || {}, version, user);
    }, { target: rootApptId });
  },
  regenerateDoc: function(paymentId, version, context) {
    return apiCall_('Api.payments.regenerateDoc', context, function(user) {
      return PaymentService.regenerateDoc(paymentId, version, user);
    }, { target: paymentId });
  },
  submitCombo: function(rootApptId, payload, version, context) {
    return apiCall_('Api.payments.submitCombo', context, function(user) {
      return PaymentService.submitCombo(rootApptId, payload || {}, version, user);
    }, { target: rootApptId });
  },
  history: function(rootApptId, context) {
    return apiCall_('Api.payments.history', context, function() {
      return PaymentService.history(rootApptId);
    }, { target: rootApptId });
  },
  getDocLinks: function(paymentId, context) {
    return apiCall_('Api.payments.getDocLinks', context, function() {
      return PaymentService.getDocLinks(paymentId);
    }, { target: paymentId });
  },
  exportPdf: function(paymentId, context) {
    return apiCall_('Api.payments.exportPdf', context, function() {
      return PaymentService.exportPdf(paymentId);
    }, { target: paymentId });
  },
  reset: function(rootApptId, version, context) {
    return apiCall_('Api.payments.reset', context, function(user) {
      return DashboardService.paymentReset(rootApptId, version, user);
    }, { target: rootApptId });
  },
  adminVoid: function(paymentId, reason, version, context) {
    return apiCall_('Api.payments.adminVoid', context, function(user) {
      return PaymentService.adminVoid(paymentId, reason || '', version, user);
    }, { target: paymentId });
  },
});
