const ApiIntake = Object.freeze({
  injectTest: function(payload, context) {
    return apiCall_('Api.intake.injectTest', context, function() {
      return Intake.process(mergeObjects_(payload || {}, {
        bookingSource: BOOKING_SOURCE.TEST,
      }));
    });
  },
  manualBooking: function(payload, context) {
    return apiCall_('Api.intake.manualBooking', context, function() {
      return Intake.process(mergeObjects_(payload || {}, {
        bookingSource: BOOKING_SOURCE.MANUAL,
        action: (payload && payload.action) || 'create',
      }));
    });
  },
  runTestScenarios: function(context) {
    return apiCall_('Api.intake.runTestScenarios', context, function() {
      return TestIntake.run();
    });
  },
});

function apiIntakeInjectTest(payload) {
  return ApiIntake.injectTest(payload || {}, apiTestContext_(ROLE.ADMIN));
}

function apiIntakeManualBooking(payload) {
  return ApiIntake.manualBooking(payload || {}, apiTestContext_(ROLE.ADMIN));
}
