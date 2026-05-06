const Ledger = Object.freeze({
  getByRoot: function(rootApptId) {
    var rows = extReadStore_('ledger').filter(function(row) {
      return row.RootApptID === rootApptId;
    }).map(ledgerNormalizeRow_);
    rows.sort(function(a, b) {
      return extComparable_(b.IssuedAt || b.PaymentDate) > extComparable_(a.IssuedAt || a.PaymentDate) ? 1 : -1;
    });
    return extResponse_(rows, null);
  },
  getByPaymentId: function(paymentId) {
    var row = ledgerFindByPaymentId_(paymentId);
    return row ? extResponse_(ledgerNormalizeRow_(row), row.Version || null) : extNotFound_();
  },
  append: function(rootApptId, payment) {
    var row = ledgerNormalizeRow_(mergeObjects_(payment || {}, {
      RootApptID: rootApptId,
      PaymentId: payment && (payment.PaymentId || payment.PaymentID) || extGeneratedId_('pay'),
      Version: 1,
      CreatedAt: extNow_(),
    }));
    extAppendRow_('ledger', row);
    return extMutationResponse_(row, ledgerPaymentInvalidations_());
  },
  update: function(paymentId, fields, version) {
    var current = ledgerFindByPaymentId_(paymentId);
    if (!current) {
      return extNotFound_();
    }
    if (version !== undefined && version !== null && Number(version) !== Number(current.Version || 0)) {
      return {
        ok: false,
        conflict: true,
        reason: 'version_conflict',
        latest: ledgerNormalizeRow_(current),
        version: current.Version || null,
        source: 'external',
        ageMs: 0,
      };
    }
    var updated = extUpdateRows_('ledger', function(row) {
      return ledgerPaymentId_(row) === ledgerPaymentId_({ PaymentId: paymentId });
    }, function(row) {
      return ledgerNormalizeRow_(mergeObjects_(row, fields || {}, {
        Version: Number(row.Version || 0) + 1,
        UpdatedAt: extNow_(),
      }));
    });
    return updated.length ? extMutationResponse_(updated[0], ledgerPaymentInvalidations_()) : extNotFound_();
  },
  updateDocLinks: function(paymentId, links, version) {
    return Ledger.update(paymentId, mergeObjects_(links || {}, {
      DocURL: links && (links.DocURL || links.docUrl) || '',
      PDFURL: links && (links.PDFURL || links.pdfUrl) || '',
    }), version);
  },
  linkDocs: function(paymentId, invoiceUrl, receiptUrl) {
    return Ledger.updateDocLinks(paymentId, {
      DocURL: invoiceUrl,
      PDFURL: receiptUrl,
      InvoiceUrl: invoiceUrl,
      ReceiptUrl: receiptUrl,
    });
  },
  markVoid: function(paymentId, reason, actorEmail, version) {
    return Ledger.update(paymentId, {
      Status: 'Voided',
      VoidedAt: extNow_(),
      VoidedBy: actorEmail || getActiveUserEmail_(),
      VoidReason: reason || '',
    }, version);
  },
  findSalesInvoiceForSO: function(rootApptId, so) {
    var targetSo = String(so || '').trim();
    var rows = Ledger.getByRoot(rootApptId).data || [];
    var match = rows.filter(function(row) {
      return row.DocType === 'SI' &&
        row.Status !== 'Voided' &&
        row.Status !== 'Draft' &&
        (!targetSo || String(row.SO || '').trim() === targetSo);
    })[0];
    return match ? extResponse_(match, match.Version || null) : extNotFound_('sales_invoice_required');
  },
  summary: function(rootApptId) {
    var payments = Ledger.getByRoot(rootApptId).data || [];
    var active = payments.filter(function(row) {
      return row.Status !== 'Voided' && row.Status !== 'Draft';
    });
    var invoiceTotal = active.reduce(function(total, row) {
      return total + (ledgerIsInvoice_(row.DocType) ? Number(row.InvoiceTotal || row.Amount || 0) : 0);
    }, 0);
    var paidToDate = active.reduce(function(total, row) {
      return total + (ledgerIsReceipt_(row.DocType) ? Number(row.AmountReceived || row.Amount || 0) : 0);
    }, 0);
    var fees = active.reduce(function(total, row) {
      return total + Number(row.Fees || 0);
    }, 0);
    var lastPayment = active.length ? active[0] : null;
    return extResponse_({
      rootApptId: rootApptId,
      invoiceTotal: ledgerRoundMoney_(invoiceTotal),
      paidToDate: ledgerRoundMoney_(paidToDate),
      fees: ledgerRoundMoney_(fees),
      balance: ledgerRoundMoney_(invoiceTotal - paidToDate),
      paymentCount: active.length,
      voidedCount: payments.length - active.length,
      lastPaymentDate: lastPayment && (lastPayment.IssuedAt || lastPayment.PaymentDate) || '',
      payments: payments,
      activePayments: active,
    }, null);
  },
});

function ledgerFindByPaymentId_(paymentId) {
  var normalized = ledgerPaymentId_({ PaymentId: paymentId });
  return extReadStore_('ledger').filter(function(row) {
    return ledgerPaymentId_(row) === normalized;
  })[0] || null;
}

function ledgerPaymentId_(row) {
  return String(row && (row.PaymentId || row.PaymentID) || '').trim();
}

function ledgerNormalizeRow_(row) {
  var paymentId = ledgerPaymentId_(row) || extGeneratedId_('pay');
  var docType = String(row && (row.DocType || row.docType) || '').toUpperCase();
  var amount = Number(row && (row.Amount || row.amount) || 0);
  if (!docType && amount > 0) {
    docType = 'DR';
  }
  var subtotal = Number(row && row.Subtotal || 0);
  var taxAmount = Number(row && row.TaxAmount || 0);
  var referralDiscount = Number(row && row.ReferralDiscount || 0);
  var invoiceTotal = row && row.InvoiceTotal !== undefined ? Number(row.InvoiceTotal || 0) : ledgerRoundMoney_(subtotal - referralDiscount + taxAmount);
  var amountReceived = row && row.AmountReceived !== undefined ? Number(row.AmountReceived || 0) : ledgerIsReceipt_(docType) ? amount : 0;
  var fees = Number(row && row.Fees || 0);
  var issuedAt = row && (row.IssuedAt || row.PaymentDate) || extNow_();
  var lineItems = row && row.LineItemsJSON;
  if (lineItems && typeof lineItems !== 'string') {
    lineItems = JSON.stringify(lineItems);
  }
  return mergeObjects_(row || {}, {
    PaymentId: paymentId,
    PaymentID: paymentId,
    RootApptID: row && row.RootApptID || '',
    APPT_ID: row && row.APPT_ID || row && row.ApptId || '',
    Brand: row && (row.Brand || row.brand) || '',
    DocType: docType,
    DocNumber: row && row.DocNumber || '',
    IssuedAt: issuedAt,
    PaymentDate: row && row.PaymentDate || issuedAt,
    IssuedBy: row && row.IssuedBy || '',
    SO: row && (row.SO || row.SONumber) || '',
    Subtotal: ledgerRoundMoney_(subtotal || amount),
    ReferralDiscount: ledgerRoundMoney_(referralDiscount),
    TaxRate: Number(row && row.TaxRate || 0),
    TaxAmount: ledgerRoundMoney_(taxAmount),
    InvoiceTotal: ledgerRoundMoney_(invoiceTotal || amount),
    AmountReceived: ledgerRoundMoney_(amountReceived),
    Amount: ledgerRoundMoney_(amount || amountReceived || invoiceTotal),
    Fees: ledgerRoundMoney_(fees),
    NetAmount: ledgerRoundMoney_(row && row.NetAmount !== undefined ? row.NetAmount : amountReceived - fees),
    BalanceDue: ledgerRoundMoney_(row && row.BalanceDue !== undefined ? row.BalanceDue : 0),
    Method: row && (row.Method || row.method) || '',
    LineItemsJSON: lineItems || '[]',
    DocFileId: row && row.DocFileId || '',
    DocURL: row && (row.DocURL || row.DocUrl || row.InvoiceUrl) || '',
    DocPDFId: row && row.DocPDFId || '',
    PDFURL: row && (row.PDFURL || row.PdfUrl || row.ReceiptUrl) || '',
    ARShortcutId: row && row.ARShortcutId || '',
    Status: row && row.Status || 'Active',
    VoidedAt: row && row.VoidedAt || '',
    VoidedBy: row && row.VoidedBy || '',
    VoidReason: row && row.VoidReason || '',
    Version: Number(row && row.Version || 1),
  });
}

function ledgerIsInvoice_(docType) {
  return ['DI', 'SI'].indexOf(String(docType || '').toUpperCase()) !== -1;
}

function ledgerIsReceipt_(docType) {
  return ['DR', 'SR'].indexOf(String(docType || '').toUpperCase()) !== -1;
}

function ledgerPaymentInvalidations_() {
  return [CACHE_SLICE.PAYMENT_SUMMARY, CACHE_SLICE.CUSTOMER_ROOT_DETAIL, CACHE_SLICE.ADMIN_HEALTH];
}

function ledgerRoundMoney_(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
