const Wax = Object.freeze({
  getLatestByRoot: function(rootApptId) {
    var rows = repoFindMany_('WaxRequests', { RootApptID: rootApptId });
    if (!rows.ok || rows.data.length === 0) {
      return repoNotFoundResponse_(Date.now());
    }
    rows.data.sort(function(a, b) {
      return repoComparable_(b.UpdatedAt) > repoComparable_(a.UpdatedAt) ? 1 : -1;
    });
    return repoReadResponse_(rows.data[0], rows.data[0].Version || null, Date.now());
  },
  create: function(request) {
    return repoAppend_('WaxRequests', request);
  },
  update: function(waxRequestId, fields, version) {
    return repoUpdateByKey_('WaxRequests', waxRequestId, fields, version, 'WaxRequestID');
  },
});
