import net from 'node:net';
import tls from 'node:tls';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

const host = `db.${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const sslRequest = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
const caUrl = new URL('../../../supabase/functions/release-coordinator/supabase-root-2021.crt', import.meta.url);

// Transport admission only. Never send a PostgreSQL StartupMessage, password,
// SQL, bearer credential or customer data. The sole plaintext write is SSLRequest.
export async function probeObserverTransport({ resolve = lookup, connect = net.connect,
  secure = tls.connect, ca = undefined, timeoutMs = 10000, now = Date.now } = {}) {
  const started = now();
  const certificate = ca ?? await readFile(caUrl);
  let stage = 'dns', socket, encrypted, timer, finished = false;
  const report = { schemaVersion: 1, kind: 'fcos_observer_transport_preflight_v1', host, port: 5432,
    capturedAt: new Date(started).toISOString(), authenticationAttempted: false, sqlSubmitted: false,
    caSha256: createHash('sha256').update(certificate).digest('hex') };
  try {
    const result = await Promise.race([
      (async () => {
        const addresses = await resolve(host, { all: true });
        if (finished) throw new Error('PROBE_FINISHED');
        if (!addresses.length) throw new Error('DNS_EMPTY');
        report.addressFamilies = [...new Set(addresses.map(value => value.family))].sort();
        stage = 'tcp';
        socket = connect({ host, port: 5432, autoSelectFamily: true });
        await new Promise((done, reject) => { socket.once('connect', done); socket.once('error', reject); });
        if (finished) throw new Error('PROBE_FINISHED');
        stage = 'postgres_ssl';
        await new Promise((done, reject) => {
          socket.once('data', data => data.length === 1 && data[0] === 83 ? done() : reject(new Error('SSL_REJECTED')));
          socket.once('error', reject);
          socket.write(sslRequest);
        });
        if (finished) throw new Error('PROBE_FINISHED');
        stage = 'tls';
        encrypted = secure({ socket, servername: host, ca: certificate, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
        await new Promise((done, reject) => { encrypted.once('secureConnect', done); encrypted.once('error', reject); });
        if (finished) throw new Error('PROBE_FINISHED');
        if (!encrypted.authorized) throw new Error('TLS_UNAUTHORIZED');
        return { ...report, status: 'passed', phase: 'tls', tlsProtocol: encrypted.getProtocol(),
          certificateSha256: encrypted.getPeerCertificate().fingerprint256, elapsedMs: now() - started };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); }),
    ]);
    return result;
  } catch {
    // Provider diagnostics may contain peer details. Emit only a fixed phase code.
    return { ...report, status: 'failed', phase: stage, code: `OBSERVER_TRANSPORT_${stage.toUpperCase()}_FAILED`, elapsedMs: now() - started };
  } finally {
    finished = true; clearTimeout(timer); encrypted?.destroy(); socket?.destroy();
  }
}
