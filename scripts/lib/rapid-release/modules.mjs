import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';

// Defaults are for pure contract callers. The real prepare/build path binds and
// rechecks the candidate's literal module registry without evaluating its code.
export const DEFAULT_MODULE_INVENTORY = Object.freeze([
  ['dashboard','/'], ['review','/review'], ['disputes','/disputes'], ['buyer_invoices','/payment-collections?tab=collections'],
  ['unofficial_compensation','/unofficial-compensation'], ['incoming_payments','/payment-collections?tab=incoming'],
  ['cashflow_forecast','/cashflow-forecast'], ['pnl','/pnl'], ['brokers','/brokers'], ['buyers_administrator','/account-managers'],
  ['master_contracts','/master-contracts'], ['markets','/markets'], ['special_terms','/special-terms'], ['hedge_desk','/hedge-desk'],
  ['xero_portal','/xero-portal'], ['email_router','/email-router'], ['settings','/settings'], ['admin','/settings?section=people'],
].map(([id,path]) => Object.freeze({id,path})));
const fail = () => { throw Object.assign(new Error('CANDIDATE_MODULE_INVENTORY_UNCLASSIFIED'), { code: 'CANDIDATE_MODULE_INVENTORY_UNCLASSIFIED' }); };
export function normalizeModuleInventory(value) {
  if (!Array.isArray(value) || !value.length || value.length > 128) fail();
  const ids = new Set();
  return value.map(item => {
    if (!item || Object.keys(item).sort().join(',') !== 'id,path' || !/^[a-z][a-z0-9_]{1,79}$/.test(item.id || '') || ids.has(item.id)
      || typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.startsWith('//') || item.path.length > 200 || /[\s\\\0]/.test(item.path)) fail();
    ids.add(item.id);return {id:item.id,path:item.path};
  }).sort((a,b) => a.id.localeCompare(b.id));
}
export function parseModuleInventory(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 256 * 1024) fail();
  let ast;
  try { ast = parse(source, { sourceType:'module' }); } catch { fail(); }
  const declarations = ast.program.body.filter(node => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration')
    .flatMap(node => node.declaration.declarations).filter(node => node.id.type === 'Identifier' && node.id.name === 'APP_MODULES');
  if (declarations.length !== 1 || declarations[0].init?.type !== 'ArrayExpression') fail();
  const modules = declarations[0].init.elements.map(node => {
    if (node?.type !== 'ObjectExpression') fail();
    const data = {};
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.computed || property.method || !['Identifier','StringLiteral'].includes(property.key.type)) fail();
      const key = property.key.name || property.key.value;
      if (Object.hasOwn(data,key)) fail();
      if (['id','path'].includes(key)) { if (property.value.type !== 'StringLiteral') fail(); data[key]=property.value.value; }
    }
    return data;
  });
  return normalizeModuleInventory(modules);
}
export function readCandidateModuleInventory(directory) { return parseModuleInventory(readFileSync(join(directory,'src/lib/authModules.js'),'utf8')); }
