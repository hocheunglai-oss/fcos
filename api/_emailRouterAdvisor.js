import { createHash } from 'node:crypto';
import {
  DASHBOARD_AI_MODELS,
  DEFAULT_DASHBOARD_AI_MODEL,
  dashboardAiUsageFromResponse,
  isAllowedDashboardAiModel,
} from './_dashboardAi.js';
import { fetchEmailRouterDetail, listEmailRouterDirectory } from './_emailRouterCore.js';

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
  const { data, error } = await table(client, 'settings').select('key,value').in('key', ['advisor.enabled', 'advisor.model']);
  if (error) throw advisorError('Email Router Advisor settings are unavailable.', 503, 'EMAIL_ROUTER_ADVISOR_SETTINGS_UNAVAILABLE');
  const settings = new Map((data || []).map((row) => [row.key, row.value]));
  const requestedModel = settings.get('advisor.model')?.modelId;
  return {
    enabled: settings.get('advisor.enabled')?.enabled !== false,
    modelId: isAllowedDashboardAiModel(requestedModel) ? requestedModel : DEFAULT_DASHBOARD_AI_MODEL,
  };
}

function recommendationSchema(candidateIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['destinationIds', 'confidence', 'rationale', 'question'],
    properties: {
      destinationIds: {
        type: 'array',
        minItems: 0,
        maxItems: 3,
        uniqueItems: true,
        items: { type: 'string', enum: candidateIds },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', maxLength: 500 },
      question: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
    },
  };
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
  const [message, directory] = await Promise.all([
    fetchEmailRouterDetail({ client, mailbox, messageId }, dependencies),
    listEmailRouterDirectory({ client }),
  ]);
  const candidates = directory.slice(0, 100).map((item) => ({ id: item.id, label: item.label }));
  if (!candidates.length) throw advisorError('No active Email Router destinations are available.', 409, 'EMAIL_ROUTER_ADVISOR_DIRECTORY_EMPTY');
  const startedAt = Date.now();
  let response;
  try {
    response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.modelId,
        store: false,
        max_output_tokens: 500,
        safety_identifier: createHash('sha256').update(String(profile.id)).digest('hex'),
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: 'You are FCOS Email Router Advisor. Recommend at most three approved routing destinations using only supplied candidate IDs. You are advisory only and cannot send, redirect, reply, forward, move, archive, or delete email. Do not quote or closely repeat the message. If confidence is below 0.50, return no destination and one concise optional clarification question.' }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify({ subject: String(message?.subject || '').slice(0, 500), messageText: cleanMessageText(message), candidates }) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'fcos_email_router_advisor',
            strict: true,
            schema: recommendationSchema(candidates.map((item) => item.id)),
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    await recordUsage(client, profile, mailbox, messageId, null, settings.modelId, Date.now() - startedAt, 'error', 'email_router_advisor_unavailable');
    throw advisorError('Email Router Advisor is temporarily unavailable.', 503, 'EMAIL_ROUTER_ADVISOR_UNAVAILABLE');
  }
  if (!response.ok) {
    await recordUsage(client, profile, mailbox, messageId, null, settings.modelId, Date.now() - startedAt, 'error', 'email_router_advisor_failed');
    throw advisorError('Email Router Advisor is temporarily unavailable.', response.status === 429 ? 503 : 502, 'EMAIL_ROUTER_ADVISOR_FAILED');
  }
  const payload = await response.json().catch(() => null);
  const usage = await recordUsage(client, profile, mailbox, messageId, payload, settings.modelId, Date.now() - startedAt, 'success');
  let parsed;
  try { parsed = JSON.parse(outputText(payload)); } catch { throw advisorError('Email Router Advisor returned an invalid recommendation.', 502, 'EMAIL_ROUTER_ADVISOR_RESPONSE_INVALID'); }
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const destinationIds = [...new Set(Array.isArray(parsed.destinationIds) ? parsed.destinationIds : [])].filter((id) => byId.has(id)).slice(0, 3);
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
  return {
    recommendation: {
      destinations: confidence < 0.5 ? [] : destinationIds.map((id) => byId.get(id)),
      confidence,
      rationale: String(parsed.rationale || '').trim().slice(0, 500),
      question: parsed.question ? String(parsed.question).trim().slice(0, 300) : null,
    },
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
