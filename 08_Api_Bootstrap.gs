const ApiBootstrap = Object.freeze({
  get: function() {
    return phaseNotImplemented_('Api.bootstrap.get');
  },
});

const ApiAuth = Object.freeze({
  login: function(email, password) {
    return phaseNotImplemented_('Api.auth.login');
  },
  logout: function() {
    return phaseNotImplemented_('Api.auth.logout');
  },
});
