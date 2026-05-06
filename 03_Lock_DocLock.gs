const DocLock = Object.freeze({
  withUserWriteLock: function(callback, context) {
    return docLockRun_(callback, mergeObjects_({
      tier: 'A',
      timeoutMs: 500,
      functionName: 'DocLock.withUserWriteLock',
    }, context || {}));
  },
  withBackgroundWriteLock: function(callback, context) {
    return docLockRun_(callback, mergeObjects_({
      tier: 'B',
      timeoutMs: 5000,
      functionName: 'DocLock.withBackgroundWriteLock',
    }, context || {}));
  },
  withSetupLock: function(callback, context) {
    return docLockRun_(callback, mergeObjects_({
      tier: 'C',
      timeoutMs: 30000,
      functionName: 'DocLock.withSetupLock',
    }, context || {}));
  },
});

function docLockRun_(callback, context) {
  var lock = LockService.getDocumentLock();
  var waitStarted = Date.now();
  var locked = lock.tryLock(context.timeoutMs);
  var waitMs = Date.now() - waitStarted;
  if (!locked) {
    docLockLogMetric_(context, 'busy', waitMs, 0, { retry: true });
    return {
      ok: false,
      retry: true,
      reason: 'busy',
      lockWaitMs: waitMs,
      lockHoldMs: 0,
    };
  }
  var holdStarted = Date.now();
  var holdMs = 0;
  var result;
  var thrown = null;
  var logResult = 'ok';
  var logMetadata = {};
  try {
    result = callback();
  } catch (err) {
    thrown = err;
    logResult = 'error';
    logMetadata = { error: err.message };
  } finally {
    holdMs = Date.now() - holdStarted;
    lock.releaseLock();
  }
  docLockLogMetric_(context, logResult, waitMs, holdMs, logMetadata);
  if (thrown) {
    throw thrown;
  }
  return docLockAttachMetrics_(result, waitMs, holdMs);
}

function docLockAttachMetrics_(result, waitMs, holdMs) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (result.lockWaitMs === undefined) {
      result.lockWaitMs = waitMs;
    }
    if (result.lockHoldMs === undefined) {
      result.lockHoldMs = holdMs;
    }
  }
  return result;
}

function docLockLogMetric_(context, result, waitMs, holdMs, metadata) {
  try {
    appendOpsLog_(getSalesWorkflowSpreadsheet_(), {
      functionName: context.functionName || 'DocLock',
      tier: context.tier || '',
      result: result,
      message: context.message || 'lock metric',
      lockWaitMs: waitMs,
      lockHoldMs: holdMs,
      target: context.target || '',
      metadata: mergeObjects_(context.metadata || {}, metadata || {}),
    });
  } catch (err) {
    // Lock metric logging must never mask the original operation.
  }
}
