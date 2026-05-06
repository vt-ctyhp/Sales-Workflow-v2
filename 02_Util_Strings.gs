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
