const DriftCheck = Object.freeze({
  run: function() {
    return driftCheckRun_();
  },
});

function runDriftReport() {
  return DriftCheck.run();
}

function driftCheckRun_() {
  var architecture = Diag.checkArchitectureRules();
  var schema = setupVerifyWorkbook_();
  var permissions = driftCheckPermissions_();
  var errors = []
    .concat(architecture.errors || [])
    .concat(schema.errors || [])
    .concat(permissions.errors || []);
  return {
    ok: errors.length === 0,
    implemented: true,
    phase: 5,
    checkedAt: new Date().toISOString(),
    architecture: architecture,
    schema: schema,
    permissions: permissions,
    errors: errors,
  };
}

function driftCheckPermissions_() {
  var errors = [];
  [
    'Api.diamonds.assignInStock',
    'Api.diamonds.applyLoupe360Sync',
    'Api.diag.benchmarks',
  ].forEach(function(apiName) {
    if (!PERMISSIONS[apiName]) {
      errors.push('Missing permission for ' + apiName);
    }
  });
  return {
    ok: errors.length === 0,
    apiCount: Object.keys(PERMISSIONS).length,
    errors: errors,
  };
}
