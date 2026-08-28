import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Incoming Payments internal report is one authoritative review-and-send surface', async () => {
  const [page, server] = await Promise.all([
    read('../src/pages/IncomingPayments.jsx'),
    read('../api/functions/[name].js'),
  ]);

  assert.doesNotMatch(page, /INCOMING_EMAIL_STEPS|emailStep|goEmailStep|goNextEmailStep|goBackEmailStep/);
  assert.doesNotMatch(page, />\s*Next\s*</);
  assert.doesNotMatch(page, />\s*Back\s*</);
  assert.match(page, /Incoming Payments Internal Report/);
  assert.match(page, /Review and send/);
  assert.match(page, /Promise\.all\(\[/);
  assert.match(page, /incomingPaymentEmailSettingsGet/);
  assert.match(page, /incomingPaymentEmailReport/);
  assert.match(page, /preview: true/);
  assert.match(page, /expectedSettingsRevision: reviewedSettingsRevision/);
  assert.match(page, /previewRevision !== settingsRevision/);
  assert.match(page, /disabled=\{!emailTemplateEditing\}/);
  assert.match(page, /Edit Recipients & Template/);
  assert.match(page, /disabled=\{emailBusy \|\| emailTemplateEditing \|\| !emailPreview \|\| emailSettingsRevision < 1 \|\| !String\(emailSettings\.to/);
  assert.equal((page.match(/Send Internal Report/g) || []).length, 1);
  assert.match(page, /toast\(\{ title: 'Incoming Payment report sent'/);
  assert.match(page, /setEmailOpen\(false\)/);

  const handlerStart = server.indexOf('async function incomingPaymentEmailReport');
  const handlerEnd = server.indexOf('\nasync function incomingPaymentEmailSettingsGet', handlerStart);
  const handler = server.slice(handlerStart, handlerEnd);
  assert.match(handler, /loadFinancialReportSettings\(activeAccess\.client, 'incoming_payment_reports'/);
  assert.match(handler, /expectedSettingsRevision !== Number\(stored\.revision \|\| 0\)/);
  assert.match(handler, /settingsRevision: Number\(stored\.revision \|\| 0\)/);
  assert.match(handler, /sendOperationalMail\(\{[\s\S]*to: settings\.to,[\s\S]*cc: settings\.cc,[\s\S]*bcc: settings\.bcc/);
  assert.doesNotMatch(handler, /body\.(to|cc|bcc)/);
});
