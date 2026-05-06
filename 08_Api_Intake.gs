const ApiIntake = Object.freeze({
  injectTest: function(payload) {
    return Intake.process(mergeObjects_(payload || {}, {
      bookingSource: BOOKING_SOURCE.TEST,
    }));
  },
  manualBooking: function(payload) {
    return Intake.process(mergeObjects_(payload || {}, {
      bookingSource: BOOKING_SOURCE.MANUAL,
      action: (payload && payload.action) || 'create',
    }));
  },
  runTestScenarios: function() {
    return TestIntake.run();
  },
});

function apiIntakeInjectTest(payload) {
  return ApiIntake.injectTest(payload || {});
}

function apiIntakeManualBooking(payload) {
  return ApiIntake.manualBooking(payload || {});
}
