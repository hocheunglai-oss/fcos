import { createClient } from '@supabase/supabase-js';
import { improvementAgentPropose, improvementAgentShow } from '../api/_fcosImprovements.js';

function requiredEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  throw new Error(`${names.join(' or ')} is required.`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function usage() {
  return [
    'Usage:',
    '  npm run improvements:agent -- show FCOS-000001',
    '  npm run improvements:agent -- comment FCOS-000001 --body "Finding or progress update"',
    '  npm run improvements:agent -- status FCOS-000001 --to "In Progress" --note "Implementation started"',
    '',
    'Codex proposals remain Pending Approval. This helper cannot approve them.',
  ].join('\n');
}

function printable(result) {
  const ticket = result.ticket;
  return {
    key: ticket.key,
    type: ticket.type,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    moduleKey: ticket.moduleKey,
    revision: ticket.revision,
    description: ticket.description,
    bug: ticket.type === 'bug' ? {
      severity: ticket.severity,
      actualBehavior: ticket.actualBehavior,
      expectedBehavior: ticket.expectedBehavior,
      reproductionSteps: ticket.reproductionSteps,
    } : undefined,
    featureRequest: ticket.type === 'feature_request' ? {
      desiredOutcome: ticket.desiredOutcome,
      businessValue: ticket.businessValue,
    } : undefined,
    proposals: result.proposals.map((proposal) => ({
      id: proposal.id,
      changeType: proposal.changeType,
      approvalState: proposal.approvalState,
      proposer: proposal.proposer,
      payload: proposal.payload,
      reviewReason: proposal.reviewReason,
      createdAt: proposal.createdAt,
    })),
  };
}

async function main() {
  const command = String(process.argv[2] || '').trim().toLowerCase();
  const ticketKey = String(process.argv[3] || '').trim().toUpperCase();
  if (!command || !ticketKey) throw new Error(usage());
  const url = requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let result;
  if (command === 'show') {
    result = await improvementAgentShow({ ticketKey }, client);
  } else if (command === 'comment') {
    const body = option('--body');
    if (!body) throw new Error(`--body is required.\n\n${usage()}`);
    result = await improvementAgentPropose({ ticketKey, changeType: 'comment', body }, client);
  } else if (command === 'status') {
    const status = option('--to');
    if (!status) throw new Error(`--to is required.\n\n${usage()}`);
    result = await improvementAgentPropose({ ticketKey, changeType: 'status', status, note: option('--note') || '' }, client);
  } else {
    throw new Error(usage());
  }
  process.stdout.write(`${JSON.stringify(printable(result), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});

