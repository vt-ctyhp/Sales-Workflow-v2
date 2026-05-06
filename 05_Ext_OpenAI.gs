const OpenAIExt = Object.freeze({
  summarizeTranscript: function(transcript, customerContext) {
    var text = typeof transcript === 'string' ? transcript : transcript && transcript.Text || '';
    var customerName = customerContext && customerContext.customerName || customerContext && customerContext.CustomerName || 'customer';
    return extResponse_({
      SalesBrief: 'Summary for ' + customerName + ': ' + text.slice(0, 240),
      ClientFollowUpDraft: 'Thank you for meeting with us. We will follow up with next steps shortly.',
      ReviewFlags: [],
      Model: 'property-backed-summary',
      CreatedAt: extNow_(),
    }, null);
  },
});
