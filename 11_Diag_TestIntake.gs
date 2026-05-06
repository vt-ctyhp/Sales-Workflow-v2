const TestIntake = Object.freeze({
  run: function() {
    var result = testIntakeRun_();
    testIntakeLogResult_(result);
    return result;
  },
});

function runTestIntake() {
  return TestIntake.run();
}

function runIntakeTests() {
  return TestIntake.run();
}

function testIntakeRun_() {
  var suite = testIntakeSuite_(repoTestContext_());
  testIntakeFreshCustomer_(suite);
  testIntakeIdempotency_(suite);
  testIntakeExistingCustomerMatch_(suite);
  testIntakeRescheduleChain_(suite);
  testIntakeCancelActive_(suite);
  testIntakeCancelRescheduledActiveOnly_(suite);
  testIntakeEdit_(suite);
  testIntakeNoShow_(suite);
  testIntakeCompleted_(suite);
  return testIntakeBuildResult_(suite);
}

function testIntakeFreshCustomer_(suite) {
  var payload = testIntakePayload_(suite.ctx, 'fresh', 'create', {});
  var result = testIntakeCall_(suite, 'new booking creates root, appointment, customer, status', function() {
    return ApiIntake.injectTest(payload, testIntakeAdminContext_());
  }, function(output) {
    var root = RootAppointments.get(output.data.rootApptId);
    var event = Appointments.getById(output.data.apptId);
    var customer = CustomerInfo.get(output.data.rootApptId);
    var status = ClientStatus.get(output.data.rootApptId);
    return output.ok && output.data.action === 'create' && root.ok && event.ok && customer.ok && status.ok &&
      status.data.SalesStage === SALES_STAGE.APPOINTMENT_BOOKED;
  });
  suite.freshPayload = payload;
  suite.freshResult = result;
}

function testIntakeIdempotency_(suite) {
  testIntakeCall_(suite, 're-running same payload does not duplicate event', function() {
    var rerun = ApiIntake.injectTest(suite.freshPayload, testIntakeAdminContext_());
    var matches = repoFindMany_('AppointmentEvents', {
      BookingSource: BOOKING_SOURCE.TEST,
      ExternalBookingId: suite.freshPayload.externalBookingId,
    });
    return {
      ok: rerun.ok && matches.ok,
      rerun: rerun,
      matches: matches,
    };
  }, function(output) {
    return output.ok && output.matches.data.length === 1 && output.rerun.data.apptId === suite.freshResult.data.apptId;
  });
}

function testIntakeExistingCustomerMatch_(suite) {
  testIntakeCall_(suite, 'new booking existing customer matches by email phone brand', function() {
    return ApiIntake.injectTest(testIntakePayload_(suite.ctx, 'existing_customer', 'create', {
      email: suite.freshPayload.email,
      phone: suite.freshPayload.phone,
      brand: suite.freshPayload.brand,
    }), testIntakeAdminContext_());
  }, function(output) {
    return output.ok && output.data.rootApptId === suite.freshResult.data.rootApptId && output.data.apptId !== suite.freshResult.data.apptId;
  });
}

function testIntakeRescheduleChain_(suite) {
  var a = testIntakePayload_(suite.ctx, 'chain_a', 'create', {});
  var b = testIntakePayload_(suite.ctx, 'chain_b', 'reschedule', {
    externalRescheduledFromId: a.externalBookingId,
    visitDateTime: '2026-05-12T10:00:00-07:00',
  });
  var c = testIntakePayload_(suite.ctx, 'chain_c', 'reschedule', {
    externalRescheduledFromId: b.externalBookingId,
    visitDateTime: '2026-05-13T10:00:00-07:00',
  });
  testIntakeCall_(suite, 'reschedule chain links A to B to C', function() {
    var created = ApiIntake.injectTest(a, testIntakeAdminContext_());
    var second = ApiIntake.injectTest(b, testIntakeAdminContext_());
    var third = ApiIntake.injectTest(c, testIntakeAdminContext_());
    var firstEvent = Appointments.findByExternalId(BOOKING_SOURCE.TEST, a.externalBookingId);
    var secondEvent = Appointments.findByExternalId(BOOKING_SOURCE.TEST, b.externalBookingId);
    var thirdEvent = Appointments.findByExternalId(BOOKING_SOURCE.TEST, c.externalBookingId);
    return {
      ok: created.ok && second.ok && third.ok && firstEvent.ok && secondEvent.ok && thirdEvent.ok,
      created: created,
      second: second,
      third: third,
      firstEvent: firstEvent,
      secondEvent: secondEvent,
      thirdEvent: thirdEvent,
    };
  }, function(output) {
    return output.ok &&
      output.firstEvent.data.AppointmentStatus === APPOINTMENT_STATUS.RESCHEDULED &&
      output.firstEvent.data.RescheduledTo === output.second.data.apptId &&
      output.secondEvent.data.RescheduledFrom === output.created.data.apptId &&
      output.secondEvent.data.RescheduledTo === output.third.data.apptId &&
      output.thirdEvent.data.RescheduledFrom === output.second.data.apptId;
  });
}

function testIntakeCancelActive_(suite) {
  var createPayload = testIntakePayload_(suite.ctx, 'cancel_active', 'create', {});
  var cancelPayload = testIntakePayload_(suite.ctx, 'cancel_active', 'cancel', {
    externalBookingId: createPayload.externalBookingId,
  });
  testIntakeCall_(suite, 'cancel marks active appointment canceled', function() {
    var created = ApiIntake.injectTest(createPayload, testIntakeAdminContext_());
    var canceled = ApiIntake.injectTest(cancelPayload, testIntakeAdminContext_());
    var event = Appointments.findByExternalId(BOOKING_SOURCE.TEST, createPayload.externalBookingId);
    return {
      ok: created.ok && canceled.ok && event.ok,
      event: event,
    };
  }, function(output) {
    return output.ok && output.event.data.AppointmentStatus === APPOINTMENT_STATUS.CANCELED;
  });
}

function testIntakeCancelRescheduledActiveOnly_(suite) {
  var a = testIntakePayload_(suite.ctx, 'cancel_chain_a', 'create', {});
  var b = testIntakePayload_(suite.ctx, 'cancel_chain_b', 'reschedule', {
    externalRescheduledFromId: a.externalBookingId,
    visitDateTime: '2026-05-15T10:00:00-07:00',
  });
  var cancelB = testIntakePayload_(suite.ctx, 'cancel_chain_b', 'cancel', {
    externalBookingId: b.externalBookingId,
  });
  testIntakeCall_(suite, 'canceling rescheduled active event leaves prior event rescheduled', function() {
    ApiIntake.injectTest(a, testIntakeAdminContext_());
    ApiIntake.injectTest(b, testIntakeAdminContext_());
    var canceled = ApiIntake.injectTest(cancelB, testIntakeAdminContext_());
    var first = Appointments.findByExternalId(BOOKING_SOURCE.TEST, a.externalBookingId);
    var second = Appointments.findByExternalId(BOOKING_SOURCE.TEST, b.externalBookingId);
    return {
      ok: canceled.ok && first.ok && second.ok,
      first: first,
      second: second,
    };
  }, function(output) {
    return output.ok &&
      output.first.data.AppointmentStatus === APPOINTMENT_STATUS.RESCHEDULED &&
      output.second.data.AppointmentStatus === APPOINTMENT_STATUS.CANCELED;
  });
}

function testIntakeEdit_(suite) {
  var createPayload = testIntakePayload_(suite.ctx, 'edit', 'create', {});
  var editPayload = testIntakePayload_(suite.ctx, 'edit', 'edit', {
    externalBookingId: createPayload.externalBookingId,
    visitType: 'Edited consult',
  });
  testIntakeCall_(suite, 'edit updates confirmed appointment in place', function() {
    var created = ApiIntake.injectTest(createPayload, testIntakeAdminContext_());
    var edited = ApiIntake.injectTest(editPayload, testIntakeAdminContext_());
    var event = Appointments.getById(created.data.apptId);
    return {
      ok: created.ok && edited.ok && event.ok,
      created: created,
      edited: edited,
      event: event,
    };
  }, function(output) {
    return output.ok && output.edited.data.apptId === output.created.data.apptId && output.event.data.VisitType === 'Edited consult';
  });
}

function testIntakeNoShow_(suite) {
  testIntakeStatusChange_(suite, 'no_show', APPOINTMENT_STATUS.NO_SHOW);
}

function testIntakeCompleted_(suite) {
  testIntakeStatusChange_(suite, 'completed', APPOINTMENT_STATUS.COMPLETED);
}

function testIntakeStatusChange_(suite, name, status) {
  var createPayload = testIntakePayload_(suite.ctx, name, 'create', {});
  var statusPayload = testIntakePayload_(suite.ctx, name, 'status_change', {
    externalBookingId: createPayload.externalBookingId,
    status: status,
  });
  testIntakeCall_(suite, 'status change to ' + status, function() {
    var created = ApiIntake.injectTest(createPayload, testIntakeAdminContext_());
    var changed = ApiIntake.injectTest(statusPayload, testIntakeAdminContext_());
    var event = Appointments.getById(created.data.apptId);
    return {
      ok: created.ok && changed.ok && event.ok,
      event: event,
    };
  }, function(output) {
    return output.ok && output.event.data.AppointmentStatus === status;
  });
}

function testIntakePayload_(ctx, name, action, overrides) {
  return mergeObjects_({
    externalBookingId: 'intake_' + name + '_' + ctx.suffix,
    action: action,
    customerName: 'Intake Test ' + name,
    firstName: 'Intake',
    lastName: 'Test',
    email: 'intake+' + name + '+' + ctx.suffix + '@example.com',
    phone: '(555) 020-0000',
    brand: 'HPUSA',
    visitDateTime: '2026-05-11T10:00:00-07:00',
    visitType: 'Initial consult',
    duration: 60,
    location: 'Showroom',
    source: 'TestIntake',
    budgetRange: '$5k-$10k',
    diamondType: 'Lab',
    styleNotes: 'Phase 3 intake test',
    referenceLinks: 'https://example.com/reference',
    receivedAt: '2026-05-05T22:00:00-07:00',
    rawPayload: { testName: name, suffix: ctx.suffix },
  }, overrides || {});
}

function testIntakeSuite_(ctx) {
  return {
    ctx: ctx,
    results: [],
    freshPayload: null,
    freshResult: null,
  };
}

function testIntakeAdminContext_() {
  return apiTestContext_(ROLE.ADMIN, 'test.intake.admin@example.com');
}

function testIntakeCall_(suite, name, callback, assertion) {
  var detail;
  var ok = false;
  try {
    detail = callback();
    ok = assertion ? Boolean(assertion(detail)) : Boolean(detail && detail.ok);
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

function testIntakeBuildResult_(suite) {
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

function testIntakeLogResult_(result) {
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
