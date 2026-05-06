const ApiCustomers = Object.freeze({
  search: function(filters, context) {
    return apiCall_('Api.customers.search', context, function() {
      return CacheSlices.customerCards(filters || {});
    });
  },
  getDetail: function(rootApptId, mode, context) {
    return apiCall_('Api.customers.getDetail', context, function() {
      return CustomerDetailCache.build(rootApptId, mode || 'standard');
    }, { target: rootApptId });
  },
  updateStatus: function(rootApptId, fields, version, context) {
    return apiCall_('Api.customers.updateStatus', context, function(user) {
      return DashboardService.customerUpdateStatus(rootApptId, fields || {}, version, user);
    }, { target: rootApptId });
  },
  updateDeadline: function(rootApptId, fields, version, context) {
    return apiCall_('Api.customers.updateDeadline', context, function(user) {
      return DashboardService.customerUpdateDeadline(rootApptId, fields || {}, version, user);
    }, { target: rootApptId });
  },
  submit3DRevision: function(rootApptId, payload, version, context) {
    return apiCall_('Api.customers.submit3DRevision', context, function(user) {
      return DashboardService.customerSubmit3DRevision(rootApptId, payload || {}, version, user);
    }, { target: rootApptId });
  },
  requestWax: function(rootApptId, payload, version, context) {
    return apiCall_('Api.customers.requestWax', context, function(user) {
      return DashboardService.customerRequestWax(rootApptId, payload || {}, version, user);
    }, { target: rootApptId });
  },
  startOrder: function(rootApptId, payload, version, context) {
    return apiCall_('Api.customers.startOrder', context, function(user) {
      return DashboardService.customerStartOrder(rootApptId, payload || {}, version, user);
    }, { target: rootApptId });
  },
});
