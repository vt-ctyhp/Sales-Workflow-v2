const Stones = Object.freeze({
  get: function(certNo) {
    return repoGetByKey_('Stones', stonesCertNo_(certNo), 'CertNo');
  },
  getByCert: function(certNo) {
    return Stones.get(certNo);
  },
  list: function(filters) {
    var started = Date.now();
    var rows = (repoReadAll_('Stones').data || []).filter(function(row) {
      return stonesMatchesFilters_(row, filters || {});
    });
    return repoReadResponse_(rows, null, started);
  },
  getInStock: function(filters) {
    return Stones.list(mergeObjects_({ inStockOnly: true }, filters || {}));
  },
  getByRoot: function(rootApptId) {
    if (!rootApptId) {
      return Stones.list({});
    }
    return repoFindMany_('Stones', { AssignedRootApptID: rootApptId });
  },
  upsertProposed: function(rootApptId, stones, version) {
    var results = stonesToArray_(stones).map(function(stone) {
      var certNo = stonesCertNo_(stone.CertNo || stone.StoneID || stone.stoneId || stone.certNo);
      var fields = stonesNormalizeInput_(stone);
      return stonesUpsert_(certNo, mergeObjects_(fields, {
        AssignedRootApptID: rootApptId,
        OrderStatus: 'Proposing',
        StoneStatus: fields.StoneStatus || 'Out',
      }), version);
    });
    return stonesMutationResponse_({ rootApptId: rootApptId, updated: results }, results);
  },
  assignInStock: function(certNo, rootApptId, fields, version) {
    return stonesUpsert_(stonesCertNo_(certNo), mergeObjects_(stonesNormalizeInput_(fields || {}), {
      AssignedRootApptID: rootApptId,
      StoneStatus: 'In Stock',
      Holder: (fields && (fields.Holder || fields.holder)) || rootApptId || '',
    }), version);
  },
  assign: function(certNo, rootApptId, fields, version) {
    return Stones.assignInStock(certNo, rootApptId, fields || {}, version);
  },
  markOrdered: function(certNos, fields) {
    var now = new Date();
    return stonesBulkUpdate_(certNos, function(row) {
      return mergeObjects_(stonesNormalizeInput_(fields || {}), {
        OrderStatus: 'On the Way',
        StoneStatus: 'Out',
        OrderedDate: fields && (fields.OrderedDate || fields.orderedDate) || row.OrderedDate || now,
        OrderedByEmail: fields && (fields.OrderedByEmail || fields.orderedBy) || getActiveUserEmail_(),
      });
    });
  },
  updateTracking: function(certNos, fields) {
    var normalized = stonesNormalizeInput_(fields || {});
    return stonesBulkUpdate_(certNos, function() {
      return mergeObjects_(normalized, {
        TrackingETA: normalized.TrackingETA || fields && (fields.eta || fields.ETA) || '',
        TrackingStatus: normalized.TrackingStatus || fields && fields.status || '',
        LastTrackingCheckAt: new Date(),
      });
    });
  },
  markDelivered: function(certNos, fields) {
    return stonesBulkUpdate_(certNos, function(row) {
      return mergeObjects_(stonesNormalizeInput_(fields || {}), {
        OrderStatus: 'Delivered',
        StoneStatus: 'In Stock',
        MemoDate: fields && (fields.MemoDate || fields.memoDate) || row.MemoDate || new Date(),
        ReturnDueDate: stonesReturnDueDate_(row, fields || {}),
      });
    });
  },
  recordDecisions: function(rootApptId, decisions) {
    var results = [];
    stonesToArray_(decisions).forEach(function(decision) {
      var certNo = stonesCertNo_(decision.CertNo || decision.StoneID || decision.stoneId || decision.certNo);
      if (!certNo) {
        return;
      }
      var fields = stonesDecisionFields_(decision);
      results.push(stonesUpsert_(certNo, mergeObjects_(fields, {
        AssignedRootApptID: rootApptId,
      }), null));
    });
    return stonesMutationResponse_({ rootApptId: rootApptId, updated: results }, results);
  },
  markReturnInProgress: function(certNos, notes) {
    return stonesBulkUpdate_(certNos, function() {
      return {
        ReturnStatus: 'Return In Progress',
        ReturnNotes: typeof notes === 'string' ? notes : notes && (notes.ReturnNotes || notes.notes) || '',
      };
    });
  },
  previewLoupe360Sync: function(fileId, sourceRows) {
    return stonesPreviewLoupe360Sync_(fileId, sourceRows || []);
  },
  applyLoupe360Sync: function(syncIdOrFileId, plan) {
    return stonesApplyLoupe360Sync_(syncIdOrFileId, plan || null);
  },
  appendSync: function(entry) {
    return repoAppend_('StonesSync', mergeObjects_({
      SyncID: repoGeneratedId_('SyncID'),
      AppliedAt: new Date(),
      AppliedByEmail: getActiveUserEmail_(),
      SourceRows: 0,
      Matched: 0,
      Updated: 0,
      Appended: 0,
      Skipped: 0,
      ConflictsJson: [],
    }, entry || {}));
  },
});

const STONES_SYNC_PLAN_PREFIX = 'salesWorkflow.stonesSyncPlan.';

function stonesUpsert_(certNo, fields, version) {
  if (!certNo) {
    return repoNotFoundResponse_(Date.now());
  }
  var current = Stones.get(certNo);
  var payload = mergeObjects_(stonesDefaultRow_(certNo), fields || {}, {
    CertNo: certNo,
  });
  var result = current.ok ?
    repoUpdateByKey_('Stones', certNo, payload, version !== undefined ? version : null, 'CertNo') :
    repoAppend_('Stones', payload);
  if (result.ok) {
    result.invalidated = stonesInvalidations_(result.data.AssignedRootApptID);
  }
  return result;
}

function stonesBulkUpdate_(certNos, fieldsBuilder) {
  var certs = stonesToArray_(certNos).map(stonesCertNo_).filter(function(certNo, index, all) {
    return certNo && all.indexOf(certNo) === index;
  });
  var results = certs.map(function(certNo) {
    var current = Stones.get(certNo);
    if (!current.ok) {
      current = repoAppend_('Stones', stonesDefaultRow_(certNo));
    }
    if (!current.ok) {
      return current;
    }
    var fields = fieldsBuilder(current.data) || {};
    return stonesUpsert_(certNo, fields, current.version);
  });
  return stonesMutationResponse_({ certNos: certs, updated: results }, results);
}

function stonesDefaultRow_(certNo) {
  return {
    CertNo: certNo,
    StoneStatus: 'In Stock',
    OrderStatus: '',
    SourceMetadataJson: {},
  };
}

function stonesNormalizeInput_(input) {
  var source = input || {};
  var mapped = {};
  var fields = [
    'CertNo', 'Vendor', 'Lab', 'Shape', 'Carat', 'Color', 'Clarity', 'Cut', 'Polish',
    'Symmetry', 'Fluorescence', 'Measurements', 'Ratio', 'StoneStatus', 'OrderStatus',
    'Decision', 'ReturnStatus', 'ReturnDueDate', 'TrackingETA', 'TrackingStatus', 'Carrier',
    'TrackingNumber', 'TrackingUrl', 'MemoDate', 'InvoiceDate', 'OrderedByEmail',
    'OrderedDate', 'PurchasedDate', 'LastTrackingCheckAt', 'JOCHandoffAt',
    'AssignedRootApptID', 'Holder', 'CustomerName', 'ClientAdvisorEmail',
    'JOCOwnerEmail', 'ReturnNotes', 'SourceMetadataJson', 'Notes'
  ];
  fields.forEach(function(field) {
    if (source[field] !== undefined) {
      mapped[field] = source[field];
    }
  });
  if (source.stoneStatus !== undefined) mapped.StoneStatus = source.stoneStatus;
  if (source.orderStatus !== undefined) mapped.OrderStatus = source.orderStatus;
  if (source.certNo !== undefined) mapped.CertNo = source.certNo;
  if (source.stoneId !== undefined && !mapped.CertNo) mapped.CertNo = source.stoneId;
  if (source.eta !== undefined) mapped.TrackingETA = source.eta;
  if (source.trackingStatus !== undefined) mapped.TrackingStatus = source.trackingStatus;
  if (source.carrier !== undefined) mapped.Carrier = source.carrier;
  if (source.trackingNumber !== undefined) mapped.TrackingNumber = source.trackingNumber;
  if (source.url !== undefined) mapped.TrackingUrl = source.url;
  if (source.trackingUrl !== undefined) mapped.TrackingUrl = source.trackingUrl;
  if (source.notes !== undefined) mapped.Notes = source.notes;
  return mapped;
}

function stonesCertNo_(value) {
  return String(value || '').trim();
}

function stonesToArray_(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stonesMatchesFilters_(row, filters) {
  var query = filters || {};
  if (query.inStockOnly === true && row.StoneStatus !== 'In Stock') {
    return false;
  }
  if (query.rootApptId && row.AssignedRootApptID !== query.rootApptId) {
    return false;
  }
  if (query.assignedRootApptId && row.AssignedRootApptID !== query.assignedRootApptId) {
    return false;
  }
  if (query.shape && row.Shape !== query.shape) {
    return false;
  }
  if (query.color && row.Color !== query.color) {
    return false;
  }
  if (query.clarity && row.Clarity !== query.clarity) {
    return false;
  }
  if (query.caratMin && Number(row.Carat || 0) < Number(query.caratMin)) {
    return false;
  }
  if (query.caratMax && Number(row.Carat || 0) > Number(query.caratMax)) {
    return false;
  }
  if (query.activeTracking === true && !stonesIsActiveTracking_(row)) {
    return false;
  }
  if (query.returnEligible === true && !stonesIsReturnEligible_(row, query.daysAhead || 7)) {
    return false;
  }
  return true;
}

function stonesIsActiveTracking_(row) {
  return row.OrderStatus === 'On the Way' ||
    row.ReturnStatus === 'Return In Progress' ||
    stonesIsReturnEligible_(row, 7);
}

function stonesIsReturnEligible_(row, daysAhead) {
  if (row.StoneStatus !== 'In Stock' || row.OrderStatus !== 'Delivered') {
    return false;
  }
  if (String(row.Decision || '').toLowerCase().indexOf('sold') !== -1 || String(row.Decision || '').toLowerCase().indexOf('purchase') !== -1) {
    return false;
  }
  if (row.ReturnStatus === 'Return In Progress' || row.ReturnStatus === 'Returned') {
    return false;
  }
  var due = row.ReturnDueDate ? new Date(row.ReturnDueDate).getTime() : 0;
  if (!due) {
    return false;
  }
  return due <= Date.now() + Number(daysAhead || 0) * 24 * 60 * 60 * 1000;
}

function stonesReturnDueDate_(row, fields) {
  if (fields.ReturnDueDate || fields.returnDueDate) {
    return fields.ReturnDueDate || fields.returnDueDate;
  }
  var ordered = row.OrderedDate ? new Date(row.OrderedDate) : new Date();
  return new Date(ordered.getTime() + 30 * 24 * 60 * 60 * 1000);
}

function stonesDecisionFields_(decision) {
  var value = decision.Decision || decision.decision || '';
  var normalized = String(value).toLowerCase();
  var fields = {
    Decision: value,
    Notes: decision.Notes || decision.notes || '',
  };
  if (normalized.indexOf('sold') !== -1 || normalized.indexOf('purchase') !== -1 || normalized.indexOf('select') !== -1) {
    fields.OrderStatus = 'Sold';
    fields.StoneStatus = 'Sold';
    fields.PurchasedDate = decision.PurchasedDate || decision.purchasedDate || new Date();
  } else if (normalized.indexOf('return') !== -1) {
    fields.ReturnStatus = 'Return Due';
  } else if (normalized.indexOf('not approved') !== -1 || normalized.indexOf('reject') !== -1) {
    fields.OrderStatus = 'Not Approved';
  }
  return fields;
}

function stonesPreviewLoupe360Sync_(fileId, sourceRows) {
  var rows = stonesToArray_(sourceRows);
  var existingByCert = {};
  (repoReadAll_('Stones').data || []).forEach(function(row) {
    existingByCert[row.CertNo] = row;
  });
  var seen = {};
  var changes = [];
  var skipped = 0;
  var conflicts = [];
  rows.forEach(function(sourceRow, index) {
    var normalized = stonesNormalizeInput_(sourceRow);
    var certNo = stonesCertNo_(normalized.CertNo || sourceRow.StoneID || sourceRow.stoneId);
    if (!certNo) {
      skipped += 1;
      return;
    }
    if (seen[certNo]) {
      conflicts.push({ certNo: certNo, row: index + 1, reason: 'duplicate_cert' });
      skipped += 1;
      return;
    }
    seen[certNo] = true;
    normalized.CertNo = certNo;
    var existing = existingByCert[certNo];
    if (existing && stonesSyncWouldConflict_(existing, normalized)) {
      conflicts.push({ certNo: certNo, row: index + 1, reason: 'status_conflict' });
      skipped += 1;
      return;
    }
    changes.push({
      action: existing ? 'update' : 'append',
      certNo: certNo,
      fields: normalized,
    });
  });
  var syncId = repoGeneratedId_('SyncID');
  var plan = {
    syncId: syncId,
    fileId: fileId || '',
    sourceRows: rows.length,
    matched: changes.filter(function(change) { return change.action === 'update'; }).length,
    willUpdate: changes.filter(function(change) { return change.action === 'update'; }).length,
    willAppend: changes.filter(function(change) { return change.action === 'append'; }).length,
    skipped: skipped,
    conflicts: conflicts,
    changes: changes,
  };
  try {
    PropertiesService.getScriptProperties().setProperty(STONES_SYNC_PLAN_PREFIX + syncId, JSON.stringify(plan));
  } catch (err) {
    plan.storeError = err.message;
  }
  return repoReadResponse_(plan, null, Date.now());
}

function stonesApplyLoupe360Sync_(syncIdOrFileId, plan) {
  var effectivePlan = plan;
  if (!effectivePlan && syncIdOrFileId) {
    var raw = PropertiesService.getScriptProperties().getProperty(STONES_SYNC_PLAN_PREFIX + syncIdOrFileId);
    if (raw) {
      effectivePlan = JSON.parse(raw);
    }
  }
  if (!effectivePlan) {
    effectivePlan = {
      syncId: repoGeneratedId_('SyncID'),
      fileId: syncIdOrFileId || '',
      sourceRows: 0,
      matched: 0,
      changes: [],
      conflicts: [],
      skipped: 0,
    };
  }
  var results = stonesToArray_(effectivePlan.changes).map(function(change) {
    return stonesUpsert_(change.certNo || change.CertNo, change.fields || change, null);
  });
  var appended = results.filter(function(result) {
    return result.ok && result.version === 1;
  }).length;
  var sync = Stones.appendSync({
    SyncID: effectivePlan.syncId || repoGeneratedId_('SyncID'),
    FileID: effectivePlan.fileId || syncIdOrFileId || '',
    SourceRows: Number(effectivePlan.sourceRows || 0),
    Matched: Number(effectivePlan.matched || effectivePlan.willUpdate || 0),
    Updated: Math.max(results.length - appended, 0),
    Appended: appended,
    Skipped: Number(effectivePlan.skipped || 0),
    ConflictsJson: effectivePlan.conflicts || [],
    SyncNotes: effectivePlan.SyncNotes || effectivePlan.syncNotes || '',
  });
  return stonesMutationResponse_({
    sync: sync.ok ? sync.data : null,
    results: results,
  }, results.concat([sync]));
}

function stonesSyncWouldConflict_(existing, incoming) {
  var existingStatus = existing.OrderStatus || '';
  var incomingStatus = incoming.OrderStatus || '';
  if (!incomingStatus || !existingStatus || incomingStatus === existingStatus) {
    return false;
  }
  return ['Delivered', 'Sold', 'Returned'].indexOf(existingStatus) !== -1 && ['On the Way', 'Proposing'].indexOf(incomingStatus) !== -1;
}

function stonesMutationResponse_(data, results) {
  var invalidated = [];
  stonesToArray_(results).forEach(function(result) {
    invalidated = invalidated.concat(result && result.invalidated || []);
  });
  return {
    ok: stonesToArray_(results).every(function(result) { return result && result.ok; }),
    data: data,
    version: null,
    source: 'domain',
    ageMs: 0,
    invalidated: serviceUnique_(invalidated.concat(stonesInvalidations_(''))),
  };
}

function stonesInvalidations_(rootApptId) {
  return serviceUnique_([
    CACHE_SLICE.DIAMOND_INVENTORY,
    CACHE_SLICE.DIAMOND_TRACKING,
    CACHE_SLICE.DIAMOND_ROOT,
    CACHE_SLICE.CUSTOMER_ROOT_DETAIL,
    rootApptId ? CACHE_SLICE.TASK_LIST : '',
  ]);
}
