import { createHash } from 'node:crypto';
import {
  DASHBOARD_AI_MODELS,
  DEFAULT_DASHBOARD_AI_MODEL,
  dashboardAiUsageFromResponse,
  isAllowedDashboardAiModel,
} from './_dashboardAi.js';
import { fetchEmailRouterDetail, listEmailRouterDirectory } from './_emailRouterCore.js';
import { listEmailRouterRoutingFolders } from './_emailRouterFolders.js';
import {
  EMAIL_ROUTER_CATEGORIES,
  buildEmailRouterLearningFeatures,
  evaluateEmailRouterLearningEvidence,
  loadEmailRouterLearningEvidence,
  recordEmailRouterAdvisorRecommendation,
} from './_emailRouterLearning.js';

function table(client, name) {
  return client.schema('emailrouter').from(name);
}

function advisorError(message, status = 400, code = 'EMAIL_ROUTER_ADVISOR_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function outputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function cleanMessageText(message) {
  const source = message?.body?.contentType === 'text'
    ? message.body.content
    : message?.body?.content || message?.bodyPreview || '';
  return String(source || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6_000);
}

async function advisorSettings(client) {
  const { data, error } = await table(client, 'settings').select('key,value').in('key', ['advisor.enabled', 'advisor.model', 'advisor.learning_enabled']);
  if (error) throw advisorError('Email Router Advisor settings are unavailable.', 503, 'EMAIL_ROUTER_ADVISOR_SETTINGS_UNAVAILABLE');
  const settings = new Map((data || []).map((row) => [row.key, row.value]));
  const requestedModel = settings.get('advisor.model')?.modelId;
  return {
    enabled: settings.get('advisor.enabled')?.enabled !== false,
    learningEnabled: settings.get('advisor.learning_enabled')?.enabled !== false,
    modelId: isAllowedDashboardAiModel(requestedModel) ? requestedModel : DEFAULT_DASHBOARD_AI_MODEL,
  };
}

export function emailRouterAdvisorRecommendationSchema(candidateIds, folderIds = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'routingCategory', 'suggestedAction', 'suggestedFolder', 'selections',
      'actionConfidence', 'recipientConfidence', 'folderConfidence', 'rationale', 'question',
    ],
    properties: {
      routingCategory: { type: 'string', enum: EMAIL_ROUTER_CATEGORIES },
      suggestedAction: { type: 'string', enum: ['redirect', 'forward'] },
      suggestedFolder: { type: 'string', enum: ['keep_current', 'archive', ...folderIds] },
      selections: {
        type: 'array',
        minItems: 0,
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['candidateId', 'recipientKind'],
          properties: {
            candidateId: { type: 'string', enum: candidateIds },
            recipientKind: { type: 'string', enum: ['to', 'cc', 'bcc'] },
          },
        },
      },
      actionConfidence: { type: 'number', minimum: 0, maximum: 1 },
      recipientConfidence: { type: 'number', minimum: 0, maximum: 1 },
      folderConfidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', maxLength: 500 },
      question: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
    },
  };
}

export function normaliseEmailRouterAdvisorRecommendation(parsed, candidates, folders = [], evidence = { outcomes: [] }) {
  const legacyConfidence = Number(parsed?.confidence);
  const normalized = evaluateEmailRouterLearningEvidence({
    parsed: {
      routingCategory: parsed?.routingCategory || 'other',
      suggestedAction: parsed?.suggestedAction || 'redirect',
      suggestedFolder: parsed?.suggestedFolder || 'archive',
      selections: parsed?.selections,
      actionConfidence: parsed?.actionConfidence ?? legacyConfidence,
      recipientConfidence: parsed?.recipientConfidence ?? legacyConfidence,
      folderConfidence: parsed?.folderConfidence ?? legacyConfidence,
      rationale: parsed?.rationale,
      question: parsed?.question,
    },
    evidence,
    candidates,
    folders,
  });
  return { ...normalized, confidence: normalized.recipientConfidence };
}

function providerFailure(response, payload) {
  const providerCode = String(payload?.error?.code || payload?.error?.type || '').toLowerCase();
  if (response.status === 401 || response.status === 403) {
    return advisorError('Email Router Advisor authentication is unavailable. Ask an Administrator to check the protected OpenAI configuration.', 503, 'EMAIL_ROUTER_ADVISOR_AUTHENTICATION_FAILED');
  }
  if (response.status === 429) {
    return advisorError('Email Router Advisor is busy or has reached its current API limit. Try again later.', 503, 'EMAIL_ROUTER_ADVISOR_RATE_LIMITED');
  }
  if (response.status === 404 || providerCode.includes('model')) {
    return advisorError('The selected Email Router Advisor model is unavailable. Choose another model in AI Models settings.', 503, 'EMAIL_ROUTER_ADVISOR_MODEL_UNAVAILABLE');
  }
  if (response.status === 400) {
    return advisorError('The selected Email Router Advisor model rejected the structured request. Choose another model or contact an Administrator.', 502, 'EMAIL_ROUTER_ADVISOR_REQUEST_REJECTED');
  }
  return advisorError('Email Router Advisor is temporarily unavailable.', 502, 'EMAIL_ROUTER_ADVISOR_FAILED');
}

async function recordUsage(client, profile, mailbox, providerMessageId, payload, modelId, latencyMs, outcome, errorCode = null) {
  const usage = payload ? dashboardAiUsageFromResponse(payload, modelId) : {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    openAiResponseId: null,
  };
  const { data: message } = await table(client, 'messages')
    .select('id')
    .eq('mailbox_id', mailbox.id)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();
  const { error } = await table(client, 'ai_usage_events').insert({
    message_id: message?.id || null,
    actor_user_id: profile.id,
    model_id: modelId,
    provider_request_id: usage.openAiResponseId,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    total_tokens: usage.totalTokens,
    cost_usd: usage.estimatedCostUsd,
    latency_ms: latencyMs,
    outcome,
    error_code: errorCode,
  });
  if (error) console.warn('[email-router-advisor] Usage accounting is unavailable.', { code: error.code || 'EMAIL_ROUTER_AI_USAGE_FAILED' });
  return usage;
}

export async function runEmailRouterAdvisor({ client, profile, mailbox, messageId }, dependencies = {}) {
  const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw advisorError('The protected OpenAI service is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
  const settings = await advisorSettings(client);
  if (!settings.enabled) throw advisorError('Email Router Advisor is disabled in Settings.', 503, 'EMAIL_ROUTER_ADVISOR_DISABLED');
  const [message, directory, folders] = await Promise.all([
    fetchEmailRouterDetail({ client, mailbox, messageId }, dependencies),
    listEmailRouterDirectory({ client }),
    listEmailRouterRoutingFolders(client, mailbox.id),
  ]);
  const candidates = directory.slice(0, 100).map((item) => ({
    id: item.id,
    kind: item.kind === 'group' ? 'group' : 'destination',
    label: item.label,
    memberCount: Number(item.memberCount || 0),
  }));
  if (!candidates.length) throw advisorError('No active Email Router destinations are available.', 409, 'EMAIL_ROUTER_ADVISOR_DIRECTORY_EMPTY');
  const features = buildEmailRouterLearningFeatures(message, dependencies.env || process.env);
  const evidence = settings.learningEnabled
    ? await loadEmailRouterLearningEvidence(client, mailbox.id, features)
    : { patterns: [], outcomes: [] };
  const folderChoices = folders.filter((folder) => !folder.system).map((folder) => ({ id: folder.id, path: folder.path }));
  const startedAt = Date.now();
  let response;
  try {
    response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.modelId,
        store: false,
        max_output_tokens: 1_000,
        ...(settings.modelId.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
        safety_identifier: createHash('sha256').update(String(profile.id)).digest('hex'),
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: 'You are FCOS Email Router Advisor. Recommend Forward or Redirect, one reviewed post-action folder, and up to ten approved routing candidates using only supplied IDs. Assign recipients to To, Cc, or Bcc and preserve order within each role. Use Bcc only when hidden distribution is clearly required. Historical patterns contain only redacted routing outcomes; prefer a repeated high-similarity company pattern but flag ambiguity. You are advisory only and cannot send or move email. Do not quote or repeat the message. Confidence must reflect uncertainty independently for action, recipients, and folder.' }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify({
              subject: String(message?.subject || '').slice(0, 500),
              messageText: cleanMessageText(message),
              candidates,
              folders: [{ id: 'keep_current', path: 'Leave in current folder' }, { id: 'archive', path: 'Archive' }, ...folderChoices],
              learnedPatterns: evidence.patterns,
            }) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'fcos_email_router_advisor',
            strict: true,
            schema: emailRouterAdvisorRecommendationSchema(candidates.map((item) => item.id), folderChoices.map((item) => item.id)),
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    await recordUsage(client, profile, mailbox, messageId, null, settings.modelId, Date.now() - startedAt, 'error', 'email_router_advisor_unavailable');
    throw advisorError('Email Router Advisor is temporarily unavailable.', 503, 'EMAIL_ROUTER_ADVISOR_UNAVAILABLE');
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const error = providerFailure(response, failure);
    await recordUsage(client, profile, mailbox, messageId, null, settings.modelId, Date.now() - startedAt, 'error', String(error.code || 'email_router_advisor_failed').toLowerCase());
    throw error;
  }
  const payload = await response.json().catch(() => null);
  const usage = await recordUsage(client, profile, mailbox, messageId, payload, settings.modelId, Date.now() - startedAt, 'success');
  let parsed;
  try { parsed = JSON.parse(outputText(payload)); } catch { throw advisorError('Email Router Advisor returned an invalid recommendation.', 502, 'EMAIL_ROUTER_ADVISOR_RESPONSE_INVALID'); }
  const recommendation = normaliseEmailRouterAdvisorRecommendation(parsed, candidates, folders, evidence);
  const recommendationId = await recordEmailRouterAdvisorRecommendation(client, {
    mailboxId: mailbox.id,
    messageId,
    actorUserId: profile.id,
    recommendation,
  });
  return {
    recommendation: { ...recommendation, recommendationId },
    modelId: settings.modelId,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
    },
  };
}

export const EMAIL_ROUTER_ADVISOR_MODELS = DASHBOARD_AI_MODELS;
