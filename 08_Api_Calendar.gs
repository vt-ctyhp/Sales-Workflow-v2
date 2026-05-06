const ApiCalendar = Object.freeze({
  getMonth: function(monthKey, context) {
    return apiCall_('Api.calendar.getMonth', context, function() {
      return CacheSlices.calendarMonth(monthKey);
    });
  },
  getAiBrief: function(rootApptId, context) {
    return apiCall_('Api.calendar.getAiBrief', context, function() {
      var detail = CustomerDetailCache.build(rootApptId, 'standard');
      if (!detail.ok) {
        return detail;
      }
      return serviceOk_({
        rootApptId: rootApptId,
        aiBrief: detail.data.sections.aiBrief || null,
      }, detail.version, []);
    }, { target: rootApptId });
  },
});
