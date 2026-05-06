const SetupTriggers = Object.freeze({
  installTriggers: function() {
    return setupInstallTriggers_();
  },
  removeTriggers: function() {
    return setupRemoveTriggers_();
  },
  listTriggers: function() {
    return setupListTriggers_();
  },
});

function setupInstallTriggers() {
  return SetupTriggers.installTriggers();
}

function setupRemoveTriggers() {
  return SetupTriggers.removeTriggers();
}

function setupListTriggers() {
  return SetupTriggers.listTriggers();
}

const LAUNCH_TRIGGER_SPECS = Object.freeze([
  Object.freeze({ handler: 'triggerTaskGen', cadence: 'minutes', interval: 5, tier: 'B' }),
  Object.freeze({ handler: 'triggerCachePrewarm', cadence: 'minutes', interval: 5, tier: 'B' }),
  Object.freeze({ handler: 'triggerArtifacts', cadence: 'minutes', interval: 5, tier: 'B' }),
  Object.freeze({ handler: 'triggerUrlRepair', cadence: 'hours', interval: 1, tier: 'B' }),
  Object.freeze({ handler: 'triggerDriftCheck', cadence: 'daily', hour: 2, tier: 'B' }),
]);

function setupInstallTriggers_() {
  var removed = setupRemoveTriggers_().removed;
  var installed = [];
  LAUNCH_TRIGGER_SPECS.forEach(function(spec) {
    var builder = ScriptApp.newTrigger(spec.handler).timeBased();
    if (spec.cadence === 'minutes') {
      builder.everyMinutes(spec.interval);
    } else if (spec.cadence === 'hours') {
      builder.everyHours(spec.interval);
    } else if (spec.cadence === 'daily') {
      builder.everyDays(1).atHour(spec.hour || 2);
    }
    builder.create();
    installed.push(spec);
  });
  appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
    functionName: 'Setup.installTriggers',
    tier: 'C',
    result: 'ok',
    message: 'Launch triggers installed',
    target: 'ScriptApp',
    metadata: {
      removed: removed,
      installed: installed.map(function(spec) { return spec.handler; }),
    },
  });
  return {
    ok: true,
    installed: installed.length,
    removed: removed,
    triggers: installed,
  };
}

function setupRemoveTriggers_() {
  var launchHandlers = LAUNCH_TRIGGER_SPECS.map(function(spec) {
    return spec.handler;
  });
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (launchHandlers.indexOf(trigger.getHandlerFunction()) === -1) {
      return;
    }
    ScriptApp.deleteTrigger(trigger);
    removed += 1;
  });
  return {
    ok: true,
    removed: removed,
  };
}

function setupListTriggers_() {
  var expected = LAUNCH_TRIGGER_SPECS.map(function(spec) {
    return spec.handler;
  });
  var triggers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler: trigger.getHandlerFunction(),
      eventType: String(trigger.getEventType()),
      source: String(trigger.getTriggerSource()),
      uniqueId: trigger.getUniqueId ? trigger.getUniqueId() : '',
      launchManaged: expected.indexOf(trigger.getHandlerFunction()) !== -1,
    };
  });
  var installedByHandler = {};
  triggers.forEach(function(trigger) {
    installedByHandler[trigger.handler] = (installedByHandler[trigger.handler] || 0) + 1;
  });
  var missing = expected.filter(function(handler) {
    return !installedByHandler[handler];
  });
  var duplicates = expected.filter(function(handler) {
    return (installedByHandler[handler] || 0) > 1;
  });
  return {
    ok: missing.length === 0 && duplicates.length === 0,
    expected: LAUNCH_TRIGGER_SPECS,
    installed: triggers,
    missing: missing,
    duplicates: duplicates,
  };
}
