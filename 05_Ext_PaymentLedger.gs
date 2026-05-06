const Ledger = Object.freeze({
  getByRoot: function(rootApptId) {
    var rows = extReadStore_('ledger').filter(function(row) {
      return row.RootApptID === rootApptId;
    });
    rows.sort(function(a, b) {
      return extComparable_(b.PaymentDate) > extComparable_(a.PaymentDate) ? 1 : -1;
    });
    return extResponse_(rows, null);
  },
  append: function(rootApptId, payment) {
    var row = mergeObjects_(payment || {}, {
      PaymentID: payment && payment.PaymentID || extGeneratedId_('pay'),
      RootApptID: rootApptId,
      PaymentDate: payment && payment.PaymentDate || extNow_(),
      Amount: Number(payment && payment.Amount || payment && payment.amount || 0),
      Method: payment && payment.Method || payment && payment.method || '',
      Notes: payment && payment.Notes || payment && payment.notes || '',
      Version: 1,
      CreatedAt: extNow_(),
    });
    extAppendRow_('ledger', row);
    return extMutationResponse_(row, [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL, CACHE_SLICE.ADMIN_HEALTH]);
  },
  linkDocs: function(paymentId, invoiceUrl, receiptUrl) {
    var updated = extUpdateRows_('ledger', function(row) {
      return row.PaymentID === paymentId;
    }, function(row) {
      return mergeObjects_(row, {
        InvoiceUrl: invoiceUrl,
        ReceiptUrl: receiptUrl,
        Version: Number(row.Version || 0) + 1,
        UpdatedAt: extNow_(),
      });
    });
    return updated.length ? extMutationResponse_(updated[0], [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]) : extNotFound_();
  },
  summary: function(rootApptId) {
    var payments = Ledger.getByRoot(rootApptId).data || [];
    var paidToDate = payments.reduce(function(total, row) {
      return total + Number(row.Amount || 0);
    }, 0);
    var lastPayment = payments.length ? payments[0] : null;
    return extResponse_({
      rootApptId: rootApptId,
      paidToDate: paidToDate,
      balance: null,
      paymentCount: payments.length,
      lastPaymentDate: lastPayment && lastPayment.PaymentDate || '',
      payments: payments,
    }, null);
  },
});
