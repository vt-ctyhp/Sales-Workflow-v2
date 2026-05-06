const SetupDropdowns = Object.freeze({
  applyAll: function() {
    return {
      ok: true,
      version: SCHEMA_VERSION_TARGET,
      applied: 0,
      message: 'Dropdown setup is reserved for later schema migrations.',
    };
  },
});
