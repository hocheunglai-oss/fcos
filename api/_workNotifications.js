function cleanIds(values, limit = 100) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].slice(0, limit);
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
    createdAt: row.created_at,
  };
}

function unavailableTable(error) {
  return error?.code === '42P01' || /does not exist|schema cache/i.test(String(error?.message || ''));
}

export async function workNotificationsList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const limit = Math.max(10, Math.min(Number(body.limit) || 50, 100));
  const queryLimit = Math.min(100, limit * 2);
  const [collaborationResult, growthResult, collaborationCount, growthCount] = await Promise.all([
    client
      .from('collaboration_notifications')
      .select('id,item_id,notification_type,title,message,read_at,created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(queryLimit),
    client
      .from('growth_notifications')
      .select('id,source_type,source_id,notification_type,title,message,link,read_at,created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(queryLimit),
    client
      .from('collaboration_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .is('read_at', null),
    client
      .from('growth_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .is('read_at', null),
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

  const notifications = [
    ...(collaborationResult.data || []).map(collaborationNotification),
    ...(growthResult.data || []).map(growthNotification),
  ]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);

  return {
    notifications,
    unreadCount: Number(collaborationCount.count || 0) + Number(growthCount.count || 0),
    unavailableSources,
  };
}

export async function workNotificationsRead(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const ids = cleanIds(body.notificationIds);
  const collaborationIds = ids
    .filter((value) => value.startsWith('collaboration:'))
    .map((value) => value.slice('collaboration:'.length));
  const growthIds = ids
    .filter((value) => value.startsWith('growth:'))
    .map((value) => value.slice('growth:'.length));
  const readAt = new Date().toISOString();

  const updateTable = async (table, selectedIds) => {
    let query = client
      .from(table)
      .update({ read_at: readAt })
      .eq('user_id', profile.id)
      .is('read_at', null);
    if (ids.length) {
      if (!selectedIds.length) return;
      query = query.in('id', selectedIds);
    }
    const { error } = await query;
    if (error && !unavailableTable(error)) throw error;
  };

  await Promise.all([
    updateTable('collaboration_notifications', collaborationIds),
    updateTable('growth_notifications', growthIds),
  ]);
  return workNotificationsList({ limit: body.limit }, accessContext);
}
