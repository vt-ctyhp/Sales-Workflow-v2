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
    { StoneID: 'stone_order', StoneStatus: 'Proposed' },
    { StoneID: 'stone_track', StoneStatus: 'Ordered' },
    { StoneID: 'stone_confirm', StoneStatus: 'Delivered Pending Confirmation' },
    { StoneID: 'stone_decision', StoneStatus: 'Decision Due' },
    { StoneID: 'stone_return', StoneStatus: 'Return Due' },
    { StoneID: 'stone_eta', StoneStatus: 'ETA Risk' },
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
  serviceTestCall_(suite, 'Stones adapter assigns and reads by root', function() {
    Stones.assign('stone_phase3_' + ctx.suffix, ctx.rootId, {
      Shape: 'Oval',
      Carat: 1.5,
      Color: 'E',
      Clarity: 'VS1',
    });
    var byRoot = Stones.getByRoot(ctx.rootId);
    var inStock = Stones.getInStock({ shape: 'Oval', inStockOnly: false });
    var preview = Stones.previewLoupe360Sync('loupe_' + ctx.suffix);
    var applied = Stones.applyLoupe360Sync('loupe_' + ctx.suffix, { changes: [] });
    return {
      ok: byRoot.ok && inStock.ok && preview.ok && applied.ok,
      byRoot: byRoot,
      inStock: inStock,
      preview: preview,
      applied: applied,
    };
  }, function(result) {
    return result.ok && result.byRoot.data.length >= 1;
  });

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
  serviceTestCall_(suite, 'PaymentService.init reads customer and ledger context', function() {
    return PaymentService.init(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.rootApptId === ctx.rootId;
  });
  serviceTestCall_(suite, 'PaymentService.submit appends ledger row', function() {
    var submitted = PaymentService.submit(ctx.rootId, {
      Amount: 250,
      Method: 'card',
      AdvanceSalesStage: SALES_STAGE.DEPOSIT_RECEIVED,
    });
    if (!submitted.ok) {
      return submitted;
    }
    var linked = Ledger.linkDocs(submitted.data.payment.PaymentID, 'https://example.com/invoice', 'https://example.com/receipt');
    return {
      ok: submitted.ok && linked.ok,
      submitted: submitted,
      linked: linked,
    };
  }, function(result) {
    return result.ok && result.submitted.data.summary.paidToDate >= 250 && result.linked.data.InvoiceUrl;
  });
}

function serviceTestsDiamonds_(suite) {
  var ctx = suite.ctx;
  serviceTestsSeedCustomerBundle_(suite);
  serviceTestCall_(suite, 'DiamondService proposal/order/delivery/return/decisions flows update stones', function() {
    var proposal = DiamondService.submitProposal(ctx.rootId, {
      stones: [{ StoneID: 'diamond_phase3_' + ctx.suffix, Shape: 'Oval' }],
      LookingForSummary: 'Phase 3 diamond proposal',
    });
    var order = DiamondService.submitOrderApproval(['diamond_phase3_' + ctx.suffix]);
    var delivery = DiamondService.submitConfirmDelivery(['diamond_phase3_' + ctx.suffix]);
    var returns = DiamondService.bulkMarkReturnInProgress(['diamond_phase3_' + ctx.suffix]);
    var decisions = DiamondService.submitDecisions(ctx.rootId, [{
      StoneID: 'diamond_phase3_' + ctx.suffix,
      Decision: 'Selected',
    }]);
    return {
      ok: proposal.ok && order.ok && delivery.ok && returns.ok && decisions.ok,
      proposal: proposal,
      order: order,
      delivery: delivery,
      returns: returns,
      decisions: decisions,
      stones: Stones.getByRoot(ctx.rootId),
    };
  }, function(result) {
    return result.ok && result.stones.data.some(function(row) {
      return row.StoneID === 'diamond_phase3_' + suite.ctx.suffix && row.Decision === 'Selected';
    });
  });
}

function serviceTestsTaskCompletion_(suite) {
  var ctx = suite.ctx;
  serviceTestsSeedCustomerBundle_(suite);
  serviceTestCall_(suite, 'TaskCompletion status task dispatches and completes', function() {
    var task = Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      TaskID: 'task_status_' + ctx.suffix,
      TaskType: TASK_TYPE.POST_CONSULT_CLIENT_STATUS,
    }));
    return TaskCompletion.complete(task.data.TaskID, {
      SalesStage: SALES_STAGE.CONSULT_COMPLETE,
    }, task.version);
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
    }, task.version);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.COMPLETED;
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
