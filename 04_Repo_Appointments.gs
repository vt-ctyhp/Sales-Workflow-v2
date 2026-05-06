const Appointments = Object.freeze({
  getById: function(apptId) {
    return repoGetByKey_('AppointmentEvents', apptId, 'APPT_ID');
  },
  findByExternalId: function(source, externalId) {
    return repoFindOne_('AppointmentEvents', {
      BookingSource: source,
      ExternalBookingId: externalId,
    });
  },
  upsertEvent: function(event) {
    if (event && event.APPT_ID) {
      var existing = repoGetByKey_('AppointmentEvents', event.APPT_ID, 'APPT_ID');
      if (existing.ok) {
        return repoUpdateByKey_('AppointmentEvents', event.APPT_ID, event, event.Version, 'APPT_ID');
      }
    }
    return repoAppend_('AppointmentEvents', event);
  },
  recordOutcome: function(apptId, outcome) {
    return repoUpdateByKey_('AppointmentEvents', apptId, {
      Outcome: outcome,
      AppointmentStatus: outcome === APPOINTMENT_STATUS.NO_SHOW ? APPOINTMENT_STATUS.NO_SHOW : APPOINTMENT_STATUS.COMPLETED,
    }, null, 'APPT_ID');
  },
});
