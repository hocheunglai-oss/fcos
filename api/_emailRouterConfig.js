import { DASHBOARD_AI_MODELS, DEFAULT_DASHBOARD_AI_MODEL, isAllowedDashboardAiModel } from './_dashboardAi.js';
import { currentEmailRouterMailbox, emailRouterProfilesById } from './_emailRouterCore.js';

function table(client, name) {
  return client.schema('emailrouter').from(name);
}

function configError(message, status = 400, code = 'EMAIL_ROUTER_CONFIGURATION_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function settingValue(rows, key, fallback) {
  return (rows || []).find((row) => row.key === key)?.value || fallback;
}

function usageTotals(rows) {
  const totals = {};
  for (const row of rows || []) {
    const current = totals[row.model_id] || {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      lastUsedAt: null,
    };
    current.requests += 1;
    current.inputTokens += Number(row.input_tokens || 0);
    current.cachedInputTokens += Number(row.cached_input_tokens || 0);
    current.outputTokens += Number(row.output_tokens || 0);
    current.reasoningTokens += Number(row.reasoning_tokens || 0);
    current.totalTokens += Number(row.total_tokens || 0);
    current.estimatedCostUsd += Number(row.cost_usd || 0);
    current.lastUsedAt = !current.lastUsedAt || row.created_at > current.lastUsedAt ? row.created_at : current.lastUsedAt;
    totals[row.model_id] = current;
  }
  return totals;
}

export async function emailRouterConfiguration(client) {
  const mailbox = await currentEmailRouterMailbox(client);
  const [destinations, groups, presets, settings, subscriptions, alerts, folderCountResults, actions, usage] = await Promise.all([
    table(client, 'destinations')
      .select('id,destination_kind,user_profile_id,nickname,redirect_enabled,active,sort_order,revision,updated_at')
      .eq('destination_kind', 'fcos_profile')
      .eq('active', true)
      .order('nickname'),
    table(client, 'destination_groups').select('id,group_key,display_name,active,revision,updated_at,destination_group_members(destination_id)').order('display_name'),
    table(client, 'routing_presets').select('id,preset_key,display_name,description,active,sort_order,revision,updated_at,routing_preset_destinations(destination_id,group_id,recipient_kind,position)').order('sort_order').order('display_name'),
    table(client, 'settings').select('key,value,revision,updated_at').order('key'),
    table(client, 'mailbox_subscriptions').select('id,resource_key,state,expires_at,lifecycle_event,lifecycle_at,updated_at').eq('mailbox_id', mailbox.id).order('resource_key'),
    table(client, 'alerts').select('id,alert_code,severity,state,created_at').in('state', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(50),
    Promise.all(['inbox', 'sentitems', 'archive'].map(async (folder) => ({
      folder,
      result: await table(client, 'messages').select('id', { count: 'exact', head: true }).eq('mailbox_id', mailbox.id).eq('folder_key', folder).is('deleted_at', null),
    }))),
    table(client, 'mail_actions').select('state').order('created_at', { ascending: false }).limit(1000),
    table(client, 'ai_usage_events').select('model_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,cost_usd,created_at').order('created_at', { ascending: false }).limit(5000),
  ]);
  const failed = [destinations, groups, presets, settings, subscriptions, alerts, ...folderCountResults.map((entry) => entry.result), actions, usage].find((result) => result.error);
  if (failed?.error) throw configError(`Email Router settings could not be loaded: ${failed.error.message}`, 503, 'EMAIL_ROUTER_CONFIGURATION_UNAVAILABLE');

  const folderCounts = Object.fromEntries(folderCountResults.map(({ folder, result }) => [folder, Number(result.count || 0)]));
  const actionCounts = {};
  for (const row of actions.data || []) actionCounts[row.state] = (actionCounts[row.state] || 0) + 1;
  const profiles = await emailRouterProfilesById(client, (destinations.data || []).map((destination) => destination.user_profile_id));
  const advisorSetting = settingValue(settings.data, 'advisor.model', { modelId: DEFAULT_DASHBOARD_AI_MODEL });
  const enabledSetting = settingValue(settings.data, 'advisor.enabled', { enabled: true });
  return {
    mailbox,
    folderCounts,
    actionCounts,
    destinations: (destinations.data || []).map((row) => {
      const profile = profiles.get(row.user_profile_id);
      return {
        id: row.id,
        kind: row.destination_kind,
        userProfileId: row.user_profile_id,
        displayName: profile?.full_name || 'FCOS user',
        emailAddress: profile?.email || null,
        nickname: row.nickname,
        included: row.redirect_enabled === true,
        active: row.active && profile?.active === true,
        sortOrder: row.sort_order,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
      };
    }),
    groups: (groups.data || []).map((row) => ({
      id: row.id,
      key: row.group_key,
      displayName: row.display_name,
      active: row.active,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      destinationIds: (row.destination_group_members || []).map((item) => item.destination_id),
    })),
    presets: (presets.data || []).map((row) => ({
      id: row.id,
      key: row.preset_key,
      displayName: row.display_name,
      description: row.description,
      active: row.active,
      sortOrder: row.sort_order,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      destinations: (row.routing_preset_destinations || []).map((item) => ({
        destinationId: item.destination_id,
        groupId: item.group_id,
        recipientKind: item.recipient_kind,
        position: item.position,
      })),
    })),
    settings: settings.data || [],
    subscriptions: subscriptions.data || [],
    alerts: alerts.data || [],
    advisor: {
      enabled: enabledSetting.enabled !== false,
      modelId: isAllowedDashboardAiModel(advisorSetting.modelId) ? advisorSetting.modelId : DEFAULT_DASHBOARD_AI_MODEL,
      models: DASHBOARD_AI_MODELS,
      usage: usageTotals(usage.data),
      apiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    },
  };
}

export async function saveEmailRouterConfiguration(client, profile, operation = {}) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw configError('A configuration change is required.');
  if (operation.type === 'routing_users_save') {
    const items = Array.isArray(operation.items) ? operation.items : [];
    if (!items.length) throw configError('At least one changed routing user is required.');
    const { data, error } = await client.rpc('save_emailrouter_routing_users', {
      p_items: items,
      p_actor: profile.id,
    });
    if (error) {
      const stale = /revision conflict/i.test(error.message || '');
      throw configError(stale ? 'The routing directory changed after it was loaded. Refresh and try again.' : error.message || 'The routing directory could not be saved.', stale ? 409 : 400, stale ? 'EMAIL_ROUTER_REVISION_CONFLICT' : 'EMAIL_ROUTER_CONFIGURATION_SAVE_FAILED');
    }
    return data;
  }
  if (operation.type === 'destination_save') {
    throw configError('Only active FCOS users can be added to the routing directory.');
  }
  if (operation.type === 'setting_save' && operation.key === 'advisor.model') {
    const modelId = operation.value?.modelId;
    if (!isAllowedDashboardAiModel(modelId)) throw configError('Select a supported Email Router Advisor model.');
  }
  const { data, error } = await client.rpc('save_emailrouter_configuration', {
    p_operation: operation,
    p_actor: profile.id,
  });
  if (error) {
    const stale = /revision conflict/i.test(error.message || '');
    throw configError(stale ? 'This Email Router setting changed after it was loaded. Refresh and try again.' : error.message || 'Email Router configuration could not be saved.', stale ? 409 : 400, stale ? 'EMAIL_ROUTER_REVISION_CONFLICT' : 'EMAIL_ROUTER_CONFIGURATION_SAVE_FAILED');
  }
  return data;
}
