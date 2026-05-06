const ApiTests = Object.freeze({
  run: function() {
    var result = apiTestsRun_();
    apiTestsLogResult_(result);
    return result;
  },
});

function runApiTests() {
  return ApiTests.run();
}

function apiTestsRun_() {
  var suite = apiTestSuite_(repoTestContext_());
  apiTestsSeed_(suite);
  apiTestsAuth_(suite);
  apiTestsAuthFailures_(suite);
  apiTestsHappyPaths_(suite);
  apiTestsRoleRules_(suite);
  apiTestsBenchmarks_(suite);
  return apiTestsBuildResult_(suite);
}

function apiTestsSeed_(suite) {
  var ctx = suite.ctx;
  ctx.adminEmail = 'phase5.admin+' + ctx.suffix + '@example.com';
  ctx.adminPassword = 'Phase5!' + ctx.suffix;
  ctx.adminSalt = 'phase5_salt_' + ctx.suffix;
  ctx.completeTaskId = 'task_complete_' + ctx.suffix;
  ctx.snoozeTaskId = 'task_snooze_' + ctx.suffix;
  ctx.claimTaskId = 'task_claim_' + ctx.suffix;
  ctx.ackTaskId = 'task_ack_' + ctx.suffix;
  ctx.templateTaskId = 'task_template_' + ctx.suffix;
  ctx.adminTaskId = 'task_admin_' + ctx.suffix;
  ctx.artifactTaskId = 'task_artifact_api_' + ctx.suffix;
  ctx.returnCertNo = 'cert_return_api_' + ctx.suffix;
  ctx.assignCertNo = 'cert_assign_api_' + ctx.suffix;
  ctx.loupeExistingCertNo = 'cert_loupe_existing_' + ctx.suffix;
  ctx.loupeNewCertNo = 'cert_loupe_new_' + ctx.suffix;

  Appointments.upsertEvent(repoTestAppointment_(ctx));
  RootAppointments.create(repoTestRootAppointment_(ctx));
  CustomerInfo.create(repoTestCustomer_(ctx));
  repoAppend_('ClientStatus', repoTestClientStatus_(ctx));
  repoAppend_('DiamondViewing', repoTestDiamondViewing_(ctx));
  repoAppend_('Order3D', repoTestOrder3D_(ctx));
  repoAppend_('Templates', repoTestTemplate_(ctx));
  Users.upsert({
    Email: ctx.adminEmail,
    Name: 'Phase 5 Admin',
    RolesCsv: [ROLE.ADMIN, ROLE.CLIENT_ADVISOR, ROLE.JOC, ROLE.DIAMOND_ORDER_ADMIN, ROLE.DIAMOND_ORDER_ASSISTANT].join(','),
    Active: true,
    PasswordSalt: ctx.adminSalt,
    PasswordHash: AuthService.hashPassword(ctx.adminPassword, ctx.adminSalt),
  });
  Users.upsert(repoTestUser_(ctx));

  [
    ctx.taskId,
    ctx.completeTaskId,
    ctx.snoozeTaskId,
    ctx.claimTaskId,
    ctx.ackTaskId,
    ctx.templateTaskId,
    ctx.adminTaskId,
    ctx.artifactTaskId,
  ].forEach(function(taskId) {
    Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      TaskID: taskId,
      TaskType: taskId === ctx.completeTaskId ? TASK_TYPE.POST_CONSULT_CLIENT_STATUS : TASK_TYPE.SEND_WELCOME,
    }));
  });

  Artifacts.registerUpload(mergeObjects_(repoTestArtifact_(ctx), {
    WorkflowStage: ARTIFACT_STAGE.SUMMARY_READY,
    SummaryDocUrl: 'https://example.com/api-summary/' + ctx.suffix,
    TranscriptDocUrl: 'https://example.com/api-transcript/' + ctx.suffix,
  }));
  Stones.assignInStock(ctx.stockStoneCertNo, ctx.rootId, {
    Shape: 'Oval',
    Carat: 1.4,
  });
  Stones.assignInStock(ctx.assignCertNo, '', {
    Shape: 'Round',
    Carat: 1.1,
  });
  repoAppend_('Stones', {
    CertNo: ctx.returnCertNo,
    StoneStatus: 'In Stock',
    OrderStatus: 'Delivered',
    ReturnDueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
  Stones.assignInStock(ctx.loupeExistingCertNo, ctx.rootId, {
    Shape: 'Oval',
    Carat: 1.2,
  });
  Ledger.append(ctx.rootId, {
    Amount: 50,
    Method: 'seed',
  });
}

function apiTestsAuth_(suite) {
  var ctx = suite.ctx;
  var login = apiTestCall_(suite, 'Api.auth.login returns session and bootstrap', function() {
    return ApiAuth.login(ctx.adminEmail, ctx.adminPassword);
  }, function(result) {
    return result.ok && result.data.session.token && result.data.bootstrap.user.email === ctx.adminEmail;
  });
  if (login.ok) {
    suite.sessionContext = {
      sessionToken: login.data.session.token,
    };
  }
  apiTestCall_(suite, 'Api.auth.login rejects invalid password', function() {
    return ApiAuth.login(ctx.adminEmail, 'wrong-password');
  }, function(result) {
    return !result.ok && result.reason === 'invalid_credentials';
  });
  apiTestCall_(suite, 'Api.auth.logout clears session token', function() {
    return ApiAuth.logout(suite.sessionContext || {});
  }, function(result) {
    return result.ok;
  });
}

function apiTestsAuthFailures_(suite) {
  [
    ['Api.bootstrap.get auth failure', function() { return ApiBootstrap.get(); }],
    ['Api.tasks.list auth failure', function() { return ApiTasks.list('mine'); }],
    ['Api.tasks.detail auth failure', function() { return ApiTasks.detail(suite.ctx.taskId); }],
    ['Api.tasks.complete auth failure', function() { return ApiTasks.complete(suite.ctx.completeTaskId, {}, 1); }],
    ['Api.tasks.snooze auth failure', function() { return ApiTasks.snooze(suite.ctx.snoozeTaskId, new Date(), '', 1); }],
    ['Api.tasks.claim auth failure', function() { return ApiTasks.claim(suite.ctx.claimTaskId, 1); }],
    ['Api.tasks.acknowledge auth failure', function() { return ApiTasks.acknowledge(suite.ctx.ackTaskId, 1); }],
    ['Api.tasks.logTemplateCopied auth failure', function() { return ApiTasks.logTemplateCopied(suite.ctx.templateTaskId); }],
    ['Api.customers.search auth failure', function() { return ApiCustomers.search({}); }],
    ['Api.customers.getDetail auth failure', function() { return ApiCustomers.getDetail(suite.ctx.rootId, 'standard'); }],
    ['Api.customers.updateStatus auth failure', function() { return ApiCustomers.updateStatus(suite.ctx.rootId, {}, 1); }],
    ['Api.customers.updateDeadline auth failure', function() { return ApiCustomers.updateDeadline(suite.ctx.rootId, {}, 1); }],
    ['Api.customers.submit3DRevision auth failure', function() { return ApiCustomers.submit3DRevision(suite.ctx.rootId, {}, 1); }],
    ['Api.customers.requestWax auth failure', function() { return ApiCustomers.requestWax(suite.ctx.rootId, {}, 1); }],
    ['Api.customers.startOrder auth failure', function() { return ApiCustomers.startOrder(suite.ctx.rootId, {}, 1); }],
    ['Api.calendar.getMonth auth failure', function() { return ApiCalendar.getMonth('2026-05'); }],
    ['Api.calendar.getAiBrief auth failure', function() { return ApiCalendar.getAiBrief(suite.ctx.rootId); }],
    ['Api.admin.dashboard auth failure', function() { return ApiAdmin.dashboard({}); }],
    ['Api.admin.assignOwners auth failure', function() { return ApiAdmin.assignOwners(suite.ctx.rootId, {}, {}, 1); }],
    ['Api.admin.reassignTask auth failure', function() { return ApiAdmin.reassignTask(suite.ctx.adminTaskId, {}, 1); }],
    ['Api.admin.blockTask auth failure', function() { return ApiAdmin.blockTask(suite.ctx.adminTaskId, '', 1); }],
    ['Api.admin.unblockTask auth failure', function() { return ApiAdmin.unblockTask(suite.ctx.adminTaskId, 1); }],
    ['Api.schedules.list auth failure', function() { return ApiSchedules.list(); }],
    ['Api.schedules.save auth failure', function() { return ApiSchedules.save([]); }],
    ['Api.schedules.upsertChange auth failure', function() { return ApiSchedules.upsertChange({}); }],
    ['Api.schedules.deleteChange auth failure', function() { return ApiSchedules.deleteChange(suite.ctx.scheduleChangeId); }],
    ['Api.users.list auth failure', function() { return ApiUsers.list(); }],
    ['Api.users.upsert auth failure', function() { return ApiUsers.upsert({ Email: 'x@example.com' }); }],
    ['Api.diamonds.inStock auth failure', function() { return ApiDiamonds.inStock({}); }],
    ['Api.diamonds.tracking auth failure', function() { return ApiDiamonds.tracking({}); }],
    ['Api.diamonds.bulkReturnCandidates auth failure', function() { return ApiDiamonds.bulkReturnCandidates({}); }],
    ['Api.diamonds.bulkMarkReturnInProgress auth failure', function() { return ApiDiamonds.bulkMarkReturnInProgress([suite.ctx.returnCertNo], '', 1); }],
    ['Api.diamonds.assignInStock auth failure', function() { return ApiDiamonds.assignInStock(suite.ctx.assignCertNo, suite.ctx.rootId, {}, 1); }],
    ['Api.diamonds.byRoot auth failure', function() { return ApiDiamonds.byRoot(suite.ctx.rootId); }],
    ['Api.diamonds.previewLoupe360Sync auth failure', function() { return ApiDiamonds.previewLoupe360Sync('file'); }],
    ['Api.diamonds.applyLoupe360Sync auth failure', function() { return ApiDiamonds.applyLoupe360Sync('sync'); }],
    ['Api.payments.init auth failure', function() { return ApiPayments.init(suite.ctx.rootId); }],
    ['Api.payments.submit auth failure', function() { return ApiPayments.submit(suite.ctx.rootId, {}, 1); }],
    ['Api.payments.history auth failure', function() { return ApiPayments.history(suite.ctx.rootId); }],
    ['Api.payments.exportPdf auth failure', function() { return ApiPayments.exportPdf('pay_missing'); }],
    ['Api.payments.reset auth failure', function() { return ApiPayments.reset(suite.ctx.rootId, 1); }],
    ['Api.artifacts.uploadFolder auth failure', function() { return ApiArtifacts.uploadFolder(suite.ctx.artifactTaskId, 'recording'); }],
    ['Api.artifacts.syncDriveUploads auth failure', function() { return ApiArtifacts.syncDriveUploads(suite.ctx.artifactTaskId); }],
    ['Api.artifacts.getBrief auth failure', function() { return ApiArtifacts.getBrief(suite.ctx.rootId); }],
    ['Api.intake.injectTest auth failure', function() { return ApiIntake.injectTest(testIntakePayload_(suite.ctx, 'api_auth', 'create', {})); }],
    ['Api.intake.manualBooking auth failure', function() { return ApiIntake.manualBooking(testIntakePayload_(suite.ctx, 'api_auth_manual', 'create', {})); }],
    ['Api.intake.runTestScenarios auth failure', function() { return ApiIntake.runTestScenarios(); }],
    ['Api.diag.benchmarks auth failure', function() { return ApiDiagnostics.benchmarks(); }],
    ['Api.diag.driftReport auth failure', function() { return ApiDiagnostics.driftReport(); }],
    ['Api.diag.opsLog auth failure', function() { return ApiDiagnostics.opsLog({}); }],
  ].forEach(function(check) {
    apiTestCall_(suite, check[0], check[1], apiTestAuthRequired_);
  });
}

function apiTestsHappyPaths_(suite) {
  var ctx = suite.ctx;
  var admin = apiTestContext_(ROLE.ADMIN, ctx.adminEmail);
  var staff = apiTestContext_([ROLE.ADMIN, ROLE.CLIENT_ADVISOR, ROLE.JOC, ROLE.DIAMOND_ORDER_ADMIN, ROLE.DIAMOND_ORDER_ASSISTANT], ctx.adminEmail);

  apiTestCall_(suite, 'Api.bootstrap.get happy path', function() {
    return ApiBootstrap.get(admin);
  }, function(result) {
    return result.ok && result.data.user.email === ctx.adminEmail && result.data.visibleViews.indexOf('admin') !== -1;
  });
  apiTestCall_(suite, 'Api.tasks.list happy path', function() {
    return ApiTasks.list({ view: 'admin', includeCompleted: true }, admin);
  }, function(result) {
    return result.ok && result.data.tasks.length >= 1;
  });
  apiTestCall_(suite, 'Api.tasks.detail happy path', function() {
    return ApiTasks.detail(ctx.taskId, staff);
  }, function(result) {
    return result.ok && result.data.task.TaskID === ctx.taskId;
  });
  apiTestCall_(suite, 'Api.tasks.complete happy path', function() {
    var task = Tasks.get(ctx.completeTaskId);
    return ApiTasks.complete(ctx.completeTaskId, {
      SalesStage: SALES_STAGE.CONSULT_COMPLETE,
    }, task.version, staff);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.COMPLETED;
  });
  apiTestCall_(suite, 'Api.tasks.snooze happy path', function() {
    var task = Tasks.get(ctx.snoozeTaskId);
    return ApiTasks.snooze(ctx.snoozeTaskId, new Date(Date.now() + 3600000), 'api test', task.version, staff);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.SNOOZED;
  });
  apiTestCall_(suite, 'Api.tasks.claim happy path', function() {
    var task = Tasks.get(ctx.claimTaskId);
    return ApiTasks.claim(ctx.claimTaskId, task.version, staff);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.CLAIMED;
  });
  apiTestCall_(suite, 'Api.tasks.acknowledge happy path', function() {
    var task = Tasks.get(ctx.ackTaskId);
    return ApiTasks.acknowledge(ctx.ackTaskId, task.version, staff);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.COMPLETED;
  });
  apiTestCall_(suite, 'Api.tasks.logTemplateCopied happy path', function() {
    return ApiTasks.logTemplateCopied(ctx.templateTaskId, staff);
  }, function(result) {
    return result.ok && result.data.log.EventType === 'TEMPLATE_COPIED';
  });

  apiTestCall_(suite, 'Api.customers.search happy path', function() {
    return ApiCustomers.search({ q: ctx.customerEmail, includeClosed: true }, staff);
  }, function(result) {
    return result.ok && result.data.rows.some(function(row) { return row.rootApptId === ctx.rootId; });
  });
  apiTestCall_(suite, 'Api.customers.getDetail happy path', function() {
    return ApiCustomers.getDetail(ctx.rootId, 'standard', staff);
  }, function(result) {
    return result.ok && result.data.rootApptId === ctx.rootId;
  });
  apiTestCall_(suite, 'Api.customers.updateStatus happy path', function() {
    var status = ClientStatus.get(ctx.rootId);
    return ApiCustomers.updateStatus(ctx.rootId, {
      SalesStage: SALES_STAGE.QUOTE_SENT,
      NextSteps: 'Phase 5 API status update',
    }, status.version, staff);
  }, function(result) {
    return result.ok && result.data.status.SalesStage === SALES_STAGE.QUOTE_SENT;
  });
  apiTestCall_(suite, 'Api.customers.updateDeadline happy path', function() {
    var status = ClientStatus.get(ctx.rootId);
    return ApiCustomers.updateDeadline(ctx.rootId, {
      Deadline3D: ctx.deadlineDate,
      Deadline3DMoveReason: 'Phase 5 API deadline update',
    }, status.version, staff);
  }, function(result) {
    return result.ok && Boolean(result.data.status.Deadline3DUpdatedAt);
  });
  apiTestCall_(suite, 'Api.customers.submit3DRevision happy path', function() {
    var order = Order3D.get(ctx.rootId);
    return ApiCustomers.submit3DRevision(ctx.rootId, {
      RevisionRequest: 'Phase 5 API revision',
    }, order.version, staff);
  }, function(result) {
    return result.ok && result.data.order3d.RevisionCount >= 1;
  });
  apiTestCall_(suite, 'Api.customers.requestWax happy path', function() {
    return ApiCustomers.requestWax(ctx.rootId, {
      AdminDeadline: ctx.deadlineDate,
      Notes: 'Phase 5 API wax',
    }, null, staff);
  }, function(result) {
    return result.ok && result.data.wax.RootApptID === ctx.rootId;
  });
  apiTestCall_(suite, 'Api.customers.startOrder happy path', function() {
    var order = Order3D.get(ctx.rootId);
    return ApiCustomers.startOrder(ctx.rootId, {
      SONumber: ctx.soNumber,
      DesignRequest: 'Phase 5 API start order',
    }, order.version, staff);
  }, function(result) {
    return result.ok && result.data.order3d.Current3DState === 'Started';
  });

  apiTestCall_(suite, 'Api.calendar.getMonth happy path', function() {
    return ApiCalendar.getMonth('2026-05', staff);
  }, function(result) {
    return result.ok && result.data.eventCount >= 1;
  });
  apiTestCall_(suite, 'Api.calendar.getAiBrief happy path', function() {
    return ApiCalendar.getAiBrief(ctx.rootId, staff);
  }, function(result) {
    return result.ok && result.data.aiBrief;
  });

  apiTestCall_(suite, 'Api.admin.dashboard happy path', function() {
    return ApiAdmin.dashboard({}, admin);
  }, function(result) {
    return result.ok && result.data.totals.tasks >= 1;
  });
  apiTestCall_(suite, 'Api.admin.assignOwners happy path', function() {
    var customer = CustomerInfo.get(ctx.rootId);
    return ApiAdmin.assignOwners(ctx.rootId, {
      email: 'advisor+' + ctx.suffix + '@example.com',
      name: 'API Advisor',
    }, {
      email: 'joc+' + ctx.suffix + '@example.com',
      name: 'API JOC',
    }, customer.version, admin);
  }, function(result) {
    return result.ok && result.data.customer.ClientAdvisorName === 'API Advisor';
  });
  apiTestCall_(suite, 'Api.admin.reassignTask happy path', function() {
    var task = Tasks.get(ctx.adminTaskId);
    return ApiAdmin.reassignTask(ctx.adminTaskId, {
      email: 'assigned+' + ctx.suffix + '@example.com',
      name: 'Assigned API',
      role: ROLE.JOC,
    }, task.version, admin);
  }, function(result) {
    return result.ok && result.data.task.OwnerRole === ROLE.JOC;
  });
  apiTestCall_(suite, 'Api.admin.blockTask happy path', function() {
    var task = Tasks.get(ctx.adminTaskId);
    return ApiAdmin.blockTask(ctx.adminTaskId, 'Phase 5 block', task.version, admin);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.BLOCKED;
  });
  apiTestCall_(suite, 'Api.admin.unblockTask happy path', function() {
    var task = Tasks.get(ctx.adminTaskId);
    return ApiAdmin.unblockTask(ctx.adminTaskId, task.version, admin);
  }, function(result) {
    return result.ok && result.data.task.TaskState === TASK_STATE.OPEN;
  });

  apiTestCall_(suite, 'Api.schedules.list happy path', function() {
    return ApiSchedules.list(admin);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.schedules.save happy path', function() {
    return ApiSchedules.save([repoTestSchedule_(ctx)], admin);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.schedules.upsertChange happy path', function() {
    return ApiSchedules.upsertChange(repoTestScheduleChange_(ctx), admin);
  }, function(result) {
    return result.ok && result.data.ScheduleChangeID === ctx.scheduleChangeId;
  });
  apiTestCall_(suite, 'Api.schedules.deleteChange happy path', function() {
    return ApiSchedules.deleteChange(ctx.scheduleChangeId, admin);
  }, function(result) {
    return result.ok && result.data.deleted === true;
  });
  apiTestCall_(suite, 'Api.users.list happy path', function() {
    return ApiUsers.list(admin);
  }, function(result) {
    return result.ok && result.data.some(function(user) { return user.email === ctx.adminEmail; });
  });
  apiTestCall_(suite, 'Api.users.upsert happy path', function() {
    return ApiUsers.upsert({
      Email: 'phase5.new+' + ctx.suffix + '@example.com',
      Name: 'Phase 5 New User',
      roles: [ROLE.READ_ONLY_VIEWER],
      Active: true,
      Password: 'new-password',
    }, admin);
  }, function(result) {
    return result.ok && result.data.roles.indexOf(ROLE.READ_ONLY_VIEWER) !== -1;
  });

  apiTestCall_(suite, 'Api.diamonds.inStock happy path', function() {
    return ApiDiamonds.inStock({}, staff);
  }, function(result) {
    return result.ok && result.data.rows.length >= 1;
  });
  apiTestCall_(suite, 'Api.diamonds.tracking happy path', function() {
    return ApiDiamonds.tracking({}, staff);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.diamonds.bulkReturnCandidates happy path', function() {
    return ApiDiamonds.bulkReturnCandidates({}, staff);
  }, function(result) {
    return result.ok && result.data.some(function(row) { return row.CertNo === ctx.returnCertNo; });
  });
  apiTestCall_(suite, 'Api.diamonds.bulkMarkReturnInProgress happy path', function() {
    return ApiDiamonds.bulkMarkReturnInProgress([ctx.returnCertNo], 'Phase 5 return', null, staff);
  }, function(result) {
    return result.ok && result.data.updated.length === 1;
  });
  apiTestCall_(suite, 'Api.diamonds.byRoot happy path', function() {
    return ApiDiamonds.byRoot(ctx.rootId, staff);
  }, function(result) {
    return result.ok && result.data.rows.length >= 1;
  });

  apiTestCall_(suite, 'Api.payments.init happy path', function() {
    return ApiPayments.init(ctx.rootId, staff);
  }, function(result) {
    return result.ok && result.data.rootApptId === ctx.rootId;
  });
  apiTestCall_(suite, 'Api.payments.submit happy path', function() {
    return ApiPayments.submit(ctx.rootId, {
      Amount: 75,
      Method: 'card',
    }, null, staff);
  }, function(result) {
    if (result.ok) {
      suite.paymentId = result.data.payment.PaymentID;
    }
    return result.ok && result.data.summary.paymentCount >= 1;
  });
  apiTestCall_(suite, 'Api.payments.history happy path', function() {
    return ApiPayments.history(ctx.rootId, staff);
  }, function(result) {
    return result.ok && result.data.length >= 1;
  });
  apiTestCall_(suite, 'Api.payments.exportPdf happy path', function() {
    return ApiPayments.exportPdf(suite.paymentId, staff);
  }, function(result) {
    return result.ok && result.data.invoiceUrl.indexOf(suite.paymentId) !== -1;
  });
  apiTestCall_(suite, 'Api.payments.reset happy path', function() {
    return ApiPayments.reset(ctx.rootId, null, admin);
  }, function(result) {
    return result.ok && result.data.rootApptId === ctx.rootId;
  });

  apiTestCall_(suite, 'Api.artifacts.uploadFolder happy path', function() {
    return ApiArtifacts.uploadFolder(ctx.artifactTaskId, 'recording', staff);
  }, function(result) {
    return result.ok && result.data.folderId;
  });
  apiTestCall_(suite, 'Api.artifacts.syncDriveUploads happy path', function() {
    var folder = ApiArtifacts.uploadFolder(ctx.artifactTaskId, 'recording', staff);
    driveExtRegisterTestFile_(folder.data.folderId, {
      Name: 'phase5-api-recording.mp3',
      Url: 'https://example.com/phase5-api-recording.mp3',
    });
    return ApiArtifacts.syncDriveUploads(ctx.artifactTaskId, staff);
  }, function(result) {
    return result.ok && result.data.count >= 1;
  });
  apiTestCall_(suite, 'Api.artifacts.getBrief happy path', function() {
    return ApiArtifacts.getBrief(ctx.rootId, staff);
  }, function(result) {
    return result.ok && result.data.aiBrief;
  });

  apiTestCall_(suite, 'Api.intake.injectTest happy path', function() {
    return ApiIntake.injectTest(testIntakePayload_(ctx, 'api_inject', 'create', {}), admin);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.intake.manualBooking happy path', function() {
    return ApiIntake.manualBooking(testIntakePayload_(ctx, 'api_manual', 'create', {}), admin);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.intake.runTestScenarios happy path', function() {
    return ApiIntake.runTestScenarios(admin);
  }, function(result) {
    return result.ok && result.failureCount === 0;
  });

  apiTestCall_(suite, 'Api.diag.driftReport happy path', function() {
    return ApiDiagnostics.driftReport(admin);
  }, apiTestOk_);
  apiTestCall_(suite, 'Api.diag.opsLog happy path', function() {
    return ApiDiagnostics.opsLog({ FunctionName: 'Api.tasks.complete' }, admin);
  }, apiTestOk_);
}

function apiTestsRoleRules_(suite) {
  var ctx = suite.ctx;
  var diamondAdmin = apiTestContext_(ROLE.DIAMOND_ORDER_ADMIN, 'diamond.admin+' + ctx.suffix + '@example.com');
  var assistant = apiTestContext_(ROLE.DIAMOND_ORDER_ASSISTANT, 'diamond.assistant+' + ctx.suffix + '@example.com');
  var admin = apiTestContext_(ROLE.ADMIN, ctx.adminEmail);

  apiTestCall_(suite, 'Diamond Order Admin can call Api.diamonds.assignInStock', function() {
    return ApiDiamonds.assignInStock(ctx.assignCertNo, ctx.rootId, {
      CustomerName: 'Phase One Test',
    }, null, diamondAdmin);
  }, function(result) {
    return result.ok && result.data.AssignedRootApptID === ctx.rootId;
  });
  apiTestCall_(suite, 'Diamond Order Assistant cannot call Api.diamonds.assignInStock', function() {
    return ApiDiamonds.assignInStock(ctx.assignCertNo, ctx.rootId, {}, null, assistant);
  }, apiTestForbidden_);

  var preview = apiTestCall_(suite, 'Api.diamonds.previewLoupe360Sync happy path', function() {
    return ApiDiamonds.previewLoupe360Sync('phase5_loupe_' + ctx.suffix, [{
      CertNo: ctx.loupeExistingCertNo,
      Shape: 'Emerald',
      Carat: 1.2,
      StoneStatus: 'In Stock',
    }, {
      CertNo: ctx.loupeNewCertNo,
      Shape: 'Pear',
      Carat: 2.1,
      StoneStatus: 'In Stock',
    }], diamondAdmin);
  }, function(result) {
    return result.ok && result.data.syncId && result.data.willAppend >= 1;
  });
  apiTestCall_(suite, 'Assistant cannot call Api.diamonds.applyLoupe360Sync', function() {
    return ApiDiamonds.applyLoupe360Sync(preview.data.syncId, assistant);
  }, apiTestForbidden_);
  apiTestCall_(suite, 'Admin can call Api.diamonds.applyLoupe360Sync', function() {
    return ApiDiamonds.applyLoupe360Sync(preview.data.syncId, admin);
  }, function(result) {
    return result.ok && result.data.appended >= 1;
  });
}

function apiTestsBenchmarks_(suite) {
  var admin = apiTestContext_(ROLE.ADMIN, suite.ctx.adminEmail);
  apiTestCall_(suite, 'Api.diag.benchmarks produces baseline', function() {
    return ApiDiagnostics.benchmarks(admin);
  }, function(result) {
    return result.ok && result.implemented === true && result.metrics.length >= 1 && result.slowestStep;
  });
}

function apiTestSuite_(ctx) {
  return {
    ctx: ctx,
    results: [],
    sessionContext: null,
    paymentId: '',
  };
}

function apiTestCall_(suite, name, callback, assertion) {
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
  suite.results.push({
    ok: ok,
    name: name,
    detail: detail,
  });
  return detail;
}

function apiTestOk_(result) {
  return Boolean(result && result.ok);
}

function apiTestAuthRequired_(result) {
  return Boolean(result && !result.ok && result.reason === 'auth_required' && result.error && result.error.code === 'AUTH_REQUIRED');
}

function apiTestForbidden_(result) {
  return Boolean(result && !result.ok && result.reason === 'forbidden' && result.error && result.error.code === 'FORBIDDEN');
}

function apiTestsBuildResult_(suite) {
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

function apiTestsLogResult_(result) {
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
