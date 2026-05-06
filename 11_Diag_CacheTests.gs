const CacheTests = Object.freeze({
  run: function() {
    var result = cacheTestsRun_();
    cacheTestsLogResult_(result);
    return result;
  },
});

function runCacheTests() {
  return CacheTests.run();
}

function cacheTestsRun_() {
  var suite = cacheTestSuite_(repoTestContext_());
  cacheTestsSeed_(suite);
  cacheTestsInvalidateAll_(suite, 'setup');
  cacheTestsCustomerDetailModes_(suite);
  cacheTestsTaskSlices_(suite);
  cacheTestsGeneralSlices_(suite);
  cacheTestsLogging_(suite);
  return cacheTestsBuildResult_(suite);
}

function cacheTestsSeed_(suite) {
  var ctx = suite.ctx;
  cacheTestCall_(suite, 'seed appointment', function() {
    return Appointments.upsertEvent(repoTestAppointment_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed root appointment', function() {
    return RootAppointments.create(repoTestRootAppointment_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed customer info', function() {
    return CustomerInfo.create(repoTestCustomer_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed client status', function() {
    return repoAppend_('ClientStatus', repoTestClientStatus_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed client status history', function() {
    return ClientStatus.appendHistory(repoTestClientStatusHistory_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed 3D order', function() {
    return repoAppend_('Order3D', repoTestOrder3D_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed 3D order history', function() {
    return Order3D.appendHistory(repoTestOrder3DHistory_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed diamond viewing', function() {
    return repoAppend_('DiamondViewing', repoTestDiamondViewing_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed wax request', function() {
    return Wax.create(repoTestWax_(ctx, ctx.waxRequestId, new Date(2026, 4, 6)));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed template', function() {
    return repoAppend_('Templates', repoTestTemplate_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed user', function() {
    return Users.upsert(repoTestUser_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed task', function() {
    return Tasks.upsert(repoTestTask_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed task log', function() {
    return Tasks.appendLog(repoTestTaskLog_(ctx));
  }, cacheTestOk_);
  cacheTestCall_(suite, 'seed artifact with summary', function() {
    return Artifacts.registerUpload(mergeObjects_(repoTestArtifact_(ctx), {
      WorkflowStage: ARTIFACT_STAGE.SUMMARY_READY,
      SummaryDocUrl: 'https://example.com/summary/' + ctx.suffix,
      TranscriptDocUrl: 'https://example.com/transcript/' + ctx.suffix,
    }));
  }, cacheTestOk_);
}

function cacheTestsInvalidateAll_(suite, reason) {
  cacheTestCall_(suite, 'invalidate all Phase 2 slices for ' + reason, function() {
    return CacheSlices.invalidate([
      CACHE_SLICE.TASK_LIST,
      CACHE_SLICE.TASK_DETAIL,
      CACHE_SLICE.CUSTOMER_CARD,
      CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
      CACHE_SLICE.CALENDAR_MONTH,
      CACHE_SLICE.APPOINTMENT_BRIEF,
      CACHE_SLICE.ADMIN_HEALTH,
      CACHE_SLICE.PAYMENT_SUMMARY,
      CACHE_SLICE.FORM_OPTIONS,
    ], {
      reason: reason,
      rootApptId: suite.ctx.rootId,
    });
  }, function(result) {
    return result.ok && result.invalidated.indexOf(CACHE_SLICE.CUSTOMER_ROOT_DETAIL) !== -1;
  });
}

function cacheTestsCustomerDetailModes_(suite) {
  var ctx = suite.ctx;
  var cardMiss = cacheTestCall_(suite, 'CustomerRootDetail card returns from domain on first read', function() {
    return CustomerDetailCache.build(ctx.rootId, 'card');
  }, function(result) {
    return result.ok &&
      result.source === 'domain' &&
      result.data.mode === 'card' &&
      result.data.sections.identity.customerName === 'Phase One Test' &&
      result.data.sections.status.salesStage === SALES_STAGE.APPOINTMENT_BOOKED &&
      Boolean(result.data.sections.wax.waxRequestId);
  });

  cacheTestCall_(suite, 'CustomerRootDetail card returns from cache on second read', function() {
    return CustomerDetailCache.build(ctx.rootId, 'card');
  }, function(result) {
    return result.ok && result.source === 'cache' && result.cacheGeneration === cardMiss.cacheGeneration;
  });

  cacheTestCall_(suite, 'CustomerRootDetail standard includes links and AI brief', function() {
    return CustomerDetailCache.build(ctx.rootId, 'standard');
  }, function(result) {
    return result.ok &&
      result.data.sections.appointmentLinks.summaryUrls.length === 1 &&
      result.data.sections.aiBrief.summaryDocUrl.indexOf(ctx.suffix) !== -1;
  });

  cacheTestCall_(suite, 'CustomerRootDetail full includes all detail sections', function() {
    return CustomerDetailCache.build(ctx.rootId, 'full');
  }, function(result) {
    return result.ok &&
      result.data.sections.statusHistory.length === 1 &&
      result.data.sections.order3dHistory.length === 1 &&
      result.data.sections.tasks.length === 1 &&
      result.data.sections.recentActivity.length >= 1 &&
      result.data.sections.formOptions.templates.length >= 1;
  });

  cacheTestCall_(suite, 'CustomerRootDetail taskMini includes compact sections', function() {
    return CustomerDetailCache.build(ctx.rootId, 'taskMini');
  }, function(result) {
    return result.ok &&
      result.data.sections.identity.customerName === 'Phase One Test' &&
      result.data.sections.currentAppointment.appointment.apptId === ctx.apptId &&
      result.data.sections.formOptions === undefined;
  });

  cacheTestCall_(suite, 'CustomerRootDetail invalidation forces rebuild', function() {
    var invalidated = CacheSlices.invalidate([CACHE_SLICE.CUSTOMER_ROOT_DETAIL], {
      reason: 'cache test rebuild',
      rootApptId: ctx.rootId,
    });
    var rebuilt = CustomerDetailCache.build(ctx.rootId, 'card');
    return {
      ok: invalidated.ok && rebuilt.ok,
      invalidated: invalidated,
      rebuilt: rebuilt,
    };
  }, function(result) {
    return result.ok &&
      result.rebuilt.source === 'domain' &&
      result.rebuilt.cacheGeneration > cardMiss.cacheGeneration;
  });
}

function cacheTestsTaskSlices_(suite) {
  var ctx = suite.ctx;
  var view = {
    view: 'mine',
    ownerEmail: ctx.userEmail,
  };
  cacheTestCall_(suite, 'TaskListSlice returns seeded task', function() {
    return TaskListCache.build(view);
  }, function(result) {
    return result.ok &&
      result.source === 'domain' &&
      cacheTestHasTask_(result.data.tasks, ctx.taskId) &&
      result.data.count === 1;
  });

  cacheTestCall_(suite, 'TaskListSlice returns cache hit', function() {
    return TaskListCache.build(view);
  }, function(result) {
    return result.ok && result.source === 'cache' && cacheTestHasTask_(result.data.tasks, ctx.taskId);
  });

  cacheTestCall_(suite, 'TaskDetailSlice returns task and customer mini', function() {
    return CacheSlices.taskDetail(ctx.taskId);
  }, function(result) {
    return result.ok &&
      result.data.task.TaskID === ctx.taskId &&
      result.data.customer.sections.identity.customerName === 'Phase One Test';
  });
}

function cacheTestsGeneralSlices_(suite) {
  var ctx = suite.ctx;
  cacheTestCall_(suite, 'CustomerCardSlice returns seeded customer', function() {
    return CacheSlices.customerCards({ q: ctx.customerEmail, includeClosed: true });
  }, function(result) {
    return result.ok && result.data.rows.some(function(row) {
      return row.rootApptId === ctx.rootId;
    });
  });

  cacheTestCall_(suite, 'CalendarMonthSlice returns seeded appointment', function() {
    return CacheSlices.calendarMonth('2026-05');
  }, function(result) {
    var day = result.data.days['2026-05-06'] || [];
    return result.ok && day.some(function(row) {
      return row.apptId === ctx.apptId;
    });
  });

  cacheTestCall_(suite, 'AppointmentBriefSlice returns appointment and artifact', function() {
    return CacheSlices.appointmentBrief(ctx.apptId);
  }, function(result) {
    return result.ok &&
      result.data.appointment.APPT_ID === ctx.apptId &&
      result.data.artifacts.length === 1 &&
      result.data.aiBrief.summaryDocUrl.indexOf(ctx.suffix) !== -1;
  });

  cacheTestCall_(suite, 'AdminHealthSlice returns totals', function() {
    return CacheSlices.adminHealth({});
  }, function(result) {
    return result.ok &&
      result.data.totals.roots >= 1 &&
      result.data.taskCounts[TASK_STATE.OPEN] >= 1;
  });

  cacheTestCall_(suite, 'FormOptionsSlice returns active template and user', function() {
    return CacheSlices.formOptions();
  }, function(result) {
    return result.ok &&
      result.data.templates.some(function(row) { return row.TemplateKey === ctx.templateKey; }) &&
      result.data.activeUsers.some(function(row) { return row.Email === ctx.userEmail; });
  });
}

function cacheTestsLogging_(suite) {
  cacheTestCall_(suite, 'cache hit and miss metrics are logged to OpsLog', function() {
    return OpsLog.list({ FunctionName: 'CacheSlices.get' });
  }, function(result) {
    var rows = result.ok ? result.data : [];
    var hasHit = rows.some(function(row) {
      return row.Target === CACHE_SLICE.CUSTOMER_ROOT_DETAIL && row.Result === 'hit';
    });
    var hasMiss = rows.some(function(row) {
      return row.Target === CACHE_SLICE.CUSTOMER_ROOT_DETAIL && row.Result === 'miss';
    });
    return result.ok && hasHit && hasMiss;
  });
}

function cacheTestSuite_(ctx) {
  return {
    ctx: ctx,
    results: [],
  };
}

function cacheTestCall_(suite, name, callback, assertion) {
  var detail;
  var ok = false;
  try {
    detail = callback();
    ok = assertion ? Boolean(assertion(detail)) : cacheTestOk_(detail);
  } catch (err) {
    detail = {
      error: err.message,
      stack: err.stack || '',
    };
  }
  suite.results.push({
    ok: ok,
    name: name,
    detail: detail,
  });
  return detail;
}

function cacheTestOk_(result) {
  return Boolean(result && result.ok);
}

function cacheTestHasTask_(rows, taskId) {
  return (rows || []).some(function(row) {
    return row.taskId === taskId;
  });
}

function cacheTestsBuildResult_(suite) {
  var failures = suite.results.filter(function(result) {
    return !result.ok;
  });
  return {
    ok: failures.length === 0,
    testCount: suite.results.length,
    failureCount: failures.length,
    failures: failures,
    results: suite.results,
  };
}

function cacheTestsLogResult_(result) {
  console.log(JSON.stringify({
    ok: result.ok,
    testCount: result.testCount,
    failureCount: result.failureCount,
    failures: result.failures.map(function(failure) {
      return {
        name: failure.name,
        detail: failure.detail,
      };
    }),
  }));
}
