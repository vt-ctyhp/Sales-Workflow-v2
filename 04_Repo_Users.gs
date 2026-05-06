const Users = Object.freeze({
  getByEmail: function(email) {
    return repoGetByKey_('Users', normalizeEmail_(email), 'Email');
  },
  listActive: function() {
    return repoFindMany_('Users', { Active: true });
  },
  upsert: function(user) {
    var payload = mergeObjects_(user || {}, {
      Email: normalizeEmail_(user && user.Email),
    });
    if (payload.Email && repoGetByKey_('Users', payload.Email, 'Email').ok) {
      return repoUpdateByKey_('Users', payload.Email, payload, payload.Version, 'Email');
    }
    return repoAppend_('Users', payload);
  },
});
