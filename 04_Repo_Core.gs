function repoContext_(tabKey) {
  var ss = getSalesWorkflowSpreadsheet_();
  var sheet = ss.getSheetByName(TAB_NAMES[tabKey]);
  if (!sheet) {
    throw new Error('Missing sheet for repo: ' + TAB_NAMES[tabKey]);
  }
  var headers = schemaHeadersForTabKey_(tabKey);
  var columns = SCHEMA_COLUMNS_BY_TAB_KEY[tabKey];
  return {
    ss: ss,
    sheet: sheet,
    tabKey: tabKey,
    tabName: TAB_NAMES[tabKey],
    headers: headers,
    columns: columns,
    keyHeader: headers[0],
  };
}

function repoReadAll_(tabKey) {
  var started = Date.now();
  var ctx = repoContext_(tabKey);
  var lastRow = ctx.sheet.getLastRow();
  if (lastRow < 2) {
    return repoReadResponse_([], null, started);
  }
  var values = ctx.sheet.getRange(2, 1, lastRow - 1, ctx.headers.length).getValues();
  var rows = values
    .filter(function(row) {
      return row.some(function(value) {
        return value !== '' && value !== null;
      });
    })
    .map(function(row) {
      return repoRowToObject_(ctx, row);
    });
  return repoReadResponse_(rows, null, started);
}

function repoGetByKey_(tabKey, keyValue, keyHeader) {
  var started = Date.now();
  var ctx = repoContext_(tabKey);
  var found = repoFindRowByFields_(ctx, objectFromPairs_([[keyHeader || ctx.keyHeader, keyValue]]));
  if (!found) {
    return repoNotFoundResponse_(started);
  }
  return repoReadResponse_(found.data, found.data.Version || null, started);
}

function repoFindOne_(tabKey, criteria) {
  var started = Date.now();
  var ctx = repoContext_(tabKey);
  var found = repoFindRowByFields_(ctx, criteria);
  if (!found) {
    return repoNotFoundResponse_(started);
  }
  return repoReadResponse_(found.data, found.data.Version || null, started);
}

function repoFindMany_(tabKey, criteria) {
  var started = Date.now();
  var ctx = repoContext_(tabKey);
  var found = repoFindRowsByFields_(ctx, criteria).map(function(match) {
    return match.data;
  });
  return repoReadResponse_(found, null, started);
}

function repoAppend_(tabKey, rowObject) {
  var ctx = repoContext_(tabKey);
  var prepared = repoPrepareNewObject_(ctx, rowObject || {});
  ctx.sheet.appendRow(repoObjectToRow_(ctx, prepared));
  return repoMutationResponse_(ctx, prepared, prepared.Version || null);
}

function repoUpdateByKey_(tabKey, keyValue, fields, expectedVersion, keyHeader) {
  var ctx = repoContext_(tabKey);
  return repoUpdateWhere_(ctx, objectFromPairs_([[keyHeader || ctx.keyHeader, keyValue]]), fields, expectedVersion);
}

function repoUpdateWhere_(ctx, criteria, fields, expectedVersion) {
  var found = repoFindRowByFields_(ctx, criteria);
  if (!found) {
    return {
      ok: false,
      reason: 'not_found',
      source: 'domain',
      ageMs: 0,
    };
  }
  var currentVersion = Number(found.data.Version || 0);
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== currentVersion) {
    return {
      ok: false,
      conflict: true,
      reason: 'version_conflict',
      latest: found.data,
      version: currentVersion,
      source: 'domain',
      ageMs: 0,
    };
  }
  var next = repoMergeForUpdate_(ctx, found.data, fields || {});
  ctx.sheet.getRange(found.rowNumber, 1, 1, ctx.headers.length).setValues([repoObjectToRow_(ctx, next)]);
  return repoMutationResponse_(ctx, next, next.Version || null);
}

function repoUpsertWhere_(tabKey, criteria, fields, expectedVersion, createFields) {
  var ctx = repoContext_(tabKey);
  var found = repoFindRowByFields_(ctx, criteria);
  if (!found) {
    return repoAppend_(tabKey, mergeObjects_(criteria, createFields || {}, fields || {}));
  }
  return repoUpdateWhere_(ctx, criteria, fields || {}, expectedVersion);
}

function repoAppendHistory_(tabKey, entry) {
  return repoAppend_(tabKey, entry || {});
}

function repoFindRowByFields_(ctx, criteria) {
  var matches = repoFindRowsByFields_(ctx, criteria);
  return matches.length ? matches[0] : null;
}

function repoFindRowsByFields_(ctx, criteria) {
  var lastRow = ctx.sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var values = ctx.sheet.getRange(2, 1, lastRow - 1, ctx.headers.length).getValues();
  var matches = [];
  values.forEach(function(row, index) {
    if (!row.some(function(value) { return value !== '' && value !== null; })) {
      return;
    }
    var data = repoRowToObject_(ctx, row);
    var ok = Object.keys(criteria || {}).every(function(field) {
      return repoComparable_(data[field]) === repoComparable_(criteria[field]);
    });
    if (ok) {
      matches.push({
        rowNumber: index + 2,
        data: data,
      });
    }
  });
  return matches;
}

function repoRowToObject_(ctx, row) {
  var object = {};
  ctx.headers.forEach(function(header, index) {
    var value = row[index];
    var meta = ctx.columns[header];
    if (meta && meta.type === 'json' && typeof value === 'string' && value !== '') {
      try {
        object[header] = JSON.parse(value);
      } catch (err) {
        object[header] = value;
      }
    } else {
      object[header] = value;
    }
  });
  return object;
}

function repoObjectToRow_(ctx, object) {
  return ctx.headers.map(function(header) {
    var meta = ctx.columns[header];
    var value = object[header];
    if (value === undefined || value === null) {
      return '';
    }
    if (meta && meta.type === 'json' && typeof value !== 'string') {
      return JSON.stringify(value);
    }
    return value;
  });
}

function repoPrepareNewObject_(ctx, object) {
  var now = new Date();
  var prepared = mergeObjects_(object);
  var keyHeader = ctx.keyHeader;
  if (!prepared[keyHeader]) {
    prepared[keyHeader] = repoGeneratedId_(keyHeader);
  }
  if (ctx.columns.Version && !prepared.Version) {
    prepared.Version = 1;
  }
  ['UpdatedAt', 'CreatedAt', 'ChangedAt', 'EventAt', 'Timestamp', 'RequestedAt'].forEach(function(header) {
    if (ctx.columns[header] && !prepared[header]) {
      prepared[header] = now;
    }
  });
  ['UpdatedByEmail', 'ChangedByEmail', 'ActorEmail'].forEach(function(header) {
    if (ctx.columns[header] && !prepared[header]) {
      prepared[header] = getActiveUserEmail_();
    }
  });
  return prepared;
}

function repoMergeForUpdate_(ctx, current, fields) {
  var next = mergeObjects_(current, fields);
  if (ctx.columns.Version) {
    next.Version = Number(current.Version || 0) + 1;
  }
  if (ctx.columns.UpdatedAt) {
    next.UpdatedAt = new Date();
  }
  if (ctx.columns.UpdatedByEmail && !fields.UpdatedByEmail) {
    next.UpdatedByEmail = getActiveUserEmail_();
  }
  return next;
}

function repoMutationResponse_(ctx, data, version) {
  return {
    ok: true,
    data: data,
    version: version,
    source: 'domain',
    ageMs: 0,
    invalidated: cacheInvalidationForTabKey_(ctx.tabKey).split(',').filter(function(value) {
      return value !== '';
    }),
  };
}

function repoReadResponse_(data, version, started) {
  return {
    ok: true,
    data: data,
    version: version,
    source: 'domain',
    ageMs: Date.now() - started,
  };
}

function repoNotFoundResponse_(started) {
  return {
    ok: false,
    reason: 'not_found',
    source: 'domain',
    ageMs: Date.now() - started,
  };
}

function repoGeneratedId_(keyHeader) {
  var prefix = String(keyHeader || 'ID').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return prefix + '_' + Utilities.getUuid();
}

function repoComparable_(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function objectFromPairs_(pairs) {
  var object = {};
  pairs.forEach(function(pair) {
    object[pair[0]] = pair[1];
  });
  return object;
}
