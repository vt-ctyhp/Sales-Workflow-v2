const NamedLock = Object.freeze({
  acquire: function(name, timeoutMs) {
    return phaseNotImplemented_('NamedLock.acquire');
  },
  release: function(name) {
    return phaseNotImplemented_('NamedLock.release');
  },
});
