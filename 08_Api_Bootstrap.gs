const ApiBootstrap = Object.freeze({
  get: function(context) {
    return apiCall_('Api.bootstrap.get', context, function(user) {
      return apiBootstrapPayload_(user);
    });
  },
});

const ApiAuth = Object.freeze({
  login: function(email, password) {
    var started = Date.now();
    var loggedIn = AuthService.login(email, password);
    if (!loggedIn.ok) {
      return apiNormalizeResult_('Api.auth.login', loggedIn, started);
    }
    var bootstrap = apiBootstrapPayload_(loggedIn.data.user);
    return apiNormalizeResult_('Api.auth.login', serviceOk_(mergeObjects_(loggedIn.data, {
      bootstrap: bootstrap.ok ? bootstrap.data : null,
    }), null, []), started);
  },
  logout: function(context) {
    var started = Date.now();
    return apiNormalizeResult_('Api.auth.logout', AuthService.logout(apiSessionTokenFromContext_(context || {})), started);
  },
});
