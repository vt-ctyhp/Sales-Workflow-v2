const DiamondCache = Object.freeze({
  inventory: function(filters) {
    return cacheBuildDiamondInventory_(filters || {});
  },
  tracking: function(filters) {
    return cacheBuildDiamondTracking_(filters || {});
  },
  root: function(rootApptId) {
    return cacheBuildDiamondRoot_(rootApptId);
  },
});

function cacheBuildDiamondInventory_(filters) {
  var stones = Stones.getInStock(filters || {});
  if (!stones.ok) {
    return stones;
  }
  return cacheBuildResponse_({
    filters: filters || {},
    count: stones.data.length,
    rows: stones.data,
  }, null);
}

function cacheBuildDiamondTracking_(filters) {
  var stones = Stones.list(mergeObjects_({
    activeTracking: true,
  }, filters || {}));
  if (!stones.ok) {
    return stones;
  }
  return cacheBuildResponse_({
    filters: filters || {},
    count: stones.data.length,
    rows: stones.data,
  }, null);
}

function cacheBuildDiamondRoot_(rootApptId) {
  var stones = Stones.getByRoot(rootApptId);
  if (!stones.ok) {
    return stones;
  }
  return cacheBuildResponse_({
    rootApptId: rootApptId,
    count: stones.data.length,
    rows: stones.data,
  }, cacheMaxVersion_(stones.data));
}
