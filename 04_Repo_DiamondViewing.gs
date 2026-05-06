const DiamondViewing = Object.freeze({
  get: function(rootApptId) {
    return repoGetByKey_('DiamondViewing', rootApptId, 'RootApptID');
  },
  update: function(rootApptId, fields, version) {
    return repoUpdateByKey_('DiamondViewing', rootApptId, fields, version, 'RootApptID');
  },
});
