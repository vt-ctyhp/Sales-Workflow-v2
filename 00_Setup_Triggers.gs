const SetupTriggers = Object.freeze({
  installTriggers: function() {
    return {
      ok: true,
      installed: 0,
      message: 'Trigger installation is reserved for later phases.',
    };
  },
  removeTriggers: function() {
    return {
      ok: true,
      removed: 0,
      message: 'No phase 0 triggers are installed.',
    };
  },
});

function setupInstallTriggers() {
  return SetupTriggers.installTriggers();
}

function setupRemoveTriggers() {
  return SetupTriggers.removeTriggers();
}
