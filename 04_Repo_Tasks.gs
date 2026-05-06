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
  complete: function(taskId, fields, version) {
    return repoUpdateByKey_('TaskQueue', taskId, mergeObjects_({
      TaskState: TASK_STATE.COMPLETED,
      CompletedAt: new Date(),
      CompletedByEmail: getActiveUserEmail_(),
    }, fields || {}), version, 'TaskID');
  },
  appendLog: function(entry) {
    return repoAppendHistory_('TaskLog', entry);
  },
});
