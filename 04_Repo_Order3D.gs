const Order3D = Object.freeze({
  get: function(rootApptId) {
    return repoGetByKey_('Order3D', rootApptId, 'RootApptID');
  },
  update: function(rootApptId, fields, version) {
    return repoUpdateByKey_('Order3D', rootApptId, fields, version, 'RootApptID');
  },
  appendHistory: function(entry) {
    return repoAppendHistory_('Order3DHistory', entry);
  },
});
