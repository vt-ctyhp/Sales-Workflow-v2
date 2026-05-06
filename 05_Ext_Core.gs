const EXT_STORE_PREFIX = 'salesWorkflow.ext.';
const EXT_STORE_CHUNK_SIZE = 7000;
const EXT_STORE_MAX_SERIALIZED_LENGTH = 320000;

function extReadStore_(name) {
  var props = PropertiesService.getScriptProperties();
  var baseKey = EXT_STORE_PREFIX + name;
  var chunkCount = Number(props.getProperty(baseKey + '.chunks') || 0);
  var raw = '';
  if (chunkCount > 0) {
    var chunks = [];
    for (var index = 0; index < chunkCount; index += 1) {
      var chunk = props.getProperty(baseKey + '.chunk.' + index);
      if (chunk === null || chunk === undefined) {
        return [];
      }
      chunks.push(chunk);
    }
    raw = chunks.join('');
  } else {
    raw = props.getProperty(baseKey);
  }
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
  while (serialized.length > EXT_STORE_MAX_SERIALIZED_LENGTH && output.length > 1) {
    output = output.slice(Math.floor(output.length / 2));
    serialized = JSON.stringify(output);
  }
  if (serialized.length > EXT_STORE_MAX_SERIALIZED_LENGTH && output.length === 1) {
    output = [extCompactRow_(output[0])];
    serialized = JSON.stringify(output);
  }
  if (serialized.length > EXT_STORE_MAX_SERIALIZED_LENGTH) {
    output = [];
    serialized = '[]';
  }

  var props = PropertiesService.getScriptProperties();
  extClearStore_(props, name);
  if (serialized.length <= EXT_STORE_CHUNK_SIZE) {
    props.setProperty(EXT_STORE_PREFIX + name, serialized);
    return;
  }

  var chunks = [];
  for (var offset = 0; offset < serialized.length; offset += EXT_STORE_CHUNK_SIZE) {
    chunks.push(serialized.slice(offset, offset + EXT_STORE_CHUNK_SIZE));
  }
  var baseKey = EXT_STORE_PREFIX + name;
  props.setProperty(baseKey + '.chunks', String(chunks.length));
  chunks.forEach(function(chunk, index) {
    props.setProperty(baseKey + '.chunk.' + index, chunk);
  });
}

function extClearStore_(props, name) {
  var baseKey = EXT_STORE_PREFIX + name;
  props.deleteProperty(baseKey);
  props.deleteProperty(baseKey + '.chunks');
  var all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(baseKey + '.chunk.') === 0) {
      props.deleteProperty(key);
    }
  });
}

function extCompactRow_(row) {
  var compact = {};
  Object.keys(row || {}).forEach(function(key) {
    var value = row[key];
    if (typeof value === 'string' && value.length > 500) {
      compact[key] = value.slice(0, 500);
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      compact[key] = '[compact]';
    } else {
      compact[key] = value;
    }
  });
  return compact;
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
