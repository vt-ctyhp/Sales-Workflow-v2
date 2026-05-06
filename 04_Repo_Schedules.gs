const Schedules = Object.freeze({
  list: function() {
    return repoReadAll_('RosterSchedule');
  },
  save: function(rows) {
    var saved = (rows || []).map(function(row) {
      if (row.ScheduleID && repoGetByKey_('RosterSchedule', row.ScheduleID, 'ScheduleID').ok) {
        return repoUpdateByKey_('RosterSchedule', row.ScheduleID, row, row.Version, 'ScheduleID');
      }
      return repoAppend_('RosterSchedule', row);
    });
    return { ok: true, data: saved };
  },
  upsertChange: function(row) {
    if (row && row.ScheduleChangeID && repoGetByKey_('ScheduleChanges', row.ScheduleChangeID, 'ScheduleChangeID').ok) {
      return repoUpdateByKey_('ScheduleChanges', row.ScheduleChangeID, row, row.Version, 'ScheduleChangeID');
    }
    return repoAppend_('ScheduleChanges', row);
  },
});
