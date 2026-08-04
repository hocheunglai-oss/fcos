function cleanIds(values, limit = 100) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function collaborationNotification(row) {
  return {
    id: `collaboration:${row.id}`,
    source: 'collaboration',
    sourceId: row.item_id,
    type: row.notification_type,
    title: row.title,
    message: row.message || '',
    link: `/projects-tasks?item=${encodeURIComponent(row.item_id)}`,
    readAt: row.read_at || null,
    handledAt: row.handled_at || null,
    snoozedUntil: row.snoozed_until || null,
    createdAt: row.created_at,
  };
}

function growthNotification(row) {
  return {
    id: `growth:${row.id}`,
    source: 'growth_coaching',
    sourceId: row.source_id || null,
    type: row.notification_type,
    title: row.title,
    message: row.message || '',
    link: row.link || '/growth-coaching',
    readAt: row.read_at || null,
    handledAt: row.handled_at || null,
    snoozedUntil: row.snoozed_until || null,
    createdAt: row.created_at,
  };
}

function emailRouterNotification(row, state = {}) {
  const title = row.severity === 'critical' ? 'Email Router action needs review' : 'Email Router warning';
  return {
    id: `email_router:${row.id}`,
    source: 'email_router',
    sourceId: row.id,
    type: row.alert_code,
    title,
    message: String(row.alert_code || 'mailbox_warning').replaceAll('_', ' ').replaceAll('.', ' '),
    link: '/email-router',
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.created_at,
  };
}

function systemErrorNotification(row, state = {}) {
  const occurrenceCount = Math.max(1, Number(row.occurrence_count || 1));
  return {
    id: `system_error:${row.id}`,
    source: 'system_error',
    sourceId: row.id,
    type: 'operational_error',
    title: row.title,
    message: `${row.message || 'An unexpected FCOS error was recorded.'}${occurrenceCount > 1 ? ` Repeated ${occurrenceCount.toLocaleString()} times.` : ''}`,
    link: row.link || '/',
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.last_seen_at || row.created_at,
  };
}

function notificationVisible(row, body, now) {
  const state = String(body.state || 'active');
  const snoozed = row.snoozedUntil && row.snoozedUntil > now;
  if (state === 'active' && (row.handledAt || snoozed)) return false;
  if (state === 'unread' && (row.readAt || row.handledAt || snoozed)) return false;
  if (state === 'handled' && !row.handledAt) return false;
  if (state === 'snoozed' && !snoozed) return false;
  if (body.source && body.source !== 'all' && row.source !== body.source) return false;
  if (body.type && body.type !== 'all' && row.type !== body.type) return false;
  return true;
}

function unavailableTable(error) {
  return error?.code === '42P01' || /does not exist|schema cache/i.test(String(error?.message || ''));
}

export async function workNotificationsList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const limit = Math.max(10, Math.min(Number(body.limit) || 50, 100));
  const queryLimit = Math.min(200, limit * 4);
  const now = new Date().toISOString();
  const systemWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const router = client.schema('emailrouter');
  const [collaborationResult, growthResult, collaborationCount, growthCount, emailRouterAlerts, emailRouterStates, systemEvents, systemStates] = await Promise.all([
    client.from('collaboration_notifications').select('id,item_id,notification_type,title,message,read_at,handled_at,snoozed_until,created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(queryLimit),
    client.from('growth_notifications').select('id,source_type,source_id,notification_type,title,message,link,read_at,handled_at,snoozed_until,created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(queryLimit),
    client.from('collaboration_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    client.from('growth_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    router.from('alerts').select('id,alert_code,severity,state,created_at').in('state', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(queryLimit),
    router.from('alert_notification_states').select('alert_id,read_at,handled_at,snoozed_until').eq('user_id', profile.id),
    client.from('system_error_events').select('id,title,message,link,occurrence_count,created_at,last_seen_at').gte('last_seen_at', systemWindow).order('last_seen_at', { ascending: false }).limit(queryLimit),
    client.from('system_error_notification_states').select('event_id,read_at,handled_at,snoozed_until').eq('user_id', profile.id),
  ]);

  const unavailableSources = [];
  if (collaborationResult.error) {
    if (!unavailableTable(collaborationResult.error)) throw collaborationResult.error;
    unavailableSources.push('Projects & Tasks');
  }
  if (growthResult.error) {
    if (!unavailableTable(growthResult.error)) throw growthResult.error;
    unavailableSources.push('Growth & Coaching');
  }
  if (collaborationCount.error && !unavailableTable(collaborationCount.error)) throw collaborationCount.error;
  if (growthCount.error && !unavailableTable(growthCount.error)) throw growthCount.error;
  if (emailRouterAlerts.error) {
    if (!unavailableTable(emailRouterAlerts.error)) throw emailRouterAlerts.error;
    unavailableSources.push('Email Router');
  }
  if (emailRouterStates.error && !unavailableTable(emailRouterStates.error)) throw emailRouterStates.error;
  if (systemEvents.error) {
    if (!unavailableTable(systemEvents.error)) throw systemEvents.error;
    unavailableSources.push('System');
  }
  if (systemStates.error && !unavailableTable(systemStates.error)) throw systemStates.error;

  const routerStateByAlert = new Map((emailRouterStates.data || []).map((row) => [row.alert_id, row]));
  const routerNotifications = (emailRouterAlerts.data || []).map((row) => emailRouterNotification(row, routerStateByAlert.get(row.id)));
  const systemStateByEvent = new Map((systemStates.data || []).map((row) => [row.event_id, row]));
  const systemNotifications = (systemEvents.data || []).map((row) => systemErrorNotification(row, systemStateByEvent.get(row.id)));

  const notifications = [...(collaborationResult.data || []).map(collaborationNotification), ...(growthResult.data || []).map(growthNotification), ...routerNotifications, ...systemNotifications]
    .filter((row) => notificationVisible(row, body, now))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);

  return {
    notifications,
    unreadCount: Number(collaborationCount.count || 0) + Number(growthCount.count || 0) + [...routerNotifications, ...systemNotifications].filter((row) => !row.readAt && !row.handledAt && (!row.snoozedUntil || row.snoozedUntil <= now)).length,
    unavailableSources,
    filters: {
      source: body.source || 'all',
      state: body.state || 'active',
      type: body.type || 'all',
    },
  };
}

export async function workNotificationsRead(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const ids = cleanIds(body.notificationIds);
  const collaborationIds = ids.filter((value) => value.startsWith('collaboration:')).map((value) => value.slice('collaboration:'.length));
  const growthIds = ids.filter((value) => value.startsWith('growth:')).map((value) => value.slice('growth:'.length));
  let emailRouterIds = ids.filter((value) => value.startsWith('email_router:')).map((value) => value.slice('email_router:'.length));
  let systemErrorIds = ids.filter((value) => value.startsWith('system_error:')).map((value) => value.slice('system_error:'.length));
  const readAt = new Date().toISOString();

  const updateTable = async (table, selectedIds) => {
    let query = client.from(table).update({ read_at: readAt }).eq('user_id', profile.id).is('read_at', null);
    if (ids.length) {
      if (!selectedIds.length) return;
      query = query.in('id', selectedIds);
    }
    const { error } = await query;
    if (error && !unavailableTable(error)) throw error;
  };

  if (!ids.length) {
    const [routerResult, systemResult] = await Promise.all([
      client.schema('emailrouter').from('alerts').select('id').in('state', ['open', 'acknowledged']),
      client.from('system_error_events').select('id').gte('last_seen_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
    if (routerResult.error && !unavailableTable(routerResult.error)) throw routerResult.error;
    if (systemResult.error && !unavailableTable(systemResult.error)) throw systemResult.error;
    emailRouterIds = (routerResult.data || []).map((row) => row.id);
    systemErrorIds = (systemResult.data || []).map((row) => row.id);
  }
  const markEmailRouterRead = async () => {
    if (!emailRouterIds.length) return;
    const { error } = await client.schema('emailrouter').from('alert_notification_states').upsert(emailRouterIds.map((alertId) => ({
      alert_id: alertId,
      user_id: profile.id,
      read_at: readAt,
      updated_at: readAt,
    })), { onConflict: 'alert_id,user_id' });
    if (error && !unavailableTable(error)) throw error;
  };

  const markSystemErrorsRead = async () => {
    if (!systemErrorIds.length) return;
    const { error } = await client.from('system_error_notification_states').upsert(systemErrorIds.map((eventId) => ({
      event_id: eventId,
      user_id: profile.id,
      read_at: readAt,
      updated_at: readAt,
    })), { onConflict: 'event_id,user_id' });
    if (error && !unavailableTable(error)) throw error;
  };

  await Promise.all([updateTable('collaboration_notifications', collaborationIds), updateTable('growth_notifications', growthIds), markEmailRouterRead(), markSystemErrorsRead()]);
  return workNotificationsList({ limit: body.limit }, accessContext);
}

export async function workNotificationsState(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const ids = cleanIds(body.notificationIds);
  if (!ids.length)
    throw Object.assign(new Error('Select at least one notification.'), {
      status: 400,
    });
  const state = String(body.state || '')
    .trim()
    .toLowerCase();
  if (!['read', 'unread', 'handled', 'unhandled', 'snoozed'].includes(state)) {
    throw Object.assign(new Error('Select a valid notification action.'), {
      status: 400,
    });
  }
  let snoozedUntil = null;
  if (state === 'snoozed') {
    const parsed = new Date(body.snoozedUntil || '');
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw Object.assign(new Error('Choose a future time for the reminder.'), {
        status: 400,
      });
    }
    snoozedUntil = parsed.toISOString();
  }

  const groups = [
    ['collaboration', ids.filter((value) => value.startsWith('collaboration:')).map((value) => value.slice(14))],
    ['growth', ids.filter((value) => value.startsWith('growth:')).map((value) => value.slice(7))],
    ['email_router', ids.filter((value) => value.startsWith('email_router:')).map((value) => value.slice('email_router:'.length))],
    ['system_error', ids.filter((value) => value.startsWith('system_error:')).map((value) => value.slice('system_error:'.length))],
  ];
  let updated = 0;
  for (const [source, sourceIds] of groups) {
    if (!sourceIds.length) continue;
    if (source === 'email_router' || source === 'system_error') {
      const current = new Date().toISOString();
      const values = sourceIds.map((sourceId) => ({
        [source === 'email_router' ? 'alert_id' : 'event_id']: sourceId,
        user_id: profile.id,
        read_at: state === 'unread' ? null : current,
        handled_at: state === 'handled' ? current : state === 'unhandled' ? null : undefined,
        snoozed_until: state === 'snoozed' ? snoozedUntil : null,
        updated_at: current,
      })).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
      const target = source === 'email_router' ? client.schema('emailrouter').from('alert_notification_states') : client.from('system_error_notification_states');
      const { error } = await target.upsert(values, { onConflict: source === 'email_router' ? 'alert_id,user_id' : 'event_id,user_id' });
      if (error) throw error;
      updated += values.length;
      continue;
    }
    const { data, error } = await client.rpc('set_work_notification_state', {
      p_source: source,
      p_notification_ids: sourceIds,
      p_user_id: profile.id,
      p_state: state,
      p_snoozed_until: snoozedUntil,
    });
    if (error) throw error;
    updated += Number(data || 0);
  }

  return {
    ...(await workNotificationsList(
      {
        limit: body.limit,
        source: body.source,
        state: body.listState,
        type: body.type,
      },
      accessContext,
    )),
    updated,
  };
}
