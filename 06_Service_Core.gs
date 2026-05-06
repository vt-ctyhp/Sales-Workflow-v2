function serviceOk_(data, version, invalidated) {
  return {
    ok: true,
    data: data,
    version: version || null,
    source: 'service',
    ageMs: 0,
    invalidated: serviceUnique_(invalidated || []),
  };
}

function serviceError_(reason, detail) {
  return {
    ok: false,
    reason: reason,
    detail: detail || {},
    source: 'service',
    ageMs: 0,
  };
}

function executionSafeResponse_(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function serviceCollectInvalidations_() {
  var output = [];
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];
    if (!value) {
      continue;
    }
    if (value.invalidated) {
      output = output.concat(value.invalidated);
    } else if (Array.isArray(value)) {
      output = output.concat(value);
    } else if (typeof value === 'string') {
      output.push(value);
    }
  }
  return serviceUnique_(serviceFlatten_(output));
}

function serviceUnique_(values) {
  return (values || []).filter(function(value, index, all) {
    return value && all.indexOf(value) === index;
  });
}

function serviceFlatten_(values) {
  var output = [];
  (values || []).forEach(function(value) {
    if (Array.isArray(value)) {
      output = output.concat(serviceFlatten_(value));
    } else {
      output.push(value);
    }
  });
  return output;
}

function serviceTaskLog_(task, eventType, oldState, newState, notes, metadata, actor) {
  return Tasks.appendLog({
    TaskID: task.TaskID,
    RootApptID: task.RootApptID,
    EventType: eventType,
    OldState: oldState || '',
    NewState: newState || '',
    Notes: notes || '',
    ActorEmail: actor && actor.email || getActiveUserEmail_(),
    MetadataJson: metadata || {},
  });
}

function serviceGeneratedId_(prefix) {
  return prefix + '_' + Utilities.getUuid();
}
