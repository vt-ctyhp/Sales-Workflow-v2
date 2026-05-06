const AuthService = Object.freeze({
  login: function(email, password) {
    return authLogin_(email, password);
  },
  logout: function(token) {
    return authLogout_(token);
  },
  getSession: function(token) {
    return authGetSession_(token);
  },
  publicUser: function(user) {
    return authPublicUser_(user);
  },
  hashPassword: function(password, salt) {
    return authPasswordHash_(password, salt);
  },
});

const AUTH_SESSION_PREFIX = 'salesWorkflow.session.';
const AUTH_SESSION_TTL_SECONDS = 8 * 60 * 60;
const AUTH_CACHE_TTL_SECONDS = 6 * 60 * 60;

function authLogin_(email, password) {
  var normalizedEmail = normalizeEmail_(email);
  var userRead = Users.getByEmail(normalizedEmail);
  if (!userRead.ok || !authIsActive_(userRead.data.Active)) {
    return authError_('invalid_credentials', 'Email or password is invalid.');
  }
  if (!authPasswordMatches_(password, userRead.data)) {
    return authError_('invalid_credentials', 'Email or password is invalid.');
  }

  var user = authPublicUser_(userRead.data);
  var token = 'sess_' + Utilities.getUuid().replace(/-/g, '');
  var session = {
    token: token,
    user: user,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  authWriteSession_(session);
  Users.upsert(mergeObjects_(userRead.data, {
    Email: normalizedEmail,
    LastLoginAt: new Date(),
    Version: userRead.version,
  }));
  return serviceOk_({
    session: session,
    user: user,
  }, null, []);
}

function authLogout_(token) {
  if (token) {
    CacheService.getScriptCache().remove(authSessionKey_(token));
    PropertiesService.getScriptProperties().deleteProperty(authSessionKey_(token));
  }
  return serviceOk_({
    loggedOut: Boolean(token),
  }, null, []);
}

function authGetSession_(token) {
  if (!token) {
    return authError_('auth_required', 'A session token is required.');
  }
  var key = authSessionKey_(token);
  var session = authReadSessionValue_(CacheService.getScriptCache().get(key)) ||
    authReadSessionValue_(PropertiesService.getScriptProperties().getProperty(key));
  if (!session || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    authLogout_(token);
    return authError_('auth_required', 'Session is missing or expired.');
  }
  CacheService.getScriptCache().put(key, JSON.stringify(session), AUTH_CACHE_TTL_SECONDS);
  return serviceOk_(session, null, []);
}

function authWriteSession_(session) {
  var key = authSessionKey_(session.token);
  var serialized = JSON.stringify(session);
  CacheService.getScriptCache().put(key, serialized, AUTH_CACHE_TTL_SECONDS);
  PropertiesService.getScriptProperties().setProperty(key, serialized);
}

function authReadSessionValue_(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function authSessionKey_(token) {
  return AUTH_SESSION_PREFIX + String(token || '');
}

function authPasswordMatches_(password, user) {
  if (!user || !user.PasswordHash) {
    return false;
  }
  var salt = user.PasswordSalt || '';
  var raw = String(password || '');
  var hash = String(user.PasswordHash || '');
  return authPasswordHash_(raw, salt) === hash ||
    sha256Hex_(salt + raw) === hash ||
    sha256Hex_(raw) === hash;
}

function authPasswordHash_(password, salt) {
  return sha256Hex_(String(password || '') + ':' + String(salt || ''));
}

function authPublicUser_(user) {
  return {
    email: normalizeEmail_(user && (user.Email || user.email)),
    name: user && (user.Name || user.name) || '',
    roles: authRolesFromCsv_(user && (user.RolesCsv || user.roles || user.role)),
    active: authIsActive_(user && (user.Active !== undefined ? user.Active : user.active)),
    version: user && user.Version || null,
  };
}

function authRolesFromCsv_(roles) {
  if (Array.isArray(roles)) {
    return roles.filter(Boolean);
  }
  return String(roles || '').split(',').map(function(role) {
    return role.trim();
  }).filter(Boolean);
}

function authRolesToCsv_(roles) {
  return authRolesFromCsv_(roles).join(',');
}

function authIsActive_(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  var normalized = String(value || '').toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function authError_(reason, message) {
  return {
    ok: false,
    reason: reason,
    error: {
      code: String(reason || 'auth_error').toUpperCase(),
      message: message || reason,
    },
    source: 'service',
    ageMs: 0,
  };
}
