const OpsLog = Object.freeze({
  append: function(entry) {
    return repoAppend_('OpsLog', {
      OpsLogID: entry.OpsLogID,
      Timestamp: entry.Timestamp || new Date(),
      ActorEmail: entry.ActorEmail || getActiveUserEmail_(),
      FunctionName: entry.FunctionName || entry.functionName,
      Tier: entry.Tier || entry.tier || '',
      Result: entry.Result || entry.result || 'ok',
      Message: entry.Message || entry.message || '',
      LockWaitMs: entry.LockWaitMs || entry.lockWaitMs || '',
      LockHoldMs: entry.LockHoldMs || entry.lockHoldMs || '',
      Target: entry.Target || entry.target || '',
      MetadataJson: entry.MetadataJson || entry.metadata || {},
    });
  },
  list: function(filters) {
    var rows = repoReadAll_('OpsLog');
    if (!filters || !rows.ok) {
      return rows;
    }
    var data = rows.data.filter(function(row) {
      return Object.keys(filters).every(function(key) {
        return !filters[key] || repoComparable_(row[key]) === repoComparable_(filters[key]);
      });
    });
    return repoReadResponse_(data, null, Date.now());
  },
});
