const ApiAdmin = Object.freeze({
  dashboard: function(filters, context) {
    return apiCall_('Api.admin.dashboard', context, function() {
      return CacheSlices.adminHealth(filters || {});
    });
  },
  assignOwners: function(rootApptId, advisor, joc, version, context) {
    return apiCall_('Api.admin.assignOwners', context, function(user) {
      return DashboardService.adminAssignOwners(rootApptId, advisor, joc, version, user);
    }, { target: rootApptId });
  },
  reassignTask: function(taskId, toUser, version, context) {
    return apiCall_('Api.admin.reassignTask', context, function(user) {
      return DashboardService.adminReassignTask(taskId, toUser || {}, version, user);
    }, { target: taskId });
  },
  blockTask: function(taskId, reason, version, context) {
    return apiCall_('Api.admin.blockTask', context, function(user) {
      return DashboardService.adminBlockTask(taskId, reason, version, user);
    }, { target: taskId });
  },
  unblockTask: function(taskId, version, context) {
    return apiCall_('Api.admin.unblockTask', context, function(user) {
      return DashboardService.adminUnblockTask(taskId, version, user);
    }, { target: taskId });
  },
});
