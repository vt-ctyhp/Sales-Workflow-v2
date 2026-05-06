const ApiTasks = Object.freeze({
  list: function(view, context) {
    return apiCall_('Api.tasks.list', context, function(user) {
      var normalizedView = typeof view === 'string' ? { view: view } : mergeObjects_(view || {});
      if (!normalizedView.view) {
        normalizedView.view = 'mine';
      }
      if (normalizedView.view === 'mine' && !normalizedView.ownerEmail) {
        normalizedView.ownerEmail = user.email;
      }
      return TaskListCache.build(normalizedView);
    });
  },
  detail: function(taskId, context) {
    return apiCall_('Api.tasks.detail', context, function() {
      return CacheSlices.taskDetail(taskId);
    }, { target: taskId });
  },
  complete: function(taskId, payload, version, context) {
    return apiCall_('Api.tasks.complete', context, function() {
      return TaskCompletion.complete(taskId, payload || {}, version);
    }, { target: taskId });
  },
  snooze: function(taskId, until, reason, version, context) {
    return apiCall_('Api.tasks.snooze', context, function(user) {
      return DashboardService.taskSnooze(taskId, until, reason, version, user);
    }, { target: taskId });
  },
  claim: function(taskId, version, context) {
    return apiCall_('Api.tasks.claim', context, function(user) {
      return DashboardService.taskClaim(taskId, version, user);
    }, { target: taskId });
  },
  acknowledge: function(taskId, version, context) {
    return apiCall_('Api.tasks.acknowledge', context, function(user) {
      return DashboardService.taskAcknowledge(taskId, version, user);
    }, { target: taskId });
  },
  logTemplateCopied: function(taskId, context) {
    return apiCall_('Api.tasks.logTemplateCopied', context, function(user) {
      return DashboardService.taskLogTemplateCopied(taskId, user);
    }, { target: taskId });
  },
});
