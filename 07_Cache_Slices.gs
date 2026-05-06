const CacheSlices = Object.freeze({
  get: function(sliceName, key, builder, options) {
    return cacheGet_(sliceName, key, builder, options || {});
  },
  invalidate: function(invalidations, context) {
    return cacheInvalidate_(invalidations, context || {});
  },
  taskDetail: function(taskId) {
    return cacheGet_(CACHE_SLICE.TASK_DETAIL, { taskId: taskId }, function() {
      return cacheBuildTaskDetail_(taskId);
    });
  },
  customerCards: function(filters) {
    return cacheGet_(CACHE_SLICE.CUSTOMER_CARD, filters || {}, function() {
      return cacheBuildCustomerCards_(filters || {});
    });
  },
  calendarMonth: function(monthKey) {
    return cacheGet_(CACHE_SLICE.CALENDAR_MONTH, { monthKey: monthKey }, function() {
      return cacheBuildCalendarMonth_(monthKey);
    });
  },
  appointmentBrief: function(apptId) {
    return cacheGet_(CACHE_SLICE.APPOINTMENT_BRIEF, { apptId: apptId }, function() {
      return cacheBuildAppointmentBrief_(apptId);
    });
  },
  adminHealth: function(filters) {
    return cacheGet_(CACHE_SLICE.ADMIN_HEALTH, filters || {}, function() {
      return cacheBuildAdminHealth_(filters || {});
    });
  },
  formOptions: function() {
    return cacheGet_(CACHE_SLICE.FORM_OPTIONS, { scope: 'all' }, function() {
      return cacheBuildFormOptions_();
    });
  },
  diamondInventory: function(filters) {
    return cacheGet_(CACHE_SLICE.DIAMOND_INVENTORY, filters || {}, function() {
      return cacheSafeExternal_('Stones.getInStock', function() {
        return Stones.getInStock(filters || {});
      });
    }, { ttlSeconds: 60 });
  },
  diamondTracking: function() {
    return cacheGet_(CACHE_SLICE.DIAMOND_TRACKING, { scope: 'all' }, function() {
      return cacheSafeExternal_('Stones.getByRoot', function() {
        return Stones.getByRoot('');
      });
    }, { ttlSeconds: 60 });
  },
  paymentSummary: function(rootApptId) {
    return cacheGet_(CACHE_SLICE.PAYMENT_SUMMARY, { rootApptId: rootApptId }, function() {
      return cacheBuildPaymentSummary_(rootApptId);
    }, { ttlSeconds: 60 });
  },
  prewarm: function() {
    return cachePrewarm_();
  },
});

const CACHE_VERSION_PREFIX = 'salesWorkflow.cache.version.';
const CACHE_KEY_PREFIX = 'sw:v1:';
const CACHE_HOT_TTL_SECONDS = 300;
const CACHE_FAST_TTL_SECONDS = 60;
const CACHE_TTL_BY_SLICE = Object.freeze({
  TaskListSlice: CACHE_FAST_TTL_SECONDS,
  TaskDetailSlice: CACHE_FAST_TTL_SECONDS,
  CalendarMonthSlice: CACHE_FAST_TTL_SECONDS,
  AppointmentBriefSlice: CACHE_FAST_TTL_SECONDS,
  PaymentSummarySlice: CACHE_FAST_TTL_SECONDS,
  DiamondInventorySlice: CACHE_FAST_TTL_SECONDS,
  DiamondTrackingSlice: CACHE_FAST_TTL_SECONDS,
});

function cacheGet_(sliceName, key, builder, options) {
  var started = Date.now();
  var stableKey = cacheStableStringify_(key || {});
  var generation = cacheGetGeneration_(sliceName);
  var cacheKey = cacheBuildKey_(sliceName, stableKey, generation);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      var envelope = JSON.parse(cached);
      cacheLogMetric_('hit', sliceName, key, {
        cacheKey: cacheKey,
        ageMs: Date.now() - Number(envelope.builtAt || started),
      });
      return {
        ok: true,
        data: envelope.data,
        version: envelope.version || null,
        slice: sliceName,
        key: key,
        source: 'cache',
        ageMs: Date.now() - Number(envelope.builtAt || started),
        buildMs: Number(envelope.buildMs || 0),
        cacheKey: cacheKey,
        cacheGeneration: generation,
      };
    } catch (err) {
      cache.remove(cacheKey);
      cacheLogMetric_('parse_error', sliceName, key, {
        cacheKey: cacheKey,
        error: err.message,
      });
    }
  }

  var built = builder();
  var normalized = cacheNormalizeBuildResult_(sliceName, key, built, started, generation, cacheKey);
  if (normalized.ok) {
    cacheStore_(cache, cacheKey, normalized, options || {});
  }
  cacheLogMetric_(normalized.ok ? 'miss' : 'builder_error', sliceName, key, {
    cacheKey: cacheKey,
    buildMs: normalized.buildMs,
    ok: normalized.ok,
    reason: normalized.reason || '',
  });
  return normalized;
}

function cacheInvalidate_(invalidations, context) {
  var slices = cacheNormalizeInvalidations_(invalidations);
  var props = PropertiesService.getScriptProperties();
  var updated = [];
  slices.forEach(function(sliceName) {
    var key = CACHE_VERSION_PREFIX + sliceName;
    var next = Number(props.getProperty(key) || '1') + 1;
    props.setProperty(key, String(next));
    updated.push({
      slice: sliceName,
      generation: next,
    });
  });
  if (updated.length) {
    cacheLogMetric_('invalidate', 'CacheSlices', updated.map(function(row) { return row.slice; }), {
      updated: updated,
      context: context || {},
    });
  }
  return {
    ok: true,
    invalidated: updated.map(function(row) { return row.slice; }),
    generations: updated,
  };
}

function cacheBuildTaskDetail_(taskId) {
  var task = Tasks.get(taskId);
  if (!task.ok) {
    return task;
  }
  var customer = task.data.RootApptID ? CustomerDetailCache.build(task.data.RootApptID, 'taskMini') : null;
  var template = task.data.TemplateKey ? Templates.get(task.data.TemplateKey) : null;
  return cacheBuildResponse_({
    task: task.data,
    version: task.version,
    customer: customer && customer.ok ? customer.data : null,
    template: template && template.ok ? template.data : null,
  }, task.version);
}

function cacheBuildCustomerCards_(filters) {
  var roots = repoReadAll_('RootAppointments');
  var customers = cacheRowsByKey_(repoReadAll_('CustomerInfo').data || [], 'RootApptID');
  var statuses = cacheRowsByKey_(repoReadAll_('ClientStatus').data || [], 'RootApptID');
  var orders = cacheRowsByKey_(repoReadAll_('Order3D').data || [], 'RootApptID');
  var waxByRoot = cacheLatestRowsByKey_(repoReadAll_('WaxRequests').data || [], 'RootApptID', 'UpdatedAt');
  var rows = (roots.data || []).map(function(root) {
    return cacheCustomerCardFromRows_(root.RootApptID, root, customers[root.RootApptID], statuses[root.RootApptID], orders[root.RootApptID], waxByRoot[root.RootApptID]);
  }).filter(function(card) {
    return cacheCustomerCardMatches_(card, filters || {});
  });
  return cacheBuildResponse_({
    filters: filters || {},
    count: rows.length,
    rows: rows,
  }, null);
}

function cacheBuildCalendarMonth_(monthKey) {
  var key = monthKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  var events = (repoReadAll_('AppointmentEvents').data || []).filter(function(event) {
    var date = event.AppointmentStart || event.AppointmentDate;
    return date && Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM') === key;
  });
  var days = {};
  events.forEach(function(event) {
    var dayKey = toDateKey_(event.AppointmentStart || event.AppointmentDate);
    if (!days[dayKey]) {
      days[dayKey] = [];
    }
    days[dayKey].push(cacheAppointmentMini_(event));
  });
  Object.keys(days).forEach(function(dayKey) {
    days[dayKey].sort(function(a, b) {
      return repoComparable_(a.start) > repoComparable_(b.start) ? 1 : -1;
    });
  });
  return cacheBuildResponse_({
    monthKey: key,
    eventCount: events.length,
    days: days,
  }, null);
}

function cacheBuildAppointmentBrief_(apptId) {
  var event = Appointments.getById(apptId);
  if (!event.ok) {
    return event;
  }
  var artifacts = Artifacts.getByRoot(event.data.RootApptID);
  return cacheBuildResponse_({
    appointment: event.data,
    artifacts: artifacts.ok ? artifacts.data.filter(function(artifact) {
      return !artifact.APPT_ID || artifact.APPT_ID === apptId;
    }) : [],
    aiBrief: cacheAiBriefFromArtifacts_(artifacts.ok ? artifacts.data : []),
  }, event.version);
}

function cacheBuildAdminHealth_(filters) {
  var roots = repoReadAll_('RootAppointments').data || [];
  var statuses = repoReadAll_('ClientStatus').data || [];
  var tasks = repoReadAll_('TaskQueue').data || [];
  var cleanup = repoReadAll_('DataCleanup').data || [];
  var pipeline = {};
  statuses.forEach(function(status) {
    var stage = status.SalesStage || 'Unspecified';
    pipeline[stage] = (pipeline[stage] || 0) + 1;
  });
  var taskCounts = cacheCountBy_(tasks, 'TaskState');
  return cacheBuildResponse_({
    filters: filters || {},
    totals: {
      roots: roots.length,
      activeRoots: roots.filter(function(root) { return root.IsActive === true; }).length,
      tasks: tasks.length,
      openTasks: tasks.filter(function(task) { return cacheIsOpenTask_(task); }).length,
      cleanupCases: cleanup.length,
      openCleanupCases: cleanup.filter(function(row) { return !row.CompletedAt; }).length,
    },
    pipelineByStage: pipeline,
    taskCounts: taskCounts,
  }, null);
}

function cacheBuildFormOptions_() {
  var config = repoReadAll_('Config');
  var templates = Templates.listActive();
  var users = Users.listActive();
  var schedules = Schedules.list();
  return cacheBuildResponse_({
    config: config.ok ? config.data : [],
    templates: templates.ok ? templates.data : [],
    activeUsers: users.ok ? users.data : [],
    schedules: schedules.ok ? schedules.data : [],
  }, null);
}

function cacheBuildPaymentSummary_(rootApptId) {
  var result = cacheSafeExternal_('Ledger.summary', function() {
    return Ledger.summary(rootApptId);
  });
  if (result.ok && result.implemented !== false) {
    return result;
  }
  return cacheBuildResponse_({
    rootApptId: rootApptId,
    available: false,
    total: null,
    paidToDate: null,
    balance: null,
    reason: 'Payment ledger adapter is reserved for Phase 3.',
  }, null);
}

function cachePrewarm_() {
  return NamedLock.withLock('cachePrewarm', function() {
    var warmed = [];
    var users = Users.listActive();
    if (users.ok) {
      users.data.forEach(function(user) {
        warmed.push(TaskListCache.build({ view: 'mine', ownerEmail: user.Email }));
      });
    }
    warmed.push(CacheSlices.calendarMonth(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM')));
    warmed.push(CacheSlices.adminHealth({}));
    return {
      ok: true,
      warmed: warmed.length,
      failures: warmed.filter(function(result) { return !result.ok; }),
    };
  }, 5000);
}

function cacheNormalizeBuildResult_(sliceName, key, built, started, generation, cacheKey) {
  var response = built && built.ok !== undefined ? built : cacheBuildResponse_(built, null);
  return mergeObjects_(response, {
    slice: sliceName,
    key: key,
    source: 'domain',
    ageMs: Date.now() - started,
    buildMs: Date.now() - started,
    cacheKey: cacheKey,
    cacheGeneration: generation,
  });
}

function cacheBuildResponse_(data, version) {
  return {
    ok: true,
    data: data,
    version: version || null,
  };
}

function cacheStore_(cache, cacheKey, response, options) {
  var ttl = options.ttlSeconds || CACHE_TTL_BY_SLICE[response.slice] || CACHE_HOT_TTL_SECONDS;
  var envelope = {
    data: response.data,
    version: response.version || null,
    builtAt: Date.now(),
    buildMs: response.buildMs || 0,
  };
  try {
    cache.put(cacheKey, JSON.stringify(envelope), ttl);
    response.cacheStored = true;
    response.ttlSeconds = ttl;
  } catch (err) {
    response.cacheStored = false;
    response.cacheStoreError = err.message;
  }
}

function cacheGetGeneration_(sliceName) {
  var props = PropertiesService.getScriptProperties();
  return Number(props.getProperty(CACHE_VERSION_PREFIX + sliceName) || '1');
}

function cacheBuildKey_(sliceName, stableKey, generation) {
  return CACHE_KEY_PREFIX + generation + ':' + sliceName + ':' + sha256Hex_(stableKey).slice(0, 40);
}

function cacheNormalizeInvalidations_(invalidations) {
  if (!invalidations) {
    return [];
  }
  var raw = invalidations.invalidated || invalidations;
  if (typeof raw === 'string') {
    raw = raw.split(',');
  }
  return (raw || []).map(function(value) {
    return String(value || '').trim();
  }).filter(function(value, index, all) {
    return value && all.indexOf(value) === index;
  });
}

function cacheStableStringify_(value) {
  return JSON.stringify(cacheStableValue_(value));
}

function cacheStableValue_(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(cacheStableValue_);
  }
  if (value && typeof value === 'object') {
    var sorted = {};
    Object.keys(value).sort().forEach(function(key) {
      sorted[key] = cacheStableValue_(value[key]);
    });
    return sorted;
  }
  return value;
}

function cacheRowsByKey_(rows, keyField) {
  var byKey = {};
  (rows || []).forEach(function(row) {
    if (row[keyField]) {
      byKey[row[keyField]] = row;
    }
  });
  return byKey;
}

function cacheRowsGroupedByKey_(rows, keyField) {
  var grouped = {};
  (rows || []).forEach(function(row) {
    var key = row[keyField] || '';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(row);
  });
  return grouped;
}

function cacheLatestRowsByKey_(rows, keyField, dateField) {
  var byKey = {};
  (rows || []).forEach(function(row) {
    var key = row[keyField] || '';
    if (!key) {
      return;
    }
    if (!byKey[key] || repoComparable_(row[dateField]) > repoComparable_(byKey[key][dateField])) {
      byKey[key] = row;
    }
  });
  return byKey;
}

function cacheCustomerCardFromRows_(rootApptId, root, customer, status, order3d, wax) {
  return {
    rootApptId: rootApptId,
    identity: cacheIdentityMini_(customer),
    owners: cacheOwnersMini_(customer),
    currentAppointment: {
      apptId: root && root.CurrentAPPT_ID,
      latestApptId: root && root.LatestAPPT_ID,
      lifecycleState: root && root.RootLifecycleState,
      isActive: root && root.IsActive,
      lastActivityAt: root && root.LastActivityAt,
    },
    status: cacheStatusMini_(status),
    order3d: cacheOrder3DMini_(order3d),
    wax: cacheWaxMini_(wax),
    finance: {
      balance: null,
      available: false,
    },
    version: cacheMaxVersion_([root, customer, status, order3d, wax]),
  };
}

function cacheCustomerCardMatches_(card, filters) {
  var query = normalizeEmail_(filters.q || filters.query || filters.search || '');
  if (query) {
    var haystack = [
      card.rootApptId,
      card.identity.customerName,
      card.identity.email,
      card.identity.phone,
      card.owners.clientAdvisorEmail,
      card.owners.jocOwnerEmail,
    ].join(' ').toLowerCase();
    if (haystack.indexOf(query) === -1) {
      return false;
    }
  }
  if (filters.brand && card.identity.brand !== filters.brand) {
    return false;
  }
  if (filters.salesStage && card.status.salesStage !== filters.salesStage) {
    return false;
  }
  if (filters.advisorEmail && card.owners.clientAdvisorEmail !== filters.advisorEmail) {
    return false;
  }
  if (filters.jocEmail && card.owners.jocOwnerEmail !== filters.jocEmail) {
    return false;
  }
  if (!filters.includeClosed && card.currentAppointment.isActive === false) {
    return false;
  }
  return true;
}

function cacheIdentityMini_(customer) {
  return {
    rootApptId: customer && customer.RootApptID || '',
    customerName: customer && customer.CustomerName || '',
    firstName: customer && customer.FirstName || '',
    lastName: customer && customer.LastName || '',
    phone: customer && customer.Phone || '',
    email: customer && customer.Email || '',
    brand: customer && customer.Brand || '',
    customerFolderUrl: customer && customer.CustomerFolderUrl || '',
    leadSource: customer && customer.LeadSource || '',
  };
}

function cacheOwnersMini_(customer) {
  return {
    clientAdvisorName: customer && customer.ClientAdvisorName || '',
    clientAdvisorEmail: customer && customer.ClientAdvisorEmail || '',
    jocOwnerName: customer && customer.JOCOwnerName || '',
    jocOwnerEmail: customer && customer.JOCOwnerEmail || '',
  };
}

function cacheStatusMini_(status) {
  return {
    salesStage: status && status.SalesStage || '',
    conversionStatus: status && status.ConversionStatus || '',
    customOrderStatus: status && status.CustomOrderStatus || '',
    inProductionStatus: status && status.InProductionStatus || '',
    centerStoneStatus: status && status.CenterStoneStatus || '',
    nextSteps: status && status.NextSteps || '',
    deadline3D: status && status.Deadline3D || '',
    deadline3DMoveCount: status && status.Deadline3DMoveCount || 0,
    is3DNeeded: status && status.Is3DNeeded,
    isWaxNeeded: status && status.IsWaxNeeded,
    version: status && status.Version || null,
  };
}

function cacheOrder3DMini_(order3d) {
  return {
    soNumber: order3d && order3d.SONumber || '',
    odooUrl: order3d && order3d.OdooUrl || '',
    trackerUrl: order3d && order3d.TrackerUrl || '',
    current3DState: order3d && order3d.Current3DState || '',
    revisionCount: order3d && order3d.RevisionCount || 0,
    version: order3d && order3d.Version || null,
  };
}

function cacheWaxMini_(wax) {
  return {
    waxRequestId: wax && wax.WaxRequestID || '',
    requestStatus: wax && wax.RequestStatus || '',
    adminDeadline: wax && wax.AdminDeadline || '',
    requestUrl: wax && wax.RequestUrl || '',
    version: wax && wax.Version || null,
  };
}

function cacheAppointmentMini_(event) {
  return {
    apptId: event.APPT_ID,
    rootApptId: event.RootApptID,
    visitType: event.VisitType,
    appointmentStatus: event.AppointmentStatus,
    start: event.AppointmentStart,
    end: event.AppointmentEnd,
    date: event.AppointmentDate,
    time: event.AppointmentTime,
    customerName: event.CustomerNameRaw,
    customerEmail: event.CustomerEmailRaw,
    brand: event.Brand,
    folderUrl: event.AppointmentFolderUrl,
    version: event.Version || null,
  };
}

function cacheAiBriefFromArtifacts_(artifacts) {
  var summaries = (artifacts || []).filter(function(artifact) {
    return artifact.SummaryDocUrl || artifact.SummaryJsonFileId || artifact.WorkflowStage === ARTIFACT_STAGE.SUMMARY_READY;
  });
  if (!summaries.length) {
    return null;
  }
  var latest = summaries[summaries.length - 1];
  return {
    workflowStage: latest.WorkflowStage,
    summaryDocUrl: latest.SummaryDocUrl,
    transcriptDocUrl: latest.TranscriptDocUrl,
    summaryJsonFileId: latest.SummaryJsonFileId,
  };
}

function cacheCountBy_(rows, field) {
  var counts = {};
  (rows || []).forEach(function(row) {
    var key = row[field] || 'Unspecified';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function cacheIsOpenTask_(task) {
  return [TASK_STATE.COMPLETED, TASK_STATE.CANCELED].indexOf(task.TaskState) === -1;
}

function cacheMaxVersion_(rows) {
  var versions = (rows || []).map(function(row) {
    return Number(row && row.Version || 0);
  });
  return Math.max.apply(null, versions.concat([0])) || null;
}

function cacheSafeExternal_(name, callback) {
  try {
    var result = callback();
    return result && result.ok !== undefined ? result : cacheBuildResponse_(result, null);
  } catch (err) {
    return {
      ok: false,
      implemented: false,
      name: name,
      reason: err.message,
    };
  }
}

function cacheLogMetric_(result, sliceName, key, metadata) {
  try {
    OpsLog.append({
      FunctionName: 'CacheSlices.get',
      Tier: 'CACHE',
      Result: result,
      Message: 'cache ' + result,
      Target: sliceName,
      MetadataJson: mergeObjects_({
        key: key,
      }, metadata || {}),
    });
  } catch (err) {
    console.log(JSON.stringify({
      functionName: 'CacheSlices.get',
      result: result,
      target: sliceName,
      error: err.message,
    }));
  }
}
