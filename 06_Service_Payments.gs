const PaymentService = Object.freeze({
  init: function(rootApptId) {
    return paymentInit_(rootApptId);
  },
  submit: function(rootApptId, payload, version) {
    return paymentSubmit_(rootApptId, payload || {}, version);
  },
});

function paymentInit_(rootApptId) {
  var customer = CustomerInfo.get(rootApptId);
  var status = ClientStatus.get(rootApptId);
  var ledger = Ledger.summary(rootApptId);
  var quote = Quote.getSavedLines(rootApptId);
  return serviceOk_({
    rootApptId: rootApptId,
    customer: customer.ok ? customer.data : null,
    status: status.ok ? status.data : null,
    summary: ledger.ok ? ledger.data : null,
    quoteLines: quote.ok ? quote.data : [],
  }, status.ok ? status.version : null, []);
}

function paymentSubmit_(rootApptId, payload, version) {
  var ledger = Ledger.append(rootApptId, payload);
  if (!ledger.ok) {
    return ledger;
  }
  var status = ClientStatus.get(rootApptId);
  var statusUpdate = null;
  if (status.ok && payload.AdvanceSalesStage) {
    statusUpdate = ClientStatus.update(rootApptId, {
      SalesStage: payload.AdvanceSalesStage,
      LastPaymentStageChangeAt: new Date(),
    }, version || status.version);
    if (!statusUpdate.ok) {
      return statusUpdate;
    }
    ClientStatus.appendHistory({
      RootApptID: rootApptId,
      Source: 'PaymentService.submit',
      FieldName: 'SalesStage',
      OldValue: status.data.SalesStage || '',
      NewValue: payload.AdvanceSalesStage,
      ChangeReason: 'Payment submitted',
      MetadataJson: {
        paymentId: ledger.data.PaymentID,
      },
    });
  }
  return serviceOk_({
    payment: ledger.data,
    status: statusUpdate && statusUpdate.ok ? statusUpdate.data : status.ok ? status.data : null,
    summary: Ledger.summary(rootApptId).data,
  }, statusUpdate && statusUpdate.version || null, serviceCollectInvalidations_(ledger, statusUpdate, [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL, CACHE_SLICE.ADMIN_HEALTH]));
}
