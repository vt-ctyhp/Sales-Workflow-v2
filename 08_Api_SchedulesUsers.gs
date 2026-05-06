const ApiSchedules = Object.freeze({
  list: function() {
    return phaseNotImplemented_('Api.schedules.list');
  },
  save: function(rows) {
    return phaseNotImplemented_('Api.schedules.save');
  },
  upsertChange: function(row) {
    return phaseNotImplemented_('Api.schedules.upsertChange');
  },
  deleteChange: function(id) {
    return phaseNotImplemented_('Api.schedules.deleteChange');
  },
});

const ApiUsers = Object.freeze({
  list: function() {
    return phaseNotImplemented_('Api.users.list');
  },
  upsert: function(user) {
    return phaseNotImplemented_('Api.users.upsert');
  },
});
