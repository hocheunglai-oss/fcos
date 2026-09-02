function incidentKey(notification) {
  if (!['system', 'system_error'].includes(notification?.source)) return `notification:${notification?.id || ''}`;
  const signature = String(notification.incidentSignature || notification.diagnosticRef || '').trim().toLowerCase();
  if (signature) return `incident:${signature}`;
  return `incident:${notification.source}:${notification.title || ''}:${notification.link || ''}`;
}

export function groupWorkNotifications(notifications = []) {
  const groups = new Map();
  for (const notification of notifications) {
    const key = incidentKey(notification);
    const current = groups.get(key);
    const rowOccurrenceCount = Math.max(1, Number(notification?.occurrenceCount || 1));
    if (!current) {
      groups.set(key, {
        ...notification,
        groupKey: key,
        notificationIds: [notification.id].filter(Boolean),
        occurrenceCount: rowOccurrenceCount,
        unreadOccurrenceCount: notification.readAt ? 0 : rowOccurrenceCount,
      });
      continue;
    }
    current.notificationIds.push(notification.id);
    current.occurrenceCount += rowOccurrenceCount;
    if (!notification.readAt) current.unreadOccurrenceCount += rowOccurrenceCount;
    if (String(notification.createdAt || '') > String(current.createdAt || '')) {
      const preserved = {
        notificationIds: current.notificationIds,
        occurrenceCount: current.occurrenceCount,
        unreadOccurrenceCount: current.unreadOccurrenceCount,
        groupKey: current.groupKey,
      };
      Object.assign(current, notification, preserved);
    }
    if (current.unreadOccurrenceCount > 0) current.readAt = null;
  }
  return [...groups.values()];
}

export const workNotificationGroupInternals = { incidentKey };
