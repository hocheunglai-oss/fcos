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
  const [collaborationResult, growthResult, collaborationCount, growthCount] = await Promise.all([client.from('collaboration_notifications').select('id,item_id,notification_type,title,message,read_at,handled_at,snoozed_until,created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(queryLimit), client.from('growth_notifications').select('id,source_type,source_id,notification_type,title,message,link,read_at,handled_at,snoozed_until,created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(queryLimit), client.from('collaboration_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`), client.from('growth_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`)]);

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

  const notifications = [...(collaborationResult.data || []).map(collaborationNotification), ...(growthResult.data || []).map(growthNotification)]
    .filter((row) => notificationVisible(row, body, now))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);

  return {
    notifications,
    unreadCount: Number(collaborationCount.count || 0) + Number(growthCount.count || 0),
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

  await Promise.all([updateTable('collaboration_notifications', collaborationIds), updateTable('growth_notifications', growthIds)]);
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
  ];
  let updated = 0;
  for (const [source, sourceIds] of groups) {
    if (!sourceIds.length) continue;
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
