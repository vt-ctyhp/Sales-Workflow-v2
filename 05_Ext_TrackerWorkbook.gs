const Tracker = Object.freeze({
  appendLog: function(rootApptId, entry) {
    var row = mergeObjects_(entry || {}, {
      TrackerLogID: entry && entry.TrackerLogID || extGeneratedId_('tracker'),
      RootApptID: rootApptId,
      EventAt: entry && entry.EventAt || extNow_(),
      Version: 1,
    });
    extAppendRow_('tracker', row);
    return extMutationResponse_(row, [CACHE_SLICE.CUSTOMER_ROOT_DETAIL, CACHE_SLICE.ADMIN_HEALTH]);
  },
  getEntries: function(rootApptId) {
    var rows = extReadStore_('tracker').filter(function(row) {
      return row.RootApptID === rootApptId;
    });
    rows.sort(function(a, b) {
      return extComparable_(b.EventAt) > extComparable_(a.EventAt) ? 1 : -1;
    });
    return extResponse_(rows, null);
  },
});
