const ServiceTests = Object.freeze({
  run: function() {
    var result = serviceTestsRun_();
    serviceTestsLogResult_(result);
    return result;
  },
});

function runServiceTests() {
  return ServiceTests.run();
}

function serviceTestsRun_() {
  var suite = serviceTestSuite_(repoTestContext_());
  serviceTestsTaskGeneration_(suite);
  serviceTestsAdapters_(suite);
  serviceTestsPayments_(suite);
  serviceTestsDiamonds_(suite);
  serviceTestsTaskCompletion_(suite);
  serviceTestsArtifacts_(suite);
  return serviceTestsBuildResult_(suite);
}

function serviceTestsTaskGeneration_(suite) {
  var ctx = suite.ctx;
  var today = new Date();
  var appointment = mergeObjects_(repoTestAppointment_(ctx), {
    AppointmentStart: today,
    AppointmentDate: today,
    AppointmentStatus: APPOINTMENT_STATUS.COMPLETED,
    Outcome: APPOINTMENT_STATUS.COMPLETED,
    ForceAppointmentDayTasks: true,
  });
  var futureAppointment = mergeObjects_(appointment, {
    APPT_ID: ctx.nextApptId,
    AppointmentStart: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    AppointmentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ForceAppointmentDayTasks: false,
  });
  var status = mergeObjects_(repoTestClientStatus_(ctx), {
    SalesStage: SALES_STAGE.CONSULT_COMPLETE,
    Is3DNeeded: true,
    IsWaxNeeded: true,
    WaxRequestNeedsUpdate: true,
  });
  var order3d = mergeObjects_(repoTestOrder3D_(ctx), {
    SONumber: '',
    Current3DState: 'Started',
  });
  var artifacts = [
    mergeObjects_(repoTestArtifact_(ctx), {
      WorkflowStage: ARTIFACT_STAGE.SUMMARY_READY,
      SummaryDocUrl: 'https://example.com/summary',
    }),
    mergeObjects_(repoTestArtifact_(ctx), {
      ArtifactID: ctx.artifactId + '_approved',
      WorkflowStage: ARTIFACT_STAGE.APPROVED,
    }),
  ];
  var dv = mergeObjects_(repoTestDiamondViewing_(ctx), {
    DecisionsDue: true,
    EtaRisk: true,
  });
  var stones = [
    { CertNo: 'stone_order', OrderStatus: 'Proposing' },
    { CertNo: 'stone_track', OrderStatus: 'On the Way' },
    { CertNo: 'stone_confirm', OrderStatus: 'On the Way', TrackingStatus: 'Arrived' },
    { CertNo: 'stone_decision', OrderStatus: 'Delivered', StoneStatus: 'In Stock' },
    { CertNo: 'stone_return', OrderStatus: 'Delivered', StoneStatus: 'In Stock', ReturnDueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    { CertNo: 'stone_eta', OrderStatus: 'On the Way', TrackingStatus: 'Delayed' },
  ];
  var cleanupStatus = mergeObjects_(status, {
    NeedsCleanupReview: true,
    CleanupPendingAdmin: true,
    CleanupNeedsRevision: true,
  });

  var desired = []
    .concat(TaskGen.coreAppointmentTasks(appointment, status, artifacts))
    .concat(TaskGen.coreAppointmentTasks(futureAppointment, status, []))
    .concat(TaskGen.postConsultTasks(appointment, status, order3d))
    .concat(TaskGen.diamondTasks(appointment, dv, stones))
    .concat(TaskGen.dataCleanupTasks(repoTestRootAppointment_(ctx), repoTestCustomer_(ctx), cleanupStatus));
  var types = desired.map(function(task) {
    return task.TaskType;
  });
  var expectedTypes = Object.keys(TASK_TYPE).map(function(key) {
    return TASK_TYPE[key];
  });
  serviceTestCheck_(suite, 'task generation covers every task type', expectedTypes.every(function(taskType) {
    return types.indexOf(taskType) !== -1;
  }), {
    expectedTypes: expectedTypes,
    actualTypes: types,
  });

  serviceTestCall_(suite, 'task generation diff creates upserts and blocks stale generated tasks', function() {
    return TaskGen.diff(desired.slice(0, 2), [
      mergeObjects_(desired[0], {
        TaskID: 'existing',
        Version: 1,
      }),
      {
        TaskID: 'stale',
        RootApptID: ctx.rootId,
        APPT_ID: ctx.apptId,
        TaskType: TASK_TYPE.SEND_FINAL_RECAP,
        TaskState: TASK_STATE.OPEN,
        PayloadJson: {
          generated: true,
          desiredKey: 'stale',
        },
      },
    ]);
  }, function(result) {
    return result.ok && result.upserts.length === 1 && result.blocks.length === 1;
  });
}

function serviceTestsAdapters_(suite) {
  var ctx = suite.ctx;
  serviceTestCall_(suite, 'Tracker adapter appends and reads entries', function() {
    Tracker.appendLog(ctx.rootId, {
      EventType: 'REPO_TEST',
      Notes: 'tracker test',
    });
    return Tracker.getEntries(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.length >= 1;
  });

  serviceTestCall_(suite, 'Quote adapter refreshes from tracker and 3D', function() {
    var tracking = Quote.refreshFromTracking(ctx.rootId);
    var from3d = Quote.refreshFrom3D(ctx.rootId);
    var lines = Quote.getSavedLines(ctx.rootId);
    return {
      ok: tracking.ok && from3d.ok && lines.ok,
      tracking: tracking,
      from3d: from3d,
      lines: lines,
    };
  }, function(result) {
    return result.ok && result.lines.data.length >= 2;
  });

  serviceTestCall_(suite, 'Drive adapter ensures folder and lists test file', function() {
    var folder = DriveExt.ensureFolder(ctx.rootId, 'Phase 3 Uploads');
    var file = driveExtRegisterTestFile_(folder.data.FolderID, {
      Name: 'phase3-audio.mp3',
      Url: 'https://example.com/phase3-audio.mp3',
    });
    var files = DriveExt.listNewFiles(folder.data.FolderID, null);
    return {
      ok: folder.ok && file.ok && files.ok,
      folder: folder,
      files: files,
    };
  }, function(result) {
    return result.ok && result.files.data.length >= 1;
  });

  serviceTestCall_(suite, 'AssemblyAI and OpenAI adapters produce deterministic summary', function() {
    var started = AssemblyAI.startTranscription('drive_file_' + ctx.suffix);
    var transcript = AssemblyAI.pollTranscription(started.data.TranscriptID);
    var summary = OpenAIExt.summarizeTranscript(transcript.data.Text, { customerName: 'Phase One Test' });
    return {
      ok: started.ok && transcript.ok && summary.ok,
      started: started,
      transcript: transcript,
      summary: summary,
    };
  }, function(result) {
    return result.ok && result.summary.data.SalesBrief.indexOf('Phase One Test') !== -1;
  });
}

function serviceTestsPayments_(suite) {
  var ctx = suite.ctx;
  serviceTestsSeedCustomerBundle_(suite);
  diagSeedPaymentTemplateIds_(ctx.suffix);
  ConfigRepo.set('payments', 'drive.parent.ar.hpusa', 'ar_parent_hpusa_' + ctx.suffix);
  ConfigRepo.set('payments', 'drive.parent.ar.vvs', 'ar_parent_vvs_' + ctx.suffix);
  serviceTestCall_(suite, 'PaymentService.init reads customer and ledger context', function() {
    return PaymentService.init(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.rootApptId === ctx.rootId && result.data.eligibleDocTypes.length === 4;
  });

  [
    { brand: 'HPUSA', mode: '', taxable: false },
    { brand: 'VVS', mode: 'TAX', taxable: true },
    { brand: 'VVS', mode: 'NOTAX', taxable: false },
  ].forEach(function(combo) {
    ['DI', 'DR', 'SI', 'SR'].forEach(function(docType) {
      serviceTestCall_(suite, 'PaymentService.submit generates docs for ' + combo.brand + ' ' + (combo.mode || 'standard') + ' ' + docType, function() {
        return PaymentService.submit(ctx.rootId, serviceTestPaymentPayload_(ctx, combo.brand, combo.mode, docType, {
          Taxable: combo.taxable,
          SO: ctx.soNumber + '_' + combo.brand + '_' + (combo.mode || 'STD'),
        }));
      }, function(result) {
        return result.ok &&
          result.data.payment.Brand === combo.brand &&
          result.data.payment.DocType === docType &&
          result.data.payment.DocNumber.indexOf(combo.brand + '-' + docType + '-') === 0 &&
          String(result.data.doc.TemplateID || '').toUpperCase().indexOf(combo.brand + '_' + docType) !== -1 &&
          result.data.payment.DocFileId &&
          result.data.payment.DocPDFId &&
          result.data.payment.DocURL &&
          result.data.payment.PDFURL &&
          result.data.payment.ARShortcutId;
      });
    });
  });

  serviceTestCall_(suite, 'PaymentService.validatePrerequisites blocks Sales Receipt without Sales Invoice', function() {
    return PaymentService.validatePrerequisites(ctx.rootId, 'SR', {
      Brand: 'HPUSA',
      SO: 'missing_invoice_' + ctx.suffix,
    });
  }, function(result) {
    return !result.ok && result.reason === 'sales_invoice_required';
  });

  serviceTestCall_(suite, 'PaymentService.validatePrerequisites allows Sales Receipt with Sales Invoice', function() {
    return PaymentService.validatePrerequisites(ctx.rootId, 'SR', {
      Brand: 'HPUSA',
      SO: ctx.soNumber + '_HPUSA_STD',
    });
  }, function(result) {
    return result.ok && result.data.eligible === true;
  });

  serviceTestCall_(suite, 'PaymentService doc number sequencing produces 50 distinct numbers', function() {
    var seen = {};
    var duplicate = false;
    for (var i = 0; i < 50; i += 1) {
      var next = paymentNextDocNumber_('HPUSA', 'DI');
      if (!next.ok) {
        return next;
      }
      duplicate = duplicate || Boolean(seen[next.data.docNumber]);
      seen[next.data.docNumber] = true;
    }
    return {
      ok: !duplicate && Object.keys(seen).length === 50,
      count: Object.keys(seen).length,
    };
  }, function(result) {
    return result.ok && result.count === 50;
  });

  serviceTestCall_(suite, 'PaymentService.submitCombo creates Sales Invoice then Sales Receipt', function() {
    return PaymentService.submitCombo(ctx.rootId, serviceTestPaymentPayload_(ctx, 'HPUSA', '', 'SI', {
      SO: 'combo_' + ctx.suffix,
      AmountReceived: 125,
    }));
  }, function(result) {
    return result.ok &&
      result.data.invoice.payment.DocType === 'SI' &&
      result.data.receipt.payment.DocType === 'SR' &&
      result.data.receipt.payment.PDFURL;
  });

  serviceTestCall_(suite, 'PaymentService.adminVoid reverses receipt summary and keeps doc links', function() {
    var receipt = PaymentService.submit(ctx.rootId, serviceTestPaymentPayload_(ctx, 'HPUSA', '', 'DR', {
      SO: 'void_' + ctx.suffix,
      AmountReceived: 60,
    }));
    if (!receipt.ok) {
      return receipt;
    }
    var before = Ledger.summary(ctx.rootId);
    var voided = PaymentService.adminVoid(receipt.data.payment.PaymentId, 'service test void', receipt.data.payment.Version);
    var after = Ledger.summary(ctx.rootId);
    return {
      ok: voided.ok && after.ok && before.ok,
      before: before,
      after: after,
      voided: voided,
    };
  }, function(result) {
    return result.ok &&
      result.after.data.paidToDate <= result.before.data.paidToDate - 60 &&
      result.voided.data.payment.Status === 'Voided' &&
      result.voided.data.payment.DocURL &&
      result.voided.data.payment.PDFURL;
  });

  serviceTestCall_(suite, 'PaymentService.regenerateDoc succeeds after Phase 2 template failure', function() {
    var failed = PaymentService.submit(ctx.rootId, serviceTestPaymentPayload_(ctx, 'HPUSA', '', 'DI', {
      SO: 'regen_' + ctx.suffix,
      ForceTemplateMissing: true,
    }));
    if (failed.ok || !failed.detail || !failed.detail.payment) {
      return failed;
    }
    var regenerated = PaymentService.regenerateDoc(failed.detail.payment.PaymentId);
    return {
      ok: regenerated.ok,
      failed: failed,
      regenerated: regenerated,
    };
  }, function(result) {
    return result.ok && result.regenerated.data.payment.DocURL && result.regenerated.data.payment.PDFURL;
  });
}

function serviceTestPaymentPayload_(ctx, brand, mode, docType, overrides) {
  var taxable = overrides && overrides.Taxable !== undefined ? overrides.Taxable : mode === 'TAX';
  return mergeObjects_({
    Brand: brand,
    DocType: docType,
    SO: ctx.soNumber + '_' + brand + '_' + (mode || 'STD') + '_' + docType,
    Method: 'card',
    AmountReceived: paymentIsReceipt_(docType) ? 50 : 0,
    LineItems: [{
      Description: brand + ' ' + docType + ' service test',
      Quantity: 1,
      UnitPrice: 200,
      Taxable: taxable,
    }],
  }, overrides || {});
}

function serviceTestsDiamonds_(suite) {
  var ctx = suite.ctx;
  serviceTestsSeedCustomerBundle_(suite);
  serviceTestCall_(suite, 'DiamondService proposal/order/delivery/return/decisions flows update stones', function() {
    var selectedCert = 'diamond_selected_' + ctx.suffix;
    var returnCert = 'diamond_return_' + ctx.suffix;
    var rejectedCert = 'diamond_rejected_' + ctx.suffix;
    var proposal = DiamondService.submitProposal(ctx.rootId, {
      stones: [
        { CertNo: selectedCert, Shape: 'Oval' },
        { CertNo: returnCert, Shape: 'Radiant' },
        { CertNo: rejectedCert, Shape: 'Round' },
      ],
      LookingForSummary: 'Phase 3 diamond proposal',
    });
    var order = DiamondService.submitOrderApproval([selectedCert, returnCert], {
      rejectedStoneIds: [rejectedCert],
    });
    var tracking = Stones.updateTracking([selectedCert, returnCert], {
      TrackingStatus: 'Arrived',
      TrackingETA: new Date(),
    });
    var delivery = DiamondService.submitConfirmDelivery([selectedCert, returnCert]);
    var decisions = DiamondService.submitDecisions(ctx.rootId, [{
      CertNo: selectedCert,
      Decision: 'Selected',
    }, {
      CertNo: returnCert,
      Decision: 'Return',
    }]);
    var returns = DiamondService.bulkMarkReturnInProgress([returnCert], 'Phase 4 return shipment');
    return {
      ok: proposal.ok && order.ok && tracking.ok && delivery.ok && returns.ok && decisions.ok,
      proposal: proposal,
      order: order,
      tracking: tracking,
      delivery: delivery,
      decisions: decisions,
      returns: returns,
      stones: Stones.getByRoot(ctx.rootId),
      logs: repoFindMany_('TaskLog', { RootApptID: ctx.rootId }),
      selectedCert: selectedCert,
      returnCert: returnCert,
      rejectedCert: rejectedCert,
    };
  }, function(result) {
    var byCert = {};
    result.stones.data.forEach(function(row) {
      byCert[row.CertNo] = row;
    });
    var hasBulkReturnLog = result.logs.data.some(function(row) {
      return row.EventType === TASK_TYPE.RETURN_DIAMONDS &&
        row.MetadataJson &&
        row.MetadataJson.bulkReturn === true &&
        row.MetadataJson.certNo === result.returnCert;
    });
    return result.ok &&
      byCert[result.selectedCert] &&
      byCert[result.selectedCert].OrderStatus === 'Sold' &&
      byCert[result.returnCert] &&
      byCert[result.returnCert].ReturnStatus === 'Return In Progress' &&
      byCert[result.rejectedCert] &&
      byCert[result.rejectedCert].OrderStatus === 'Not Approved' &&
      hasBulkReturnLog;
  });

  serviceTestCall_(suite, 'Loupe360 sync preview/apply captures diffs and audit row', function() {
    var existingCert = 'loupe_existing_' + ctx.suffix;
    var newCert = 'loupe_new_' + ctx.suffix;
    Stones.assignInStock(existingCert, ctx.rootId, {
      Shape: 'Oval',
      Carat: 1.1,
    });
    var preview = Stones.previewLoupe360Sync('loupe_fixture_' + ctx.suffix, [{
      CertNo: existingCert,
      Shape: 'Emerald',
      Carat: 1.1,
      StoneStatus: 'In Stock',
    }, {
      CertNo: newCert,
      Shape: 'Pear',
      Carat: 2.2,
      StoneStatus: 'In Stock',
    }, {
      CertNo: newCert,
      Shape: 'Duplicate',
      StoneStatus: 'In Stock',
    }]);
    var applied = Stones.applyLoupe360Sync(preview.data.syncId);
    var syncRows = repoFindMany_('StonesSync', { SyncID: preview.data.syncId });
    var updated = Stones.get(existingCert);
    var appended = Stones.get(newCert);
    return {
      ok: preview.ok && applied.ok && syncRows.ok && updated.ok && appended.ok,
      preview: preview,
      applied: applied,
      syncRows: syncRows,
      updated: updated,
      appended: appended,
    };
  }, function(result) {
    return result.ok &&
      result.preview.data.matched === 1 &&
      result.preview.data.willUpdate === 1 &&
      result.preview.data.willAppend === 1 &&
      result.preview.data.skipped === 1 &&
      result.preview.data.changes[0].diffs.length >= 1 &&
      result.syncRows.data.length === 1 &&
      result.syncRows.data[0].Updated === 1 &&
      result.syncRows.data[0].Appended === 1 &&
      result.updated.data.Shape === 'Emerald' &&
      result.appended.data.Shape === 'Pear';
  });
}

function serviceTestsTaskCompletion_(suite) {
  var ctx = suite.ctx;
  var actor = { email: ctx.userEmail, roles: [ROLE.CLIENT_ADVISOR] };
  serviceTestsSeedCustomerBundle_(suite);
  serviceTestCall_(suite, 'TaskCompletion status task dispatches and completes', function() {
    var task = Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      TaskID: 'task_status_' + ctx.suffix,
      TaskType: TASK_TYPE.POST_CONSULT_CLIENT_STATUS,
    }));
    return TaskCompletion.complete(task.data.TaskID, {
      SalesStage: SALES_STAGE.CONSULT_COMPLETE,
    }, task.version, actor);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.COMPLETED;
  });

  serviceTestCall_(suite, 'TaskCompletion diamond task dispatches adapter', function() {
    var task = Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      TaskID: 'task_diamond_' + ctx.suffix,
      TaskType: TASK_TYPE.ORDER_DIAMONDS,
    }));
    return TaskCompletion.complete(task.data.TaskID, {
      stoneIds: ['task_stone_' + ctx.suffix],
    }, task.version, actor);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.COMPLETED;
  });

  serviceTestCall_(suite, 'TaskCompletion appointment checklist marks artifact requirement', function() {
    var task = Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      TaskID: 'task_checklist_' + ctx.suffix,
      TaskType: TASK_TYPE.APPOINTMENT_DAY_CHECKLIST,
    }));
    var completed = TaskCompletion.complete(task.data.TaskID, {
      artifactRequirements: ['recording'],
    }, task.version, actor);
    var artifacts = Artifacts.getByRoot(ctx.rootId);
    return {
      ok: completed.ok && artifacts.ok,
      completed: completed,
      artifacts: artifacts,
    };
  }, function(result) {
    return result.ok &&
      result.completed.data.task.TaskState === TASK_STATE.COMPLETED &&
      result.artifacts.data.some(function(row) {
        return row.TaskID === 'task_checklist_' + suite.ctx.suffix &&
          row.WorkflowStage === ARTIFACT_STAGE.REQUIRED &&
          row.ArtifactType === 'recording';
      });
  });
}

function serviceTestsArtifacts_(suite) {
  var ctx = suite.ctx;
  serviceTestsSeedCustomerBundle_(suite);
  var task = Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
    TaskID: 'task_artifact_' + ctx.suffix,
    TaskType: TASK_TYPE.APPOINTMENT_DAY_CHECKLIST,
  }));
  serviceTestCall_(suite, 'ArtifactService uploadFolder and syncDriveUploads register dropped file', function() {
    var folder = ArtifactService.uploadFolder(task.data.TaskID, 'recording');
    driveExtRegisterTestFile_(folder.data.folderId, {
      Name: 'phase3-recording.mp3',
      Url: 'https://example.com/phase3-recording.mp3',
    });
    var synced = ArtifactService.syncDriveUploads(task.data.TaskID);
    return {
      ok: folder.ok && synced.ok,
      folder: folder,
      synced: synced,
    };
  }, function(result) {
    return result.ok && result.synced.data.count >= 1;
  });

  serviceTestCall_(suite, 'ArtifactService processTick moves upload through summary ready', function() {
    var first = ArtifactService.processTick();
    var second = ArtifactService.processTick();
    var third = ArtifactService.processTick();
    var artifacts = Artifacts.getByRoot(ctx.rootId);
    return {
      ok: first.ok && second.ok && third.ok && artifacts.ok,
      first: first,
      second: second,
      third: third,
      artifacts: artifacts,
    };
  }, function(result) {
    return result.ok && result.artifacts.data.some(function(row) {
      return row.WorkflowStage === ARTIFACT_STAGE.SUMMARY_READY;
    });
  });
}

function serviceTestsSeedCustomerBundle_(suite) {
  var ctx = suite.ctx;
  if (suite.seeded) {
    return;
  }
  suite.seeded = true;
  Appointments.upsertEvent(repoTestAppointment_(ctx));
  RootAppointments.create(repoTestRootAppointment_(ctx));
  CustomerInfo.create(repoTestCustomer_(ctx));
  repoAppend_('ClientStatus', repoTestClientStatus_(ctx));
  repoAppend_('DiamondViewing', repoTestDiamondViewing_(ctx));
  repoAppend_('Order3D', repoTestOrder3D_(ctx));
}

function serviceTestSuite_(ctx) {
  return {
    ctx: ctx,
    results: [],
    seeded: false,
  };
}

function serviceTestCall_(suite, name, callback, assertion) {
  var detail;
  var ok = false;
  try {
    detail = callback();
    ok = assertion ? Boolean(assertion(detail)) : Boolean(detail && detail.ok);
  } catch (err) {
    detail = {
      error: err.message,
      stack: err.stack || '',
    };
  }
  serviceTestCheck_(suite, name, ok, detail);
  return detail;
}

function serviceTestCheck_(suite, name, condition, detail) {
  suite.results.push({
    ok: Boolean(condition),
    name: name,
    detail: detail,
  });
}

function serviceTestsBuildResult_(suite) {
  var failures = suite.results.filter(function(result) {
    return !result.ok;
  });
  return {
    ok: failures.length === 0,
    testCount: suite.results.length,
    failureCount: failures.length,
    failures: failures,
    results: suite.results,
  };
}

function serviceTestsLogResult_(result) {
  console.log(JSON.stringify({
    ok: result.ok,
    testCount: result.testCount,
    failureCount: result.failureCount,
    failures: result.failures.map(function(failure) {
      return {
        name: failure.name,
        detail: failure.detail,
      };
    }),
  }));
}

function diagSeedPaymentTemplateIds_(suffix) {
  [
    'HPUSA_DI_TEMPLATE_ID',
    'HPUSA_DR_TEMPLATE_ID',
    'HPUSA_SI_TEMPLATE_ID',
    'HPUSA_SR_TEMPLATE_ID',
    'VVS_DI_TAX_TEMPLATE_ID',
    'VVS_DR_TAX_TEMPLATE_ID',
    'VVS_SI_TAX_TEMPLATE_ID',
    'VVS_SR_TAX_TEMPLATE_ID',
    'VVS_DI_NOTAX_TEMPLATE_ID',
    'VVS_DR_NOTAX_TEMPLATE_ID',
    'VVS_SI_NOTAX_TEMPLATE_ID',
    'VVS_SR_NOTAX_TEMPLATE_ID',
  ].forEach(function(key) {
    ConfigRepo.set('payments', key, 'tpl_' + key.toLowerCase() + '_' + suffix);
  });
}
