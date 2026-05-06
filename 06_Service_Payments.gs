const PaymentService = Object.freeze({
  init: function(rootApptId) {
    return paymentInit_(rootApptId);
  },
  validatePrerequisites: function(rootApptId, docType, payload) {
    return paymentValidatePrerequisites_(rootApptId, docType, payload || {});
  },
  submit: function(rootApptId, payload, version, actor) {
    return paymentSubmit_(rootApptId, payload || {}, version, actor || null);
  },
  regenerateDoc: function(paymentId, version, actor) {
    return paymentRegenerateDoc_(paymentId, version, actor || null);
  },
  submitCombo: function(rootApptId, payload, version, actor) {
    return paymentSubmitCombo_(rootApptId, payload || {}, version, actor || null);
  },
  adminVoid: function(paymentId, reason, version, actor) {
    return paymentAdminVoid_(paymentId, reason || '', version, actor || null);
  },
  history: function(rootApptId) {
    return paymentHistory_(rootApptId);
  },
  getDocLinks: function(paymentId) {
    return paymentGetDocLinks_(paymentId);
  },
  exportPdf: function(paymentId) {
    return paymentExportPdf_(paymentId);
  },
  fillPlaceholders: function(doc, mergeData) {
    return paymentFillPlaceholders_(doc, mergeData || {});
  },
});

const PAYMENT_DOC_TYPE = Object.freeze({
  DEPOSIT_INVOICE: 'DI',
  DEPOSIT_RECEIPT: 'DR',
  SALES_INVOICE: 'SI',
  SALES_RECEIPT: 'SR',
});

const PAYMENT_DOC_TYPE_LABELS = Object.freeze({
  DI: 'Deposit Invoice',
  DR: 'Deposit Receipt',
  SI: 'Sales Invoice',
  SR: 'Sales Receipt',
});

function paymentInit_(rootApptId) {
  var context = paymentBuildContext_(rootApptId, {});
  var eligible = ['DI', 'DR', 'SI', 'SR'].map(function(docType) {
    var prereq = paymentValidatePrerequisites_(rootApptId, docType, {
      SO: context.so,
    });
    return {
      docType: docType,
      label: PAYMENT_DOC_TYPE_LABELS[docType],
      eligible: prereq.ok,
      reason: prereq.ok ? '' : prereq.reason,
      detail: prereq.detail || {},
      nextDocNumber: paymentPeekDocNumber_(context.brand, docType),
    };
  });
  return serviceOk_({
    rootApptId: rootApptId,
    apptId: context.apptId,
    so: context.so,
    brand: context.brand,
    taxRate: context.taxRate,
    taxMode: context.taxMode,
    customer: context.customer,
    status: context.status,
    order3d: context.order3d,
    summary: context.summary,
    quoteLines: context.quoteLines,
    eligibleDocTypes: eligible,
    priorInvoices: context.payments.filter(function(row) { return paymentIsInvoice_(row.DocType); }),
    priorReceipts: context.payments.filter(function(row) { return paymentIsReceipt_(row.DocType); }),
  }, context.statusVersion || null, []);
}

function paymentValidatePrerequisites_(rootApptId, docType, payload) {
  var normalizedDocType = paymentNormalizeDocType_(docType || payload && (payload.DocType || payload.docType));
  if (!normalizedDocType) {
    return serviceError_('invalid_doc_type', { docType: docType || '' });
  }
  if (normalizedDocType !== PAYMENT_DOC_TYPE.SALES_RECEIPT) {
    return serviceOk_({
      rootApptId: rootApptId,
      docType: normalizedDocType,
      eligible: true,
    }, null, []);
  }
  var context = paymentBuildContext_(rootApptId, mergeObjects_(payload || {}, {
    DocType: normalizedDocType,
  }));
  var invoice = Ledger.findSalesInvoiceForSO(rootApptId, context.so);
  if (!invoice.ok) {
    return serviceError_('sales_invoice_required', {
      rootApptId: rootApptId,
      so: context.so,
      docType: normalizedDocType,
    });
  }
  return serviceOk_({
    rootApptId: rootApptId,
    so: context.so,
    docType: normalizedDocType,
    eligible: true,
    invoice: invoice.data,
  }, invoice.version || null, []);
}

function paymentSubmit_(rootApptId, payload, version, actor) {
  var context = paymentBuildContext_(rootApptId, payload || {});
  var validation = paymentValidateSubmit_(rootApptId, payload || {}, context);
  if (!validation.ok) {
    return validation;
  }
  var ledger = paymentSubmitLedger_(rootApptId, payload || {}, version, actor, context, validation.data);
  if (!ledger.ok) {
    return ledger;
  }
  var generated = paymentGenerateDoc_(ledger.data.PaymentId, payload || {}, actor);
  if (!generated.ok) {
    return serviceError_('doc_generation_failed', {
      ledgerSaved: true,
      payment: ledger.data,
      reason: generated.reason,
      detail: generated.detail || generated,
      summary: Ledger.summary(rootApptId).data,
    });
  }
  return serviceOk_({
    payment: generated.data.payment,
    summary: Ledger.summary(rootApptId).data,
    doc: generated.data.doc,
    pdf: generated.data.pdf,
    arShortcut: generated.data.arShortcut || null,
    warnings: generated.data.warnings || [],
  }, generated.data.payment.Version || null, serviceCollectInvalidations_(ledger, generated, ledgerPaymentInvalidations_()));
}

function paymentSubmitLedger_(rootApptId, payload, version, actor, context, computed) {
  var docNumber = paymentNextDocNumber_(computed.brand, computed.docType);
  if (!docNumber.ok) {
    return docNumber;
  }
  return DocLock.withUserWriteLock(function() {
    var statusRead = ClientStatus.get(rootApptId);
    if (statusRead.ok && version !== undefined && version !== null && Number(version) !== Number(statusRead.version || 0)) {
      return {
        ok: false,
        conflict: true,
        reason: 'version_conflict',
        latest: statusRead.data,
        version: statusRead.version,
        source: 'service',
        ageMs: 0,
      };
    }
    var issuedAt = new Date();
    var row = paymentBuildLedgerRow_(rootApptId, payload, context, computed, docNumber.data.docNumber, issuedAt, actor);
    var ledger = Ledger.append(rootApptId, row);
    if (!ledger.ok) {
      return ledger;
    }
    var statusUpdate = null;
    if (statusRead.ok && paymentIsReceipt_(computed.docType)) {
      var statusFields = {
        LastPaymentStageChangeAt: issuedAt,
      };
      if (payload.AdvanceSalesStage) {
        statusFields.SalesStage = payload.AdvanceSalesStage;
      }
      statusUpdate = ClientStatus.update(rootApptId, statusFields, statusRead.version);
      if (!statusUpdate.ok) {
        return statusUpdate;
      }
      ClientStatus.appendHistory({
        RootApptID: rootApptId,
        Source: 'PaymentService.submitLedger',
        FieldName: 'Payment',
        OldValue: '',
        NewValue: row.DocNumber,
        ChangeReason: 'Payment ledger row submitted',
        MetadataJson: {
          paymentId: row.PaymentId,
          docType: row.DocType,
          amountReceived: row.AmountReceived,
          balanceDue: row.BalanceDue,
        },
      });
    }
    return extMutationResponse_(ledger.data, serviceCollectInvalidations_(ledger, statusUpdate, ledgerPaymentInvalidations_()));
  }, {
    functionName: 'PaymentService.submitLedger',
    target: rootApptId,
    metadata: {
      docType: computed.docType,
      docNumber: docNumber.data.docNumber,
      actorEmail: actor && actor.email || '',
    },
  });
}

function paymentGenerateDoc_(paymentId, payload, actor) {
  if (payload && (payload.ForceTemplateMissing || payload.forceTemplateMissing)) {
    return serviceError_('template_missing', { paymentId: paymentId });
  }
  var paymentRead = Ledger.getByPaymentId(paymentId);
  if (!paymentRead.ok) {
    return paymentRead;
  }
  var payment = paymentRead.data;
  var taxMode = payment.TaxMode || paymentBuildTaxMode_(payment.Brand, paymentLineItemsFromRow_(payment));
  var template = Templates.getId(payment.Brand, payment.DocType, taxMode);
  if (!template.ok || !template.data.templateId) {
    return serviceError_('template_missing', {
      paymentId: paymentId,
      brand: payment.Brand,
      docType: payment.DocType,
      taxMode: taxMode,
    });
  }
  var folder = paymentResolveDestinationFolder_(payment.RootApptID, payment, payload || {});
  if (!folder.ok) {
    return folder;
  }
  var mergeData = paymentBuildMergeData_(payment);
  var name = paymentDocFileName_(payment);
  var doc = DriveExt.copyTemplate(template.data.templateId, name, folder.data.FolderID);
  if (!doc.ok) {
    return serviceError_('doc_copy_failed', doc);
  }
  var fill = paymentTryFillDoc_(doc.data.FileID, mergeData);
  paymentRecordRenderedDoc_(doc.data.FileID, mergeData, fill);
  var pdf = DriveExt.exportPdf(doc.data.FileID, name, folder.data.FolderID);
  if (!pdf.ok) {
    return serviceError_('pdf_export_failed', pdf);
  }
  var warnings = [];
  if (!fill.ok) {
    warnings.push({
      reason: 'placeholder_merge_skipped',
      message: fill.reason || fill.error && fill.error.message || 'Document placeholder merge was skipped.',
    });
  }
  var ar = paymentCreateArShortcut_(payment, pdf.data, actor);
  if (!ar.ok && ar.reason !== 'ar_not_configured') {
    warnings.push({
      reason: ar.reason,
      message: ar.error && ar.error.message || ar.reason,
    });
    paymentLogWarning_('PaymentService.generateDoc', payment.PaymentId, ar.reason, ar);
  }
  var updated = Ledger.updateDocLinks(payment.PaymentId, {
    DocFileId: doc.data.FileID,
    DocURL: doc.data.Url,
    DocPDFId: pdf.data.FileID,
    PDFURL: pdf.data.Url,
    ARShortcutId: ar.ok && ar.data ? ar.data.ShortcutID : payment.ARShortcutId || '',
  }, payment.Version);
  if (!updated.ok) {
    return updated;
  }
  return serviceOk_({
    payment: updated.data,
    doc: doc.data,
    pdf: pdf.data,
    arShortcut: ar.ok ? ar.data : null,
    warnings: warnings,
  }, updated.version || null, updated.invalidated || ledgerPaymentInvalidations_());
}

function paymentRegenerateDoc_(paymentId, version, actor) {
  var read = Ledger.getByPaymentId(paymentId);
  if (!read.ok) {
    return read;
  }
  if (version !== undefined && version !== null && Number(version) !== Number(read.version || 0)) {
    return {
      ok: false,
      conflict: true,
      reason: 'version_conflict',
      latest: read.data,
      version: read.version,
      source: 'service',
      ageMs: 0,
    };
  }
  var generated = paymentGenerateDoc_(paymentId, {}, actor);
  if (!generated.ok) {
    return generated;
  }
  return serviceOk_(generated.data, generated.version || null, serviceCollectInvalidations_(generated, ledgerPaymentInvalidations_()));
}

function paymentSubmitCombo_(rootApptId, payload, version, actor) {
  var invoicePayload = mergeObjects_(payload || {}, payload.invoice || {}, {
    DocType: PAYMENT_DOC_TYPE.SALES_INVOICE,
    AmountReceived: 0,
  });
  var invoice = paymentSubmit_(rootApptId, invoicePayload, version, actor);
  if (!invoice.ok) {
    return invoice;
  }
  var receiptPayload = mergeObjects_(payload || {}, payload.receipt || {}, {
    DocType: PAYMENT_DOC_TYPE.SALES_RECEIPT,
    SO: invoice.data.payment.SO,
    LineItems: paymentLineItemsFromRow_(invoice.data.payment),
    AmountReceived: payload.AmountReceived || payload.amountReceived || invoice.data.payment.InvoiceTotal,
    Method: payload.Method || payload.method || 'card',
  });
  var receipt = paymentSubmit_(rootApptId, receiptPayload, null, actor);
  if (!receipt.ok) {
    return serviceError_('combo_receipt_failed', {
      invoice: invoice.data,
      receiptError: receipt,
    });
  }
  return serviceOk_({
    invoice: invoice.data,
    receipt: receipt.data,
  }, receipt.version || null, serviceCollectInvalidations_(invoice, receipt, ledgerPaymentInvalidations_()));
}

function paymentAdminVoid_(paymentId, reason, version, actor) {
  return DocLock.withUserWriteLock(function() {
    var paymentRead = Ledger.getByPaymentId(paymentId);
    if (!paymentRead.ok) {
      return paymentRead;
    }
    if (paymentRead.data.Status === 'Voided') {
      return serviceError_('already_voided', { paymentId: paymentId });
    }
    var voided = Ledger.markVoid(paymentId, reason, actor && actor.email || getActiveUserEmail_(), version);
    if (!voided.ok) {
      return voided;
    }
    ClientStatus.appendHistory({
      RootApptID: voided.data.RootApptID,
      Source: 'PaymentService.adminVoid',
      FieldName: 'Payment',
      OldValue: paymentRead.data.DocNumber,
      NewValue: 'Voided',
      ChangeReason: reason || 'Payment voided',
      MetadataJson: {
        paymentId: paymentId,
        docType: paymentRead.data.DocType,
        amountReceived: paymentRead.data.AmountReceived,
      },
    });
    return serviceOk_({
      payment: voided.data,
      summary: Ledger.summary(voided.data.RootApptID).data,
      docUrl: voided.data.DocURL,
      pdfUrl: voided.data.PDFURL,
    }, voided.version || null, serviceCollectInvalidations_(voided, ledgerPaymentInvalidations_()));
  }, {
    functionName: 'PaymentService.adminVoid',
    target: paymentId,
    metadata: {
      actorEmail: actor && actor.email || '',
    },
  });
}

function paymentHistory_(rootApptId) {
  return Ledger.getByRoot(rootApptId);
}

function paymentGetDocLinks_(paymentId) {
  var payment = Ledger.getByPaymentId(paymentId);
  if (!payment.ok) {
    return payment;
  }
  return serviceOk_({
    paymentId: payment.data.PaymentId,
    docFileId: payment.data.DocFileId,
    docUrl: payment.data.DocURL,
    pdfFileId: payment.data.DocPDFId,
    pdfUrl: payment.data.PDFURL,
    arShortcutId: payment.data.ARShortcutId || '',
  }, payment.version || null, []);
}

function paymentExportPdf_(paymentId) {
  var links = paymentGetDocLinks_(paymentId);
  if (!links.ok) {
    return links;
  }
  if (!links.data.pdfUrl) {
    return serviceError_('pdf_missing', { paymentId: paymentId });
  }
  return serviceOk_(mergeObjects_(links.data, {
    contentType: 'application/pdf',
    blobName: paymentId + '.pdf',
  }), links.version || null, []);
}

function paymentBuildContext_(rootApptId, payload) {
  var customerRead = CustomerInfo.get(rootApptId);
  var statusRead = ClientStatus.get(rootApptId);
  var orderRead = Order3D.get(rootApptId);
  var rootRead = RootAppointments.get(rootApptId);
  var ledger = Ledger.summary(rootApptId);
  var quote = Quote.getSavedLines(rootApptId);
  var rawBrand = payload.Brand || payload.brand || customerRead.ok && customerRead.data.Brand || '';
  var brand = paymentNormalizeBrand_(rawBrand);
  var lineItems = paymentLineItemsFromPayload_(payload);
  var taxMode = paymentBuildTaxMode_(brand, lineItems);
  return {
    rootApptId: rootApptId,
    apptId: payload.APPT_ID || payload.apptId || rootRead.ok && rootRead.data.CurrentAPPT_ID || '',
    so: payload.SO || payload.so || payload.SONumber || orderRead.ok && orderRead.data.SONumber || '',
    brand: brand,
    taxRate: paymentResolveTaxRate_(brand, payload, taxMode),
    taxMode: taxMode,
    customer: customerRead.ok ? customerRead.data : null,
    status: statusRead.ok ? statusRead.data : null,
    statusVersion: statusRead.ok ? statusRead.version : null,
    order3d: orderRead.ok ? orderRead.data : null,
    root: rootRead.ok ? rootRead.data : null,
    summary: ledger.ok ? ledger.data : null,
    payments: ledger.ok ? ledger.data.payments : [],
    quoteLines: quote.ok ? quote.data : [],
    lineItems: lineItems,
  };
}

function paymentValidateSubmit_(rootApptId, payload, context) {
  var errors = [];
  var docType = paymentNormalizeDocType_(payload.DocType || payload.docType);
  var lineItems = context.lineItems;
  var brand = context.brand;
  if (!docType) {
    docType = payload.Amount || payload.amount ? PAYMENT_DOC_TYPE.DEPOSIT_RECEIPT : '';
  }
  if (!docType) {
    errors.push({ field: 'DocType', reason: 'required' });
  }
  if (['HPUSA', 'VVS'].indexOf(brand) === -1) {
    errors.push({ field: 'Brand', reason: 'unsupported_brand', value: brand });
  }
  if (!lineItems.length) {
    errors.push({ field: 'LineItems', reason: 'required' });
  }
  if (brand === 'VVS' && context.taxMode === 'MIXED') {
    errors.push({ field: 'LineItems', reason: 'mixed_tax_mode_requires_split' });
  }
  var computed = paymentComputeTotals_(lineItems, payload, context, docType);
  if (paymentIsReceipt_(docType)) {
    if (computed.amountReceived <= 0) {
      errors.push({ field: 'AmountReceived', reason: 'required_positive' });
    }
    var remaining = paymentRemainingForReceipt_(context, computed);
    if (computed.amountReceived > remaining + 0.01) {
      errors.push({
        field: 'AmountReceived',
        reason: 'exceeds_remaining_balance',
        amountReceived: computed.amountReceived,
        remaining: remaining,
      });
    }
  }
  if (docType === PAYMENT_DOC_TYPE.SALES_RECEIPT) {
    var prereq = paymentValidatePrerequisites_(rootApptId, docType, payload);
    if (!prereq.ok) {
      errors.push({ field: 'DocType', reason: prereq.reason, detail: prereq.detail });
    }
  }
  if (errors.length) {
    return serviceError_('validation_failed', { errors: errors });
  }
  return serviceOk_(mergeObjects_(computed, {
    docType: docType,
    brand: brand,
    taxMode: context.taxMode,
  }), null, []);
}

function paymentBuildLedgerRow_(rootApptId, payload, context, computed, docNumber, issuedAt, actor) {
  var lineItems = computed.lineItems;
  return {
    PaymentId: serviceGeneratedId_('pay'),
    RootApptID: rootApptId,
    APPT_ID: context.apptId,
    Brand: computed.brand,
    DocType: computed.docType,
    DocNumber: docNumber,
    IssuedAt: issuedAt,
    IssuedBy: actor && actor.email || getActiveUserEmail_(),
    SO: context.so,
    Subtotal: computed.subtotal,
    ReferralDiscount: computed.referralDiscount,
    TaxRate: computed.taxRate,
    TaxAmount: computed.taxAmount,
    InvoiceTotal: computed.invoiceTotal,
    AmountReceived: computed.amountReceived,
    Amount: paymentIsReceipt_(computed.docType) ? computed.amountReceived : computed.invoiceTotal,
    Fees: computed.fees,
    NetAmount: computed.netAmount,
    BalanceDue: computed.balanceDue,
    Method: payload.Method || payload.method || '',
    Reference: payload.Reference || payload.reference || '',
    TaxMode: computed.taxMode,
    LineItemsJSON: JSON.stringify(lineItems),
    Status: 'Active',
    Notes: payload.Notes || payload.notes || '',
  };
}

function paymentComputeTotals_(lineItems, payload, context, docType) {
  var subtotal = paymentRoundMoney_(lineItems.reduce(function(total, item) {
    return total + Number(item.quantity || 0) * Number(item.unitPrice || 0);
  }, 0));
  var taxableSubtotal = paymentRoundMoney_(lineItems.reduce(function(total, item) {
    return total + (item.taxable ? Number(item.quantity || 0) * Number(item.unitPrice || 0) : 0);
  }, 0));
  var referralDiscount = paymentRoundMoney_(payload.ReferralDiscount || payload.referralDiscount || 0);
  var taxBase = Math.max(taxableSubtotal - (taxableSubtotal === subtotal ? referralDiscount : 0), 0);
  var taxRate = Number(payload.TaxRate !== undefined ? payload.TaxRate : payload.taxRate !== undefined ? payload.taxRate : context.taxRate || 0);
  var taxAmount = paymentRoundMoney_(taxBase * taxRate);
  var invoiceTotal = paymentRoundMoney_(subtotal - referralDiscount + taxAmount);
  var amountReceived = paymentRoundMoney_(payload.AmountReceived !== undefined ? payload.AmountReceived : payload.amountReceived !== undefined ? payload.amountReceived : payload.Amount !== undefined ? payload.Amount : payload.amount || (paymentIsReceipt_(docType) ? invoiceTotal : 0));
  var fees = paymentRoundMoney_(payload.Fees || payload.fees || 0);
  var balanceDue = paymentBalanceAfter_(context, docType, invoiceTotal, amountReceived);
  return {
    lineItems: lineItems,
    subtotal: subtotal,
    referralDiscount: referralDiscount,
    taxRate: taxRate,
    taxAmount: taxAmount,
    invoiceTotal: invoiceTotal,
    amountReceived: amountReceived,
    fees: fees,
    netAmount: paymentRoundMoney_(amountReceived - fees),
    balanceDue: balanceDue,
  };
}

function paymentBalanceAfter_(context, docType, invoiceTotal, amountReceived) {
  var currentBalance = context.summary ? Number(context.summary.balance || 0) : 0;
  if (paymentIsInvoice_(docType)) {
    return paymentRoundMoney_(currentBalance + invoiceTotal);
  }
  if (currentBalance > 0) {
    return paymentRoundMoney_(Math.max(currentBalance - amountReceived, 0));
  }
  return paymentRoundMoney_(Math.max(invoiceTotal - amountReceived, 0));
}

function paymentRemainingForReceipt_(context, computed) {
  var currentBalance = context.summary ? Number(context.summary.balance || 0) : 0;
  if (currentBalance > 0) {
    return currentBalance;
  }
  return computed.invoiceTotal;
}

function paymentLineItemsFromPayload_(payload) {
  var raw = payload.LineItems || payload.lineItems || payload.items || [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      raw = [];
    }
  }
  if (!Array.isArray(raw) || !raw.length) {
    var amount = Number(payload.Amount || payload.amount || payload.AmountReceived || payload.amountReceived || 0);
    if (amount > 0) {
      raw = [{
        description: payload.Description || payload.description || payload.Notes || payload.notes || 'Payment',
        quantity: 1,
        unitPrice: amount,
        taxable: Boolean(payload.Taxable || payload.taxable),
      }];
    }
  }
  return (raw || []).map(function(item, index) {
    var quantity = Number(item.Quantity !== undefined ? item.Quantity : item.quantity !== undefined ? item.quantity : 1);
    var unitPrice = Number(item.UnitPrice !== undefined ? item.UnitPrice : item.unitPrice !== undefined ? item.unitPrice : item.Amount !== undefined ? item.Amount : item.amount || 0);
    return {
      description: String(item.Description || item.description || item.Name || item.name || 'Line item ' + (index + 1)),
      quantity: quantity,
      unitPrice: paymentRoundMoney_(unitPrice),
      taxable: item.Taxable !== undefined ? Boolean(item.Taxable) : item.taxable !== undefined ? Boolean(item.taxable) : false,
      total: paymentRoundMoney_(quantity * unitPrice),
    };
  }).filter(function(item) {
    return item.quantity > 0 && item.unitPrice >= 0;
  });
}

function paymentLineItemsFromRow_(row) {
  try {
    return paymentLineItemsFromPayload_({
      LineItems: JSON.parse(row.LineItemsJSON || '[]'),
    });
  } catch (err) {
    return [];
  }
}

function paymentNormalizeDocType_(value) {
  var text = String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  var map = {
    DI: 'DI',
    DEPOSITINVOICE: 'DI',
    DR: 'DR',
    DEPOSITRECEIPT: 'DR',
    SI: 'SI',
    SALESINVOICE: 'SI',
    SR: 'SR',
    SALESRECEIPT: 'SR',
  };
  return map[text] || '';
}

function paymentNormalizeBrand_(value) {
  var text = String(value || '').trim().toUpperCase();
  if (text === 'VVS') {
    return 'VVS';
  }
  if (text === 'HPUSA' || text === 'HP' || text === 'HARRY POTTER USA') {
    return 'HPUSA';
  }
  return text || 'HPUSA';
}

function paymentBuildTaxMode_(brand, lineItems) {
  if (brand !== 'VVS') {
    return '';
  }
  var taxableCount = (lineItems || []).filter(function(item) { return item.taxable; }).length;
  if (taxableCount === 0) {
    return 'NOTAX';
  }
  if (taxableCount === lineItems.length) {
    return 'TAX';
  }
  return 'MIXED';
}

function paymentResolveTaxRate_(brand, payload, taxMode) {
  if (payload.TaxRate !== undefined || payload.taxRate !== undefined) {
    return Number(payload.TaxRate !== undefined ? payload.TaxRate : payload.taxRate);
  }
  if (brand !== 'VVS' || taxMode !== 'TAX') {
    return 0;
  }
  var configured = ConfigRepo.get('payments', 'tax.vvs.rate');
  return configured.ok && configured.data.Value !== '' ? Number(configured.data.Value) : 0.0875;
}

function paymentNextDocNumber_(brand, docType) {
  return NamedLock.withLock('docnumber:' + brand + ':' + docType, function() {
    var key = paymentDocNumberKey_(brand, docType);
    var current = ConfigRepo.get('payments', key);
    var next = current.ok ? Number(current.data.Value || 1) : 1;
    var set = ConfigRepo.set('payments', key, String(next + 1), current.ok ? current.version : null);
    if (!set.ok) {
      return set;
    }
    return serviceOk_({
      docNumber: paymentFormatDocNumber_(brand, docType, next),
      sequenceValue: next,
      nextValue: next + 1,
    }, set.version || null, [CACHE_SLICE.FORM_OPTIONS]);
  }, 5000);
}

function paymentPeekDocNumber_(brand, docType) {
  var current = ConfigRepo.get('payments', paymentDocNumberKey_(brand, docType));
  var next = current.ok ? Number(current.data.Value || 1) : 1;
  return paymentFormatDocNumber_(brand, docType, next);
}

function paymentDocNumberKey_(brand, docType) {
  return 'docnumber.' + String(brand || '').toLowerCase() + '.' + String(docType || '').toLowerCase() + '.next';
}

function paymentFormatDocNumber_(brand, docType, sequenceValue) {
  var padded = ('000000' + Number(sequenceValue || 1)).slice(-6);
  return String(brand || '').toUpperCase() + '-' + String(docType || '').toUpperCase() + '-' + padded;
}

function paymentResolveDestinationFolder_(rootApptId, payment, payload) {
  var overrideUrl = payload.PaymentsFolderURL || payload.paymentsFolderURL;
  if (overrideUrl) {
    return DriveExt.folderFromUrl(overrideUrl);
  }
  var customer = CustomerInfo.get(rootApptId);
  var brand = paymentNormalizeBrand_(payment.Brand);
  if (payment.SO && !(payment.APPT_ID || payload.APPT_ID || payload.apptId)) {
    var parentKey = 'drive.parent.so.' + brand.toLowerCase();
    var parentConfig = ConfigRepo.get('payments', parentKey);
    var parentId = parentConfig.ok && parentConfig.data.Value || 'so_parent_' + brand.toLowerCase();
    var soFolder = DriveExt.ensureChildFolder(parentId, brand + '-' + payment.SO);
    if (!soFolder.ok) {
      return soFolder;
    }
    return DriveExt.ensureChildFolder(soFolder.data.FolderID, '04-Deposit');
  }
  var customerFolderId = customer.ok && customer.data.CustomerFolderId || rootApptId;
  return DriveExt.ensureChildFolder(customerFolderId, '04-Deposit');
}

function paymentCreateArShortcut_(payment, pdfFile, actor) {
  var key = 'drive.parent.ar.' + paymentNormalizeBrand_(payment.Brand).toLowerCase();
  var configured = ConfigRepo.get('payments', key);
  if (!configured.ok || !configured.data.Value) {
    return serviceError_('ar_not_configured', { key: key });
  }
  var monthKey = Utilities.formatDate(new Date(payment.IssuedAt || new Date()), Session.getScriptTimeZone(), 'yyyy-MM');
  var monthFolder = DriveExt.ensureChildFolder(configured.data.Value, monthKey);
  if (!monthFolder.ok) {
    return monthFolder;
  }
  var customer = CustomerInfo.get(payment.RootApptID);
  var customerName = customer.ok && customer.data.CustomerName || payment.RootApptID;
  return DriveExt.createShortcut(pdfFile.FileID, payment.DocNumber + ' - ' + customerName + '.pdf.lnk', monthFolder.data.FolderID);
}

function paymentBuildMergeData_(payment) {
  var customer = CustomerInfo.get(payment.RootApptID);
  var lineItems = paymentLineItemsFromRow_(payment);
  return {
    CustomerName: customer.ok && customer.data.CustomerName || '',
    CustomerAddress: customer.ok && customer.data.Address || '',
    CustomerEmail: customer.ok && customer.data.Email || '',
    Brand: payment.Brand,
    DocType: PAYMENT_DOC_TYPE_LABELS[payment.DocType] || payment.DocType,
    DocNumber: payment.DocNumber,
    IssuedDate: paymentFormatDate_(payment.IssuedAt),
    SO: payment.SO,
    Subtotal: paymentFormatCurrency_(payment.Subtotal),
    ReferralDiscount: paymentFormatCurrency_(payment.ReferralDiscount),
    TaxRate: paymentFormatPercent_(payment.TaxRate),
    TaxAmount: paymentFormatCurrency_(payment.TaxAmount),
    InvoiceTotal: paymentFormatCurrency_(payment.InvoiceTotal),
    AmountReceived: paymentFormatCurrency_(payment.AmountReceived),
    BalanceDue: paymentFormatCurrency_(payment.BalanceDue),
    Method: payment.Method,
    LineItems: paymentLineItemsText_(lineItems),
    LineItemsArray: lineItems,
  };
}

function paymentTryFillDoc_(docFileId, mergeData) {
  try {
    if (!docFileId || /^(doc|test|pdf)_/i.test(docFileId)) {
      return serviceError_('property_backed_doc', { docFileId: docFileId });
    }
    var doc = DocumentApp.openById(docFileId);
    paymentFillPlaceholders_(doc, mergeData);
    doc.saveAndClose();
    return serviceOk_({ docFileId: docFileId }, null, []);
  } catch (err) {
    return serviceError_('document_merge_failed', { message: err.message, docFileId: docFileId });
  }
}

function paymentFillPlaceholders_(doc, mergeData) {
  var body = doc.getBody();
  paymentFillLineItemTables_(body, mergeData.LineItemsArray || []);
  Object.keys(mergeData || {}).forEach(function(key) {
    if (key === 'LineItemsArray') {
      return;
    }
    body.replaceText('\\{\\{' + key + '\\}\\}', String(mergeData[key] === undefined || mergeData[key] === null ? '' : mergeData[key]));
  });
  return doc;
}

function paymentFillLineItemTables_(body, lineItems) {
  try {
    var tables = body.getTables ? body.getTables() : [];
    for (var t = 0; t < tables.length; t += 1) {
      var table = tables[t];
      for (var r = 0; r < table.getNumRows(); r += 1) {
        var row = table.getRow(r);
        var text = row.getText();
        if (text.indexOf('{{LineItem') !== -1) {
          var templateCells = [];
          for (var c = 0; c < row.getNumCells(); c += 1) {
            templateCells.push(row.getCell(c).getText());
          }
          table.removeRow(r);
          lineItems.forEach(function(item) {
            var newRow = table.appendTableRow();
            templateCells.forEach(function(cellTemplate) {
              newRow.appendTableCell(cellTemplate
                .replace(/\{\{LineItemDescription\}\}/g, item.description)
                .replace(/\{\{LineItemQuantity\}\}/g, String(item.quantity))
                .replace(/\{\{LineItemUnitPrice\}\}/g, paymentFormatCurrency_(item.unitPrice))
                .replace(/\{\{LineItemTotal\}\}/g, paymentFormatCurrency_(item.total))
                .replace(/\{\{LineItemTaxable\}\}/g, item.taxable ? 'Yes' : 'No'));
            });
          });
          return true;
        }
      }
    }
  } catch (err) {
    // Fall back to replacing {{LineItems}} with plain text below.
  }
  try {
    body.replaceText('\\{\\{LineItems\\}\\}', paymentLineItemsText_(lineItems || []));
  } catch (err2) {
    // Placeholder merge should not fail the ledger submit.
  }
  return false;
}

function paymentRecordRenderedDoc_(docFileId, mergeData, fillResult) {
  extUpdateRows_('driveFiles', function(row) {
    return row.FileID === docFileId;
  }, function(row) {
    return mergeObjects_(row, {
      DocNumber: mergeData.DocNumber || '',
      RenderedText: paymentRenderedText_(mergeData),
      PlaceholderMergeStatus: fillResult.ok ? 'merged' : 'skipped',
      UpdatedAt: extNow_(),
      Version: Number(row.Version || 0) + 1,
    });
  });
}

function paymentRenderedText_(mergeData) {
  return [
    mergeData.DocNumber,
    mergeData.CustomerName,
    mergeData.DocType,
    mergeData.Subtotal,
    mergeData.TaxAmount,
    mergeData.InvoiceTotal,
    mergeData.AmountReceived,
    mergeData.BalanceDue,
    mergeData.LineItems,
  ].join('\n');
}

function paymentDocFileName_(payment) {
  var customer = CustomerInfo.get(payment.RootApptID);
  var customerName = customer.ok && customer.data.CustomerName || payment.RootApptID;
  return payment.DocNumber + ' - ' + customerName;
}

function paymentLineItemsText_(lineItems) {
  return (lineItems || []).map(function(item) {
    return item.description + ' x ' + item.quantity + ' @ ' + paymentFormatCurrency_(item.unitPrice) + ' = ' + paymentFormatCurrency_(item.total);
  }).join('\n');
}

function paymentIsInvoice_(docType) {
  return ['DI', 'SI'].indexOf(paymentNormalizeDocType_(docType)) !== -1;
}

function paymentIsReceipt_(docType) {
  return ['DR', 'SR'].indexOf(paymentNormalizeDocType_(docType)) !== -1;
}

function paymentRoundMoney_(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function paymentFormatCurrency_(value) {
  return '$' + paymentRoundMoney_(value).toFixed(2);
}

function paymentFormatPercent_(value) {
  return (Number(value || 0) * 100).toFixed(2) + '%';
}

function paymentFormatDate_(value) {
  return value ? Utilities.formatDate(new Date(value), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function paymentLogWarning_(functionName, target, message, metadata) {
  try {
    OpsLog.append({
      FunctionName: functionName,
      Tier: 'API',
      Result: 'warning',
      Message: message || '',
      Target: target || '',
      MetadataJson: metadata || {},
    });
  } catch (err) {
    // Non-blocking payment warnings must not fail payment submission.
  }
}
