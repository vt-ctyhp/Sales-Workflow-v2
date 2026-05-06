function runRepoTestsSummary() {
  return diagRunSummary_('RepoTests', function() {
    return RepoTests.run();
  });
}

function runCacheTestsSummary() {
  return diagRunSummary_('CacheTests', function() {
    return CacheTests.run();
  });
}

function runTestIntakeSummary() {
  return diagRunSummary_('TestIntake', function() {
    return TestIntake.run();
  });
}

function runServiceTestsSummary() {
  return diagRunSummary_('ServiceTests', function() {
    return ServiceTests.run();
  });
}

function runApiTestsSummary() {
  return diagRunSummary_('ApiTests', function() {
    return ApiTests.run();
  });
}

function runBenchmarksSummary() {
  return diagRunSummary_('Benchmarks', function() {
    return Benchmarks.run();
  });
}

function diagRunSummary_(suiteName, runner) {
  try {
    return JSON.stringify(diagSummarizeResult_(suiteName, runner()));
  } catch (err) {
    return JSON.stringify({
      suite: suiteName,
      ok: false,
      threw: true,
      error: err.message,
      stack: String(err.stack || '').split('\n').slice(0, 6),
    });
  }
}

function diagSummarizeResult_(suiteName, result) {
  result = result || {};
  var failures = (result.failures || []).map(diagSummarizeFailure_);
  var summary = {
    suite: suiteName,
    ok: Boolean(result.ok),
    testCount: result.testCount || result.metricCount || 0,
    failureCount: result.failureCount !== undefined ? result.failureCount : failures.length,
    failures: failures,
  };
  if (result.repoMethodCoverage) {
    summary.repoMethodCoverage = result.repoMethodCoverage;
  }
  if (result.thresholds) {
    summary.thresholds = result.thresholds;
  }
  if (result.totalMs !== undefined) {
    summary.totalMs = result.totalMs;
  }
  if (result.baselineAt) {
    summary.baselineAt = result.baselineAt;
  }
  if (result.metrics) {
    summary.metrics = result.metrics.map(function(metric) {
      return {
        name: metric.name,
        ok: Boolean(metric.ok),
        elapsedMs: metric.elapsedMs,
        thresholdMs: metric.thresholdMs,
        source: metric.source || '',
      };
    });
  }
  return summary;
}

function diagSummarizeFailure_(failure) {
  return {
    name: failure && failure.name || '',
    method: failure && failure.method || '',
    detail: diagCompact_(failure && failure.detail, 3),
  };
}

function diagCompact_(value, depth) {
  if (depth <= 0) {
    return diagScalar_(value);
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(function(item) {
      return diagCompact_(item, depth - 1);
    });
  }
  if (typeof value === 'object') {
    var output = {};
    Object.keys(value).slice(0, 12).forEach(function(key) {
      output[key] = diagCompact_(value[key], depth - 1);
    });
    return output;
  }
  return diagScalar_(value);
}

function diagScalar_(value) {
  if (typeof value === 'string' && value.length > 500) {
    return value.slice(0, 500) + '...';
  }
  return value;
}
