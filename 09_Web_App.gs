function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sales Workflow')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function webLogin(email, password) {
  return webSafeResponse_(ApiAuth.login(email, password));
}

function webLogout(token) {
  return webSafeResponse_(ApiAuth.logout(webContext_(token)));
}

function webBootstrap(token) {
  return webSafeResponse_(ApiBootstrap.get(webContext_(token)));
}

function webBootstrapAdmin(payload) {
  return webSafeResponse_(webBootstrapAdmin_(payload || {}));
}

function webTasksList(view, token) {
  return webSafeResponse_(ApiTasks.list(view || {}, webContext_(token)));
}

function webTaskDetail(taskId, token) {
  return webSafeResponse_(ApiTasks.detail(taskId, webContext_(token)));
}

function webTaskComplete(taskId, payload, version, token) {
  return webSafeResponse_(ApiTasks.complete(taskId, payload || {}, version, webContext_(token)));
}

function webTaskClaim(taskId, version, token) {
  return webSafeResponse_(ApiTasks.claim(taskId, version, webContext_(token)));
}

function webTaskAcknowledge(taskId, version, token) {
  return webSafeResponse_(ApiTasks.acknowledge(taskId, version, webContext_(token)));
}

function webTaskSnooze(taskId, until, reason, version, token) {
  return webSafeResponse_(ApiTasks.snooze(taskId, until, reason, version, webContext_(token)));
}

function webCustomersSearch(filters, token) {
  return webSafeResponse_(ApiCustomers.search(filters || {}, webContext_(token)));
}

function webCustomerDetail(rootApptId, mode, token) {
  return webSafeResponse_(ApiCustomers.getDetail(rootApptId, mode || 'standard', webContext_(token)));
}

function webCalendarMonth(monthKey, token) {
  return webSafeResponse_(ApiCalendar.getMonth(monthKey, webContext_(token)));
}

function webAdminDashboard(token) {
  return webSafeResponse_(ApiAdmin.dashboard({}, webContext_(token)));
}

function webAdminAssignOwners(rootApptId, advisor, joc, version, token) {
  return webSafeResponse_(ApiAdmin.assignOwners(rootApptId, advisor || {}, joc || {}, version, webContext_(token)));
}

function webAdminReassignTask(taskId, toUser, version, token) {
  return webSafeResponse_(ApiAdmin.reassignTask(taskId, toUser || {}, version, webContext_(token)));
}

function webAdminBlockTask(taskId, reason, version, token) {
  return webSafeResponse_(ApiAdmin.blockTask(taskId, reason || '', version, webContext_(token)));
}

function webAdminUnblockTask(taskId, version, token) {
  return webSafeResponse_(ApiAdmin.unblockTask(taskId, version, webContext_(token)));
}

function webSchedulesList(token) {
  return webSafeResponse_(ApiSchedules.list(webContext_(token)));
}

function webSchedulesSave(rows, token) {
  return webSafeResponse_(ApiSchedules.save(rows || [], webContext_(token)));
}

function webScheduleChangeUpsert(row, token) {
  return webSafeResponse_(ApiSchedules.upsertChange(row || {}, webContext_(token)));
}

function webScheduleChangeDelete(id, token) {
  return webSafeResponse_(ApiSchedules.deleteChange(id, webContext_(token)));
}

function webUsersList(token) {
  return webSafeResponse_(ApiUsers.list(webContext_(token)));
}

function webUserUpsert(user, token) {
  return webSafeResponse_(ApiUsers.upsert(user || {}, webContext_(token)));
}

function webDiamondsInStock(filters, token) {
  return webSafeResponse_(ApiDiamonds.inStock(filters || {}, webContext_(token)));
}

function webDiamondsTracking(filters, token) {
  return webSafeResponse_(ApiDiamonds.tracking(filters || {}, webContext_(token)));
}

function webDiamondsByRoot(rootApptId, token) {
  return webSafeResponse_(ApiDiamonds.byRoot(rootApptId, webContext_(token)));
}

function webDiamondsBulkReturnCandidates(filters, token) {
  return webSafeResponse_(ApiDiamonds.bulkReturnCandidates(filters || {}, webContext_(token)));
}

function webDiamondsBulkMarkReturnInProgress(stoneIds, notes, version, token) {
  return webSafeResponse_(ApiDiamonds.bulkMarkReturnInProgress(stoneIds || [], notes || '', version, webContext_(token)));
}

function webPaymentInit(rootApptId, token) {
  return webSafeResponse_(ApiPayments.init(rootApptId, webContext_(token)));
}

function webPaymentValidatePrerequisites(rootApptId, docType, payload, token) {
  return webSafeResponse_(ApiPayments.validatePrerequisites(rootApptId, docType, payload || {}, webContext_(token)));
}

function webPaymentSubmit(rootApptId, payload, version, token) {
  return webSafeResponse_(ApiPayments.submit(rootApptId, payload || {}, version, webContext_(token)));
}

function webPaymentRegenerateDoc(paymentId, version, token) {
  return webSafeResponse_(ApiPayments.regenerateDoc(paymentId, version, webContext_(token)));
}

function webPaymentSubmitCombo(rootApptId, payload, version, token) {
  return webSafeResponse_(ApiPayments.submitCombo(rootApptId, payload || {}, version, webContext_(token)));
}

function webPaymentHistory(rootApptId, token) {
  return webSafeResponse_(ApiPayments.history(rootApptId, webContext_(token)));
}

function webPaymentDocLinks(paymentId, token) {
  return webSafeResponse_(ApiPayments.getDocLinks(paymentId, webContext_(token)));
}

function webPaymentExportPdf(paymentId, token) {
  return webSafeResponse_(ApiPayments.exportPdf(paymentId, webContext_(token)));
}

function webPaymentReset(rootApptId, version, token) {
  return webSafeResponse_(ApiPayments.reset(rootApptId, version, webContext_(token)));
}

function webPaymentAdminVoid(paymentId, reason, version, token) {
  return webSafeResponse_(ApiPayments.adminVoid(paymentId, reason || '', version, webContext_(token)));
}

function webArtifactUploadFolder(taskId, artifactType, token) {
  return webSafeResponse_(ApiArtifacts.uploadFolder(taskId, artifactType || 'recording', webContext_(token)));
}

function webArtifactSyncDriveUploads(taskId, token) {
  return webSafeResponse_(ApiArtifacts.syncDriveUploads(taskId, webContext_(token)));
}

function webArtifactBrief(rootApptId, token) {
  return webSafeResponse_(ApiArtifacts.getBrief(rootApptId, webContext_(token)));
}

function webDiagnosticsDrift(token) {
  return webSafeResponse_(ApiDiagnostics.driftReport(webContext_(token)));
}

function webDiagnosticsOpsLog(filters, token) {
  return webSafeResponse_(ApiDiagnostics.opsLog(filters || {}, webContext_(token)));
}

function webDiagnosticsBenchmarks(token) {
  return webSafeResponse_(ApiDiagnostics.benchmarks(webContext_(token)));
}

function webDiagnosticsTriggerStatus(token) {
  return webSafeResponse_(ApiDiagnostics.triggerStatus(webContext_(token)));
}

function webDiagnosticsLogClientTiming(payload, token) {
  return webSafeResponse_(ApiDiagnostics.logClientTiming(payload || {}, webContext_(token)));
}

function webContext_(token) {
  return {
    sessionToken: token || '',
  };
}

function webSafeResponse_(value) {
  return executionSafeResponse_(value);
}

function webBootstrapAdmin_(payload) {
  var active = Users.listActive();
  var rows = active.ok ? active.data || [] : [];
  var realAdmins = rows.filter(function(row) {
    var email = normalizeEmail_(row.Email);
    return authRolesFromCsv_(row.RolesCsv).indexOf(ROLE.ADMIN) !== -1 &&
      email.indexOf('@example.com') === -1 &&
      email.indexOf('phase') !== 0;
  });
  if (realAdmins.length) {
    return authError_('bootstrap_closed', 'An admin user already exists.');
  }
  var email = normalizeEmail_(payload.email || payload.Email);
  var password = payload.password || payload.Password;
  if (!email || !password || String(password).length < 8) {
    return authError_('invalid_bootstrap', 'Email and an 8 character password are required.');
  }
  return DashboardService.usersUpsert({
    Email: email,
    Name: payload.name || payload.Name || email,
    RolesCsv: ROLE.ADMIN,
    Active: true,
    Password: password,
  }, {
    email: email,
    roles: [ROLE.ADMIN],
  });
}
