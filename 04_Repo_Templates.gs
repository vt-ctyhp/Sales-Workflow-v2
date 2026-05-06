const Templates = Object.freeze({
  get: function(templateKey) {
    return repoGetByKey_('Templates', templateKey, 'TemplateKey');
  },
  getId: function(brand, docType, taxMode) {
    return templatesGetPaymentTemplateId_(brand, docType, taxMode);
  },
  listActive: function() {
    return repoFindMany_('Templates', { Active: true });
  },
});

function templatesGetPaymentTemplateId_(brand, docType, taxMode) {
  var normalizedBrand = String(brand || '').toUpperCase();
  var normalizedDocType = String(docType || '').toUpperCase();
  var normalizedTaxMode = String(taxMode || '').toUpperCase();
  var keys = [];
  if (normalizedBrand === 'VVS' && normalizedTaxMode) {
    keys.push('VVS_' + normalizedDocType + '_' + normalizedTaxMode + '_TEMPLATE_ID');
  }
  keys.push(normalizedBrand + '_' + normalizedDocType + '_TEMPLATE_ID');
  keys.push(normalizedBrand.toLowerCase() + '.' + normalizedDocType.toLowerCase() + '.templateId');

  for (var i = 0; i < keys.length; i += 1) {
    var configured = ConfigRepo.get('payments', keys[i]);
    if (configured.ok && configured.data.Value) {
      return repoReadResponse_({
        key: keys[i],
        templateId: configured.data.Value,
        source: 'config',
      }, configured.version || null, Date.now());
    }
  }

  return repoReadResponse_({
    key: keys[0] || '',
    templateId: 'tpl_' + normalizedBrand + '_' + normalizedDocType + (normalizedTaxMode ? '_' + normalizedTaxMode : ''),
    source: 'default',
  }, null, Date.now());
}
