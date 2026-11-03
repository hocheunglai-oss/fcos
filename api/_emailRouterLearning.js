import { AUTO_AI_MODEL, AI_MODEL_SELECTIONS, isAllowedAiSelection, resolveAiModel, aiRequestOptions } from './_aiModelRouting.js';
import { createHmac } from 'node:crypto';
import { dashboardAiUsageFromResponse } from './_dashboardAi.js';
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

// Leave time to durably record either success or failure before the caller's
// deadline. The database lease is longer (360s) than this whole job budget.
const LEARNING_WORK_MS = 50_000;
const LEARNING_STORAGE_MS = 5_000;
const LEARNING_MIN_REMAINING_MS = 75_000;
const LEARNING_DEFAULT_BUDGET_MS = 180_000;

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
  const { data, error } = await table(client, 'settings').select('key,value').in('key', ['advisor.learning_enabled', 'advisor.model'])
    .abortSignal(AbortSignal.timeout(LEARNING_STORAGE_MS));
  if (error) throw learningError('Email Router learning settings are unavailable.', 503, 'EMAIL_ROUTER_LEARNING_SETTINGS_UNAVAILABLE');
  const values = new Map((data || []).map((row) => [row.key, row.value]));
  const requestedModel = values.get('advisor.model')?.modelId;
  return {
    enabled: values.get('advisor.learning_enabled')?.enabled !== false,
    modelId: isAllowedAiSelection(requestedModel) ? requestedModel : AUTO_AI_MODEL,
  };
}

async function classifyMessage(message, modelId, dependencies) {
  const routing = resolveAiModel({ task: 'email_classification', selection: modelId });
  modelId = routing.modelId;
  const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw learningError('The protected OpenAI service is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
  const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      store: false,
      ...aiRequestOptions(routing, 100),
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
  return {
    category: EMAIL_ROUTER_CATEGORIES.includes(parsed.routingCategory) ? parsed.routingCategory : 'other',
    usage: {
      model_id: modelId,
      provider_request_id: usage.openAiResponseId,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      cost_usd: usage.estimatedCostUsd,
    },
  };
}

async function learningRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(LEARNING_STORAGE_MS));
  if (error) throw learningError('Email Router learning storage is unavailable.', 503, 'EMAIL_ROUTER_LEARNING_STORAGE_UNAVAILABLE');
  return data;
}

async function learningResult(client, mailbox, job, modelId, dependencies) {
  const controller = new AbortController();
  const timeoutError = learningError('Email Router learning work timed out.', 503, 'EMAIL_ROUTER_LEARNING_TIMEOUT');
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(timeoutError); reject(timeoutError); }, LEARNING_WORK_MS);
  });
  const fetchImpl = dependencies.fetchImpl || fetch;
  const boundedDependencies = {
    ...dependencies,
    fetchImpl: (url, options = {}) => {
      controller.signal.throwIfAborted();
      return fetchImpl(url, { ...options, signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal]) : controller.signal });
    },
  };
  const work = (async () => {
    const message = await (dependencies.fetchDetail || fetchEmailRouterDetail)({
      client, mailbox, messageId: job.mail_actions.messages.provider_message_id, hasAttachmentsHint: false,
    }, boundedDependencies);
    controller.signal.throwIfAborted();
    const features = buildEmailRouterLearningFeatures(message, dependencies.env || process.env);
    const { category, usage } = await classifyMessage(message, modelId, boundedDependencies);
    controller.signal.throwIfAborted();
    return {
      routing_category: category,
      sender_fingerprint: features.senderFingerprint,
      sender_domain_fingerprint: features.senderDomainFingerprint,
      subject_token_fingerprints: features.subjectTokenFingerprints,
      attachment_profile: features.attachmentProfile,
      usage,
    };
  })();
  try { return await Promise.race([work, deadline]); } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export async function processEmailRouterLearningJobs({ client, mailbox, limit = 10, deadlineAt }, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const deadline = deadlineAt == null ? now() + LEARNING_DEFAULT_BUDGET_MS : Number(deadlineAt);
  const summary = { processed: 0, completed: 0, failed: 0, deferred: false, disabled: false };
  const hasTime = () => Number.isFinite(deadline) && deadline - now() >= LEARNING_MIN_REMAINING_MS;
  if (!hasTime()) return { ...summary, deferred: true };
  const settings = await learningSettings(client);
  if (!settings.enabled) return { ...summary, disabled: true };
  for (let index = 0; index < Math.min(25, Math.max(1, Number(limit) || 10)); index += 1) {
    if (!hasTime()) { summary.deferred = true; break; }
    // Claim only the next item: preclaiming a batch makes later items expire
    // while earlier provider calls are still running.
    const job = await learningRpc(client, 'claim_emailrouter_learning_job', { p_mailbox_id: mailbox.id });
    if (!job) break;
    summary.processed += 1;
    if (job.exhausted) { summary.failed += 1; continue; }
    const claim = { p_job_id: job.id, p_attempt_count: job.attempt_count, p_claimed_at: job.updated_at };
    try {
      // Existing (including intentionally forgotten) outcomes are authoritative.
      // The RPC repairs legacy partial recipients without reclassifying content.
      const result = job.has_outcome ? null : await learningResult(client, mailbox, job, settings.modelId, dependencies);
      const completed = await learningRpc(client, 'finalize_emailrouter_learning_job', { ...claim, p_result: result });
      if (completed) summary.completed += 1;
    } catch (failure) {
      const failureCode = String(failure?.code || 'email_router_learning_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      const failed = await learningRpc(client, 'finalize_emailrouter_learning_job', { ...claim, p_failure_code: failureCode });
      if (failed) summary.failed += 1;
    }
  }
  return summary;
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

export const EMAIL_ROUTER_ADVISOR_MODELS = AI_MODEL_SELECTIONS;
