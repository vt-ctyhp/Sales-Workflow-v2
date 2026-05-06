const EXT_STORE_PREFIX = 'salesWorkflow.ext.';

function extReadStore_(name) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(EXT_STORE_PREFIX + name);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function extWriteStore_(name, rows) {
  var output = rows || [];
  var serialized = JSON.stringify(output);
  if (serialized.length > 8000) {
    output = output.slice(Math.max(output.length - 75, 0));
    serialized = JSON.stringify(output);
  }
  PropertiesService.getScriptProperties().setProperty(EXT_STORE_PREFIX + name, serialized);
}

function extAppendRow_(name, row) {
  var rows = extReadStore_(name);
  rows.push(row);
  extWriteStore_(name, rows);
  return row;
}

function extUpdateRows_(name, predicate, updater) {
  var rows = extReadStore_(name);
  var updated = [];
  rows = rows.map(function(row) {
    if (!predicate(row)) {
      return row;
    }
    var next = updater(row);
    updated.push(next);
    return next;
  });
  extWriteStore_(name, rows);
  return updated;
}

function extResponse_(data, version) {
  return {
    ok: true,
    data: data,
    version: version || null,
    source: 'external',
    ageMs: 0,
  };
}

function extMutationResponse_(data, invalidated) {
  return {
    ok: true,
    data: data,
    version: data && data.Version || null,
    source: 'external',
    ageMs: 0,
    invalidated: invalidated || [],
  };
}

function extNotFound_(reason) {
  return {
    ok: false,
    reason: reason || 'not_found',
    source: 'external',
    ageMs: 0,
  };
}

function extGeneratedId_(prefix) {
  return prefix + '_' + Utilities.getUuid();
}

function extNow_() {
  return new Date();
}

function extComparable_(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return value;
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) {
    var parsed = Date.parse(text);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return repoComparable_(value);
}

function extToArray_(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
