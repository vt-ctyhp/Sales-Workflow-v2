const RepoTests = Object.freeze({
  run: function() {
    var result = repoTestsRun_();
    repoTestsLogResult_(result);
    return result;
  },
});

function runRepoTests() {
  return RepoTests.run();
}

function repoTestsRun_() {
  var suite = repoTestSuite_(repoTestContext_());

  repoTestsExerciseConfig_(suite);
  repoTestsExerciseAppointments_(suite);
  repoTestsExerciseRootAppointments_(suite);
  repoTestsExerciseCustomerInfo_(suite);
  repoTestsExerciseClientStatus_(suite);
  repoTestsExerciseOrder3D_(suite);
  repoTestsExerciseDiamondViewing_(suite);
  repoTestsExerciseStones_(suite);
  repoTestsExerciseWax_(suite);
  repoTestsExerciseTasks_(suite);
  repoTestsExerciseArtifacts_(suite);
  repoTestsExerciseUsers_(suite);
  repoTestsExerciseSchedules_(suite);
  repoTestsExerciseTemplates_(suite);
  repoTestsExerciseDataCleanup_(suite);
  repoTestsExerciseIntakeQueue_(suite);
  repoTestsExerciseOpsLog_(suite);
  repoTestsExerciseLocks_(suite);
  repoTestsAssertRepoMethodCoverage_(suite);

  return repoTestsBuildResult_(suite);
}

function repoTestsExerciseConfig_(suite) {
  var ctx = suite.ctx;
  var section = 'Phase1Tests';
  var key = 'OptimisticConcurrency_' + ctx.suffix;
  var seed = 'seed_' + ctx.suffix;

  var seeded = repoTestCall_(suite, 'ConfigRepo.set', 'creates config row', function() {
    return ConfigRepo.set(section, key, seed, null);
  }, function(result) {
    return result.ok && result.data.Value === seed;
  });

  var read = repoTestCall_(suite, 'ConfigRepo.get', 'reads config row', function() {
    return ConfigRepo.get(section, key);
  }, function(result) {
    return result.ok && result.data.Value === seed;
  });

  var firstUpdate = repoTestCall_(suite, 'ConfigRepo.set', 'updates config row with matching version', function() {
    return ConfigRepo.set(section, key, 'first_update', read.version);
  }, function(result) {
    return result.ok && result.version === Number(read.version) + 1;
  });

  repoTestCall_(suite, 'ConfigRepo.set', 'rejects stale config update', function() {
    return ConfigRepo.set(section, key, 'stale_update', read.version);
  }, function(result) {
    return !result.ok && result.conflict === true && result.reason === 'version_conflict';
  });

  repoTestCall_(suite, 'ConfigRepo.get', 'keeps latest value after stale update', function() {
    return ConfigRepo.get(section, key);
  }, function(result) {
    return result.ok && result.data.Value === 'first_update' && result.version === firstUpdate.version;
  });

  repoTestCheck_(suite, 'config create returned invalidation list', seeded.ok && seeded.invalidated.indexOf(CACHE_SLICE.FORM_OPTIONS) !== -1, seeded);
}

function repoTestsExerciseAppointments_(suite) {
  var ctx = suite.ctx;

  var created = repoTestCall_(suite, 'Appointments.upsertEvent', 'creates appointment event', function() {
    return Appointments.upsertEvent(repoTestAppointment_(ctx));
  }, function(result) {
    return result.ok && result.data.APPT_ID === ctx.apptId && result.version === 1;
  });

  repoTestCall_(suite, 'Appointments.getById', 'gets appointment event by APPT_ID', function() {
    return Appointments.getById(ctx.apptId);
  }, function(result) {
    return result.ok && result.data.RootApptID === ctx.rootId;
  });

  repoTestCall_(suite, 'Appointments.findByExternalId', 'finds appointment event by external id', function() {
    return Appointments.findByExternalId(BOOKING_SOURCE.ACUITY, ctx.externalBookingId);
  }, function(result) {
    return result.ok && result.data.APPT_ID === ctx.apptId;
  });

  repoTestCall_(suite, 'Appointments.upsertEvent', 'updates appointment event with matching version', function() {
    return Appointments.upsertEvent(mergeObjects_(repoTestAppointment_(ctx), {
      Version: created.version,
      VisitType: 'Updated consult',
    }));
  }, function(result) {
    return result.ok && result.version === Number(created.version) + 1 && result.data.VisitType === 'Updated consult';
  });

  repoTestCall_(suite, 'Appointments.recordOutcome', 'records no-show outcome', function() {
    return Appointments.recordOutcome(ctx.apptId, APPOINTMENT_STATUS.NO_SHOW);
  }, function(result) {
    return result.ok && result.data.Outcome === APPOINTMENT_STATUS.NO_SHOW && result.data.AppointmentStatus === APPOINTMENT_STATUS.NO_SHOW;
  });
}

function repoTestsExerciseRootAppointments_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'RootAppointments.create', 'creates root appointment', function() {
    return RootAppointments.create(repoTestRootAppointment_(ctx));
  }, function(result) {
    return result.ok && result.data.RootApptID === ctx.rootId && result.version === 1;
  });

  repoTestCall_(suite, 'RootAppointments.get', 'gets root appointment', function() {
    return RootAppointments.get(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.CurrentAPPT_ID === ctx.apptId;
  });

  repoTestCall_(suite, 'RootAppointments.updateCurrentAppointment', 'updates appointment pointers', function() {
    return RootAppointments.updateCurrentAppointment(ctx.rootId, ctx.nextApptId, created.version);
  }, function(result) {
    return result.ok && result.data.CurrentAPPT_ID === ctx.nextApptId && result.data.LatestAPPT_ID === ctx.nextApptId;
  });
}

function repoTestsExerciseCustomerInfo_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'CustomerInfo.create', 'creates customer info', function() {
    return CustomerInfo.create(repoTestCustomer_(ctx));
  }, function(result) {
    return result.ok && result.data.RootApptID === ctx.rootId && result.data.EmailLower === ctx.customerEmail;
  });

  repoTestCall_(suite, 'CustomerInfo.get', 'gets customer info', function() {
    return CustomerInfo.get(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.CustomerName === 'Phase One Test';
  });

  repoTestCall_(suite, 'CustomerInfo.updateOwners', 'updates owner fields with version check', function() {
    return CustomerInfo.updateOwners(ctx.rootId, {
      ClientAdvisorName: 'Updated CA',
      ClientAdvisorEmail: 'updated.ca@example.com',
      JOCOwnerName: 'Updated JOC',
      JOCOwnerEmail: 'updated.joc@example.com',
    }, created.version);
  }, function(result) {
    return result.ok && result.data.ClientAdvisorEmail === 'updated.ca@example.com';
  });
}

function repoTestsExerciseClientStatus_(suite) {
  var ctx = suite.ctx;
  var seeded = repoTestSeed_(suite, 'ClientStatus', repoTestClientStatus_(ctx), 'seeds client status');

  repoTestCall_(suite, 'ClientStatus.get', 'gets client status', function() {
    return ClientStatus.get(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.SalesStage === SALES_STAGE.APPOINTMENT_BOOKED;
  });

  var updated = repoTestCall_(suite, 'ClientStatus.update', 'updates client status with version check', function() {
    return ClientStatus.update(ctx.rootId, {
      SalesStage: SALES_STAGE.CONSULT_COMPLETE,
      NextSteps: 'Phase 1 repo test next step',
    }, seeded.version);
  }, function(result) {
    return result.ok && result.data.SalesStage === SALES_STAGE.CONSULT_COMPLETE;
  });

  repoTestCall_(suite, 'ClientStatus.updateDeadline', 'updates 3D deadline metadata', function() {
    return ClientStatus.updateDeadline(ctx.rootId, {
      Deadline3D: ctx.deadlineDate,
      Deadline3DMoveCount: 1,
      Deadline3DMoveReason: 'Repo test',
    }, updated.version);
  }, function(result) {
    return result.ok && result.data.Deadline3DMoveCount === 1 && Boolean(result.data.Deadline3DUpdatedAt);
  });

  repoTestCall_(suite, 'ClientStatus.appendHistory', 'appends client status history', function() {
    return ClientStatus.appendHistory(repoTestClientStatusHistory_(ctx));
  }, function(result) {
    return result.ok && result.data.RootApptID === ctx.rootId && result.data.MetadataJson.repoTest === true;
  });
}

function repoTestsExerciseOrder3D_(suite) {
  var ctx = suite.ctx;
  var seeded = repoTestSeed_(suite, 'Order3D', repoTestOrder3D_(ctx), 'seeds 3D order');

  repoTestCall_(suite, 'Order3D.get', 'gets 3D order', function() {
    return Order3D.get(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.SONumber === ctx.soNumber;
  });

  repoTestCall_(suite, 'Order3D.update', 'updates 3D order with version check', function() {
    return Order3D.update(ctx.rootId, {
      Current3DState: 'Design Started',
      RevisionCount: 1,
    }, seeded.version);
  }, function(result) {
    return result.ok && result.data.RevisionCount === 1;
  });

  repoTestCall_(suite, 'Order3D.appendHistory', 'appends 3D order history', function() {
    return Order3D.appendHistory(repoTestOrder3DHistory_(ctx));
  }, function(result) {
    return result.ok && result.data.RootApptID === ctx.rootId && result.data.EventType === 'REPO_TEST';
  });
}

function repoTestsExerciseDiamondViewing_(suite) {
  var ctx = suite.ctx;
  var seeded = repoTestSeed_(suite, 'DiamondViewing', repoTestDiamondViewing_(ctx), 'seeds diamond viewing');

  repoTestCall_(suite, 'DiamondViewing.get', 'gets diamond viewing row', function() {
    return DiamondViewing.get(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.WorkflowState === 'Open';
  });

  repoTestCall_(suite, 'DiamondViewing.update', 'updates diamond viewing row with version check', function() {
    return DiamondViewing.update(ctx.rootId, {
      WorkflowState: 'Proposal Ready',
      LookingForSummary: 'Updated by repo tests',
    }, seeded.version);
  }, function(result) {
    return result.ok && result.data.WorkflowState === 'Proposal Ready';
  });
}

function repoTestsExerciseStones_(suite) {
  var ctx = suite.ctx;
  var certNo = ctx.stoneCertNo;
  var stockCertNo = ctx.stockStoneCertNo;
  var aliasCertNo = ctx.aliasStoneCertNo;

  repoTestCall_(suite, 'Stones.upsertProposed', 'upserts proposed stones by CertNo', function() {
    return Stones.upsertProposed(ctx.rootId, [{
      CertNo: certNo,
      Shape: 'Oval',
      Carat: 1.5,
      Color: 'E',
      Clarity: 'VS1',
    }]);
  }, function(result) {
    return result.ok && result.data.updated[0].data.OrderStatus === 'Proposing';
  });

  repoTestCall_(suite, 'Stones.get', 'gets stone by CertNo', function() {
    return Stones.get(certNo);
  }, function(result) {
    return result.ok && result.data.CertNo === certNo;
  });

  repoTestCall_(suite, 'Stones.getByCert', 'gets stone by CertNo alias', function() {
    return Stones.getByCert(certNo);
  }, function(result) {
    return result.ok && result.data.CertNo === certNo;
  });

  repoTestCall_(suite, 'Stones.list', 'lists stones with filters', function() {
    return Stones.list({ shape: 'Oval' });
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'CertNo', certNo);
  });

  repoTestCall_(suite, 'Stones.assignInStock', 'assigns in-stock stone to root', function() {
    return Stones.assignInStock(stockCertNo, ctx.rootId, {
      Shape: 'Radiant',
      Holder: 'Repo test hold',
    });
  }, function(result) {
    return result.ok && result.data.AssignedRootApptID === ctx.rootId && result.data.StoneStatus === 'In Stock';
  });

  repoTestCall_(suite, 'Stones.assign', 'assign alias delegates to in-stock assignment', function() {
    return Stones.assign(aliasCertNo, ctx.rootId, {
      Shape: 'Oval',
    });
  }, function(result) {
    return result.ok && result.data.CertNo === aliasCertNo && result.data.AssignedRootApptID === ctx.rootId;
  });

  repoTestCall_(suite, 'Stones.getInStock', 'lists in-stock stones', function() {
    return Stones.getInStock({ shape: 'Radiant' });
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'CertNo', stockCertNo);
  });

  repoTestCall_(suite, 'Stones.getByRoot', 'lists stones by root assignment', function() {
    return Stones.getByRoot(ctx.rootId);
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'CertNo', certNo) && repoTestHasRow_(result, 'CertNo', stockCertNo);
  });

  repoTestCall_(suite, 'Stones.markOrdered', 'marks stone ordered', function() {
    return Stones.markOrdered([certNo], {
      OrderedDate: new Date(2026, 4, 1),
      OrderedByEmail: ctx.userEmail,
    });
  }, function(result) {
    return result.ok && result.data.updated[0].data.OrderStatus === 'On the Way';
  });

  repoTestCall_(suite, 'Stones.markNotApproved', 'marks rejected proposed stone not approved', function() {
    Stones.upsertProposed(ctx.rootId, [{
      CertNo: ctx.rejectedStoneCertNo,
      Shape: 'Round',
    }]);
    return Stones.markNotApproved([ctx.rejectedStoneCertNo], {
      Notes: 'Repo test rejection',
    });
  }, function(result) {
    return result.ok && result.data.updated[0].data.OrderStatus === 'Not Approved';
  });

  repoTestCall_(suite, 'Stones.updateTracking', 'updates tracking details', function() {
    return Stones.updateTracking([certNo], {
      TrackingETA: new Date(2026, 4, 2),
      TrackingStatus: 'Arrived',
      Carrier: 'FedEx',
      TrackingNumber: 'TRACK-' + ctx.suffix,
    });
  }, function(result) {
    return result.ok && result.data.updated[0].data.TrackingStatus === 'Arrived' && Boolean(result.data.updated[0].data.LastTrackingCheckAt);
  });

  repoTestCall_(suite, 'Stones.markDelivered', 'marks stone delivered and computes return due date', function() {
    return Stones.markDelivered([certNo], {
      MemoDate: new Date(2026, 4, 3),
    });
  }, function(result) {
    return result.ok && result.data.updated[0].data.OrderStatus === 'Delivered' && result.data.updated[0].data.StoneStatus === 'In Stock' && Boolean(result.data.updated[0].data.ReturnDueDate);
  });

  repoTestCall_(suite, 'Stones.recordDecisions', 'records customer stone decisions', function() {
    return Stones.recordDecisions(ctx.rootId, [{
      CertNo: certNo,
      Decision: 'Return',
    }]);
  }, function(result) {
    return result.ok && result.data.updated[0].data.Decision === 'Return';
  });

  repoTestCall_(suite, 'Stones.markReturnInProgress', 'marks return in progress', function() {
    return Stones.markReturnInProgress([certNo], 'Repo test return');
  }, function(result) {
    return result.ok && result.data.updated[0].data.ReturnStatus === 'Return In Progress';
  });

  var preview = repoTestCall_(suite, 'Stones.previewLoupe360Sync', 'previews Loupe360 sync rows', function() {
    return Stones.previewLoupe360Sync('loupe_' + ctx.suffix, [{
      CertNo: ctx.syncStoneCertNo,
      Shape: 'Emerald',
      Carat: 2.01,
      StoneStatus: 'In Stock',
    }]);
  }, function(result) {
    return result.ok && result.data.willAppend === 1 && Boolean(result.data.syncId);
  });

  repoTestCall_(suite, 'Stones.applyLoupe360Sync', 'applies Loupe360 sync plan', function() {
    return Stones.applyLoupe360Sync(preview.data.syncId);
  }, function(result) {
    return result.ok && result.data.results.length === 1;
  });

  repoTestCall_(suite, 'Stones.appendSync', 'appends stone sync audit row', function() {
    return Stones.appendSync({
      SyncID: ctx.syncId,
      FileID: 'manual_sync_' + ctx.suffix,
      SourceRows: 1,
      Matched: 0,
      Updated: 0,
      Appended: 1,
      Skipped: 0,
      SyncNotes: 'Repo test sync audit',
    });
  }, function(result) {
    return result.ok && result.data.SyncID === ctx.syncId;
  });
}

function repoTestsExerciseWax_(suite) {
  var ctx = suite.ctx;
  var oldWax = repoTestWax_(ctx, ctx.waxRequestIdOld, new Date(2026, 0, 1));
  var newWax = repoTestWax_(ctx, ctx.waxRequestId, new Date(2026, 0, 2));

  repoTestCall_(suite, 'Wax.create', 'creates older wax request', function() {
    return Wax.create(oldWax);
  }, function(result) {
    return result.ok && result.data.WaxRequestID === ctx.waxRequestIdOld;
  });

  var created = repoTestCall_(suite, 'Wax.create', 'creates latest wax request', function() {
    return Wax.create(newWax);
  }, function(result) {
    return result.ok && result.data.WaxRequestID === ctx.waxRequestId;
  });

  repoTestCall_(suite, 'Wax.getLatestByRoot', 'returns latest wax request for root', function() {
    return Wax.getLatestByRoot(ctx.rootId);
  }, function(result) {
    return result.ok && result.data.WaxRequestID === ctx.waxRequestId;
  });

  repoTestCall_(suite, 'Wax.update', 'updates wax request with version check', function() {
    return Wax.update(ctx.waxRequestId, {
      RequestStatus: 'Complete',
      CompletedAt: new Date(),
    }, created.version);
  }, function(result) {
    return result.ok && result.data.RequestStatus === 'Complete';
  });
}

function repoTestsExerciseTasks_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'Tasks.upsert', 'creates task', function() {
    return Tasks.upsert(repoTestTask_(ctx));
  }, function(result) {
    return result.ok && result.data.TaskID === ctx.taskId && result.data.PayloadJson.repoTest === true;
  });

  repoTestCall_(suite, 'Tasks.get', 'gets task', function() {
    return Tasks.get(ctx.taskId);
  }, function(result) {
    return result.ok && result.data.TaskState === TASK_STATE.OPEN;
  });

  var updated = repoTestCall_(suite, 'Tasks.upsert', 'updates task with version check', function() {
    return Tasks.upsert(mergeObjects_(repoTestTask_(ctx), {
      Version: created.version,
      TaskState: TASK_STATE.CLAIMED,
      ClaimedByEmail: ctx.userEmail,
      ClaimedAt: new Date(),
    }));
  }, function(result) {
    return result.ok && result.data.TaskState === TASK_STATE.CLAIMED;
  });

  repoTestCall_(suite, 'Tasks.complete', 'completes task with version check', function() {
    return Tasks.complete(ctx.taskId, {
      Notes: 'Completed by repo tests',
    }, updated.version);
  }, function(result) {
    return result.ok && result.data.TaskState === TASK_STATE.COMPLETED && Boolean(result.data.CompletedAt);
  });

  repoTestCall_(suite, 'Tasks.appendLog', 'appends task log', function() {
    return Tasks.appendLog(repoTestTaskLog_(ctx));
  }, function(result) {
    return result.ok && result.data.TaskID === ctx.taskId && result.data.MetadataJson.repoTest === true;
  });
}

function repoTestsExerciseArtifacts_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'Artifacts.registerUpload', 'registers uploaded artifact', function() {
    return Artifacts.registerUpload(repoTestArtifact_(ctx));
  }, function(result) {
    return result.ok && result.data.ArtifactID === ctx.artifactId;
  });

  repoTestCall_(suite, 'Artifacts.getByRoot', 'lists artifacts by root', function() {
    return Artifacts.getByRoot(ctx.rootId);
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'ArtifactID', ctx.artifactId);
  });

  repoTestCall_(suite, 'Artifacts.markRequirement', 'marks artifact requirement placeholder', function() {
    return Artifacts.markRequirement(ctx.rootId, ctx.apptId, 'recording', {
      TaskID: ctx.taskId,
      MetadataJson: {
        repoTest: true,
      },
    });
  }, function(result) {
    return result.ok && result.data.WorkflowStage === ARTIFACT_STAGE.REQUIRED && result.data.MetadataJson.required === true;
  });

  var updated = repoTestCall_(suite, 'Artifacts.update', 'updates artifact with version check', function() {
    return Artifacts.update(ctx.artifactId, {
      TranscriptDocUrl: 'https://example.com/transcript',
    }, created.version);
  }, function(result) {
    return result.ok && result.data.TranscriptDocUrl === 'https://example.com/transcript';
  });

  var approved = repoTestCall_(suite, 'Artifacts.markApproved', 'marks artifact approved with version check', function() {
    return Artifacts.markApproved(ctx.artifactId, {
      SummaryDocUrl: 'https://example.com/summary',
    }, updated.version);
  }, function(result) {
    return result.ok && result.data.WorkflowStage === ARTIFACT_STAGE.APPROVED && Boolean(result.data.ApprovedAt);
  });

  repoTestCall_(suite, 'Artifacts.markHandoff', 'marks artifact JOC handoff with version check', function() {
    return Artifacts.markHandoff(ctx.artifactId, {}, approved.version);
  }, function(result) {
    return result.ok && result.data.WorkflowStage === ARTIFACT_STAGE.JOC_HANDOFF && Boolean(result.data.JOCHandoffAt);
  });
}

function repoTestsExerciseUsers_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'Users.upsert', 'creates user', function() {
    return Users.upsert(repoTestUser_(ctx));
  }, function(result) {
    return result.ok && result.data.Email === ctx.userEmail;
  });

  repoTestCall_(suite, 'Users.getByEmail', 'gets user by normalized email', function() {
    return Users.getByEmail(ctx.userEmail.toUpperCase());
  }, function(result) {
    return result.ok && result.data.Email === ctx.userEmail;
  });

  repoTestCall_(suite, 'Users.listActive', 'lists active users', function() {
    return Users.listActive();
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'Email', ctx.userEmail);
  });

  repoTestCall_(suite, 'Users.upsert', 'updates user with version check', function() {
    return Users.upsert(mergeObjects_(repoTestUser_(ctx), {
      Version: created.version,
      Name: 'Updated Phase One User',
    }));
  }, function(result) {
    return result.ok && result.data.Name === 'Updated Phase One User';
  });
}

function repoTestsExerciseSchedules_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'Schedules.save', 'creates roster schedule row', function() {
    return Schedules.save([repoTestSchedule_(ctx)]);
  }, function(result) {
    return result.ok && result.data.length === 1 && result.data[0].ok && result.data[0].data.ScheduleID === ctx.scheduleId;
  });

  repoTestCall_(suite, 'Schedules.list', 'lists roster schedule rows', function() {
    return Schedules.list();
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'ScheduleID', ctx.scheduleId);
  });

  repoTestCall_(suite, 'Schedules.save', 'updates roster schedule row with version check', function() {
    return Schedules.save([mergeObjects_(repoTestSchedule_(ctx), {
      Version: created.data[0].version,
      Monday: '10:00-18:00',
    })]);
  }, function(result) {
    return result.ok && result.data[0].ok && result.data[0].data.Monday === '10:00-18:00';
  });

  var changeCreated = repoTestCall_(suite, 'Schedules.upsertChange', 'creates schedule change', function() {
    return Schedules.upsertChange(repoTestScheduleChange_(ctx));
  }, function(result) {
    return result.ok && result.data.ScheduleChangeID === ctx.scheduleChangeId;
  });

  repoTestCall_(suite, 'Schedules.upsertChange', 'updates schedule change with version check', function() {
    return Schedules.upsertChange(mergeObjects_(repoTestScheduleChange_(ctx), {
      Version: changeCreated.version,
      Reason: 'Updated by repo tests',
    }));
  }, function(result) {
    return result.ok && result.data.Reason === 'Updated by repo tests';
  });
}

function repoTestsExerciseTemplates_(suite) {
  var ctx = suite.ctx;
  repoTestSeed_(suite, 'Templates', repoTestTemplate_(ctx), 'seeds active template');

  repoTestCall_(suite, 'Templates.get', 'gets template by key', function() {
    return Templates.get(ctx.templateKey);
  }, function(result) {
    return result.ok && result.data.TemplateKey === ctx.templateKey;
  });

  repoTestCall_(suite, 'Templates.listActive', 'lists active templates', function() {
    return Templates.listActive();
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'TemplateKey', ctx.templateKey);
  });
}

function repoTestsExerciseDataCleanup_(suite) {
  var ctx = suite.ctx;
  var created = repoTestCall_(suite, 'DataCleanup.upsertCase', 'creates cleanup case', function() {
    return DataCleanup.upsertCase(repoTestCleanupCase_(ctx));
  }, function(result) {
    return result.ok && result.data.CaseID === ctx.cleanupCaseId;
  });

  repoTestCall_(suite, 'DataCleanup.listOpen', 'lists open cleanup cases', function() {
    return DataCleanup.listOpen();
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'CaseID', ctx.cleanupCaseId);
  });

  repoTestCall_(suite, 'DataCleanup.upsertCase', 'updates cleanup case with version check', function() {
    return DataCleanup.upsertCase(mergeObjects_(repoTestCleanupCase_(ctx), {
      Version: created.version,
      AdminNotes: 'Updated by repo tests',
    }));
  }, function(result) {
    return result.ok && result.data.AdminNotes === 'Updated by repo tests';
  });
}

function repoTestsExerciseIntakeQueue_(suite) {
  var ctx = suite.ctx;
  var queued = repoTestCall_(suite, 'IntakeQueue.enqueue', 'enqueues normalized intake payload', function() {
    return IntakeQueue.enqueue(repoTestIntakePayload_(ctx, 'queued'));
  }, function(result) {
    return result.ok && result.data.Status === 'queued' && result.data.PayloadJson.bookingSource === BOOKING_SOURCE.TEST;
  });

  repoTestCall_(suite, 'IntakeQueue.listPending', 'lists pending intake payloads', function() {
    return IntakeQueue.listPending(10);
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'IntakeID', queued.data.IntakeID);
  });

  repoTestCall_(suite, 'IntakeQueue.markProcessed', 'marks intake payload processed', function() {
    return IntakeQueue.markProcessed(queued.data.IntakeID, {
      ok: true,
      rootApptId: ctx.rootId,
    }, queued.version);
  }, function(result) {
    return result.ok && result.data.Status === 'processed' && Boolean(result.data.ProcessedAt);
  });

  var failed = repoTestCall_(suite, null, 'enqueues intake payload for error test', function() {
    return IntakeQueue.enqueue(repoTestIntakePayload_(ctx, 'error'));
  }, function(result) {
    return result.ok;
  });

  repoTestCall_(suite, 'IntakeQueue.markError', 'marks intake payload error', function() {
    return IntakeQueue.markError(failed.data.IntakeID, new Error('repo test intake error'), failed.version);
  }, function(result) {
    return result.ok && result.data.Status === 'error' && result.data.Error === 'repo test intake error';
  });
}

function repoTestsExerciseOpsLog_(suite) {
  var ctx = suite.ctx;
  repoTestCall_(suite, 'OpsLog.append', 'appends ops log row', function() {
    return OpsLog.append({
      FunctionName: ctx.opsFunction,
      Tier: 'TEST',
      Result: 'ok',
      Message: 'repo test ops log',
      LockWaitMs: 1,
      LockHoldMs: 2,
      Target: ctx.rootId,
      MetadataJson: { repoTest: true },
    });
  }, function(result) {
    return result.ok && result.data.FunctionName === ctx.opsFunction && result.data.MetadataJson.repoTest === true;
  });

  repoTestCall_(suite, 'OpsLog.list', 'filters ops log rows', function() {
    return OpsLog.list({ FunctionName: ctx.opsFunction });
  }, function(result) {
    return result.ok && repoTestHasRow_(result, 'FunctionName', ctx.opsFunction);
  });
}

function repoTestsExerciseLocks_(suite) {
  var named = repoTestCall_(suite, null, 'NamedLock.acquire returns token', function() {
    return NamedLock.acquire('phase1_repo_tests_' + suite.ctx.suffix, 5000);
  }, function(result) {
    return result.ok && Boolean(result.token);
  });

  if (named.ok) {
    repoTestCall_(suite, null, 'NamedLock.release releases matching token', function() {
      return NamedLock.release('phase1_repo_tests_' + suite.ctx.suffix, named.token);
    }, function(result) {
      return result.ok && result.released === true;
    });
  }

  repoTestCall_(suite, null, 'DocLock.withUserWriteLock runs callback', function() {
    return DocLock.withUserWriteLock(function() {
      return { ok: true, marker: 'doc_lock_test' };
    }, {
      functionName: 'RepoTests.docLock',
      target: 'Phase1Tests',
    });
  }, function(result) {
    return result.ok && result.marker === 'doc_lock_test';
  });
}

function repoTestsAssertRepoMethodCoverage_(suite) {
  var publicMethods = repoTestPublicRepoMethods_();
  var missing = publicMethods.filter(function(method) {
    return !suite.covered[method];
  });
  var unexpected = Object.keys(suite.covered).filter(function(method) {
    return publicMethods.indexOf(method) === -1;
  });
  repoTestCheck_(suite, 'public repo method coverage is complete', missing.length === 0 && unexpected.length === 0, {
    expectedCount: publicMethods.length,
    coveredCount: Object.keys(suite.covered).length,
    missing: missing,
    unexpected: unexpected,
  });
}

function repoTestSuite_(ctx) {
  return {
    ctx: ctx,
    covered: {},
    results: [],
  };
}

function repoTestContext_() {
  var suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var userEmail = 'phase1+' + suffix + '@example.com';
  return {
    suffix: suffix,
    rootId: 'root_phase1_' + suffix,
    apptId: 'appt_phase1_' + suffix,
    nextApptId: 'appt_phase1_next_' + suffix,
    externalBookingId: 'external_phase1_' + suffix,
    customerEmail: 'customer+' + suffix + '@example.com',
    userEmail: userEmail,
    soNumber: 'SO-' + suffix,
    waxRequestId: 'wax_phase1_' + suffix,
    waxRequestIdOld: 'wax_phase1_old_' + suffix,
    taskId: 'task_phase1_' + suffix,
    artifactId: 'artifact_phase1_' + suffix,
    scheduleId: 'schedule_phase1_' + suffix,
    scheduleChangeId: 'schedule_change_phase1_' + suffix,
    templateKey: 'template_phase1_' + suffix,
    cleanupCaseId: 'cleanup_phase1_' + suffix,
    stoneCertNo: 'cert_phase1_' + suffix,
    stockStoneCertNo: 'cert_stock_phase1_' + suffix,
    aliasStoneCertNo: 'cert_alias_phase1_' + suffix,
    rejectedStoneCertNo: 'cert_rejected_phase1_' + suffix,
    syncStoneCertNo: 'cert_sync_phase1_' + suffix,
    syncId: 'sync_phase1_' + suffix,
    opsFunction: 'RepoTests.ops.' + suffix,
    deadlineDate: new Date(2026, 4, 30),
    weekStart: new Date(2026, 4, 4),
    changeDate: new Date(2026, 4, 5),
  };
}

function repoTestCall_(suite, methodName, name, callback, assertion) {
  var detail;
  var ok = false;
  try {
    detail = callback();
    ok = assertion ? Boolean(assertion(detail)) : Boolean(detail && detail.ok);
  } catch (err) {
    detail = {
      error: err.message,
      stack: err.stack || '',
    };
  }
  if (methodName) {
    suite.covered[methodName] = true;
  }
  repoTestCheck_(suite, name, ok, detail, methodName);
  return detail;
}

function repoTestCheck_(suite, name, condition, detail, methodName) {
  suite.results.push(repoTestAssert_(name, condition, detail, methodName));
}

function repoTestSeed_(suite, tabKey, row, name) {
  return repoTestCall_(suite, null, name, function() {
    return repoAppend_(tabKey, row);
  }, function(result) {
    return result.ok;
  });
}

function repoTestAssert_(name, condition, detail, methodName) {
  return {
    ok: Boolean(condition),
    name: name,
    method: methodName || '',
    detail: detail,
  };
}

function repoTestsBuildResult_(suite) {
  var failures = suite.results.filter(function(result) {
    return !result.ok;
  });
  return {
    ok: failures.length === 0,
    testCount: suite.results.length,
    repoMethodCoverage: repoTestsCoverageSummary_(suite),
    failures: failures,
    results: suite.results,
  };
}

function repoTestsCoverageSummary_(suite) {
  var publicMethods = repoTestPublicRepoMethods_();
  var covered = Object.keys(suite.covered).sort();
  var missing = publicMethods.filter(function(method) {
    return !suite.covered[method];
  });
  return {
    ok: missing.length === 0,
    expectedCount: publicMethods.length,
    coveredCount: covered.length,
    missing: missing,
  };
}

function repoTestPublicRepoMethods_() {
  var repos = {
    Appointments: Appointments,
    Artifacts: Artifacts,
    ClientStatus: ClientStatus,
    ConfigRepo: ConfigRepo,
    CustomerInfo: CustomerInfo,
    DataCleanup: DataCleanup,
    DiamondViewing: DiamondViewing,
    IntakeQueue: IntakeQueue,
    OpsLog: OpsLog,
    Order3D: Order3D,
    RootAppointments: RootAppointments,
    Schedules: Schedules,
    Stones: Stones,
    Tasks: Tasks,
    Templates: Templates,
    Users: Users,
    Wax: Wax,
  };
  var methods = [];
  Object.keys(repos).forEach(function(repoName) {
    Object.keys(repos[repoName]).forEach(function(methodName) {
      if (typeof repos[repoName][methodName] === 'function') {
        methods.push(repoName + '.' + methodName);
      }
    });
  });
  return methods.sort();
}

function repoTestHasRow_(response, field, expectedValue) {
  return response.ok && response.data.some(function(row) {
    return repoComparable_(row[field]) === repoComparable_(expectedValue);
  });
}

function repoTestAppointment_(ctx) {
  var start = new Date(2026, 4, 6, 10, 0, 0);
  var end = new Date(2026, 4, 6, 11, 0, 0);
  return {
    APPT_ID: ctx.apptId,
    RootApptID: ctx.rootId,
    BookingSource: BOOKING_SOURCE.ACUITY,
    ExternalBookingId: ctx.externalBookingId,
    ExternalBookingUrl: 'https://example.com/appointments/' + ctx.externalBookingId,
    SourcePayloadHash: 'hash_' + ctx.suffix,
    SourceMetadataJson: { repoTest: true },
    VisitType: 'Initial consult',
    Brand: 'Phase1',
    AppointmentStatus: APPOINTMENT_STATUS.ACTIVE,
    AppointmentStart: start,
    AppointmentEnd: end,
    AppointmentDate: start,
    AppointmentTime: start,
    TimeZone: 'America/Los_Angeles',
    BookedAt: new Date(),
    CustomerNameRaw: 'Phase One Test',
    CustomerEmailRaw: ctx.customerEmail,
    CustomerPhoneRaw: '(555) 010-0000',
    EmailLower: ctx.customerEmail,
    PhoneNorm: '5550100000',
    Notes: 'Repo test appointment',
  };
}

function repoTestRootAppointment_(ctx) {
  return {
    RootApptID: ctx.rootId,
    CurrentAPPT_ID: ctx.apptId,
    LatestAPPT_ID: ctx.apptId,
    RootLifecycleState: ROOT_LIFECYCLE_STATE.ACTIVE,
    RootVersion: 1,
    FirstBookedAt: new Date(),
    LastActivityAt: new Date(),
    IsActive: true,
    Notes: 'Repo test root',
  };
}

function repoTestCustomer_(ctx) {
  return {
    RootApptID: ctx.rootId,
    CustomerName: 'Phase One Test',
    FirstName: 'Phase',
    LastName: 'Test',
    Phone: '(555) 010-0000',
    PhoneNorm: '5550100000',
    Email: ctx.customerEmail,
    EmailLower: ctx.customerEmail,
    Brand: 'Phase1',
    ClientAdvisorName: 'Test CA',
    ClientAdvisorEmail: 'ca@example.com',
    JOCOwnerName: 'Test JOC',
    JOCOwnerEmail: 'joc@example.com',
    LeadSource: 'RepoTests',
    LeadIdentity: ctx.externalBookingId,
    PreferredContactMethod: 'email',
    Notes: 'Repo test customer',
  };
}

function repoTestClientStatus_(ctx) {
  return {
    RootApptID: ctx.rootId,
    SalesStage: SALES_STAGE.APPOINTMENT_BOOKED,
    ConversionStatus: 'Open',
    NextSteps: 'Initial repo test next step',
    Deadline3DMoveCount: 0,
    Is3DNeeded: true,
    IsWaxNeeded: false,
    Notes: 'Repo test client status',
  };
}

function repoTestClientStatusHistory_(ctx) {
  return {
    HistoryID: 'history_status_' + ctx.suffix,
    RootApptID: ctx.rootId,
    Source: 'RepoTests',
    FieldName: 'SalesStage',
    OldValue: SALES_STAGE.APPOINTMENT_BOOKED,
    NewValue: SALES_STAGE.CONSULT_COMPLETE,
    ChangeReason: 'Repo test',
    MetadataJson: { repoTest: true },
  };
}

function repoTestOrder3D_(ctx) {
  return {
    RootApptID: ctx.rootId,
    SONumber: ctx.soNumber,
    OdooUrl: 'https://example.com/odoo/' + ctx.soNumber,
    DesignRequest: 'Repo test design request',
    TrackerUrl: 'https://example.com/tracker/' + ctx.soNumber,
    Current3DState: 'Requested',
    RevisionCount: 0,
    Notes: 'Repo test 3D order',
  };
}

function repoTestOrder3DHistory_(ctx) {
  return {
    HistoryID: 'history_3d_' + ctx.suffix,
    RootApptID: ctx.rootId,
    Source: 'RepoTests',
    EventType: 'REPO_TEST',
    SONumber: ctx.soNumber,
    OldValue: 'Requested',
    NewValue: 'Design Started',
    RevisionRequest: 'Repo test revision',
    MetadataJson: { repoTest: true },
  };
}

function repoTestDiamondViewing_(ctx) {
  return {
    RootApptID: ctx.rootId,
    WorkflowState: 'Open',
    StoneType: 'Lab',
    ShapePreference: 'Oval',
    CaratMin: 1,
    CaratMax: 2,
    ColorRange: 'D-F',
    ClarityRange: 'VS1-VS2',
    VarietyStrategy: 'Balanced',
    LookingForSummary: 'Repo test diamond viewing',
  };
}

function repoTestWax_(ctx, waxRequestId, updatedAt) {
  return {
    WaxRequestID: waxRequestId,
    RootApptID: ctx.rootId,
    UpdatedAt: updatedAt,
    RequestStatus: 'Requested',
    AdminDeadline: ctx.deadlineDate,
    RequestUrl: 'https://example.com/wax/' + waxRequestId,
    RequestedAt: updatedAt,
    Notes: 'Repo test wax',
  };
}

function repoTestTask_(ctx) {
  return {
    TaskID: ctx.taskId,
    RootApptID: ctx.rootId,
    APPT_ID: ctx.apptId,
    TaskType: TASK_TYPE.SEND_WELCOME,
    TaskState: TASK_STATE.OPEN,
    OwnerRole: ROLE.CLIENT_ADVISOR,
    OwnerEmail: ctx.userEmail,
    OwnerName: 'Phase One User',
    DueAt: new Date(),
    TemplateKey: ctx.templateKey,
    PayloadJson: { repoTest: true },
    InvalidatesJson: [CACHE_SLICE.TASK_LIST],
  };
}

function repoTestTaskLog_(ctx) {
  return {
    TaskLogID: 'tasklog_phase1_' + ctx.suffix,
    TaskID: ctx.taskId,
    RootApptID: ctx.rootId,
    EventType: 'REPO_TEST',
    OldState: TASK_STATE.OPEN,
    NewState: TASK_STATE.COMPLETED,
    Notes: 'Repo test task log',
    MetadataJson: { repoTest: true },
  };
}

function repoTestArtifact_(ctx) {
  return {
    ArtifactID: ctx.artifactId,
    RootApptID: ctx.rootId,
    APPT_ID: ctx.apptId,
    TaskID: ctx.taskId,
    ArtifactType: 'recording',
    WorkflowStage: ARTIFACT_STAGE.UPLOADED,
    DriveFileId: 'drive_file_' + ctx.suffix,
    DriveFileUrl: 'https://example.com/drive-file/' + ctx.suffix,
    Attempts: 0,
    MetadataJson: { repoTest: true },
  };
}

function repoTestUser_(ctx) {
  return {
    Email: ctx.userEmail,
    Name: 'Phase One User',
    RolesCsv: ROLE.CLIENT_ADVISOR,
    Active: true,
    PasswordSalt: 'salt_' + ctx.suffix,
    PasswordHash: 'hash_' + ctx.suffix,
    Notes: 'Repo test user',
  };
}

function repoTestSchedule_(ctx) {
  return {
    ScheduleID: ctx.scheduleId,
    Email: ctx.userEmail,
    WeekStart: ctx.weekStart,
    Role: ROLE.CLIENT_ADVISOR,
    Monday: '09:00-17:00',
    Tuesday: '09:00-17:00',
    Wednesday: '09:00-17:00',
    Thursday: '09:00-17:00',
    Friday: '09:00-17:00',
    Active: true,
    Notes: 'Repo test schedule',
  };
}

function repoTestScheduleChange_(ctx) {
  return {
    ScheduleChangeID: ctx.scheduleChangeId,
    Email: ctx.userEmail,
    ChangeDate: ctx.changeDate,
    AvailabilityState: 'Unavailable',
    StartTime: new Date(2026, 4, 5, 12, 0, 0),
    EndTime: new Date(2026, 4, 5, 15, 0, 0),
    Reason: 'Repo test',
    Notes: 'Repo test schedule change',
  };
}

function repoTestTemplate_(ctx) {
  return {
    TemplateKey: ctx.templateKey,
    TaskType: TASK_TYPE.SEND_WELCOME,
    Channel: 'email',
    Subject: 'Repo test template',
    Body: 'Hello {{CustomerName}}',
    Active: true,
    Notes: 'Repo test template',
  };
}

function repoTestCleanupCase_(ctx) {
  return {
    CaseID: ctx.cleanupCaseId,
    RootApptID: ctx.rootId,
    AssignedToEmail: ctx.userEmail,
    CaseState: 'Open',
    IssueType: 'RepoTest',
    ProposedChangesJson: { repoTest: true },
    AdminNotes: 'Repo test cleanup case',
  };
}

function repoTestIntakePayload_(ctx, name) {
  return {
    bookingSource: BOOKING_SOURCE.TEST,
    externalBookingId: 'intake_repo_' + name + '_' + ctx.suffix,
    action: 'create',
    customerName: 'Repo Intake Test',
    firstName: 'Repo',
    lastName: 'Intake',
    email: ctx.customerEmail,
    phone: '(555) 010-0000',
    brand: 'Phase1',
    visitDateTime: '2026-05-06T10:00:00-07:00',
    visitType: 'Initial consult',
    duration: 60,
    location: 'Showroom',
    source: 'RepoTests',
    receivedAt: '2026-05-05T22:00:00-07:00',
    rawPayload: { repoTest: true, name: name },
  };
}

function repoTestsLogResult_(result) {
  var failures = result.failures.map(function(failure) {
    return {
      name: failure.name,
      method: failure.method,
      detail: failure.detail,
    };
  });
  console.log(JSON.stringify({
    ok: result.ok,
    testCount: result.testCount,
    failureCount: failures.length,
    repoMethodCoverage: result.repoMethodCoverage,
    failures: failures,
  }));
}
