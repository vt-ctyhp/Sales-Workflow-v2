const CustomerInfo = Object.freeze({
  get: function(rootApptId) {
    return repoGetByKey_('CustomerInfo', rootApptId, 'RootApptID');
  },
  create: function(customer) {
    return repoAppend_('CustomerInfo', customer);
  },
  updateOwners: function(rootApptId, owners, version) {
    return repoUpdateByKey_('CustomerInfo', rootApptId, owners, version, 'RootApptID');
  },
});
