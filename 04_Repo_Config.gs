const ConfigRepo = Object.freeze({
  get: function(section, key) {
    return repoFindOne_('Config', {
      Section: section,
      Key: key,
    });
  },
  set: function(section, key, value, version) {
    return repoUpsertWhere_('Config', {
      Section: section,
      Key: key,
    }, {
      Value: value,
      ValueType: typeof value,
      EditableByAdmin: true,
    }, version, {
      Version: 1,
      Description: '',
    });
  },
});
