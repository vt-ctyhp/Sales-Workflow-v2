const Templates = Object.freeze({
  get: function(templateKey) {
    return repoGetByKey_('Templates', templateKey, 'TemplateKey');
  },
  listActive: function() {
    return repoFindMany_('Templates', { Active: true });
  },
});
