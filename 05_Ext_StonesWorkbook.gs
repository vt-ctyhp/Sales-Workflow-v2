const Stones = Object.freeze({
  getInStock: function(filters) {
    var rows = extReadStore_('stones').filter(function(row) {
      return stonesMatchesFilters_(row, filters || {});
    });
    return extResponse_(rows, null);
  },
  getByRoot: function(rootApptId) {
    var rows = extReadStore_('stones').filter(function(row) {
      return !rootApptId || row.RootApptID === rootApptId;
    });
    return extResponse_(rows, null);
  },
  assign: function(stoneId, rootApptId, fields) {
    var existing = extReadStore_('stones').some(function(row) {
      return row.StoneID === stoneId;
    });
    if (!existing) {
      extAppendRow_('stones', stonesDefaultRow_(stoneId));
    }
    var updated = extUpdateRows_('stones', function(row) {
      return row.StoneID === stoneId;
    }, function(row) {
      return mergeObjects_(row, fields || {}, {
        StoneID: stoneId,
        RootApptID: rootApptId,
        AssignmentStatus: 'Assigned',
        UpdatedAt: extNow_(),
        Version: Number(row.Version || 0) + 1,
      });
    });
    return updated.length ? extMutationResponse_(updated[0], [CACHE_SLICE.DIAMOND_INVENTORY, CACHE_SLICE.DIAMOND_TRACKING, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]) : extNotFound_();
  },
  markOrdered: function(stoneIds, fields) {
    return stonesBulkUpdate_(stoneIds, fields || {}, {
      StoneStatus: 'Ordered',
      OrderedAt: extNow_(),
    });
  },
  markReturnInProgress: function(stoneIds) {
    return stonesBulkUpdate_(stoneIds, {}, {
      ReturnStatus: 'Return In Progress',
      ReturnStartedAt: extNow_(),
    });
  },
  markDelivered: function(stoneIds) {
    return stonesBulkUpdate_(stoneIds, {}, {
      StoneStatus: 'Delivered',
      DeliveredAt: extNow_(),
    });
  },
  recordDecisions: function(rootApptId, decisions) {
    var byStone = {};
    (decisions || []).forEach(function(decision) {
      byStone[decision.StoneID || decision.stoneId] = decision;
    });
    var updated = extUpdateRows_('stones', function(row) {
      return row.RootApptID === rootApptId && byStone[row.StoneID];
    }, function(row) {
      return mergeObjects_(row, {
        Decision: byStone[row.StoneID].Decision || byStone[row.StoneID].decision || '',
        DecisionNotes: byStone[row.StoneID].Notes || byStone[row.StoneID].notes || '',
        DecisionRecordedAt: extNow_(),
        Version: Number(row.Version || 0) + 1,
      });
    });
    return extMutationResponse_({
      rootApptId: rootApptId,
      updated: updated,
    }, [CACHE_SLICE.DIAMOND_TRACKING, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
  },
  previewLoupe360Sync: function(fileId) {
    return extResponse_({
      fileId: fileId,
      changes: [],
      message: 'Loupe360 sync preview adapter is ready; no file parser is configured yet.',
    }, null);
  },
  applyLoupe360Sync: function(fileId, plan) {
    return extMutationResponse_({
      fileId: fileId,
      applied: plan && plan.changes ? plan.changes.length : 0,
    }, [CACHE_SLICE.DIAMOND_INVENTORY, CACHE_SLICE.DIAMOND_TRACKING]);
  },
});

function stonesDefaultRow_(stoneId) {
  return {
    StoneID: stoneId,
    Version: 1,
    StoneStatus: 'In Stock',
    AssignmentStatus: 'Unassigned',
    UpdatedAt: extNow_(),
  };
}

function stonesBulkUpdate_(stoneIds, fields, fixedFields) {
  var ids = extToArray_(stoneIds);
  ids.forEach(function(stoneId) {
    if (!extReadStore_('stones').some(function(row) { return row.StoneID === stoneId; })) {
      extAppendRow_('stones', stonesDefaultRow_(stoneId));
    }
  });
  var updated = extUpdateRows_('stones', function(row) {
    return ids.indexOf(row.StoneID) !== -1;
  }, function(row) {
    return mergeObjects_(row, fields || {}, fixedFields || {}, {
      UpdatedAt: extNow_(),
      Version: Number(row.Version || 0) + 1,
    });
  });
  return extMutationResponse_({
    stoneIds: ids,
    updated: updated,
  }, [CACHE_SLICE.DIAMOND_INVENTORY, CACHE_SLICE.DIAMOND_TRACKING, CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
}

function stonesMatchesFilters_(row, filters) {
  if (filters.inStockOnly !== false && row.StoneStatus && row.StoneStatus !== 'In Stock') {
    return false;
  }
  if (filters.shape && row.Shape !== filters.shape) {
    return false;
  }
  if (filters.color && row.Color !== filters.color) {
    return false;
  }
  if (filters.clarity && row.Clarity !== filters.clarity) {
    return false;
  }
  if (filters.caratMin && Number(row.Carat || 0) < Number(filters.caratMin)) {
    return false;
  }
  if (filters.caratMax && Number(row.Carat || 0) > Number(filters.caratMax)) {
    return false;
  }
  return true;
}
