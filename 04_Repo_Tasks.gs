const Tasks = Object.freeze({
  get: function(taskId) {
    return repoGetByKey_('TaskQueue', taskId, 'TaskID');
  },
  upsert: function(task) {
    if (task && task.TaskID && repoGetByKey_('TaskQueue', task.TaskID, 'TaskID').ok) {
      return repoUpdateByKey_('TaskQueue', task.TaskID, task, task.Version, 'TaskID');
    }
    return repoAppend_('TaskQueue', task);
  },
  complete: function(taskId, fields, version, actor) {
    return repoUpdateByKey_('TaskQueue', taskId, mergeObjects_({
      TaskState: TASK_STATE.COMPLETED,
      CompletedAt: new Date(),
      CompletedByEmail: actor && actor.email || getActiveUserEmail_(),
    }, fields || {}), version, 'TaskID');
  },
  canActOn: function(taskOrId, user) {
    return tasksCanActOn_(taskOrId, user);
  },
  appendLog: function(entry) {
    return repoAppendHistory_('TaskLog', entry);
  },
});

function tasksCanActOn_(taskOrId, user) {
  var task = typeof taskOrId === 'string' ? Tasks.get(taskOrId).data : taskOrId;
  if (!task || [TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) !== -1) {
    return false;
  }
  var roles = tasksUserRoles_(user);
  if (roles.indexOf(ROLE.ADMIN) !== -1) {
    return true;
  }
  var userEmail = normalizeEmail_(user && (user.email || user.Email));
  if (userEmail && normalizeEmail_(task.OwnerEmail) === userEmail) {
    return true;
  }
  if (!normalizeEmail_(task.OwnerEmail) && task.OwnerRole && roles.indexOf(task.OwnerRole) !== -1) {
    return true;
  }
  return task.TaskType === TASK_TYPE.RETURN_DIAMONDS && roles.indexOf(ROLE.DIAMOND_ORDER_ADMIN) !== -1;
}

function tasksUserRoles_(user) {
  if (!user) {
    return [];
  }
  var roles = user.roles || user.Roles || user.RolesCsv || user.role || '';
  if (Array.isArray(roles)) {
    return roles.filter(Boolean);
  }
  return String(roles || '').split(/[,\n;]/).map(function(role) {
    return role.trim();
  }).filter(Boolean);
}
