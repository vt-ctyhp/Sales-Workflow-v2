const DataCleanup = Object.freeze({
  listOpen: function() {
    return repoFindMany_('DataCleanup', { CompletedAt: '' });
  },
  upsertCase: function(cleanupCase) {
    if (cleanupCase && cleanupCase.CaseID) {
      var existing = repoGetByKey_('DataCleanup', cleanupCase.CaseID, 'CaseID');
      if (existing.ok) {
        return repoUpdateByKey_('DataCleanup', cleanupCase.CaseID, cleanupCase, cleanupCase.Version, 'CaseID');
      }
    }
    return repoAppend_('DataCleanup', cleanupCase);
  },
});
