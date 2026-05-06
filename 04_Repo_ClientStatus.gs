const ClientStatus = Object.freeze({
  get: function(rootApptId) {
    return repoGetByKey_('ClientStatus', rootApptId, 'RootApptID');
  },
  update: function(rootApptId, fields, version) {
    return repoUpdateByKey_('ClientStatus', rootApptId, fields, version, 'RootApptID');
  },
  updateDeadline: function(rootApptId, fields, version) {
    var payload = mergeObjects_(fields || {}, {
      Deadline3DUpdatedAt: new Date(),
    });
    return repoUpdateByKey_('ClientStatus', rootApptId, payload, version, 'RootApptID');
  },
  appendHistory: function(entry) {
    return repoAppendHistory_('ClientStatusHistory', entry);
  },
});
