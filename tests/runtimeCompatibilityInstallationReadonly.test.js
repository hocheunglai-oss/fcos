import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installationControlSource,installationControlsV2,hash} from './helpers/runtimeCompatibilitySuccessorPortable.mjs';
test('dedicated reader configuration retains exact historical input and rejects arbitrary current drift',()=>{
 const current=readFileSync(new URL('../config/fcosConnections.js',import.meta.url));
 const retained=installationControlSource('config/fcosConnections.js',current);
 assert.equal(hash(retained),installationControlsV2.sources[0].sha256);
 assert.notEqual(hash(retained),hash(current));
 assert.throws(()=>installationControlSource('config/fcosConnections.js',Buffer.concat([current,Buffer.from('\n')])),/Unreviewed current installation control/);
});
