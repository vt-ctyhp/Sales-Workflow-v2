const TaskGen = Object.freeze({
  runTick: function(limit) {
    return taskGenRunTick_(limit);
  },
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

const TASK_GEN_CURSOR_KEY = 'salesWorkflow.taskGen.cursor';
const TASK_GEN_TRIGGER_BATCH_SIZE = 10;

function taskGenRunTick_(limit) {
  return NamedLock.withLock('trigger.taskGen', function() {
    var context = taskGenReadContext_();
    var roots = context.roots.filter(function(root) {
      return root.IsActive !== false && root.RootLifecycleState !== ROOT_LIFECYCLE_STATE.ARCHIVED;
    });
    var selection = taskGenSelectBatch_(roots, limit);
    roots = selection.roots;
    var summary = {
      processed: 0,
      totalRoots: selection.totalRoots,
      batchStart: selection.startIndex,
      batchNext: selection.nextIndex,
      batched: selection.batched,
      desired: 0,
      upserted: 0,
      blocked: 0,
      skipped: 0,
      failures: [],
    };
    roots.forEach(function(root) {
      var result = taskGenProcessRoot_(root, context);
      summary.processed += 1;
      summary.desired += result.desired || 0;
      summary.upserted += result.upserted || 0;
      summary.blocked += result.blocked || 0;
      summary.skipped += result.skipped || 0;
      if (!result.ok) {
        summary.failures.push(result);
      }
    });
    var invalidations = summary.upserted || summary.blocked ? [
      CACHE_SLICE.TASK_LIST,
      CACHE_SLICE.TASK_DETAIL,
      CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
      CACHE_SLICE.ADMIN_HEALTH,
    ] : [];
    if (invalidations.length) {
      CacheSlices.invalidate(invalidations, {
        reason: 'task_generation_tick',
      });
    }
    return serviceOk_(summary, null, invalidations);
  }, 1000);
}

function taskGenSelectBatch_(roots, limit) {
  var total = roots.length;
  var size = Number(limit || 0);
  if (!size || size >= total || total === 0) {
    return {
      roots: roots,
      totalRoots: total,
      startIndex: 0,
      nextIndex: 0,
      batched: false,
    };
  }
  var props = PropertiesService.getScriptProperties();
  var rawStart = Number(props.getProperty(TASK_GEN_CURSOR_KEY) || 0);
  var start = rawStart >= 0 && rawStart < total ? rawStart : 0;
  var selected = [];
  var count = Math.min(size, total);
  for (var i = 0; i < count; i += 1) {
    selected.push(roots[(start + i) % total]);
  }
  var next = (start + count) % total;
  props.setProperty(TASK_GEN_CURSOR_KEY, String(next));
  return {
    roots: selected,
    totalRoots: total,
    startIndex: start,
    nextIndex: next,
    batched: true,
  };
}

function taskGenReadContext_() {
  return {
    roots: repoReadAll_('RootAppointments').data || [],
    appointmentsByRoot: taskGenGroupBy_(repoReadAll_('AppointmentEvents').data || [], 'RootApptID'),
    statusByRoot: taskGenFirstBy_(repoReadAll_('ClientStatus').data || [], 'RootApptID'),
    customerByRoot: taskGenFirstBy_(repoReadAll_('CustomerInfo').data || [], 'RootApptID'),
    order3dByRoot: taskGenFirstBy_(repoReadAll_('Order3D').data || [], 'RootApptID'),
    diamondViewingByRoot: taskGenFirstBy_(repoReadAll_('DiamondViewing').data || [], 'RootApptID'),
    artifactsByRoot: taskGenGroupBy_(repoReadAll_('AppointmentArtifacts').data || [], 'RootApptID'),
    stonesByRoot: taskGenGroupBy_(repoReadAll_('Stones').data || [], 'AssignedRootApptID'),
    tasksByRoot: taskGenGroupBy_(repoReadAll_('TaskQueue').data || [], 'RootApptID'),
  };
}

function taskGenProcessRoot_(root, context) {
  try {
    var rootId = root.RootApptID;
    var appointments = taskGenActiveAppointments_(context.appointmentsByRoot[rootId] || []);
    var latestAppointment = taskGenLatestAppointment_(root, appointments);
    if (!latestAppointment && !rootId) {
      return { ok: true, skipped: 1, desired: 0, upserted: 0, blocked: 0 };
    }
    var status = context.statusByRoot[rootId] || {};
    var customer = context.customerByRoot[rootId] || {};
    var order3d = context.order3dByRoot[rootId] || {};
    var diamondViewing = context.diamondViewingByRoot[rootId] || {};
    var artifacts = context.artifactsByRoot[rootId] || [];
    var stones = context.stonesByRoot[rootId] || [];
    var desired = [];
    appointments.forEach(function(appointment) {
      desired = desired.concat(TaskGen.coreAppointmentTasks(appointment, status, artifacts));
    });
    desired = desired
      .concat(TaskGen.postConsultTasks(latestAppointment || {}, status, order3d))
      .concat(TaskGen.diamondTasks(latestAppointment || {}, diamondViewing, stones))
      .concat(TaskGen.dataCleanupTasks(root, customer, status))
      .map(function(task) {
        return taskGenAssignOwner_(task, customer);
      });
    var current = context.tasksByRoot[rootId] || [];
    var diff = TaskGen.diff(desired, current);
    var upserted = 0;
    var blocked = 0;
    var failures = [];
    diff.upserts.forEach(function(task) {
      var result = taskGenWithWriteLock_(function() {
        return Tasks.upsert(task);
      }, 'upsert', task.TaskID);
      if (result.ok) {
        upserted += 1;
      } else {
        failures.push(taskGenMutationFailure_('upsert', task.TaskID, result));
      }
    });
    diff.blocks.forEach(function(task) {
      var result = taskGenWithWriteLock_(function() {
        return repoUpdateByKey_('TaskQueue', task.TaskID, {
          TaskState: TASK_STATE.BLOCKED,
          BlockReason: 'Generated task no longer matches desired state.',
        }, task.Version, 'TaskID');
      }, 'block', task.TaskID);
      if (result.ok) {
        blocked += 1;
      } else {
        failures.push(taskGenMutationFailure_('block', task.TaskID, result));
      }
    });
    return {
      ok: failures.length === 0,
      rootApptId: rootId,
      desired: desired.length,
      upserted: upserted,
      blocked: blocked,
      failures: failures,
      skipped: 0,
    };
  } catch (err) {
    return {
      ok: false,
      rootApptId: root && root.RootApptID || '',
      reason: err.message,
      desired: 0,
      upserted: 0,
      blocked: 0,
      skipped: 1,
    };
  }
}

function taskGenWithWriteLock_(callback, action, taskId) {
  return DocLock.withBackgroundWriteLock(callback, {
    timeoutMs: 100,
    functionName: 'Trigger.taskGen.' + action,
    target: taskId || 'TaskQueue',
    metadata: {
      action: action,
    },
  });
}

function taskGenMutationFailure_(action, taskId, result) {
  return {
    action: action,
    taskId: taskId || '',
    reason: result && result.reason || 'mutation_failed',
    retry: Boolean(result && result.retry),
    lockWaitMs: result && result.lockWaitMs || 0,
  };
}

function taskGenAssignOwner_(task, customer) {
  if (!task.OwnerRole || task.OwnerEmail) {
    return task;
  }
  if (task.OwnerRole === ROLE.CLIENT_ADVISOR) {
    return mergeObjects_(task, {
      OwnerEmail: customer.ClientAdvisorEmail || '',
      OwnerName: customer.ClientAdvisorName || '',
    });
  }
  if (task.OwnerRole === ROLE.JOC) {
    return mergeObjects_(task, {
      OwnerEmail: customer.JOCOwnerEmail || '',
      OwnerName: customer.JOCOwnerName || '',
    });
  }
  return task;
}

function taskGenActiveAppointments_(appointments) {
  return (appointments || []).filter(function(appointment) {
    return appointment.AppointmentStatus !== APPOINTMENT_STATUS.CANCELED;
  }).sort(function(a, b) {
    return repoComparable_(a.AppointmentStart || a.AppointmentDate) > repoComparable_(b.AppointmentStart || b.AppointmentDate) ? 1 : -1;
  });
}

function taskGenLatestAppointment_(root, appointments) {
  var ids = [root.CurrentAPPT_ID, root.LatestAPPT_ID].filter(Boolean);
  for (var i = 0; i < ids.length; i += 1) {
    var match = (appointments || []).filter(function(appointment) {
      return appointment.APPT_ID === ids[i];
    })[0];
    if (match) {
      return match;
    }
  }
  return appointments && appointments.length ? appointments[appointments.length - 1] : null;
}

function taskGenGroupBy_(rows, key) {
  var groups = {};
  (rows || []).forEach(function(row) {
    var value = row[key] || '';
    if (!value) {
      return;
    }
    if (!groups[value]) {
      groups[value] = [];
    }
    groups[value].push(row);
  });
  return groups;
}

function taskGenFirstBy_(rows, key) {
  var first = {};
  (rows || []).forEach(function(row) {
    var value = row[key] || '';
    if (value && !first[value]) {
      first[value] = row;
    }
  });
  return first;
}

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

  if (taskGenAnyStoneOrder_(stones, ['Proposing'])) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.ORDER_DIAMONDS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ADMIN,
      dueAt: new Date(),
    }));
  }
  if (taskGenAnyStoneOrder_(stones, ['On the Way'])) {
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
  if (taskGenAnyStoneArrived_(stones)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.CONFIRM_DIAMOND_DELIVERY, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ADMIN,
      dueAt: new Date(),
    }));
  }
  if (dv.DecisionsDue === true || taskGenAnyStoneDecisionDue_(stones)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.RECORD_DIAMOND_DECISIONS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.JOC,
      dueAt: new Date(),
    }));
  }
  if (taskGenAnyStoneReturnDue_(stones)) {
    tasks.push(taskGenDesiredTask_(TASK_TYPE.RETURN_DIAMONDS, rootId, appointment.APPT_ID, {
      ownerRole: ROLE.DIAMOND_ORDER_ASSISTANT,
      dueAt: new Date(),
    }));
  }
  if (dv.EtaRisk === true || taskGenAnyStoneEtaRisk_(stones, appointment)) {
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

function taskGenAnyStoneOrder_(stones, statuses) {
  return (stones || []).some(function(stone) {
    return statuses.indexOf(stone.OrderStatus) !== -1;
  });
}

function taskGenAnyStoneArrived_(stones) {
  return (stones || []).some(function(stone) {
    var tracking = String(stone.TrackingStatus || '').toLowerCase();
    return stone.OrderStatus === 'On the Way' && (tracking === 'arrived' || tracking === 'delivered');
  });
}

function taskGenAnyStoneDecisionDue_(stones) {
  return (stones || []).some(function(stone) {
    return stone.OrderStatus === 'Delivered' && stone.StoneStatus === 'In Stock' && !stone.Decision;
  });
}

function taskGenAnyStoneReturnDue_(stones) {
  return (stones || []).some(function(stone) {
    if (stone.ReturnStatus === 'Return Due' || stone.ReturnStatus === 'Return Overdue') {
      return true;
    }
    if (!stone.ReturnDueDate || stone.ReturnStatus === 'Return In Progress') {
      return false;
    }
    return new Date(stone.ReturnDueDate).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000;
  });
}

function taskGenAnyStoneEtaRisk_(stones, appointment) {
  var appointmentStart = appointment && appointment.AppointmentStart ? new Date(appointment.AppointmentStart).getTime() : 0;
  var riskyStatuses = ['delayed', 'concerning', 'unavailable', 'canceled', 'cancelled'];
  return (stones || []).some(function(stone) {
    var tracking = String(stone.TrackingStatus || '').toLowerCase();
    var eta = stone.TrackingETA ? new Date(stone.TrackingETA).getTime() : 0;
    return riskyStatuses.indexOf(tracking) !== -1 || Boolean(appointmentStart && eta && eta > appointmentStart);
  });
}

function taskGenIsOpenTask_(task) {
  return [TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) === -1;
}
