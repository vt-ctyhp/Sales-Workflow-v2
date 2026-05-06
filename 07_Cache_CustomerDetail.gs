const CustomerDetailCache = Object.freeze({
  build: function(rootApptId, mode) {
    var normalizedMode = cacheNormalizeCustomerDetailMode_(mode);
    return CacheSlices.get(CACHE_SLICE.CUSTOMER_ROOT_DETAIL, {
      rootApptId: rootApptId,
      mode: normalizedMode,
    }, function() {
      return customerDetailBuild_(rootApptId, normalizedMode);
    });
  },
});

function customerDetailBuild_(rootApptId, mode) {
  var bundle = customerDetailReadBundle_(rootApptId);
  if (!bundle.root.ok && !bundle.customer.ok) {
    return {
      ok: false,
      reason: 'not_found',
      source: 'domain',
      ageMs: 0,
    };
  }
  var full = customerDetailFullPayload_(rootApptId, mode, bundle);
  if (mode === 'taskMini') {
    return cacheBuildResponse_(customerDetailPick_(full, [
      'identity',
      'owners',
      'currentAppointment',
      'status',
      'order3d',
      'diamondViewing',
    ]), full.version);
  }
  if (mode === 'card') {
    return cacheBuildResponse_(customerDetailPick_(full, [
      'identity',
      'owners',
      'currentAppointment',
      'status',
      'order3d',
      'wax',
      'finance',
    ]), full.version);
  }
  if (mode === 'standard') {
    return cacheBuildResponse_(customerDetailPick_(full, [
      'identity',
      'owners',
      'currentAppointment',
      'status',
      'order3d',
      'wax',
      'finance',
      'appointmentLinks',
      'aiBrief',
    ]), full.version);
  }
  return cacheBuildResponse_(full, full.version);
}

function customerDetailReadBundle_(rootApptId) {
  var root = RootAppointments.get(rootApptId);
  var customer = CustomerInfo.get(rootApptId);
  var currentApptId = root.ok ? root.data.CurrentAPPT_ID : '';
  var appointment = currentApptId ? Appointments.getById(currentApptId) : { ok: false, reason: 'not_found' };
  var status = ClientStatus.get(rootApptId);
  var statusHistory = repoFindMany_('ClientStatusHistory', { RootApptID: rootApptId });
  var order3d = Order3D.get(rootApptId);
  var order3dHistory = repoFindMany_('Order3DHistory', { RootApptID: rootApptId });
  var diamondViewing = DiamondViewing.get(rootApptId);
  var wax = Wax.getLatestByRoot(rootApptId);
  var artifacts = Artifacts.getByRoot(rootApptId);
  var tasks = repoFindMany_('TaskQueue', { RootApptID: rootApptId });
  var taskLogs = repoFindMany_('TaskLog', { RootApptID: rootApptId });
  var finance = CacheSlices.paymentSummary(rootApptId);
  return {
    root: root,
    customer: customer,
    appointment: appointment,
    status: status,
    statusHistory: statusHistory,
    order3d: order3d,
    order3dHistory: order3dHistory,
    diamondViewing: diamondViewing,
    wax: wax,
    artifacts: artifacts,
    tasks: tasks,
    taskLogs: taskLogs,
    finance: finance,
  };
}

function customerDetailFullPayload_(rootApptId, mode, bundle) {
  var customer = bundle.customer.ok ? bundle.customer.data : null;
  var root = bundle.root.ok ? bundle.root.data : null;
  var appointment = bundle.appointment.ok ? bundle.appointment.data : null;
  var status = bundle.status.ok ? bundle.status.data : null;
  var order3d = bundle.order3d.ok ? bundle.order3d.data : null;
  var wax = bundle.wax.ok ? bundle.wax.data : null;
  var artifacts = bundle.artifacts.ok ? bundle.artifacts.data : [];
  var tasks = bundle.tasks.ok ? bundle.tasks.data : [];
  var statusHistory = bundle.statusHistory.ok ? bundle.statusHistory.data : [];
  var order3dHistory = bundle.order3dHistory.ok ? bundle.order3dHistory.data : [];
  var taskLogs = bundle.taskLogs.ok ? bundle.taskLogs.data : [];

  return {
    rootApptId: rootApptId,
    mode: mode,
    version: cacheMaxVersion_([
      root,
      customer,
      appointment,
      status,
      order3d,
      bundle.diamondViewing.ok ? bundle.diamondViewing.data : null,
      wax,
    ]),
    sections: {
      identity: cacheIdentityMini_(customer),
      owners: cacheOwnersMini_(customer),
      currentAppointment: customerDetailAppointmentSection_(root, appointment),
      status: cacheStatusMini_(status),
      statusHistory: statusHistory,
      order3d: order3d || null,
      order3dHistory: order3dHistory,
      diamondViewing: bundle.diamondViewing.ok ? bundle.diamondViewing.data : null,
      wax: wax ? cacheWaxMini_(wax) : null,
      finance: bundle.finance && bundle.finance.ok ? bundle.finance.data : null,
      artifacts: artifacts,
      tasks: tasks,
      recentActivity: customerDetailRecentActivity_(statusHistory, order3dHistory, taskLogs),
      appointmentLinks: customerDetailAppointmentLinks_(appointment, artifacts),
      aiBrief: cacheAiBriefFromArtifacts_(artifacts),
      formOptions: CacheSlices.formOptions().data,
    },
  };
}

function customerDetailPick_(full, sectionNames) {
  var picked = {
    rootApptId: full.rootApptId,
    mode: full.mode,
    version: full.version,
    sections: {},
  };
  sectionNames.forEach(function(sectionName) {
    picked.sections[sectionName] = full.sections[sectionName];
  });
  return picked;
}

function customerDetailAppointmentSection_(root, appointment) {
  return {
    root: root ? {
      rootApptId: root.RootApptID,
      currentApptId: root.CurrentAPPT_ID,
      latestApptId: root.LatestAPPT_ID,
      lifecycleState: root.RootLifecycleState,
      isActive: root.IsActive,
      firstBookedAt: root.FirstBookedAt,
      lastActivityAt: root.LastActivityAt,
      version: root.Version || null,
    } : null,
    appointment: appointment ? cacheAppointmentMini_(appointment) : null,
  };
}

function customerDetailAppointmentLinks_(appointment, artifacts) {
  return {
    appointmentFolderUrl: appointment && appointment.AppointmentFolderUrl || '',
    recordingUrls: (artifacts || []).filter(function(artifact) {
      return artifact.ArtifactType === 'recording' && artifact.DriveFileUrl;
    }).map(function(artifact) {
      return artifact.DriveFileUrl;
    }),
    transcriptUrls: (artifacts || []).filter(function(artifact) {
      return artifact.TranscriptDocUrl;
    }).map(function(artifact) {
      return artifact.TranscriptDocUrl;
    }),
    summaryUrls: (artifacts || []).filter(function(artifact) {
      return artifact.SummaryDocUrl;
    }).map(function(artifact) {
      return artifact.SummaryDocUrl;
    }),
  };
}

function customerDetailRecentActivity_(statusHistory, order3dHistory, taskLogs) {
  var rows = [];
  (statusHistory || []).forEach(function(row) {
    rows.push({
      type: 'status',
      at: row.ChangedAt,
      label: row.FieldName,
      detail: row.NewValue,
      actorEmail: row.ActorEmail,
    });
  });
  (order3dHistory || []).forEach(function(row) {
    rows.push({
      type: 'order3d',
      at: row.ChangedAt,
      label: row.EventType,
      detail: row.NewValue || row.RevisionRequest,
      actorEmail: row.ActorEmail,
    });
  });
  (taskLogs || []).forEach(function(row) {
    rows.push({
      type: 'task',
      at: row.EventAt,
      label: row.EventType,
      detail: row.NewState,
      actorEmail: row.ActorEmail,
    });
  });
  rows.sort(function(a, b) {
    return repoComparable_(b.at) > repoComparable_(a.at) ? 1 : -1;
  });
  return rows.slice(0, 30);
}

function cacheNormalizeCustomerDetailMode_(mode) {
  var value = mode || 'full';
  return ['card', 'standard', 'full', 'taskMini'].indexOf(value) === -1 ? 'full' : value;
}
