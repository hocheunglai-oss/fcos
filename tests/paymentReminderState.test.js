import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPaymentReminderSentEvent,
  latestPaymentReminderSentAt,
} from '../src/lib/paymentReminderState.js';

test('confirmed reminder event type remains authoritative when Graph note wording changes', () => {
  assert.equal(isPaymentReminderSentEvent({
    eventType: 'reminder_sent',
    note: 'Payment reminder accepted by Microsoft Graph.\nRecipients: 2',
  }), true);
  assert.equal(isPaymentReminderSentEvent({
    event_type: 'reminder_sent',
    note: 'Provider wording may change without changing the durable event.',
  }), true);
});

test('legacy reminder notes remain recognized without accepting unrelated collection notes', () => {
  assert.equal(isPaymentReminderSentEvent({ note: 'Payment reminder sent.' }), true);
  assert.equal(isPaymentReminderSentEvent({ note: 'Payment reminder accepted by Microsoft Graph.' }), true);
  assert.equal(isPaymentReminderSentEvent({ eventType: 'note', note: 'Buyer asked for another reminder.' }), false);
});

test('latest reminder timestamp ignores newer unrelated events', () => {
  assert.equal(latestPaymentReminderSentAt({
    collectionEvents: [
      { eventType: 'note', note: 'Followed up by phone.', createdAt: '2026-08-21T09:00:00.000Z' },
      { eventType: 'reminder_sent', note: 'Accepted.', createdAt: '2026-08-21T08:00:00.000Z' },
      { note: 'Payment reminder sent.', createdAt: '2026-08-20T08:00:00.000Z' },
    ],
  }), '2026-08-21T08:00:00.000Z');
});
