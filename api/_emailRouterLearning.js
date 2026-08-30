import { createHmac } from 'node:crypto';
import { DASHBOARD_AI_MODELS, DEFAULT_DASHBOARD_AI_MODEL, dashboardAiUsageFromResponse, isAllowedDashboardAiModel } from './_dashboardAi.js';
import { fetchEmailRouterDetail } from './_emailRouterCore.js';

export const EMAIL_ROUTER_CATEGORIES = Object.freeze([
  'market_report',
  'price_quote',
  'nomination',
  'confirmation',
  'invoice',
  'payment',
  'settlement',
  'operations',
  'compliance',
  'internal',
  'general',
  'other',
]);

const STOP_WORDS = new Set(['and', 'the', 'for', 'from', 'with', 'this', 'that', 'your', 'our', 'email', 'message', 'reply', 'forward', 'fwd', 're']);

function table(client, name) {
  return client.schema('emailrouter').from(name);
}

function learningError(message, status = 500, code = 'EMAIL_ROUTER_LEARNING_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function learningSecret(env) {
  const secret = String(env.FCOS_EMAIL_ROUTER_LEARNING_KEY || env.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET || '').trim();
  if (secret.length < 32) throw learningError('Email Router learning protection is not configured.', 503, 'EMAIL_ROUTER_LEARNING_SECRET_MISSING');
  return secret;
}

function fingerprint(secret, value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized ? createHmac('sha256', secret).update(normalized).digest('hex') : null;
}

function subjectTokens(subject) {
  return [...new Set(String(subject || '')
    .toLowerCase()
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token)))]
    .slice(0, 24);
}

function cleanMessageText(message) {
  const source = message?.body?.content || message?.bodyPreview || '';
  return String(source || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000);
}

function senderAddress(message) {
  return String(message?.from?.emailAddress?.address || message?.sender?.emailAddress?.address || message?.from?.address || '').trim().toLowerCase();
}

export function buildEmailRouterLearningFeatures(message, env = process.env) {
  const secret = learningSecret(env);
  const sender = senderAddress(message);
  const domain = sender.includes('@') ? sender.split('@').at(-1) : '';
  const attachmentKinds = [...new Set((message?.attachments || []).map((attachment) => String(attachment?.contentType || '').split('/')[0].toLowerCase()).filter(Boolean))].sort();
  return {
    senderFingerprint: fingerprint(secret, sender),
    senderDomainFingerprint: fingerprint(secret, domain),
    subjectTokenFingerprints: subjectTokens(message?.subject).map((token) => fingerprint(secret, token)),
    attachmentProfile: attachmentKinds.length ? attachmentKinds.join('+').slice(0, 120) : message?.hasAttachments ? 'unknown' : 'none',
  };
}

function selectionSignature(selections) {
  return [...(selections || [])]
    .sort((left, right) => String(left.recipient_kind).localeCompare(String(right.recipient_kind)) || Number(left.position) - Number(right.position))
    .map((item) => `${item.recipient_kind}:${item.position}:${item.destination_id ? `d:${item.destination_id}` : `g:${item.group_id}`}`)
    .join('|');
}

function folderChoice(outcome) {
  if (outcome.post_action_mode === 'keep_current') return 'keep_current';
  return outcome.post_action_folder_id || 'archive';
}

function similarityScore(features, outcome) {
  let score = 0;
  if (features.senderFingerprint && features.senderFingerprint === outcome.sender_fingerprint) score += 4;
  else if (features.senderDomainFingerprint && features.senderDomainFingerprint === outcome.sender_domain_fingerprint) score += 2;
  const currentTokens = new Set(features.subjectTokenFingerprints || []);
  const historicTokens = new Set(Array.isArray(outcome.subject_token_fingerprints) ? outcome.subject_token_fingerprints : []);
  const union = new Set([...currentTokens, ...historicTokens]);
  const overlap = [...currentTokens].filter((token) => historicTokens.has(token)).length;
  if (union.size) score += (overlap / union.size) * 3;
  if (features.attachmentProfile === outcome.attachment_profile) score += 1;
  return Number(score.toFixed(3));
}

export async function loadEmailRouterLearningEvidence(client, mailboxId, features) {
  const { data, error } = await table(client, 'advisor_learning_outcomes')
    .select('id,routing_category,sender_fingerprint,sender_domain_fingerprint,subject_token_fingerprints,attachment_profile,action_type,post_action_mode,post_action_folder_id,recipients_complete,created_at,advisor_learning_outcome_destinations(destination_id,group_id,recipient_kind,position)')
    .eq('mailbox_id', mailboxId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return { patterns: [], outcomes: [] };
  const outcomes = (data || []).map((row) => ({
    ...row,
    similarity: similarityScore(features, row),
    recipientSignature: row.recipients_complete ? selectionSignature(row.advisor_learning_outcome_destinations) : '',
    folderChoice: folderChoice(row),
  }));
  const aggregates = new Map();
  for (const outcome of outcomes) {
    const key = `${outcome.routing_category}|${outcome.action_type}|${outcome.folderChoice}|${outcome.recipientSignature}`;
    const current = aggregates.get(key) || {
      category: outcome.routing_category,
      action: outcome.action_type,
      folderChoice: outcome.folderChoice,
      selections: (outcome.recipients_complete ? outcome.advisor_learning_outcome_destinations || [] : []).map((item) => ({
        candidateId: item.destination_id || item.group_id,
        candidateKind: item.group_id ? 'group' : 'destination',
        recipientKind: item.recipient_kind,
        position: item.position,
      })),
      count: 0,
      similarity: 0,
    };
    current.count += 1;
    current.similarity = Math.max(current.similarity, outcome.similarity);
    aggregates.set(key, current);
  }
  return {
    outcomes,
    patterns: [...aggregates.values()]
      .filter((pattern) => pattern.similarity >= 3)
      .sort((left, right) => right.similarity - left.similarity || right.count - left.count)
      .slice(0, 50),
  };
}

export function evaluateEmailRouterLearningEvidence({ parsed, evidence, candidates, folders }) {
  const category = EMAIL_ROUTER_CATEGORIES.includes(parsed?.routingCategory) ? parsed.routingCategory : 'other';
  const categoryOutcomes = (evidence?.outcomes || []).filter((outcome) => outcome.routing_category === category && Number(outcome.similarity || 0) >= 3);
  const action = ['redirect', 'forward'].includes(parsed?.suggestedAction) ? parsed.suggestedAction : 'redirect';
  const requestedFolder = String(parsed?.suggestedFolder || (action === 'redirect' ? 'archive' : 'keep_current'));
  const allowedFolders = new Set(['archive', 'keep_current', ...(folders || []).map((folder) => folder.id)]);
  const folder = allowedFolders.has(requestedFolder) ? requestedFolder : action === 'redirect' ? 'archive' : 'keep_current';
  const candidateMap = new Map((candidates || []).map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  const selections = [];
  for (const item of Array.isArray(parsed?.selections) ? parsed.selections : []) {
    const candidate = candidateMap.get(item?.candidateId);
    const recipientKind = String(item?.recipientKind || '').toLowerCase();
    if (!candidate || !['to', 'cc', 'bcc'].includes(recipientKind) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    selections.push({ ...candidate, recipientKind });
    if (selections.length === 10) break;
  }
  const selectionPositions = { to: 0, cc: 0, bcc: 0 };
  const signature = selectionSignature(selections.map((item) => {
    selectionPositions[item.recipientKind] += 1;
    return {
      destination_id: item.kind === 'group' ? null : item.id,
      group_id: item.kind === 'group' ? item.id : null,
      recipient_kind: item.recipientKind,
      position: selectionPositions[item.recipientKind],
    };
  }));
  const countFor = (predicate) => categoryOutcomes.filter(predicate).length;
  const actionCount = countFor((outcome) => outcome.action_type === action);
  const folderCount = countFor((outcome) => outcome.folderChoice === folder);
  const recipientCount = signature ? countFor((outcome) => outcome.recipientSignature === signature) : 0;
  const total = categoryOutcomes.length;
  const confidence = (value) => Math.min(1, Math.max(0, Number(value) || 0));
  const agreement = (count) => total ? count / total : 0;
  const actionConfidence = confidence(parsed?.actionConfidence);
  const recipientConfidence = confidence(parsed?.recipientConfidence);
  const folderConfidence = confidence(parsed?.folderConfidence);
  const inconsistentComponents = [
    total >= 3 && agreement(actionCount) <= 0.6 ? 'action' : null,
    signature && total >= 3 && agreement(recipientCount) <= 0.6 ? 'recipients' : null,
    total >= 3 && agreement(folderCount) <= 0.6 ? 'folder' : null,
  ].filter(Boolean);
  return {
    routingCategory: category,
    suggestedAction: action,
    suggestedFolder: folder,
    selections,
    destinations: selections.map(({ recipientKind: _kind, ...candidate }) => candidate),
    actionConfidence,
    recipientConfidence,
    folderConfidence,
    actionEvidenceCount: actionCount,
    recipientEvidenceCount: recipientCount,
    folderEvidenceCount: folderCount,
    evidenceCount: Math.max(actionCount, recipientCount, folderCount),
    preselectAction: actionCount >= 3 && actionConfidence > 0.6 && agreement(actionCount) > 0.6,
    preselectRecipients: recipientCount >= 3 && recipientConfidence > 0.6 && agreement(recipientCount) > 0.6,
    preselectFolder: folderCount >= 3 && folderConfidence > 0.6 && agreement(folderCount) > 0.6,
    rationale: String(parsed?.rationale || '').trim().slice(0, 500),
    historyWarning: inconsistentComponents.length
      ? `Similar confirmed outcomes are inconsistent for: ${inconsistentComponents.join(', ')}. FCOS left those controls unchanged.`
      : null,
    question: parsed?.question ? String(parsed.question).trim().slice(0, 300) : null,
  };
}

export async function recordEmailRouterAdvisorRecommendation(client, { mailboxId, messageId, actorUserId, recommendation }) {
  const { data: message, error: messageError } = await table(client, 'messages')
    .select('id')
    .eq('mailbox_id', mailboxId)
    .eq('provider_message_id', messageId)
    .maybeSingle();
  if (messageError || !message) return null;
  const positions = { to: 0, cc: 0, bcc: 0 };
  const { data, error } = await table(client, 'advisor_recommendations').insert({
    mailbox_id: mailboxId,
    message_id: message.id,
    actor_user_id: actorUserId,
    routing_category: recommendation.routingCategory,
    suggested_action: recommendation.suggestedAction,
    suggested_post_action_mode: recommendation.suggestedFolder === 'keep_current' ? 'keep_current' : 'move',
    suggested_folder_key: recommendation.suggestedFolder === 'archive' ? 'archive' : null,
    suggested_folder_id: /^[0-9a-f-]{36}$/i.test(recommendation.suggestedFolder) ? recommendation.suggestedFolder : null,
    action_confidence: recommendation.actionConfidence,
    recipient_confidence: recommendation.recipientConfidence,
    folder_confidence: recommendation.folderConfidence,
    evidence_count: recommendation.evidenceCount,
    selection_snapshot: recommendation.selections.map((selection) => {
      positions[selection.recipientKind] += 1;
      return {
        candidateId: selection.id,
        candidateKind: selection.kind,
        recipientKind: selection.recipientKind,
        position: positions[selection.recipientKind],
      };
    }),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  }).select('id').single();
  if (error) return null;
  return data.id;
}

async function learningSettings(client) {
  const { data, error } = await table(client, 'settings').select('key,value').in('key', ['advisor.learning_enabled', 'advisor.model']);
  if (error) throw learningError('Email Router learning settings are unavailable.', 503, 'EMAIL_ROUTER_LEARNING_SETTINGS_UNAVAILABLE');
  const values = new Map((data || []).map((row) => [row.key, row.value]));
  const requestedModel = values.get('advisor.model')?.modelId;
  return {
    enabled: values.get('advisor.learning_enabled')?.enabled !== false,
    modelId: isAllowedDashboardAiModel(requestedModel) ? requestedModel : DEFAULT_DASHBOARD_AI_MODEL,
  };
}

async function classifyMessage(client, action, message, modelId, dependencies) {
  const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw learningError('The protected OpenAI service is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
  const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      store: false,
      max_output_tokens: 100,
      ...(modelId.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Classify this shared-mailbox message into exactly one allowed routing category. Do not quote or repeat the message.' }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ subject: String(message?.subject || '').slice(0, 500), messageText: cleanMessageText(message), categories: EMAIL_ROUTER_CATEGORIES }) }] },
      ],
      text: { format: { type: 'json_schema', name: 'email_router_learning_category', strict: true, schema: { type: 'object', additionalProperties: false, required: ['routingCategory'], properties: { routingCategory: { type: 'string', enum: EMAIL_ROUTER_CATEGORIES } } } } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw learningError('Email Router learning classification is temporarily unavailable.', 503, 'EMAIL_ROUTER_LEARNING_CLASSIFICATION_FAILED');
  const payload = await response.json().catch(() => null);
  const output = typeof payload?.output_text === 'string' ? payload.output_text : (payload?.output || []).flatMap((item) => item?.content || []).filter((item) => item?.type === 'output_text').map((item) => item.text).join('');
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw learningError('Email Router learning classification was invalid.', 502, 'EMAIL_ROUTER_LEARNING_CLASSIFICATION_INVALID'); }
  const usage = dashboardAiUsageFromResponse(payload, modelId);
  await table(client, 'ai_usage_events').insert({
    message_id: action.message_id,
    mail_action_id: action.id,
    actor_user_id: action.requested_by,
    model_id: modelId,
    provider_request_id: usage.openAiResponseId,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    total_tokens: usage.totalTokens,
    cost_usd: usage.estimatedCostUsd,
    outcome: 'success',
  });
  return EMAIL_ROUTER_CATEGORIES.includes(parsed.routingCategory) ? parsed.routingCategory : 'other';
}

export async function processEmailRouterLearningJobs({ client, mailbox, limit = 10 }, dependencies = {}) {
  const settings = await learningSettings(client);
  if (!settings.enabled) return { processed: 0, completed: 0, disabled: true };
  const { data: jobs, error } = await table(client, 'advisor_learning_jobs')
    .select('id,mail_action_id,state,attempt_count,mail_actions(id,message_id,requested_by,action_type,state,post_action_mode,post_action_folder_id,learning_recipients_complete,messages(id,provider_message_id,mailbox_id),mail_action_destinations(destination_id,group_id,recipient_kind,position))')
    .in('state', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(Math.min(25, Math.max(1, Number(limit) || 10)));
  if (error) throw learningError('Email Router learning jobs are unavailable.', 503, 'EMAIL_ROUTER_LEARNING_STORAGE_UNAVAILABLE');
  let completed = 0;
  for (const job of jobs || []) {
    const action = Array.isArray(job.mail_actions) ? job.mail_actions[0] : job.mail_actions;
    const messageRow = Array.isArray(action?.messages) ? action.messages[0] : action?.messages;
    if (!action || !messageRow || action.state !== 'confirmed' || !['redirect', 'forward'].includes(action.action_type)) continue;
    const { data: claimed } = await table(client, 'advisor_learning_jobs')
      .update({ state: 'processing', attempt_count: Number(job.attempt_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('state', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    try {
      const message = await fetchEmailRouterDetail({ client, mailbox, messageId: messageRow.provider_message_id, hasAttachmentsHint: false }, dependencies);
      const category = await classifyMessage(client, action, message, settings.modelId, dependencies);
      const features = buildEmailRouterLearningFeatures(message, dependencies.env || process.env);
      const { data: outcome, error: outcomeError } = await table(client, 'advisor_learning_outcomes').upsert({
        mail_action_id: action.id,
        mailbox_id: mailbox.id,
        routing_category: category,
        sender_fingerprint: features.senderFingerprint,
        sender_domain_fingerprint: features.senderDomainFingerprint,
        subject_token_fingerprints: features.subjectTokenFingerprints,
        attachment_profile: features.attachmentProfile,
        action_type: action.action_type,
        post_action_mode: action.post_action_mode || 'keep_current',
        post_action_folder_id: action.post_action_folder_id || null,
        recipients_complete: action.learning_recipients_complete !== false,
        active: true,
        disabled_at: null,
        disabled_by: null,
        disabled_reason: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'mail_action_id' }).select('id').single();
      if (outcomeError) throw outcomeError;
      await table(client, 'advisor_learning_outcome_destinations').delete().eq('outcome_id', outcome.id);
      const destinations = (action.mail_action_destinations || []).map((item) => ({
        outcome_id: outcome.id,
        destination_id: item.destination_id || null,
        group_id: item.group_id || null,
        recipient_kind: item.recipient_kind,
        position: item.position,
      }));
      if (destinations.length) {
        const { error: destinationError } = await table(client, 'advisor_learning_outcome_destinations').insert(destinations);
        if (destinationError) throw destinationError;
      }
      await Promise.all([
        table(client, 'advisor_learning_jobs').update({ state: 'completed', completed_at: new Date().toISOString(), failure_code: null, updated_at: new Date().toISOString() }).eq('id', job.id),
        table(client, 'mail_actions').update({ learning_state: 'completed' }).eq('id', action.id),
      ]);
      completed += 1;
    } catch (failure) {
      const failureCode = String(failure?.code || 'email_router_learning_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      const delayMinutes = Math.min(24 * 60, 2 ** Math.min(10, Number(job.attempt_count || 0) + 1));
      await Promise.all([
        table(client, 'advisor_learning_jobs').update({ state: 'failed', failure_code: failureCode, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id),
        table(client, 'mail_actions').update({ learning_state: 'failed' }).eq('id', action.id),
      ]);
    }
  }
  return { processed: (jobs || []).length, completed, disabled: false };
}

export async function listEmailRouterLearnedRoutes(client, mailboxId) {
  const { data, error } = await table(client, 'advisor_learning_outcomes')
    .select('id,routing_category,action_type,post_action_mode,post_action_folder_id,recipients_complete,active,revision,created_at,advisor_learning_outcome_destinations(destination_id,group_id,recipient_kind,position)')
    .eq('mailbox_id', mailboxId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw learningError('Learned routing patterns are unavailable.', 503, 'EMAIL_ROUTER_LEARNING_STORAGE_UNAVAILABLE');
  const aggregates = new Map();
  for (const row of data || []) {
    const signature = `${row.routing_category}|${row.action_type}|${folderChoice(row)}|${row.recipients_complete ? selectionSignature(row.advisor_learning_outcome_destinations) : 'manual-recipient-route'}`;
    const current = aggregates.get(signature) || {
      id: row.id,
      category: row.routing_category,
      action: row.action_type,
      folderChoice: folderChoice(row),
      count: 0,
      revision: Number(row.revision),
      latestAt: row.created_at,
      outcomes: [],
    };
    current.count += 1;
    current.outcomes.push({ id: row.id, expectedRevision: Number(row.revision) });
    aggregates.set(signature, current);
  }
  return [...aggregates.values()].sort((left, right) => right.count - left.count || String(right.latestAt).localeCompare(String(left.latestAt)));
}

export const EMAIL_ROUTER_ADVISOR_MODELS = DASHBOARD_AI_MODELS;
