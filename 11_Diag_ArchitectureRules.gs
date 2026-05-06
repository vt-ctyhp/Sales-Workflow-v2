const PROJECT_SOURCE_FILES = Object.freeze([
  '00_Setup_Schema.gs',
  '00_Setup_Dropdowns.gs',
  '00_Setup_Triggers.gs',
  '01_Const_Tabs.gs',
  '01_Const_Columns.gs',
  '01_Const_Enums.gs',
  '01_Const_Permissions.gs',
  '02_Util_Time.gs',
  '02_Util_Strings.gs',
  '02_Util_Hashing.gs',
  '03_Lock_DocLock.gs',
  '03_Lock_NamedLock.gs',
  '04_Repo_Appointments.gs',
  '04_Repo_RootAppointments.gs',
  '04_Repo_CustomerInfo.gs',
  '04_Repo_ClientStatus.gs',
  '04_Repo_Order3D.gs',
  '04_Repo_DiamondViewing.gs',
  '04_Repo_Wax.gs',
  '04_Repo_Tasks.gs',
  '04_Repo_Artifacts.gs',
  '04_Repo_Users.gs',
  '04_Repo_Schedules.gs',
  '04_Repo_Config.gs',
  '04_Repo_Templates.gs',
  '04_Repo_DataCleanup.gs',
  '04_Repo_OpsLog.gs',
  '05_Ext_StonesWorkbook.gs',
  '05_Ext_PaymentLedger.gs',
  '05_Ext_TrackerWorkbook.gs',
  '05_Ext_QuoteWorkbook.gs',
  '05_Ext_Drive.gs',
  '05_Ext_Acuity.gs',
  '05_Ext_AssemblyAI.gs',
  '05_Ext_OpenAI.gs',
  '06_Service_Intake.gs',
  '06_Service_TaskGeneration.gs',
  '06_Service_TaskCompletion.gs',
  '06_Service_Diamonds.gs',
  '06_Service_Payments.gs',
  '06_Service_Artifacts.gs',
  '07_Cache_Slices.gs',
  '07_Cache_CustomerDetail.gs',
  '07_Cache_TaskList.gs',
  '08_Api_Bootstrap.gs',
  '08_Api_Tasks.gs',
  '08_Api_Customers.gs',
  '08_Api_Calendar.gs',
  '08_Api_Admin.gs',
  '08_Api_Diamonds.gs',
  '08_Api_Payments.gs',
  '08_Api_Artifacts.gs',
  '08_Api_SchedulesUsers.gs',
  '08_Api_Diagnostics.gs',
  '09_Web_App.gs',
  'Index.html',
  '10_Trigger_Acuity.gs',
  '10_Trigger_FormSubmit.gs',
  '10_Trigger_TaskGen.gs',
  '10_Trigger_Artifacts.gs',
  '10_Trigger_Maintenance.gs',
  '11_Diag_ArchitectureRules.gs',
  '11_Diag_Benchmarks.gs',
  '11_Diag_DriftCheck.gs',
]);

const Diag = Object.freeze({
  checkArchitectureRules: function() {
    return checkArchitectureRules_();
  },
  driftReport: function() {
    return phaseNotImplemented_('Diag.driftReport');
  },
  benchmarks: function() {
    return phaseNotImplemented_('Diag.benchmarks');
  },
});

function checkArchitectureRules() {
  return Diag.checkArchitectureRules();
}

function checkArchitectureRules_() {
  var errors = [];
  var warnings = [];
  var prefixes = {};
  PROJECT_SOURCE_FILES.forEach(function(file) {
    if (file === 'Index.html') {
      prefixes['09'] = true;
      return;
    }
    var match = file.match(/^(\d{2})_[A-Za-z]+_[A-Za-z0-9]+\.gs$/);
    if (!match) {
      errors.push('Invalid source file name: ' + file);
      return;
    }
    var prefix = match[1];
    if (Number(prefix) < 0 || Number(prefix) > 11) {
      errors.push('Unsupported source prefix in ' + file);
    }
    prefixes[prefix] = true;
  });

  ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].forEach(function(prefix) {
    if (!prefixes[prefix]) {
      errors.push('Missing source prefix ' + prefix);
    }
  });

  TAB_ORDER.forEach(function(tabKey) {
    var tabName = TAB_NAMES[tabKey];
    var owner = TAB_OWNER_REPOS[tabKey];
    if (!owner) {
      errors.push('Missing owner repo for ' + tabName);
    } else if (owner.indexOf('00_') !== 0 && PROJECT_SOURCE_FILES.indexOf(owner) === -1) {
      errors.push('Owner repo file is not declared for ' + tabName + ': ' + owner);
    }
    var columns = SCHEMA_COLUMNS_BY_TAB_KEY[tabKey];
    if (!columns) {
      errors.push('Missing column schema for ' + tabName);
      return;
    }
    var seen = {};
    schemaHeadersForTabKey_(tabKey).forEach(function(header, index) {
      var meta = columns[header];
      if (meta.col !== index + 1) {
        errors.push(tabName + '.' + header + ' has non-contiguous column index ' + meta.col);
      }
      if (seen[meta.col]) {
        errors.push(tabName + ' duplicates column index ' + meta.col);
      }
      seen[meta.col] = true;
      if (!meta.type) {
        errors.push(tabName + '.' + header + ' is missing type');
      }
      if (!meta.width || meta.width < 50) {
        warnings.push(tabName + '.' + header + ' has narrow width metadata');
      }
    });
  });

  Object.keys(PERMISSIONS).forEach(function(apiName) {
    var roles = PERMISSIONS[apiName];
    roles.forEach(function(role) {
      if (Object.keys(ROLE).map(function(key) { return ROLE[key]; }).indexOf(role) === -1) {
        errors.push(apiName + ' references unknown role ' + role);
      }
    });
  });

  return {
    ok: errors.length === 0,
    filesChecked: PROJECT_SOURCE_FILES.length,
    schemaTabsChecked: TAB_ORDER.length,
    errors: errors,
    warnings: warnings,
  };
}
