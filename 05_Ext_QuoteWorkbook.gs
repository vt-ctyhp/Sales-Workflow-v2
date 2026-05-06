const Quote = Object.freeze({
  getSavedLines: function(rootApptId) {
    var rows = extReadStore_('quotes').filter(function(row) {
      return row.RootApptID === rootApptId;
    });
    return extResponse_(rows, null);
  },
  refreshFromTracking: function(rootApptId) {
    var tracker = Tracker.getEntries(rootApptId);
    var row = {
      QuoteLineID: extGeneratedId_('quote'),
      RootApptID: rootApptId,
      Source: 'tracking',
      RefreshedAt: extNow_(),
      SourceCount: tracker.ok ? tracker.data.length : 0,
      Version: 1,
    };
    extAppendRow_('quotes', row);
    return extMutationResponse_(row, [CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
  },
  refreshFrom3D: function(rootApptId) {
    var order = Order3D.get(rootApptId);
    var row = {
      QuoteLineID: extGeneratedId_('quote'),
      RootApptID: rootApptId,
      Source: '3d',
      SONumber: order.ok ? order.data.SONumber : '',
      RefreshedAt: extNow_(),
      Version: 1,
    };
    extAppendRow_('quotes', row);
    return extMutationResponse_(row, [CACHE_SLICE.CUSTOMER_ROOT_DETAIL]);
  },
});
