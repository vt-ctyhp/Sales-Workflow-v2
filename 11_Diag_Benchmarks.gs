const Benchmarks = Object.freeze({
  run: function() {
    return benchmarksRun_();
  },
});

function runBenchmarks() {
  return Benchmarks.run();
}

function benchmarksRun_() {
  var suiteStarted = Date.now();
  var ctx = repoTestContext_();
  benchmarksSeed_(ctx);
  CacheSlices.invalidate([
    CACHE_SLICE.TASK_LIST,
    CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
    CACHE_SLICE.CUSTOMER_CARD,
    CACHE_SLICE.CALENDAR_MONTH,
    CACHE_SLICE.ADMIN_HEALTH,
    CACHE_SLICE.DIAMOND_INVENTORY,
    CACHE_SLICE.DIAMOND_TRACKING,
    CACHE_SLICE.DIAMOND_ROOT,
    CACHE_SLICE.PAYMENT_SUMMARY,
    CACHE_SLICE.FORM_OPTIONS,
  ], {
    reason: 'benchmark_baseline',
    rootApptId: ctx.rootId,
  });

  var metrics = [
    benchmarksMeasure_('TaskListSlice.domain', function() {
      return TaskListCache.build({
        view: 'mine',
        ownerEmail: ctx.userEmail,
      });
    }),
    benchmarksMeasure_('TaskListSlice.cache', function() {
      return TaskListCache.build({
        view: 'mine',
        ownerEmail: ctx.userEmail,
      });
    }),
    benchmarksMeasure_('CustomerRootDetail.standard', function() {
      return CustomerDetailCache.build(ctx.rootId, 'standard');
    }),
    benchmarksMeasure_('CustomerCardSlice.search', function() {
      return CacheSlices.customerCards({
        q: ctx.customerEmail,
        includeClosed: true,
      });
    }),
    benchmarksMeasure_('CalendarMonthSlice', function() {
      return CacheSlices.calendarMonth('2026-05');
    }),
    benchmarksMeasure_('AdminHealthSlice', function() {
      return CacheSlices.adminHealth({});
    }),
    benchmarksMeasure_('DiamondInventorySlice', function() {
      return CacheSlices.diamondInventory({});
    }),
    benchmarksMeasure_('PaymentSummarySlice', function() {
      return CacheSlices.paymentSummary(ctx.rootId);
    }),
  ];
  var failures = metrics.filter(function(metric) {
    return !metric.ok;
  });
  metrics.sort(function(a, b) {
    return b.elapsedMs - a.elapsedMs;
  });
  return {
    ok: failures.length === 0,
    implemented: true,
    phase: 5,
    totalMs: Date.now() - suiteStarted,
    baselineAt: new Date().toISOString(),
    slowestStep: metrics.length ? metrics[0] : null,
    metrics: metrics,
    failures: failures,
  };
}

function benchmarksMeasure_(name, callback) {
  var started = Date.now();
  var result;
  try {
    result = callback();
  } catch (err) {
    return {
      ok: false,
      name: name,
      elapsedMs: Date.now() - started,
      reason: 'exception',
      error: err.message,
    };
  }
  return {
    ok: Boolean(result && result.ok),
    name: name,
    elapsedMs: Date.now() - started,
    source: result && result.source || '',
    ageMs: result && result.ageMs || 0,
    version: result && result.version || null,
    slice: result && result.slice || '',
    cacheGeneration: result && result.cacheGeneration || null,
    reason: result && result.reason || '',
  };
}

function benchmarksSeed_(ctx) {
  Appointments.upsertEvent(repoTestAppointment_(ctx));
  RootAppointments.create(repoTestRootAppointment_(ctx));
  CustomerInfo.create(repoTestCustomer_(ctx));
  repoAppend_('ClientStatus', repoTestClientStatus_(ctx));
  repoAppend_('DiamondViewing', repoTestDiamondViewing_(ctx));
  repoAppend_('Order3D', repoTestOrder3D_(ctx));
  Users.upsert(repoTestUser_(ctx));
  Tasks.upsert(repoTestTask_(ctx));
  Artifacts.registerUpload(mergeObjects_(repoTestArtifact_(ctx), {
    WorkflowStage: ARTIFACT_STAGE.SUMMARY_READY,
    SummaryDocUrl: 'https://example.com/benchmark-summary/' + ctx.suffix,
  }));
  Stones.assignInStock(ctx.stockStoneCertNo, ctx.rootId, {
    Shape: 'Oval',
    Carat: 1.25,
  });
  Ledger.append(ctx.rootId, {
    Amount: 100,
    Method: 'benchmark',
  });
}
