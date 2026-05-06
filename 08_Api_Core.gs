function apiCall_(apiName, context, handler, options) {
  var started = Date.now();
  var auth = apiAuthorize_(apiName, context || {});
  if (!auth.ok) {
    return auth;
  }
  var result;
  try {
    result = handler(auth.user);
  } catch (err) {
    result = apiError_(apiName, 'exception', err.message, {
      stack: err.stack || '',
    }, started);
  }
  var normalized = apiNormalizeResult_(apiName, result, started);
  DashboardService.logApiOperation(apiName, auth.user.email, normalized, options || {}, started);
  return normalized;
}

function apiAuthorize_(apiName, context) {
  var rolesAllowed = PERMISSIONS[apiName];
  if (rolesAllowed === undefined) {
    return apiError_(apiName, 'unknown_api', 'No permission rule exists for ' + apiName, {}, Date.now());
  }
  if (!rolesAllowed.length) {
    return {
      ok: true,
      user: apiAnonymousUser_(),
    };
  }

  var user = null;
  if (context && context.testAuth === true) {
    user = apiTestUserFromContext_(context);
  } else {
    var session = AuthService.getSession(apiSessionTokenFromContext_(context));
    if (!session.ok) {
      return apiError_(apiName, session.reason || 'auth_required', session.error && session.error.message || 'A valid session is required.', session, Date.now());
    }
    user = session.data.user;
  }

  var roles = user && user.roles || [];
  var allowed = roles.some(function(role) {
    return rolesAllowed.indexOf(role) !== -1;
  });
  if (!allowed) {
    return apiError_(apiName, 'forbidden', 'This user does not have access to ' + apiName + '.', {
      requiredRoles: rolesAllowed,
      userRoles: roles,
    }, Date.now());
  }
  return {
    ok: true,
    user: user,
  };
}

function apiNormalizeResult_(apiName, result, started) {
  if (result && result.ok === false) {
    return apiError_(apiName, result.reason || 'operation_failed', result.error && result.error.message || result.reason || 'Operation failed.', result, started);
  }
  if (result && result.ok === true) {
    return mergeObjects_({
      apiName: apiName,
    }, result);
  }
  return {
    ok: true,
    data: result === undefined ? null : result,
    source: 'api',
    apiName: apiName,
    ageMs: Date.now() - started,
  };
}

function apiError_(apiName, reason, message, detail, started) {
  return {
    ok: false,
    reason: reason,
    error: {
      code: String(reason || 'error').toUpperCase(),
      message: message || reason || 'Error',
    },
    detail: detail || {},
    source: 'api',
    apiName: apiName,
    ageMs: Date.now() - (started || Date.now()),
  };
}

function apiSessionTokenFromContext_(context) {
  return context && (context.sessionToken || context.token || context.session && context.session.token) || '';
}

function apiIsContext_(value) {
  return Boolean(value && typeof value === 'object' && (
    value.testAuth === true ||
    value.sessionToken ||
    value.token ||
    value.session && value.session.token
  ));
}

function apiTestContext_(roles, email) {
  return {
    testAuth: true,
    user: {
      email: normalizeEmail_(email || 'phase5.api@example.com'),
      name: 'Phase 5 API Test',
      roles: Array.isArray(roles) ? roles : [roles],
      active: true,
    },
  };
}

function apiTestUserFromContext_(context) {
  var user = context.user || {};
  return {
    email: normalizeEmail_(user.email || user.Email || context.email || 'phase5.api@example.com'),
    name: user.name || user.Name || context.name || 'Phase 5 API Test',
    roles: Array.isArray(user.roles) ? user.roles : authRolesFromCsv_(user.RolesCsv || user.role || context.roles || context.role),
    active: true,
    version: null,
  };
}

function apiAnonymousUser_() {
  return {
    email: '',
    name: '',
    roles: [],
    active: false,
    version: null,
  };
}

function apiBootstrapPayload_(user) {
  var visibleViews = apiVisibleViews_(user.roles || []);
  var taskView = {
    view: 'mine',
    ownerEmail: user.email,
  };
  var tasks = TaskListCache.build(taskView);
  var options = CacheSlices.formOptions();
  return serviceOk_({
    user: user,
    visibleViews: visibleViews,
    permissions: apiPermissionsForRoles_(user.roles || []),
    taskQueue: tasks.ok ? tasks.data : null,
    formOptions: options.ok ? options.data : null,
  }, null, []);
}

function apiVisibleViews_(roles) {
  var views = [];
  if (apiHasAnyRole_(roles, [ROLE.ADMIN, ROLE.CLIENT_ADVISOR, ROLE.JOC, ROLE.DIAMOND_ORDER_ADMIN, ROLE.DIAMOND_ORDER_ASSISTANT])) {
    views.push('tasks');
  }
  if (apiHasAnyRole_(roles, [ROLE.ADMIN, ROLE.CLIENT_ADVISOR, ROLE.JOC, ROLE.READ_ONLY_VIEWER])) {
    views.push('customers');
    views.push('calendar');
  }
  if (apiHasAnyRole_(roles, [ROLE.ADMIN, ROLE.DIAMOND_ORDER_ADMIN, ROLE.DIAMOND_ORDER_ASSISTANT, ROLE.CLIENT_ADVISOR, ROLE.JOC])) {
    views.push('diamonds');
  }
  if (apiHasAnyRole_(roles, [ROLE.ADMIN, ROLE.CLIENT_ADVISOR, ROLE.JOC])) {
    views.push('payments');
  }
  if (roles.indexOf(ROLE.ADMIN) !== -1) {
    views.push('admin');
    views.push('diagnostics');
  }
  return views.filter(function(view, index, all) {
    return all.indexOf(view) === index;
  });
}

function apiPermissionsForRoles_(roles) {
  var allowed = {};
  Object.keys(PERMISSIONS).forEach(function(apiName) {
    var required = PERMISSIONS[apiName];
    allowed[apiName] = required.length === 0 || apiHasAnyRole_(roles, required);
  });
  return allowed;
}

function apiHasAnyRole_(roles, required) {
  return (roles || []).some(function(role) {
    return required.indexOf(role) !== -1;
  });
}
