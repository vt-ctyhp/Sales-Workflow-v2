function nowIso_() {
  return new Date().toISOString();
}

function toDateKey_(value) {
  if (!value) {
    return '';
  }
  return Utilities.formatDate(new Date(value), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
