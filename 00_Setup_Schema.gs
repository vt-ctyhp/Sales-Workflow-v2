const SALES_WORKFLOW_SPREADSHEET_ID = '1XA7ozQFhtZJj9oX6PuiBer4dpwt9wEFuJ4M4bpaj-ms';
const SETUP_REVISION = 'phase3-intake';

const Setup = Object.freeze({
  runAll: function() {
    return setupRunAll_();
  },
  verify: function() {
    return setupVerifyWorkbook_();
  },
  regenerateDataFlowRef: function() {
    var ss = getSalesWorkflowSpreadsheet_();
    return regenerateDataFlowRef_(ss);
  },
});

function setupRunAll() {
  return Setup.runAll();
}

function setupVerify() {
  return Setup.verify();
}

function setupRunAll_() {
  var startedAt = new Date();
  var lock = LockService.getDocumentLock();
  var lockStarted = Date.now();
  lock.waitLock(30000);
  var lockWaitMs = Date.now() - lockStarted;
  try {
    var ss = getSalesWorkflowSpreadsheet_();
    TAB_ORDER.forEach(function(tabKey) {
      setupSheet_(ss, tabKey);
    });
    removeUnexpectedEmptySheets_(ss);
    var dataFlowCount = regenerateDataFlowRef_(ss).rowCount;
    var verification = setupVerifyWorkbook_();
    updateSchemaVersion_(ss, startedAt, verification);
    appendOpsLog_(ss, {
      functionName: 'Setup.runAll',
      tier: 'C',
      result: verification.ok ? 'ok' : 'error',
      message: verification.ok ? 'Setup completed' : verification.errors.join('; '),
      lockWaitMs: lockWaitMs,
      lockHoldMs: Date.now() - startedAt.getTime(),
      target: SCHEMA_VERSION_TARGET,
      metadata: {
        tabCount: TAB_ORDER.length,
        columnCount: dataFlowCount,
      },
    });
    if (!verification.ok) {
      throw new Error('Setup verification failed: ' + verification.errors.join('; '));
    }
    return {
      ok: true,
      version: SCHEMA_VERSION_TARGET,
      tabCount: TAB_ORDER.length,
      columnCount: dataFlowCount,
      lockWaitMs: lockWaitMs,
    };
  } catch (err) {
    try {
      appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
        functionName: 'Setup.runAll',
        tier: 'C',
        result: 'error',
        message: err.message,
        lockWaitMs: lockWaitMs,
        lockHoldMs: Date.now() - startedAt.getTime(),
        target: SCHEMA_VERSION_TARGET,
        metadata: {},
      });
    } catch (logErr) {
      // Preserve the original setup failure.
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function getSalesWorkflowSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active && active.getId() === SALES_WORKFLOW_SPREADSHEET_ID) {
    return active;
  }
  return SpreadsheetApp.openById(SALES_WORKFLOW_SPREADSHEET_ID);
}

function setupSheet_(ss, tabKey) {
  var tabName = TAB_NAMES[tabKey];
  var headers = schemaHeadersForTabKey_(tabKey);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  ensureSheetColumnCount_(sheet, headers.length);
  assertHeaderCanBeManaged_(sheet, headers);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setFontWeight('bold')
    .setBackground('#EFE8DD')
    .setFontColor('#2A2725')
    .setWrap(true)
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setHorizontalAlignment('left');
  applyColumnWidths_(sheet, tabKey);
  sheet.autoResizeRows(1, 1);
  return sheet;
}

function ensureSheetColumnCount_(sheet, expectedCols) {
  var maxCols = sheet.getMaxColumns();
  if (maxCols < expectedCols) {
    sheet.insertColumnsAfter(maxCols, expectedCols - maxCols);
  } else if (maxCols > expectedCols) {
    var extraRange = sheet.getRange(1, expectedCols + 1, sheet.getMaxRows(), maxCols - expectedCols);
    var extraValues = extraRange.getDisplayValues();
    var hasExtraData = extraValues.some(function(row) {
      return row.some(function(cell) {
        return cell !== '';
      });
    });
    if (hasExtraData) {
      throw new Error('Unexpected data outside managed schema in ' + sheet.getName());
    }
    sheet.deleteColumns(expectedCols + 1, maxCols - expectedCols);
  }
}

function assertHeaderCanBeManaged_(sheet, expectedHeaders) {
  var existing = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];
  var hasAnyHeader = existing.some(function(value) {
    return value !== '';
  });
  if (!hasAnyHeader) {
    return;
  }
  var mismatches = [];
  expectedHeaders.forEach(function(header, index) {
    if (existing[index] !== '' && existing[index] !== header) {
      mismatches.push(sheet.getName() + '!' + columnNumberToLetter_(index + 1) + ' expected "' + header + '" found "' + existing[index] + '"');
    }
  });
  if (mismatches.length) {
    throw new Error('Manual header drift detected: ' + mismatches.join('; '));
  }
}

function applyColumnWidths_(sheet, tabKey) {
  var columns = SCHEMA_COLUMNS_BY_TAB_KEY[tabKey];
  schemaHeadersForTabKey_(tabKey).forEach(function(header) {
    var meta = columns[header];
    sheet.setColumnWidth(meta.col, meta.width);
  });
}

function removeUnexpectedEmptySheets_(ss) {
  var expectedNames = TAB_ORDER.map(function(tabKey) {
    return TAB_NAMES[tabKey];
  });
  ss.getSheets().forEach(function(sheet) {
    if (expectedNames.indexOf(sheet.getName()) !== -1) {
      return;
    }
    if (sheetHasAnyValue_(sheet)) {
      throw new Error('Unexpected non-empty sheet exists: ' + sheet.getName());
    }
    ss.deleteSheet(sheet);
  });
}

function sheetHasAnyValue_(sheet) {
  var values = sheet.getDataRange().getDisplayValues();
  return values.some(function(row) {
    return row.some(function(cell) {
      return cell !== '';
    });
  });
}

function regenerateDataFlowRef_(ss) {
  var sheet = ss.getSheetByName(TAB_NAMES.DataFlowRef);
  if (!sheet) {
    sheet = setupSheet_(ss, 'DataFlowRef');
  }
  var headers = schemaHeadersForTabKey_('DataFlowRef');
  var rows = schemaRowsForDataFlowRef_();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  applyColumnWidths_(sheet, 'DataFlowRef');
  return {
    ok: true,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

function updateSchemaVersion_(ss, startedAt, verification) {
  var sheet = ss.getSheetByName(TAB_NAMES.SchemaVersion);
  var headers = schemaHeadersForTabKey_('SchemaVersion');
  var actor = getActiveUserEmail_();
  var previousHistory = [];
  if (sheet.getLastRow() >= 2) {
    var existingHistory = sheet.getRange(2, 6).getDisplayValue();
    if (existingHistory) {
      try {
        previousHistory = JSON.parse(existingHistory);
      } catch (err) {
        previousHistory = [];
      }
    }
  }
  var hasTarget = previousHistory.some(function(entry) {
    return entry.version === SCHEMA_VERSION_TARGET;
  });
  if (!hasTarget) {
    previousHistory.push({
      version: SCHEMA_VERSION_TARGET,
      appliedAt: startedAt.toISOString(),
      migration: 'phase0_foundation_schema',
    });
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, 1, headers.length).setValues([[
    SCHEMA_VERSION_TARGET,
    startedAt,
    actor,
    SETUP_REVISION,
    'phase0_foundation_schema',
    JSON.stringify(previousHistory),
    verification.ok ? 'ok' : 'error',
    verification.ok ? 'Workbook schema verified.' : verification.errors.join('; '),
  ]]);
}

function setupVerifyWorkbook_() {
  var ss = getSalesWorkflowSpreadsheet_();
  var errors = [];
  TAB_ORDER.forEach(function(tabKey) {
    var tabName = TAB_NAMES[tabKey];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      errors.push('Missing tab: ' + tabName);
      return;
    }
    var expectedHeaders = schemaHeadersForTabKey_(tabKey);
    var actualHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];
    expectedHeaders.forEach(function(header, index) {
      if (actualHeaders[index] !== header) {
        errors.push(tabName + ' header mismatch at column ' + (index + 1) + ': expected ' + header + ', found ' + actualHeaders[index]);
      }
    });
    if (sheet.getFrozenRows() !== 1) {
      errors.push(tabName + ' must freeze one header row');
    }
  });

  var expectedColumnCount = schemaRowsForDataFlowRef_().length;
  var dataFlow = ss.getSheetByName(TAB_NAMES.DataFlowRef);
  if (dataFlow) {
    var actualDataFlowRows = Math.max(dataFlow.getLastRow() - 1, 0);
    if (actualDataFlowRows !== expectedColumnCount) {
      errors.push('_DataFlowRef row count expected ' + expectedColumnCount + ', found ' + actualDataFlowRows);
    }
  }

  var architecture = Diag.checkArchitectureRules();
  if (!architecture.ok) {
    errors = errors.concat(architecture.errors);
  }

  return {
    ok: errors.length === 0,
    version: SCHEMA_VERSION_TARGET,
    errors: errors,
  };
}

function appendOpsLog_(ss, entry) {
  var sheet = ss.getSheetByName(TAB_NAMES.OpsLog);
  if (!sheet) {
    return;
  }
  var id = 'ops_' + Utilities.getUuid();
  sheet.appendRow([
    id,
    new Date(),
    getActiveUserEmail_(),
    entry.functionName,
    entry.tier || '',
    entry.result,
    entry.message || '',
    entry.lockWaitMs || '',
    entry.lockHoldMs || '',
    entry.target || '',
    JSON.stringify(entry.metadata || {}),
  ]);
}

function getActiveUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function columnNumberToLetter_(column) {
  var letter = '';
  var temp = column;
  while (temp > 0) {
    var mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}
