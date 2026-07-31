import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buyerInvoiceEmailSettingsPatch,
  canonicalizeBuyerInvoiceEmail,
  canonicalizeBuyerInvoiceEmailValue,
} from '../src/lib/buyerInvoiceEmailSettings.js';

const root = new URL('../', import.meta.url);

test('canonicalizes the known Louisa address typo in strings and lists', () => {
  assert.equal(canonicalizeBuyerInvoiceEmail('LOUSIA@cosulich.com.hk'), 'louisa@cosulich.com.hk');
  assert.equal(
    canonicalizeBuyerInvoiceEmailValue('lousia@cosulich.com.hk, laureen@cosulich.com.hk'),
    'louisa@cosulich.com.hk, laureen@cosulich.com.hk',
  );
  assert.deepEqual(
    canonicalizeBuyerInvoiceEmailValue(['lousia@cosulich.com.hk', 'other@example.com']),
    ['louisa@cosulich.com.hk', 'other@example.com'],
  );
});

test('creates an allowlisted partial settings patch without unrelated recipients', () => {
  const patch = buyerInvoiceEmailSettingsPatch({
    paymentReminderSubject: 'Reminder',
    paymentReminderCc: 'lousia@cosulich.com.hk',
    ignored: 'value',
  });

  assert.deepEqual(patch, {
    paymentReminderCc: 'louisa@cosulich.com.hk',
    paymentReminderSubject: 'Reminder',
  });
  assert.equal(Object.hasOwn(patch, 'cc'), false);
  assert.equal(Object.hasOwn(patch, 'ignored'), false);
});

test('payment reminder template save sends only payment reminder fields', async () => {
  const source = await readFile(new URL('src/pages/BuyerInvoices.jsx', root), 'utf8');
  const saveStart = source.indexOf('const savePaymentReminderTemplateFromModal');
  const saveEnd = source.indexOf('const prepareSend', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.doesNotMatch(saveSource, /\.\.\.\(data\?\.settings/);
  assert.match(saveSource, /paymentReminderSubject:\s*form\.subject/);
  assert.doesNotMatch(saveSource, /^\s*cc:/m);
});

test('server merges settings patches and fails closed when storage is unavailable', async () => {
  const source = await readFile(new URL('api/functions/[name].js', root), 'utf8');

  assert.match(source, /\.rpc\('merge_buyer_invoice_email_settings'/);
  assert.match(source, /stored\.meta\.storageAvailable !== true/);
  assert.doesNotMatch(source, /cc:\s*\['lousia@cosulich\.com\.hk'/);
});

test('migration repairs the typo and exposes only a service-role merge function', async () => {
  const migration = await readFile(
    new URL('supabase/migrations/20260731022451_buyer_invoice_email_recipient_persistence.sql', root),
    'utf8',
  );

  assert.match(migration, /replace\([\s\S]*'lousia@cosulich\.com\.hk'[\s\S]*'louisa@cosulich\.com\.hk'/);
  assert.match(migration, /settings\s*=\s*public\.buyer_invoice_email_settings\.settings\s*\|\|\s*excluded\.settings/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/);
});
