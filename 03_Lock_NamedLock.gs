const NamedLock = Object.freeze({
  acquire: function(name, timeoutMs) {
    return namedLockAcquire_(name, timeoutMs || 5000);
  },
  release: function(name, token) {
    return namedLockRelease_(name, token);
  },
  withLock: function(name, callback, timeoutMs) {
    var acquired = namedLockAcquire_(name, timeoutMs || 5000);
    if (!acquired.ok) {
      return acquired;
    }
    try {
      return callback(acquired);
    } finally {
      namedLockRelease_(name, acquired.token);
    }
  },
});

const NAMED_LOCK_PREFIX = 'salesWorkflow.lock.';
const NAMED_LOCK_TTL_MS = 300000;

function namedLockAcquire_(name, timeoutMs) {
  if (!name) {
    throw new Error('Named lock requires a name');
  }
  var waitStarted = Date.now();
  var guard = LockService.getScriptLock();
  var guardLocked = guard.tryLock(timeoutMs);
  var waitMs = Date.now() - waitStarted;
  if (!guardLocked) {
    namedLockLogMetric_(name, 'busy', waitMs, 0, { stage: 'guard' });
    return {
      ok: false,
      retry: true,
      reason: 'busy',
      lockWaitMs: waitMs,
    };
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var key = NAMED_LOCK_PREFIX + name;
    var current = namedLockRead_(props.getProperty(key));
    var now = Date.now();
    if (current && current.expiresAt > now) {
      namedLockLogMetric_(name, 'busy', waitMs, 0, { owner: current.token });
      return {
        ok: false,
        retry: true,
        reason: 'busy',
        lockWaitMs: waitMs,
      };
    }
    var token = Utilities.getUuid();
    props.setProperty(key, JSON.stringify({
      token: token,
      acquiredAt: now,
      expiresAt: now + NAMED_LOCK_TTL_MS,
    }));
    namedLockLogMetric_(name, 'acquired', waitMs, 0, { token: token });
    return {
      ok: true,
      name: name,
      token: token,
      lockWaitMs: waitMs,
    };
  } finally {
    guard.releaseLock();
  }
}

function namedLockRelease_(name, token) {
  var holdStarted = Date.now();
  var guard = LockService.getScriptLock();
  guard.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = NAMED_LOCK_PREFIX + name;
    var current = namedLockRead_(props.getProperty(key));
    if (!current) {
      namedLockLogMetric_(name, 'release_missing', 0, Date.now() - holdStarted, {});
      return { ok: true, released: false, reason: 'missing' };
    }
    if (token && current.token !== token) {
      namedLockLogMetric_(name, 'release_mismatch', 0, Date.now() - holdStarted, { token: token });
      return { ok: false, released: false, reason: 'token_mismatch' };
    }
    props.deleteProperty(key);
    namedLockLogMetric_(name, 'released', 0, Date.now() - holdStarted, { token: current.token });
    return { ok: true, released: true };
  } finally {
    guard.releaseLock();
  }
}

function namedLockRead_(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function namedLockLogMetric_(name, result, waitMs, holdMs, metadata) {
  try {
    appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
      functionName: 'NamedLock.' + name,
      tier: 'B',
      result: result,
      message: 'named lock metric',
      lockWaitMs: waitMs,
      lockHoldMs: holdMs,
      target: name,
      metadata: metadata || {},
    });
  } catch (err) {
    // Lock metric logging must never mask the original operation.
  }
}
