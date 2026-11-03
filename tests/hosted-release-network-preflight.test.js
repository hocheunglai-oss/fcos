import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { probeObserverTransport } from '../scripts/lib/hosted-release/network-preflight.mjs';
import { observerEndpoint } from '../scripts/lib/hosted-release/observer-target.mjs';

function fixture({ response = 'S', authorized = true, tlsError = false } = {}) {
  const writes = [], options = [], sockets = [];
  const socket = () => { const value = new EventEmitter(); value.destroy = () => { value.destroyed = true; }; sockets.push(value); return value; };
  return { writes, options, sockets, ca: Buffer.from('test CA'), resolve: async () => [{ family: 6 }],
    connect: value => { options.push(value); const stream = socket(); stream.write = bytes => { writes.push(Buffer.from(bytes)); queueMicrotask(() => stream.emit('data', Buffer.from(response))); }; queueMicrotask(() => stream.emit('connect')); return stream; },
    secure: value => { options.push(value); const stream = socket(); stream.authorized = authorized;
      stream.getProtocol = () => 'TLSv1.3'; stream.getPeerCertificate = () => ({ fingerprint256: 'AA:BB' });
      queueMicrotask(() => tlsError ? stream.emit('error', new Error('private diagnostics')) : stream.emit('secureConnect')); return stream; },
  };
}

test('fixed endpoint performs verified TLS and sends only PostgreSQL SSLRequest', async () => {
  const f = fixture(); const result = await probeObserverTransport(f);
  assert.equal(result.status, 'passed'); assert.equal(result.authenticationAttempted, false); assert.equal(result.sqlSubmitted, false);
  assert.deepEqual(f.writes, [Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])]);
  assert.equal(f.options[0].host, result.host); assert.equal(f.options[0].port, 5432);
  assert.equal(f.options[1].servername, result.host); assert.equal(f.options[1].rejectUnauthorized, true);
  assert.equal(f.options[1].minVersion, 'TLSv1.2'); assert.deepEqual(f.options[1].ca, f.ca);
  assert.ok(f.sockets.every(value => value.destroyed));
});

test('DNS failure exposes a fixed code and never opens a socket', async () => {
  const f = fixture(); f.resolve = async () => { throw new Error('sensitive diagnostics'); };
  const result = await probeObserverTransport(f); assert.equal(result.code, 'OBSERVER_TRANSPORT_DNS_FAILED');
  assert.equal(f.sockets.length, 0); assert.ok(!JSON.stringify(result).includes('sensitive'));
});

test('approved session transport uses only its pinned host with verified hostname TLS', async () => {
  const f = fixture(); const result = await probeObserverTransport({ ...f, transport: 'session' });
  assert.equal(result.status, 'passed'); assert.equal(result.transport, 'session');
  assert.equal(result.host, observerEndpoint('session').host);
  assert.equal(f.options[0].host, result.host); assert.equal(f.options[1].servername, result.host);
  assert.equal(f.options[1].rejectUnauthorized, true); assert.equal(f.writes.length, 1);
});

test('server SSL refusal never starts TLS or authentication', async () => {
  const f = fixture({ response: 'N' }); const result = await probeObserverTransport(f);
  assert.equal(result.code, 'OBSERVER_TRANSPORT_POSTGRES_SSL_FAILED'); assert.equal(f.options.length, 1);
  assert.equal(f.writes.length, 1); assert.ok(f.sockets.every(value => value.destroyed));
});

test('invalid certificate and TLS failures fail closed without private diagnostics', async () => {
  for (const value of [{ authorized: false }, { tlsError: true }]) {
    const f = fixture(value); const result = await probeObserverTransport(f);
    assert.equal(result.code, 'OBSERVER_TRANSPORT_TLS_FAILED'); assert.ok(!JSON.stringify(result).includes('private diagnostics'));
    assert.equal(f.writes.length, 1); assert.ok(f.sockets.every(stream => stream.destroyed));
  }
});

test('a DNS result arriving after timeout cannot open a late socket', async () => {
  const f = fixture(); let complete;
  f.resolve = () => new Promise(resolve => { complete = resolve; });
  const result = await probeObserverTransport({ ...f, timeoutMs: 1 });
  assert.equal(result.code, 'OBSERVER_TRANSPORT_DNS_FAILED');
  complete([{ family: 6 }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.sockets.length, 0);
});
