const ApiSchedules = Object.freeze({
  list: function(context) {
    return apiCall_('Api.schedules.list', context, function() {
      return DashboardService.schedulesList();
    });
  },
  save: function(rows, context) {
    return apiCall_('Api.schedules.save', context, function(user) {
      return DashboardService.schedulesSave(rows || [], user);
    }, { target: 'RosterSchedule' });
  },
  upsertChange: function(row, context) {
    return apiCall_('Api.schedules.upsertChange', context, function(user) {
      return DashboardService.schedulesUpsertChange(row || {}, user);
    }, { target: row && row.ScheduleChangeID || 'ScheduleChanges' });
  },
  deleteChange: function(id, context) {
    return apiCall_('Api.schedules.deleteChange', context, function(user) {
      return DashboardService.schedulesDeleteChange(id, user);
    }, { target: id });
  },
});

const ApiUsers = Object.freeze({
  list: function(context) {
    return apiCall_('Api.users.list', context, function() {
      return DashboardService.usersList();
    });
  },
  upsert: function(user, context) {
    return apiCall_('Api.users.upsert', context, function(actor) {
      return DashboardService.usersUpsert(user || {}, actor);
    }, { target: user && (user.Email || user.email) || 'Users' });
  },
});
