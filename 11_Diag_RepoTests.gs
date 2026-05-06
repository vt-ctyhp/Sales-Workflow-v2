const RepoTests = Object.freeze({
  run: function() {
    var result = repoTestsRun_();
    repoTestsLogResult_(result);
    return result;
  },
});

function runRepoTests() {
  return RepoTests.run();
}

function repoTestsRun_() {
  var results = [];
  var testKey = 'OptimisticConcurrency';
  var seed = 'seed_' + Utilities.getUuid();

  var seeded = ConfigRepo.set('Phase1Tests', testKey, seed, null);
  results.push(repoTestAssert_('config seed write succeeds', seeded.ok, seeded));

  var read = ConfigRepo.get('Phase1Tests', testKey);
  results.push(repoTestAssert_('config read succeeds', read.ok && read.data.Value === seed, read));

  var firstUpdate = ConfigRepo.set('Phase1Tests', testKey, 'first_update', read.version);
  results.push(repoTestAssert_('versioned update succeeds', firstUpdate.ok && firstUpdate.version === Number(read.version) + 1, firstUpdate));

  var staleUpdate = ConfigRepo.set('Phase1Tests', testKey, 'stale_update', read.version);
  results.push(repoTestAssert_('stale version update conflicts', !staleUpdate.ok && staleUpdate.conflict === true, staleUpdate));

  var latest = ConfigRepo.get('Phase1Tests', testKey);
  results.push(repoTestAssert_('stale update does not overwrite latest value', latest.ok && latest.data.Value === 'first_update', latest));

  var named = NamedLock.acquire('phase1_repo_tests', 5000);
  results.push(repoTestAssert_('named lock acquire succeeds', named.ok, named));
  if (named.ok) {
    var released = NamedLock.release('phase1_repo_tests', named.token);
    results.push(repoTestAssert_('named lock release succeeds', released.ok && released.released === true, released));
  }

  var doc = DocLock.withUserWriteLock(function() {
    return { ok: true, marker: 'doc_lock_test' };
  }, {
    functionName: 'RepoTests.docLock',
    target: 'Phase1Tests',
  });
  results.push(repoTestAssert_('document lock callback succeeds', doc.ok && doc.marker === 'doc_lock_test', doc));

  var failures = results.filter(function(result) {
    return !result.ok;
  });
  return {
    ok: failures.length === 0,
    testCount: results.length,
    failures: failures,
    results: results,
  };
}

function repoTestAssert_(name, condition, detail) {
  return {
    ok: Boolean(condition),
    name: name,
    detail: detail,
  };
}

function repoTestsLogResult_(result) {
  var failures = result.failures.map(function(failure) {
    return {
      name: failure.name,
      detail: failure.detail,
    };
  });
  console.log(JSON.stringify({
    ok: result.ok,
    testCount: result.testCount,
    failureCount: failures.length,
    failures: failures,
  }));
}
