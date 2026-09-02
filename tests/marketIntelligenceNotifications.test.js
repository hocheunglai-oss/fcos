import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Markets alerts are service-only and use per-user notification state', () => {
  const migration = read('supabase/migrations/20260820175956_platts_market_intelligence.sql');
  assert.match(migration, /alter table public\.market_intelligence_alert_events enable row level security/i);
  assert.match(migration, /alter table public\.market_intelligence_alert_notification_states enable row level security/i);
  assert.match(migration, /revoke all on table[\s\S]*market_intelligence_alert_events[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /set_market_intelligence_alert_notification_state/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('work notifications expose Markets alerts without email delivery', () => {
  const service = read('api/_workNotifications.js');
  const handlers = read('api/functions/[name].js');
  const component = read('src/components/WorkNotifications.jsx');
  assert.match(service, /market_intelligence_alert_events/);
  assert.match(service, /market_intelligence_alert_notification_states/);
  assert.match(service, /marketAlertIds = \(marketAlertEvents\.data \|\| \[\]\)/);
  assert.match(service, /\.in\('alert_event_id', marketAlertIds\)/);
  assert.doesNotMatch(service, /market_intelligence_alert_notification_states[^\n]+\.eq\('user_id', profile\.id\)\s*\n\s*: Promise\.resolve/);
  assert.match(service, /source: 'markets'/);
  assert.match(service, /set_market_intelligence_alert_notification_state/);
  assert.match(service, /capabilities\?\.markets === true/);
  assert.match(service, /\? 'critical'[\s\S]*\? 'warning' : 'info'/);
  assert.doesNotMatch(service, /sendMail|sendEmail|mail\.send/i);
  assert.match(component, /markets: "Markets"/);
  assert.match(component, /SelectItem value="markets">Markets/);
  assert.match(handlers, /userHasAnyModuleAccess\(context\.client, context\.profile, \['markets'\]\)/);
  assert.match(handlers, /capabilities: \{ \.\.\.\(context\.capabilities \|\| \{\}\), markets \}/);
});
