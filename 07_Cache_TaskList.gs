const TaskListCache = Object.freeze({
  build: function(view) {
    var normalized = taskListNormalizeView_(view);
    return CacheSlices.get(CACHE_SLICE.TASK_LIST, normalized, function() {
      return taskListBuild_(normalized);
    });
  },
});

function taskListBuild_(view) {
  var tasks = repoReadAll_('TaskQueue');
  if (!tasks.ok) {
    return tasks;
  }
  var customers = cacheRowsByKey_(repoReadAll_('CustomerInfo').data || [], 'RootApptID');
  var statuses = cacheRowsByKey_(repoReadAll_('ClientStatus').data || [], 'RootApptID');
  var filtered = tasks.data.filter(function(task) {
    return taskListMatchesView_(task, view);
  }).map(function(task) {
    return taskListRow_(task, customers[task.RootApptID], statuses[task.RootApptID]);
  });
  filtered.sort(taskListSort_);
  return cacheBuildResponse_({
    view: view,
    count: filtered.length,
    counts: taskListCounts_(filtered),
    tasks: filtered,
  }, null);
}

function taskListNormalizeView_(view) {
  if (typeof view === 'string') {
    return {
      view: view,
      ownerEmail: view === 'mine' ? getActiveUserEmail_() : '',
    };
  }
  var normalized = mergeObjects_({
    view: 'mine',
    ownerEmail: '',
    ownerRole: '',
    includeCompleted: false,
  }, view || {});
  if (normalized.ownerEmail) {
    normalized.ownerEmail = normalizeEmail_(normalized.ownerEmail);
  } else if (normalized.view === 'mine') {
    normalized.ownerEmail = normalizeEmail_(getActiveUserEmail_());
  }
  return normalized;
}

function taskListMatchesView_(task, view) {
  if (!view.includeCompleted && !cacheIsOpenTask_(task)) {
    return false;
  }
  if (view.view === 'mine') {
    return !view.ownerEmail || normalizeEmail_(task.OwnerEmail) === view.ownerEmail;
  }
  if (view.view === 'cleanup') {
    return String(task.TaskType || '').indexOf('CUSTOMER_DATA_CLEANUP') === 0;
  }
  if (view.view === 'coverage') {
    return task.OwnerRole === ROLE.JOC || task.OwnerRole === ROLE.CLIENT_ADVISOR;
  }
  if (view.view === 'admin') {
    return true;
  }
  if (view.ownerRole) {
    return task.OwnerRole === view.ownerRole;
  }
  return true;
}

function taskListRow_(task, customer, status) {
  return {
    taskId: task.TaskID,
    rootApptId: task.RootApptID,
    apptId: task.APPT_ID,
    version: task.Version || null,
    taskType: task.TaskType,
    taskState: task.TaskState,
    ownerRole: task.OwnerRole,
    ownerEmail: task.OwnerEmail,
    ownerName: task.OwnerName,
    dueAt: task.DueAt,
    snoozedUntil: task.SnoozedUntil,
    blockReason: task.BlockReason,
    customer: {
      customerName: customer && customer.CustomerName || '',
      brand: customer && customer.Brand || '',
      email: customer && customer.Email || '',
      phone: customer && customer.Phone || '',
    },
    status: {
      salesStage: status && status.SalesStage || '',
      nextSteps: status && status.NextSteps || '',
      deadline3D: status && status.Deadline3D || '',
    },
  };
}

function taskListCounts_(rows) {
  return {
    total: rows.length,
    open: rows.filter(function(row) { return row.taskState === TASK_STATE.OPEN; }).length,
    claimed: rows.filter(function(row) { return row.taskState === TASK_STATE.CLAIMED; }).length,
    snoozed: rows.filter(function(row) { return row.taskState === TASK_STATE.SNOOZED; }).length,
    blocked: rows.filter(function(row) { return row.taskState === TASK_STATE.BLOCKED; }).length,
  };
}

function taskListSort_(a, b) {
  var aDue = repoComparable_(a.snoozedUntil || a.dueAt);
  var bDue = repoComparable_(b.snoozedUntil || b.dueAt);
  if (aDue === bDue) {
    return String(a.taskType || '').localeCompare(String(b.taskType || ''));
  }
  if (!aDue) {
    return 1;
  }
  if (!bDue) {
    return -1;
  }
  return aDue > bDue ? 1 : -1;
}
