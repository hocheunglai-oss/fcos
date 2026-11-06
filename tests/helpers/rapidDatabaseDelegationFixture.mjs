// Offline only: real local PostgreSQL role/session facts, dummy issuer and TLS.
import { EventEmitter } from 'node:events';
import { TLSSocket } from 'node:tls';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { openPinnedDatabase, MANAGED_DATABASE_ROLE_SQL } from '../../scripts/lib/rapid-release/database-connection.mjs';

export const PUBLIC_CA = "-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL\nBQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l\ndyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh\nc2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow\nazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD\nYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug\nUm9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW\nQyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q\nDmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2\nGtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi\ncvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4\nO4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt\nNaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX\nuXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt\naUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU\ntVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b\nVW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6\njB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx\nCea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2\nCMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P\no/bKiIz+Fq8=\n-----END CERTIFICATE-----\n";
let sequence = 0;
export async function createManagedRoleFixture(native) {
  await native.exec(`create role supabase_admin superuser;
    create role cli_login_postgres login nosuperuser noinherit nocreaterole nocreatedb noreplication nobypassrls valid until '${new Date(Date.now() + 300000).toISOString()}';
    grant postgres to supabase_admin with admin true;
    grant postgres to cli_login_postgres with inherit false,set true,admin false granted by supabase_admin;`);
}
export async function dummyDelegation(native) {
  await createManagedRoleFixture(native);
  await native.exec('set session authorization cli_login_postgres');
  const projectRef = fcosConnectionIdentifier('supabase', 'Project ref');
  const host = fcosConnectionIdentifier('supabase', 'Database session host');
  const credential = { kind: 'supabase_management', token: 'DUMMY_ONLY_Management_credential' };
  const intentStore = {
    async begin(request) {
      const row = (await native.query(MANAGED_DATABASE_ROLE_SQL)).rows[0];
      return { state: 'fresh', intentId: `native_fixture_${++sequence}`, requestDigest: request.requestDigest,
        preflight: { projectRef, observedAtMs: Date.now(), role: row } };
    },
    async complete() {},
    async uncertain() { throw Error('DUMMY_ISSUANCE_UNEXPECTEDLY_UNCERTAIN'); },
  };
  class Client extends EventEmitter {
    constructor(config) {
      super();
      this.connectionParameters = { password: config.password };
      const stream = new TLSSocket(); stream.authorized = true; stream.servername = host;
      this.connection = { stream };
    }
    async connect() {}
    async query(sql, parameters) {
      return sql.startsWith('-- One-time') || sql.startsWith('-- Controller-only')
        ? (await native.exec(sql)).at(-1) : native.query(sql, parameters);
    }
    async end() { this._ending = true; this.connection.stream.destroy(); this.emit('end'); }
  }
  const fetchImpl = async url => {
    const body = url.endsWith('/cli/login-role')
      ? { role: 'cli_login_postgres', password: 'DUMMY_ONLY_temporary_password', ttl_seconds: 300 }
      : { id: projectRef, name: 'FCOS', organization_id: 'yxyxcenpgqutvoctrdkj', status: 'ACTIVE_HEALTHY' };
    const response = new Response(JSON.stringify(body), { status: url.endsWith('/cli/login-role') ? 201 : 200 });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const deps = { Client, fetchImpl, readFile: () => Buffer.from(PUBLIC_CA) };
  return { credential, intentStore, deps, open: () => openPinnedDatabase({ credential, caFile: '/dummy/public-ca.crt', intentStore, deps }) };
}
