// Exact public historical source snapshot. This is test input, not live authority.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function originalFinancialBuilderSource(){
 const bytes=readFileSync(new URL('../fixtures/xero-financial-source-builder-2f4bca02.txt',import.meta.url));
 assert.equal(bytes.length,195749);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'55a22268dfb6ea729041e3a22f662fae5ccbdeffed43ab1f2711e014af6530db','Historical public builder bytes changed');
 assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'65753048833f770966f3849345ae8ce11412bc5a','Historical Git blob changed');
 return bytes.toString('utf8');
}
