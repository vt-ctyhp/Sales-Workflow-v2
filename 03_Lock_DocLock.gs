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
    };
  }
  var holdStarted = Date.now();
  try {
    var result = callback();
    docLockLogMetric_(context, 'ok', waitMs, Date.now() - holdStarted, {});
    return result;
  } catch (err) {
    docLockLogMetric_(context, 'error', waitMs, Date.now() - holdStarted, { error: err.message });
    throw err;
  } finally {
    lock.releaseLock();
  }
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
