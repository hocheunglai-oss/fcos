function normalizedText(value) {
  return String(value ?? '').trim();
}

export function isPaymentReminderSentEvent(event = {}) {
  const eventType = normalizedText(event.eventType ?? event.event_type).toLowerCase();
  if (eventType === 'reminder_sent') return true;
  return /^Payment reminder (?:sent|accepted by Microsoft Graph)\b/i.test(normalizedText(event.note));
}

export function latestPaymentReminderSentEvent(row = {}) {
  const events = Array.isArray(row.collectionEvents) ? row.collectionEvents : [];
  return events
    .filter(isPaymentReminderSentEvent)
    .filter((event) => event.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export function latestPaymentReminderSentAt(row = {}) {
  return latestPaymentReminderSentEvent(row)?.createdAt || null;
}
