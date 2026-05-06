function phaseNotImplemented_(functionName) {
  return {
    ok: false,
    implemented: false,
    functionName: functionName,
    reason: 'Reserved for a later implementation phase.',
  };
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone_(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function mergeObjects_() {
  var output = {};
  for (var i = 0; i < arguments.length; i += 1) {
    var source = arguments[i] || {};
    Object.keys(source).forEach(function(key) {
      output[key] = source[key];
    });
  }
  return output;
}
