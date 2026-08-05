import { randomUUID } from 'node:crypto';
import {
  COLLABORATION_ALLOWED_ATTACHMENTS,
  collaborationAvailableDisplayFilename,
  validateCollaborationAttachment,
} from './_collaboration.js';

const IMPROVEMENTS_BUCKET = 'fcos-improvement-files';
const CLOSED_STATUSES = new Set(['Closed', 'Rejected']);
const ADMIN_USER_TYPES = new Set(['administrator']);

export const IMPROVEMENT_TYPES = Object.freeze(['bug', 'feature_request']);
export const IMPROVEMENT_STATUSES = Object.freeze([
  'Reported',
  'Under Review',
  'Accepted',
  'In Progress',
  'Ready for Verification',
  'Closed',
  'Reopened',
  'Rejected',
]);
export const IMPROVEMENT_PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Urgent']);
export const IMPROVEMENT_SEVERITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical']);
export const IMPROVEMENT_MODULES = Object.freeze([
  ['general', 'General / Cross-module'],
  ['my_commitments', 'My Commitments'],
  ['growth_coaching', 'Growth & Coaching'],
  ['projects_tasks', 'Projects & Tasks'],
  ['dashboard', 'Dashboard'],
  ['buyers_administrator', 'Account Managers'],
  ['markets', 'Markets'],
  ['special_terms', 'Special Terms'],
  ['hedge_desk', 'Hedge Desk'],
  ['payment_collections', 'Payment Collections'],
  ['disputes', 'Dispute Workflow'],
  ['unofficial_compensation', 'Unofficial Compensation'],
  ['brokers', 'Broker Commissions'],
  ['cashflow_forecast', 'Cashflow'],
  ['email_router', 'Email Router'],
  ['review', 'Exception Review'],
  ['pnl', 'Qlik Validator'],
  ['settings', 'Settings'],
]);

const STATUS_TRANSITIONS = Object.freeze({
  Reported: ['Under Review', 'Rejected'],
  'Under Review': ['Accepted', 'Rejected'],
  Accepted: ['In Progress', 'Rejected'],
  'In Progress': ['Ready for Verification', 'Rejected'],
  'Ready for Verification': ['Closed', 'Reopened'],
  Closed: ['Reopened'],
  Reopened: ['Accepted', 'In Progress', 'Rejected'],
  Rejected: ['Reopened'],
});

export function improvementStatusTransitionAllowed(fromStatus, toStatus) {
  return (STATUS_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

function appError(message, status = 500, details = undefined) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanText(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength);
}

function nullableId(value) {
  return cleanText(value, 80) || null;
}

function requiredId(value, label) {
  const id = nullableId(value);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw appError(`${label} is invalid.`, 400);
  return id;
}

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw appError('Refresh the ticket before proposing this change.', 409);
  }
  return revision;
}

function rpcError(error) {
  const message = cleanText(error?.message || 'FCOS Improvements request failed.', 2000);
  if (/changed after|fresh change|already been reviewed|no longer allowed/i.test(message)) return appError(message, 409);
  if (/not found|unavailable/i.test(message)) return appError(message, 404);
  if (/only the|select|require|must|invalid|active/i.test(message)) return appError(message, 400);
  return error;
}

function isUnavailable(error) {
  return error?.code === '42P01' || /does not exist|schema cache/i.test(String(error?.message || ''));
}

async function activeGeneralManager(client) {
  const { data: roles, error } = await client
    .from('collaboration_roles')
    .select('user_id')
    .eq('role', 'general_manager')
    .eq('active', true)
    .limit(2);
  if (error || (roles || []).length !== 1) {
    throw appError('General Manager approval is unavailable because the active role is missing or inconsistent.', 503);
  }
  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active')
    .eq('id', roles[0].user_id)
    .eq('active', true)
    .maybeSingle();
  if (profileError || !profile) {
    throw appError('General Manager approval is unavailable because the assigned user is inactive.', 503);
  }
  return profile;
}

function personShape(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.full_name || profile.email || 'FCOS user',
    email: profile.email || null,
  };
}

function ticketShape(row, extras = {}) {
  return {
    id: row.id,
    key: row.ticket_key,
    type: row.ticket_type,
    title: row.title,
    moduleKey: row.module_key,
    description: row.description,
    actualBehavior: row.actual_behavior || '',
    expectedBehavior: row.expected_behavior || '',
    reproductionSteps: row.reproduction_steps || '',
    desiredOutcome: row.desired_outcome || '',
    businessValue: row.business_value || '',
    severity: row.severity || null,
    priority: row.priority,
    status: row.status,
    reporter: row.reporter_user_id ? { id: row.reporter_user_id, name: row.reporter_name, email: row.reporter_email } : { id: null, name: row.reporter_name, email: row.reporter_email },
    assignee: row.assignee_user_id ? { id: row.assignee_user_id, name: row.assignee_name, email: row.assignee_email } : null,
    revision: Number(row.revision || 1),
    closedAt: row.closed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

function proposalShape(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    changeType: row.change_type,
    payload: row.payload || {},
    baseRevision: Number(row.base_revision || 1),
    approvalState: row.approval_state,
    proposerSource: row.proposer_source,
    proposer: { id: row.proposer_user_id || null, name: row.proposer_name, email: row.proposer_email || null },
    reviewer: row.reviewed_by ? { id: row.reviewed_by, name: row.reviewer_name, email: row.reviewer_email } : null,
    reviewReason: row.review_reason || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attachmentShape(row) {
  return {
    id: row.id,
    displayFilename: row.display_filename,
    contentType: row.content_type,
    size: Number(row.content_size || 0),
    uploadedBy: { id: row.uploaded_by || null, name: row.uploaded_by_name },
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function eventShape(row) {
  return {
    id: row.id,
    type: row.event_type,
    summary: row.summary,
    metadata: row.metadata || {},
    actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name } : { id: null, name: row.actor_name || 'System' },
    createdAt: row.created_at,
  };
}

function permissionsFor(ticket, profile, isGeneralManager) {
  const isAdmin = ADMIN_USER_TYPES.has(profile.user_type);
  const isReporter = ticket.reporter_user_id === profile.id;
  const isAssignee = ticket.assignee_user_id === profile.id;
  return {
    canComment: true,
    canUpload: true,
    canProposeWorkflow: isReporter || isAssignee || isAdmin || isGeneralManager,
    canProposeEdit: isReporter || isAdmin || isGeneralManager,
    canReview: isGeneralManager,
    canDeleteAttachment: isReporter || isAdmin || isGeneralManager,
  };
}

function normalizedTicketInput(body = {}, { partial = false } = {}) {
  const type = cleanText(body.type, 40);
  const title = cleanText(body.title, 255);
  const moduleKey = cleanText(body.moduleKey, 100);
  const description = cleanText(body.description, 20000);
  const priority = cleanText(body.priority || 'Medium', 40);
  const severity = cleanText(body.severity, 40) || null;
  const actualBehavior = cleanText(body.actualBehavior, 10000);
  const expectedBehavior = cleanText(body.expectedBehavior, 10000);
  const reproductionSteps = cleanText(body.reproductionSteps, 15000);
  const desiredOutcome = cleanText(body.desiredOutcome, 15000);
  const businessValue = cleanText(body.businessValue, 10000);
  const errors = [];
  if (!partial || Object.hasOwn(body, 'type')) {
    if (!IMPROVEMENT_TYPES.includes(type)) errors.push('Select Bug or Feature Request.');
  }
  if (!title) errors.push('A concise title is required.');
  if (!moduleKey || !IMPROVEMENT_MODULES.some(([key]) => key === moduleKey)) errors.push('Select the affected FCOS area.');
  if (!description) errors.push('A description is required.');
  if (!IMPROVEMENT_PRIORITIES.includes(priority)) errors.push('Select a valid priority.');
  if (type === 'bug') {
    if (!IMPROVEMENT_SEVERITIES.includes(severity)) errors.push('Select the bug severity.');
    if (!actualBehavior) errors.push('Describe what actually happened.');
    if (!expectedBehavior) errors.push('Describe what should have happened.');
    if (!reproductionSteps) errors.push('Add the steps to reproduce the bug.');
  }
  if (type === 'feature_request') {
    if (!desiredOutcome) errors.push('Describe the desired outcome.');
    if (!businessValue) errors.push('Describe the business value.');
  }
  if (errors.length) throw appError(errors.join(' '), 400);
  return { type, title, moduleKey, description, priority, severity, actualBehavior, expectedBehavior, reproductionSteps, desiredOutcome, businessValue };
}

async function loadTicket(client, value) {
  const lookup = cleanText(value, 80);
  if (!lookup) throw appError('Ticket is required.', 400);
  let query = client.from('fcos_improvement_tickets').select('*');
  query = /^[0-9a-f-]{36}$/i.test(lookup) ? query.eq('id', lookup) : query.eq('ticket_key', lookup.toUpperCase());
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw appError('The FCOS Improvement ticket was not found.', 404);
  return data;
}

async function activeUsers(client) {
  const { data, error } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type')
    .eq('active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data || []).map(personShape);
}

async function insertNotifications(client, rows) {
  const values = rows.filter((row) => row.user_id).map((row) => ({ ...row, dedupe_key: cleanText(row.dedupe_key, 255) }));
  if (!values.length) return;
  const { error } = await client.from('fcos_improvement_notifications').upsert(values, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  if (error && !isUnavailable(error)) throw error;
}

async function insertEvent(client, values) {
  const { error } = await client.from('fcos_improvement_events').insert(values);
  if (error) throw error;
}

function approvedParticipantNotifications(ticket, proposal, actorId, excludedIds = []) {
  const excluded = new Set([actorId, ...excludedIds].filter(Boolean));
  const recipients = [...new Set([ticket.reporter_user_id, ticket.assignee_user_id].filter((id) => id && !excluded.has(id)))];
  if (proposal.change_type === 'comment') {
    return recipients.map((userId) => ({
      user_id: userId,
      ticket_id: ticket.id,
      proposal_id: proposal.id,
      notification_type: 'comment_approved',
      title: `${ticket.ticket_key} has a new approved comment`,
      message: ticket.title,
      dedupe_key: `comment-approved:${proposal.id}:${userId}`,
    }));
  }
  if (proposal.change_type === 'status') {
    return recipients.map((userId) => ({
      user_id: userId,
      ticket_id: ticket.id,
      proposal_id: proposal.id,
      notification_type: 'status_changed',
      title: `${ticket.ticket_key} moved to ${ticket.status}`,
      message: ticket.title,
      dedupe_key: `status-changed:${proposal.id}:${userId}`,
    }));
  }
  return [];
}

export async function improvementsList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const generalManager = await activeGeneralManager(client);
  const limit = Math.max(20, Math.min(Number(body.limit) || 200, 300));
  let query = client.from('fcos_improvement_tickets').select('*', { count: 'exact' }).order('updated_at', { ascending: false }).limit(limit);
  const type = cleanText(body.type, 40);
  const status = cleanText(body.status, 40);
  const moduleKey = cleanText(body.moduleKey, 100);
  const priority = cleanText(body.priority, 40);
  if (IMPROVEMENT_TYPES.includes(type)) query = query.eq('ticket_type', type);
  if (IMPROVEMENT_STATUSES.includes(status)) query = query.eq('status', status);
  if (moduleKey) query = query.eq('module_key', moduleKey);
  if (IMPROVEMENT_PRIORITIES.includes(priority)) query = query.eq('priority', priority);
  if (body.closed === true) query = query.in('status', [...CLOSED_STATUSES]);
  if (body.closed === false) query = query.not('status', 'in', '(Closed,Rejected)');
  const search = cleanText(body.search, 160).replace(/[(),%_]/g, ' ');
  if (search) query = query.or(`ticket_key.ilike.%${search}%,title.ilike.%${search}%,description.ilike.%${search}%,module_key.ilike.%${search}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const ids = (data || []).map((row) => row.id);
  let proposals = [];
  if (ids.length) {
    const { data: proposalRows, error: proposalError } = await client
      .from('fcos_improvement_proposals')
      .select('id,ticket_id,change_type,approval_state,created_at')
      .in('ticket_id', ids)
      .eq('approval_state', 'pending');
    if (proposalError) throw proposalError;
    proposals = proposalRows || [];
  }
  const pendingByTicket = new Map();
  for (const proposal of proposals) pendingByTicket.set(proposal.ticket_id, (pendingByTicket.get(proposal.ticket_id) || 0) + 1);
  return {
    tickets: (data || []).map((row) => ticketShape(row, { pendingApprovalCount: pendingByTicket.get(row.id) || 0 })),
    total: Number(count || 0),
    activeUsers: await activeUsers(client),
    currentUser: personShape(profile),
    generalManager: personShape(generalManager),
    isGeneralManager: generalManager.id === profile.id,
    options: {
      types: IMPROVEMENT_TYPES,
      statuses: IMPROVEMENT_STATUSES,
      priorities: IMPROVEMENT_PRIORITIES,
      severities: IMPROVEMENT_SEVERITIES,
      modules: IMPROVEMENT_MODULES.map(([value, label]) => ({ value, label })),
    },
  };
}

export async function improvementDetail(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const [ticket, generalManager] = await Promise.all([
    loadTicket(client, body.ticketId || body.ticketKey),
    activeGeneralManager(client),
  ]);
  const [proposalResult, attachmentResult, eventResult, users] = await Promise.all([
    client.from('fcos_improvement_proposals').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    client.from('fcos_improvement_attachments').select('*').eq('ticket_id', ticket.id).eq('upload_status', 'complete').order('created_at', { ascending: false }),
    client.from('fcos_improvement_events').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: false }).limit(300),
    activeUsers(client),
  ]);
  if (proposalResult.error) throw proposalResult.error;
  if (attachmentResult.error) throw attachmentResult.error;
  if (eventResult.error) throw eventResult.error;
  const isGeneralManager = generalManager.id === profile.id;
  return {
    ticket: ticketShape(ticket, {
      permissions: permissionsFor(ticket, profile, isGeneralManager),
      allowedNextStatuses: STATUS_TRANSITIONS[ticket.status] || [],
    }),
    proposals: (proposalResult.data || []).map(proposalShape),
    comments: (proposalResult.data || []).filter((row) => row.change_type === 'comment').map(proposalShape),
    attachments: (attachmentResult.data || []).map(attachmentShape),
    events: (eventResult.data || []).map(eventShape),
    activeUsers: users,
    currentUser: personShape(profile),
    generalManager: personShape(generalManager),
    isGeneralManager,
  };
}

export async function improvementCreate(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const input = normalizedTicketInput(body);
  const generalManager = await activeGeneralManager(client);
  const { data: ticket, error } = await client.from('fcos_improvement_tickets').insert({
    ticket_type: input.type,
    title: input.title,
    module_key: input.moduleKey,
    description: input.description,
    actual_behavior: input.actualBehavior,
    expected_behavior: input.expectedBehavior,
    reproduction_steps: input.reproductionSteps,
    desired_outcome: input.desiredOutcome,
    business_value: input.businessValue,
    severity: input.type === 'bug' ? input.severity : null,
    priority: input.priority,
    reporter_user_id: profile.id,
    reporter_name: profile.full_name || profile.email,
    reporter_email: profile.email,
    assignee_user_id: generalManager.id,
    assignee_name: generalManager.full_name || generalManager.email,
    assignee_email: generalManager.email,
  }).select('*').single();
  if (error) throw error;
  await Promise.all([
    insertEvent(client, {
      ticket_id: ticket.id,
      event_type: 'ticket_created',
      summary: `${ticket.ticket_type === 'bug' ? 'Bug' : 'Feature request'} reported`,
      metadata: {
        ticketKey: ticket.ticket_key,
        moduleKey: ticket.module_key,
        priority: ticket.priority,
        defaultAssigneeRole: 'general_manager',
      },
      actor_user_id: profile.id,
      actor_name: profile.full_name || profile.email,
      actor_email: profile.email,
    }),
    insertNotifications(client, generalManager.id === profile.id ? [] : [{
      user_id: generalManager.id,
      ticket_id: ticket.id,
      notification_type: 'ticket_created',
      title: `${ticket.ticket_key} needs review`,
      message: ticket.title,
      dedupe_key: `ticket-created:${ticket.id}`,
    }]),
  ]);
  return improvementDetail({ ticketId: ticket.id }, accessContext);
}

function proposalPayload(changeType, body, ticket) {
  if (changeType === 'comment') {
    const text = cleanText(body.comment || body.body, 10000);
    if (!text) throw appError('Enter a comment before submitting it.', 400);
    return { body: text };
  }
  if (changeType === 'status') {
    const status = cleanText(body.status, 40);
    if (!improvementStatusTransitionAllowed(ticket.status, status)) {
      throw appError(`Status cannot move from ${ticket.status} to ${status || 'the selected value'}.`, 400);
    }
    const note = cleanText(body.note, 2000);
    if (['Rejected', 'Reopened'].includes(status) && !note) throw appError(`A note is required when moving to ${status}.`, 400);
    return { status, note: note || null, fromStatus: ticket.status };
  }
  if (changeType === 'assignment') {
    return { assigneeUserId: nullableId(body.assigneeUserId) };
  }
  if (changeType === 'ticket_edit') {
    const input = normalizedTicketInput({ ...body, type: ticket.ticket_type });
    return {
      title: input.title,
      moduleKey: input.moduleKey,
      description: input.description,
      priority: input.priority,
      severity: input.type === 'bug' ? input.severity : null,
      actualBehavior: input.actualBehavior,
      expectedBehavior: input.expectedBehavior,
      reproductionSteps: input.reproductionSteps,
      desiredOutcome: input.desiredOutcome,
      businessValue: input.businessValue,
    };
  }
  throw appError('Select a valid proposed change.', 400);
}

async function createProposal({ client, ticket, profile, generalManager, changeType, payload, baseRevision, source = 'user', operationKey = null }) {
  if (changeType === 'assignment' && payload.assigneeUserId) {
    const { data: assignee, error } = await client.from('user_profiles').select('id').eq('id', payload.assigneeUserId).eq('active', true).maybeSingle();
    if (error) throw error;
    if (!assignee) throw appError('The selected assignee is not an active FCOS user.', 400);
  }
  const proposerName = source === 'codex' ? 'Codex' : (profile.full_name || profile.email);
  const { data: proposal, error } = await client.from('fcos_improvement_proposals').insert({
    ticket_id: ticket.id,
    change_type: changeType,
    payload,
    base_revision: baseRevision,
    proposer_source: source,
    proposer_user_id: source === 'user' ? profile.id : null,
    proposer_name: proposerName,
    proposer_email: source === 'user' ? profile.email : null,
    operation_key: operationKey,
  }).select('*').single();
  if (error?.code === '23505') throw appError('A pending change of this type already exists for the ticket.', 409);
  if (error) throw error;
  await insertEvent(client, {
    ticket_id: ticket.id,
    proposal_id: proposal.id,
    event_type: 'proposal_created',
    summary: `${source === 'codex' ? 'Codex' : 'User'} proposed ${changeType.replace('_', ' ')}`,
    metadata: { changeType },
    actor_user_id: source === 'user' ? profile.id : null,
    actor_name: proposerName,
    actor_email: source === 'user' ? profile.email : null,
  });
  if (source === 'user' && generalManager.id === profile.id) {
    const { data: decisionData, error: decisionError } = await client.rpc('decide_fcos_improvement_proposal', {
      p_proposal_id: proposal.id,
      p_decision: 'approved',
      p_reason: 'General Manager proposal applied immediately.',
      p_actor_id: profile.id,
      p_actor_name: profile.full_name || profile.email,
      p_actor_email: profile.email,
    });
    if (decisionError) throw rpcError(decisionError);
    const appliedTicket = decisionData?.ticket || ticket;
    const notifications = approvedParticipantNotifications(appliedTicket, proposal, profile.id);
    if (changeType === 'assignment' && appliedTicket.assignee_user_id && appliedTicket.assignee_user_id !== profile.id) {
      notifications.push({
        user_id: appliedTicket.assignee_user_id,
        ticket_id: appliedTicket.id,
        proposal_id: proposal.id,
        notification_type: 'assigned',
        title: `${appliedTicket.ticket_key} assigned to you`,
        message: appliedTicket.title,
        dedupe_key: `assigned:${proposal.id}:${appliedTicket.assignee_user_id}`,
      });
    }
    await insertNotifications(client, notifications);
  } else {
    await insertNotifications(client, [{
      user_id: generalManager.id,
      ticket_id: ticket.id,
      proposal_id: proposal.id,
      notification_type: 'proposal_pending',
      title: `${ticket.ticket_key} change needs approval`,
      message: `${proposerName} proposed ${changeType.replace('_', ' ')}.`,
      dedupe_key: `proposal-pending:${proposal.id}`,
    }]);
  }
  return proposal;
}

export async function improvementPropose(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const ticket = await loadTicket(client, body.ticketId || body.ticketKey);
  const generalManager = await activeGeneralManager(client);
  const isGeneralManager = generalManager.id === profile.id;
  const permissions = permissionsFor(ticket, profile, isGeneralManager);
  const changeType = cleanText(body.changeType, 40);
  if (changeType !== 'comment' && changeType !== 'ticket_edit' && !permissions.canProposeWorkflow) {
    throw appError('Only the reporter, assignee, an Administrator, or the General Manager may propose workflow changes.', 403);
  }
  if (changeType === 'ticket_edit' && !permissions.canProposeEdit) {
    throw appError('Only the reporter, an Administrator, or the General Manager may propose ticket edits.', 403);
  }
  const baseRevision = changeType === 'comment' ? Number(ticket.revision) : positiveRevision(body.expectedRevision);
  if (changeType !== 'comment' && baseRevision !== Number(ticket.revision)) throw appError('The ticket changed. Refresh it before proposing another change.', 409);
  const payload = proposalPayload(changeType, body, ticket);
  await createProposal({ client, ticket, profile, generalManager, changeType, payload, baseRevision });
  return improvementDetail({ ticketId: ticket.id }, accessContext);
}

export async function improvementDecision(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const generalManager = await activeGeneralManager(client);
  if (generalManager.id !== profile.id) throw appError('Only the active General Manager may approve or reject changes.', 403);
  const proposalId = requiredId(body.proposalId, 'Proposal');
  const decision = cleanText(body.decision, 20).toLowerCase();
  const reason = cleanText(body.reason, 2000);
  if (!['approved', 'rejected'].includes(decision)) throw appError('Select Approve or Reject.', 400);
  if (decision === 'rejected' && !reason) throw appError('A rejection reason is required.', 400);
  const { data: before, error: beforeError } = await client.from('fcos_improvement_proposals').select('*').eq('id', proposalId).maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) throw appError('The proposed change was not found.', 404);
  const { data, error } = await client.rpc('decide_fcos_improvement_proposal', {
    p_proposal_id: proposalId,
    p_decision: decision,
    p_reason: reason || null,
    p_actor_id: profile.id,
    p_actor_name: profile.full_name || profile.email,
    p_actor_email: profile.email,
  });
  if (error) throw rpcError(error);
  const ticket = data.ticket;
  const notifications = [];
  if (before.proposer_user_id && before.proposer_user_id !== profile.id) notifications.push({
    user_id: before.proposer_user_id,
    ticket_id: ticket.id,
    proposal_id: before.id,
    notification_type: decision === 'approved' ? 'proposal_approved' : 'proposal_rejected',
    title: `${ticket.ticket_key} proposal ${decision}`,
    message: decision === 'approved' ? `Your ${before.change_type.replace('_', ' ')} was approved.` : reason,
    dedupe_key: `proposal-${decision}:${before.id}`,
  });
  if (decision === 'approved' && before.change_type === 'assignment' && ticket.assignee_user_id && ticket.assignee_user_id !== profile.id) notifications.push({
    user_id: ticket.assignee_user_id,
    ticket_id: ticket.id,
    proposal_id: before.id,
    notification_type: 'assigned',
    title: `${ticket.ticket_key} assigned to you`,
    message: ticket.title,
    dedupe_key: `assigned:${before.id}:${ticket.assignee_user_id}`,
  });
  if (decision === 'approved') notifications.push(...approvedParticipantNotifications(ticket, before, profile.id, [before.proposer_user_id]));
  await insertNotifications(client, notifications);
  return improvementDetail({ ticketId: ticket.id }, accessContext);
}

export async function improvementAttachmentPrepare(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const ticket = await loadTicket(client, body.ticketId || body.ticketKey);
  const validation = validateCollaborationAttachment({ fileName: body.fileName, mimeType: body.contentType, size: Number(body.size) });
  if (!validation.ok) throw appError(validation.errors.join(' '), 400);
  const { data: existing, error: existingError } = await client.from('fcos_improvement_attachments').select('display_filename').eq('ticket_id', ticket.id).in('upload_status', ['pending', 'complete']);
  if (existingError) throw existingError;
  const displayFilename = collaborationAvailableDisplayFilename(validation.value.fileName, (existing || []).map((row) => row.display_filename));
  const contentType = !validation.value.mimeType || validation.value.mimeType === 'application/octet-stream'
    ? COLLABORATION_ALLOWED_ATTACHMENTS[validation.value.extension][0]
    : validation.value.mimeType;
  const storagePath = `${ticket.id}/${randomUUID()}.${validation.value.extension}`;
  const uploadExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data: attachment, error } = await client.from('fcos_improvement_attachments').insert({
    ticket_id: ticket.id,
    storage_path: storagePath,
    original_filename: validation.value.fileName,
    display_filename: displayFilename,
    content_type: contentType,
    file_extension: validation.value.extension,
    content_size: validation.value.size,
    upload_expires_at: uploadExpiresAt,
    uploaded_by: profile.id,
    uploaded_by_name: profile.full_name || profile.email,
    uploaded_by_email: profile.email,
  }).select('*').single();
  if (error) throw error;
  const { data: signed, error: signedError } = await client.storage.from(IMPROVEMENTS_BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
  if (signedError || !signed?.token) {
    await client.from('fcos_improvement_attachments').delete().eq('id', attachment.id);
    throw appError('Private file upload is temporarily unavailable.', 503);
  }
  return { attachmentId: attachment.id, ticketId: ticket.id, displayFilename, contentType, path: signed.path, token: signed.token, bucket: IMPROVEMENTS_BUCKET, expiresAt: uploadExpiresAt };
}

export async function improvementAttachmentComplete(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const attachmentId = requiredId(body.attachmentId, 'Attachment');
  const { data: attachment, error } = await client.from('fcos_improvement_attachments').select('*').eq('id', attachmentId).maybeSingle();
  if (error) throw error;
  if (!attachment || attachment.upload_status !== 'pending' || attachment.uploaded_by !== profile.id) throw appError('The pending attachment was not found.', 404);
  if (attachment.upload_expires_at && attachment.upload_expires_at < new Date().toISOString()) throw appError('The upload expired. Select the file again.', 409);
  const { data: info, error: infoError } = await client.storage.from(IMPROVEMENTS_BUCKET).info(attachment.storage_path);
  if (infoError || !info || Number(info.size || 0) !== Number(attachment.content_size)) {
    await client.storage.from(IMPROVEMENTS_BUCKET).remove([attachment.storage_path]).catch(() => null);
    throw appError('The uploaded file could not be verified. Upload it again.', 409);
  }
  const completedAt = new Date().toISOString();
  const { error: updateError } = await client.from('fcos_improvement_attachments').update({ upload_status: 'complete', completed_at: completedAt, updated_at: completedAt }).eq('id', attachment.id).eq('upload_status', 'pending');
  if (updateError) throw updateError;
  await insertEvent(client, {
    ticket_id: attachment.ticket_id,
    attachment_id: attachment.id,
    event_type: 'attachment_added',
    summary: 'Private file attached',
    metadata: { contentType: attachment.content_type, size: Number(attachment.content_size) },
    actor_user_id: profile.id,
    actor_name: profile.full_name || profile.email,
    actor_email: profile.email,
  });
  return improvementDetail({ ticketId: attachment.ticket_id }, accessContext);
}

export async function improvementAttachmentUrl(body = {}, accessContext) {
  const { client } = accessContext;
  const attachmentId = requiredId(body.attachmentId, 'Attachment');
  const { data: attachment, error } = await client.from('fcos_improvement_attachments').select('*').eq('id', attachmentId).eq('upload_status', 'complete').maybeSingle();
  if (error) throw error;
  if (!attachment) throw appError('The selected attachment is unavailable.', 404);
  const download = body.download === true ? attachment.display_filename : false;
  const { data: signed, error: signedError } = await client.storage.from(IMPROVEMENTS_BUCKET).createSignedUrl(attachment.storage_path, 300, download ? { download } : undefined);
  if (signedError || !signed?.signedUrl) throw appError('The private file link could not be created.', 503);
  return { url: signed.signedUrl, expiresIn: 300, displayFilename: attachment.display_filename, contentType: attachment.content_type };
}

export async function improvementAttachmentDelete(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const attachmentId = requiredId(body.attachmentId, 'Attachment');
  const { data: attachment, error } = await client.from('fcos_improvement_attachments').select('*,fcos_improvement_tickets!inner(reporter_user_id)').eq('id', attachmentId).maybeSingle();
  if (error) throw error;
  if (!attachment || attachment.upload_status !== 'complete') throw appError('The selected attachment is unavailable.', 404);
  const gm = await activeGeneralManager(client);
  const allowed = attachment.uploaded_by === profile.id || attachment.fcos_improvement_tickets?.reporter_user_id === profile.id || ADMIN_USER_TYPES.has(profile.user_type) || gm.id === profile.id;
  if (!allowed) throw appError('You cannot remove this attachment.', 403);
  const deletedAt = new Date().toISOString();
  const { error: updateError } = await client.from('fcos_improvement_attachments').update({ upload_status: 'deleted', deleted_at: deletedAt, updated_at: deletedAt }).eq('id', attachment.id);
  if (updateError) throw updateError;
  const { error: removeError } = await client.storage.from(IMPROVEMENTS_BUCKET).remove([attachment.storage_path]);
  await insertEvent(client, {
    ticket_id: attachment.ticket_id,
    attachment_id: attachment.id,
    event_type: 'attachment_removed',
    summary: 'Private file removed',
    metadata: { storageCleanupPending: Boolean(removeError) },
    actor_user_id: profile.id,
    actor_name: profile.full_name || profile.email,
    actor_email: profile.email,
  });
  return { ...(await improvementDetail({ ticketId: attachment.ticket_id }, accessContext)), storageCleanupPending: Boolean(removeError) };
}

export async function improvementAgentShow(body = {}, client) {
  const ticket = await loadTicket(client, body.ticketKey || body.ticketId);
  const { data: proposals, error } = await client.from('fcos_improvement_proposals').select('id,change_type,payload,approval_state,proposer_source,proposer_name,review_reason,created_at,reviewed_at').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
  if (error) throw error;
  return {
    ticket: ticketShape(ticket),
    proposals: (proposals || []).map((row) => ({
      id: row.id,
      changeType: row.change_type,
      payload: row.payload,
      approvalState: row.approval_state,
      proposer: row.proposer_name,
      proposerSource: row.proposer_source,
      reviewReason: row.review_reason,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
    })),
  };
}

export async function improvementAgentPropose(body = {}, client) {
  const ticket = await loadTicket(client, body.ticketKey || body.ticketId);
  const generalManager = await activeGeneralManager(client);
  const changeType = cleanText(body.changeType, 40);
  if (!['comment', 'status'].includes(changeType)) throw appError('Codex may propose only comments or status changes.', 400);
  const payload = proposalPayload(changeType, body, ticket);
  const operationKey = cleanText(body.operationKey, 255) || `codex:${ticket.id}:${changeType}:${randomUUID()}`;
  await createProposal({
    client,
    ticket,
    profile: { id: null, full_name: 'Codex', email: null },
    generalManager,
    changeType,
    payload,
    baseRevision: Number(ticket.revision),
    source: 'codex',
    operationKey,
  });
  return improvementAgentShow({ ticketId: ticket.id }, client);
}
