import {
  DASHBOARD_AI_MODELS,
  DEFAULT_DASHBOARD_AI_MODEL,
  dashboardAiUsageFromResponse,
  isAllowedDashboardAiModel,
} from './_dashboardAi.js';

function assistantError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-12).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.content || '').trim().slice(0, 2000),
  })).filter((message) => message.content);
}

function compactRows(rows, fields, limit) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row) => Object.fromEntries(
    fields.filter((field) => row?.[field] !== undefined).map((field) => [field, row[field]]),
  ));
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  return (payload?.output || []).flatMap((item) => item?.content || []).filter((item) => item?.type === 'output_text').map((item) => item.text).join('\n').trim();
}

async function modelSetting(client) {
  const { data, error } = await client.from('hedge_settings').select('value').eq('key', 'assistant_model').maybeSingle();
  if (error) throw assistantError(`Trading Assistant model setting could not be loaded: ${error.message}`, 502);
  const requested = typeof data?.value === 'string' ? data.value : data?.value?.modelId;
  return isAllowedDashboardAiModel(requested) ? requested : DEFAULT_DASHBOARD_AI_MODEL;
}

export async function runHedgeAssistant(client, profile, body = {}, dependencies = {}) {
  const messages = cleanMessages(body.messages);
  if (!messages.length) throw assistantError('Enter a question for the Trading Assistant.', 400);
  const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw assistantError('The protected OpenAI service is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
  const model = await modelSetting(client);
  const context = {
    physicalTrades: compactRows(body.physicals, ['product', 'qty_min', 'qty_max', 'sell_price', 'buy_price', 'sell_pricing_month', 'buy_pricing_month', 'delivery_date_from', 'counterparty', 'vessel_name', 'trade_date', 'is_closed'], 30),
    paperHedges: compactRows(body.swaps, ['product', 'direction', 'swap_month', 'quantity', 'unit', 'price', 'venue', 'broker', 'trade_type', 'is_expired', 'trade_date', 'live_mtm'], 50),
    recentMarkets: compactRows(body.mops, ['price_date', 's380', 's05', 'sgo'], 20),
  };
  const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'developer',
          content: 'You are the FCOS Hedge Desk trading assistant. Use only the compact book and market summary supplied. Explain assumptions, quantify exposures when possible, and never claim to execute a trade. Do not infer or request customer identities, email addresses, Salesforce IDs, secrets, or user data. Keep the answer concise and operational.',
        },
        { role: 'developer', content: `Current compact Hedge Desk summary:\n${JSON.stringify(context)}` },
        ...messages,
      ],
      max_output_tokens: 900,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) {
    const status = response?.status === 429 ? 503 : response?.status || 503;
    throw assistantError(response?.status === 429 ? 'The Trading Assistant is temporarily busy. Try again shortly.' : 'The Trading Assistant is unavailable.', status, 'HEDGE_ASSISTANT_FAILED');
  }
  const payload = await response.json();
  const reply = responseText(payload);
  if (!reply) throw assistantError('The Trading Assistant returned no answer.', 502);
  const usage = dashboardAiUsageFromResponse(payload, model);
  await client.from('hedge_ai_usage_events').insert({
    actor_user_id: profile.id,
    model_id: model,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
    request_id: payload.id || null,
  }).then(({ error }) => {
    if (error) console.warn('[hedge-assistant] Usage event could not be recorded.', { code: error.code || 'HEDGE_AI_USAGE_FAILED' });
  });
  return { ok: true, reply, model, usage };
}

export async function hedgeAssistantSettings(client) {
  const modelId = await modelSetting(client);
  const { data: usage, error } = await client.from('hedge_ai_usage_events').select('model_id,input_tokens,cached_input_tokens,output_tokens,estimated_cost_usd,created_at').order('created_at', { ascending: false }).limit(1000);
  if (error) throw assistantError(`Trading Assistant usage could not be loaded: ${error.message}`, 502);
  const totals = new Map();
  for (const row of usage || []) {
    const current = totals.get(row.model_id) || { requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    current.requests += 1;
    current.inputTokens += Number(row.input_tokens || 0);
    current.cachedInputTokens += Number(row.cached_input_tokens || 0);
    current.outputTokens += Number(row.output_tokens || 0);
    current.estimatedCostUsd += Number(row.estimated_cost_usd || 0);
    totals.set(row.model_id, current);
  }
  return {
    modelId,
    models: DASHBOARD_AI_MODELS,
    apiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    usage: Object.fromEntries(totals),
  };
}
