const TaskGen = Object.freeze({
  coreAppointmentTasks: function(appointment, status, artifacts) {
    return taskGenCoreAppointmentTasks_(appointment || {}, status || {}, artifacts || []);
  },
  postConsultTasks: function(appointment, status, order3d) {
    return taskGenPostConsultTasks_(appointment || {}, status || {}, order3d || {});
  },
  diamondTasks: function(appointment, dv, stones) {
    return taskGenDiamondTasks_(appointment || {}, dv || {}, stones || []);
  },
  dataCleanupTasks: function(root, customerInfo, status) {
    return taskGenDataCleanupTasks_(root || {}, customerInfo || {}, status || {});
  },
  diff: function(desired, current) {
    return taskGenDiff_(desired || [], current || []);
  },
});

function taskGenCoreAppointmentTasks_(appointment, status, artifacts) {
  var tasks = [];
  if (!appointment.APPT_ID || appointment.AppointmentStatus === APPOINTMENT_STATUS.CANCELED) {
    return tasks;
  }
  var start = appointment.AppointmentStart ? new Date(appointment.AppointmentStart) : null;
  var rootId = appointment.RootApptID || '';

  tasks.push(taskGenDesiredTask_(TASK_TYPE.ASSIGN_APPOINTMENT, rootId, appointment.APPT_ID, {
    ownerRole: '',
    taskState: TASK_STATE.COMPLETED,
    dueAt: appointment.BookedAt || new Date(),
    payload: { autoComplete: true },
  }));

  if (start) {
    var daysUntil = taskGenDaysUntil_(start);
    tasks.push(taskGenDesiredTask_(daysUntil <= taskGenHybridWindowDays_() ? TASK_TYPE.SEND_HYBRID_WELCOME : TASK_TYPE.SEND_WELCOME, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: appointment.BookedAt || new Date(),
    }));
    tasks.push(taskGenDesiredTask_(TASK_TYPE.SEND_MAP_INSTRUCTIONS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: taskGenAddDays_(start, -2),
    }));
    tasks.push(taskGenDesiredTask_(TASK_TYPE.REVIEW_APPOINTMENT, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.CLIENT_ADVISOR,
      dueAt: taskGenAddDays_(start, -1),
    }));
    if (toDateKey_(start) === toDateKey_(new Date()) || appointment.ForceAppointmentDayTasks === true) {
      tasks.push(taskGenDesiredTask_(TASK_TYPE.APPOINTMENT_DAY_CHECKLIST, rootId, appointment.APPT_ID, {
        ownerRole: ROLE.CLIENT_ADVISOR,
        dueAt: start,
      }));
    }
  }

  if (taskGenAppointmentCompleted_(appointment) && taskGenHasSummaryReady_(artifacts)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.APPROVE_RECAP_MESSAGE, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.CLIENT_ADVISOR,
      dueAt: new Date(),
      payload: { artifactId: taskGenLatestArtifactId_(artifacts, ARTIFACT_STAGE.SUMMARY_READY) },
    }));
  }
  if (taskGenHasApprovedArtifact_(artifacts)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.SEND_FINAL_RECAP, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
      payload: { artifactId: taskGenLatestArtifactId_(artifacts, ARTIFACT_STAGE.APPROVED) },
    }));
  }
  return tasks;
}

function taskGenPostConsultTasks_(appointment, status, order3d) {
  var tasks = [];
  var rootId = appointment.RootApptID || status.RootApptID || order3d.RootApptID || '';
  if (!rootId) {
    return tasks;
  }
  if (taskGenAppointmentCompleted_(appointment)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.POST_CONSULT_CLIENT_STATUS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (status.SalesStage === SALES_STAGE.CONSULT_COMPLETE && status.Is3DNeeded === true && !order3d.SONumber) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.START_3D_DESIGN, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if ((order3d.Current3DState || '').indexOf('Started') !== -1 && !status.Deadline3D) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.RECORD_3D_DEADLINE, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (status.IsWaxNeeded === true && !status.ActiveWaxRequestID && !status.WaxRequestStatus) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.REQUEST_WAX_PRINT, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (status.WaxRequestNeedsUpdate === true || order3d.WaxRequestNeedsUpdate === true) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.UPDATE_WAX_REQUEST, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  return tasks;
}

function taskGenDiamondTasks_(appointment, dv, stones) {
  var tasks = [];
  var rootId = appointment.RootApptID || dv.RootApptID || '';
  if (!rootId || !taskGenDiamondWorkflowActive_(dv)) {
    return tasks;
  }
  tasks.push(taskGenDesiredTask_(TASK_TYPE.PROPOSE_DIAMONDS, rootId, appointment.APPT_ID, {
    ownerRole: ROLE.CLIENT_ADVISOR,
    dueAt: new Date(),
  }));
  tasks.push(taskGenDesiredTask_(TASK_TYPE.PREPARE_DV_QUOTATION, rootId, appointment.APPT_ID, {
    ownerRole: ROLE.JOC,
    dueAt: new Date(),
  }));

  if (taskGenAnyStone_(stones, ['Proposed', 'Order Review', 'Orderable'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.ORDER_DIAMONDS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ADMIN,
      dueAt: new Date(),
    }));
  }
  if (taskGenAnyStone_(stones, ['Ordered'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.TRACK_DIAMONDS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ASSISTANT,
      dueAt: new Date(),
    }));
    tasks.push(taskGenDesiredTask_(TASK_TYPE.ACK_DIAMONDS_ORDERED_ASSIGNED_REP, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.CLIENT_ADVISOR,
      dueAt: new Date(),
    }));
    tasks.push(taskGenDesiredTask_(TASK_TYPE.ACK_DIAMONDS_ORDERED_JOC, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (taskGenAnyStone_(stones, ['Delivered Pending Confirmation'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.CONFIRM_DIAMOND_DELIVERY, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ADMIN,
      dueAt: new Date(),
    }));
  }
  if (dv.DecisionsDue === true || taskGenAnyStone_(stones, ['Decision Due'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.RECORD_DIAMOND_DECISIONS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (taskGenAnyStone_(stones, ['Return Due'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.RETURN_DIAMONDS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ASSISTANT,
      dueAt: new Date(),
    }));
  }
  if (dv.EtaRisk === true || taskGenAnyStone_(stones, ['ETA Risk'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.REVIEW_DIAMOND_ETA_ASSIGNED_REP, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.CLIENT_ADVISOR,
      dueAt: new Date(),
    }));
    tasks.push(taskGenDesiredTask_(TASK_TYPE.REVIEW_DIAMOND_ETA_JOC, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  return tasks;
}

function taskGenDataCleanupTasks_(root, customerInfo, status) {
  var rootId = root.RootApptID || customerInfo.RootApptID || status.RootApptID || '';
  if (!rootId) {
    return [];
  }
  var tasks = [];
  if (!customerInfo.Email || !customerInfo.Phone || !customerInfo.ClientAdvisorEmail || status.NeedsCleanupReview === true) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.CUSTOMER_DATA_CLEANUP_REVIEW, rootId, '', {
      ownerRole: customerInfo.ClientAdvisorEmail ? ROLE.CLIENT_ADVISOR : ROLE.JOC,
      ownerEmail: customerInfo.ClientAdvisorEmail || customerInfo.JOCOwnerEmail || '',
      dueAt: new Date(),
    }));
  }
  if (status.CleanupPendingAdmin === true) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.CUSTOMER_DATA_CLEANUP_CONFIRM, rootId, '', {
      ownerRole: ROLE.ADMIN,
      dueAt: new Date(),
    }));
  }
  if (status.CleanupNeedsRevision === true) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.CUSTOMER_DATA_CLEANUP_REVISE, rootId, '', {
      ownerRole: customerInfo.ClientAdvisorEmail ? ROLE.CLIENT_ADVISOR : ROLE.JOC,
      ownerEmail: customerInfo.ClientAdvisorEmail || customerInfo.JOCOwnerEmail || '',
      dueAt: new Date(),
    }));
  }
  return tasks;
}

function taskGenDiff_(desired, current) {
  var currentByKey = {};
  (current || []).forEach(function(task) {
    currentByKey[taskGenTaskKey_(task)] = task;
  });
  var desiredKeys = {};
  var upserts = [];
  (desired || []).forEach(function(task) {
    var key = taskGenTaskKey_(task);
    desiredKeys[key] = true;
    var existing = currentByKey[key];
    if (!existing) {
      upserts.push(task);
      return;
    }
    if (taskGenNeedsUpsert_(task, existing)) {
      upserts.push(mergeObjects_(task, {
        TaskID: existing.TaskID,
        Version: existing.Version,
      }));
    }
  });
  var blocks = (current || []).filter(function(task) {
    return taskGenIsOpenTask_(task) && task.PayloadJson && task.PayloadJson.generated === true && !desiredKeys[taskGenTaskKey_(task)];
  });
  return {
    ok: true,
    upserts: upserts,
    blocks: blocks,
  };
}

function taskGenDesiredTask_(taskType, rootApptId, apptId, options) {
  var payload = mergeObjects_({
    generated: true,
    desiredKey: taskType + '|' + (rootApptId || '') + '|' + (apptId || ''),
  }, options && options.payload || {});
  return {
    TaskID: '',
    RootApptID: rootApptId || '',
    APPT_ID: apptId || '',
    TaskType: taskType,
    TaskState: options && options.taskState || TASK_STATE.OPEN,
    OwnerRole: options && options.ownerRole || '',
    OwnerEmail: options && options.ownerEmail || '',
    OwnerName: options && options.ownerName || '',
    DueAt: options && options.dueAt || new Date(),
    TemplateKey: options && options.templateKey || '',
    PayloadJson: payload,
    InvalidatesJson: [CACHE_SLICE.TASK_LIST, CACHE_SLICE.TASK_DETAIL, CACHE_SLICE.CUSTOMER_ROOT_DETAIL],
  };
}

function taskGenTaskKey_(task) {
  var payload = task.PayloadJson || {};
  if (payload.desiredKey) {
    return payload.desiredKey;
  }
  return [task.TaskType || '', task.RootApptID || '', task.APPT_ID || '', task.TemplateKey || ''].join('|');
}

function taskGenNeedsUpsert_(desired, existing) {
  return desired.TaskState !== existing.TaskState ||
    desired.OwnerRole !== existing.OwnerRole ||
    desired.OwnerEmail !== existing.OwnerEmail ||
    repoComparable_(desired.DueAt) !== repoComparable_(existing.DueAt);
}

function taskGenHybridWindowDays_() {
  var config = ConfigRepo.get('TaskGeneration', 'HybridWelcomeWindowDays');
  return config.ok ? Number(config.data.Value || 7) : 7;
}

function taskGenDaysUntil_(date) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function taskGenAddDays_(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function taskGenAppointmentCompleted_(appointment) {
  return appointment.AppointmentStatus === APPOINTMENT_STATUS.COMPLETED || appointment.Outcome === APPOINTMENT_STATUS.COMPLETED;
}

function taskGenHasSummaryReady_(artifacts) {
  return (artifacts || []).some(function(artifact) {
    return artifact.WorkflowStage === ARTIFACT_STAGE.SUMMARY_READY || artifact.SummaryDocUrl;
  });
}

function taskGenHasApprovedArtifact_(artifacts) {
  return (artifacts || []).some(function(artifact) {
    return artifact.WorkflowStage === ARTIFACT_STAGE.APPROVED;
  });
}

function taskGenLatestArtifactId_(artifacts, stage) {
  var matches = (artifacts || []).filter(function(artifact) {
    return artifact.WorkflowStage === stage || stage === ARTIFACT_STAGE.SUMMARY_READY && artifact.SummaryDocUrl;
  });
  return matches.length ? matches[matches.length - 1].ArtifactID : '';
}

function taskGenDiamondWorkflowActive_(dv) {
  var state = String(dv.WorkflowState || '').toLowerCase();
  return state && ['closed', 'complete', 'inactive', 'none'].indexOf(state) === -1;
}

function taskGenAnyStone_(stones, statuses) {
  return (stones || []).some(function(stone) {
    return statuses.indexOf(stone.StoneStatus) !== -1 || statuses.indexOf(stone.WorkflowState) !== -1 || statuses.indexOf(stone.ReturnStatus) !== -1 || stone.EtaRisk === true && statuses.indexOf('ETA Risk') !== -1;
  });
}

function taskGenIsOpenTask_(task) {
  return [TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) === -1;
}
