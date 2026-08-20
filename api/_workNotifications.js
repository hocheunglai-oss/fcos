import { validSystemErrorSignature } from './_systemErrorNotifications.js';
import { listSpecialTermApprovalQueue, listSpecialTermClauseConsolidations } from './_specialTermClauses.js';

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

function improvementNotification(row) {
  return {
    id: `fcos_improvements:${row.id}`,
    source: 'fcos_improvements',
    sourceId: row.ticket_id,
    type: row.notification_type,
    title: row.title,
    message: row.message || '',
    link: `/fcos-improvements?ticket=${encodeURIComponent(row.ticket_id)}`,
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

function marketIntelligenceNotification(row, state = {}) {
  const sourceSeverity = String(row.severity || '').trim().toLowerCase();
  const severity = ['critical', 'error'].includes(sourceSeverity)
    ? 'critical'
    : ['warning', 'high'].includes(sourceSeverity) ? 'warning' : 'info';
  return {
    id: `market_intelligence:${row.id}`,
    source: 'markets',
    sourceId: row.series_id || row.report_id || row.id,
    type: row.alert_type || 'market_alert',
    severity,
    title: row.title || (severity === 'critical' ? 'Market data needs review' : 'Market intelligence alert'),
    message: row.message || 'Review the affected market series and its source evidence.',
    link: '/markets?tab=drivers',
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.created_at,
  };
}

function systemErrorNotification(row, state = {}) {
  const occurrenceCount = Math.max(1, Number(row.occurrence_count || 1));
  const verificationHandlers = new Set([
    'outstandingBuyerInvoicesEmailReport',
    'outstandingBuyerInvoicesEmailCron',
    'incomingPaymentEmailReport',
    'buyerInvoicePaymentReminderSend',
    'disputeWorkflowList',
    'workNotificationsList',
    'specialTermsWorkspace',
    'hedgeDeskSalesforceMapping',
    'emailRouterMaintenanceCron',
    'salesforceQuery',
  ]);
  return {
    id: `system_error:${row.id}`,
    source: 'system_error',
    sourceId: row.id,
    type: 'operational_error',
    severity: 'critical',
    title: row.title,
    message: `${row.message || 'An unexpected FCOS error was recorded.'}${occurrenceCount > 1 ? ` Repeated ${occurrenceCount.toLocaleString()} times.` : ''}`,
    link: row.link || '/',
    occurrenceCount,
    diagnosticRef: row.last_request_id || null,
    incidentSignature: row.dedupe_key || null,
    verificationAvailable: verificationHandlers.has(row.handler) && validSystemErrorSignature(row.dedupe_key),
    outcome: 'Completion not confirmed',
    retryAvailable: Boolean(row.link),
    actionLabel: row.link ? 'Review affected workspace before retrying' : 'Review error details',
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.last_seen_at || row.created_at,
  };
}

function variableChargeNotification(row, state = {}) {
  const notificationKey = `${row.id}:${row.revision}:${row.workflow_status}`;
  const postInvoice = row.workflow_status === 'post_invoice_change';
  const needsAction = row.workflow_status === 'needs_action';
  return {
    id: `variable_charges:${notificationKey}`,
    source: 'variable_charges',
    sourceId: row.id,
    type: postInvoice ? 'post_invoice_change' : row.workflow_status,
    severity: postInvoice ? 'critical' : 'warning',
    title: postInvoice ? 'Urgent Variable Charges post-invoice change' : needsAction ? 'Variable Charges need review' : 'Variable Charges ready for invoice',
    message: postInvoice
      ? `${row.stem_name || row.stem_id} changed after its final buyer invoice and needs a documented resolution.`
      : needsAction
        ? `${row.stem_name || row.stem_id} is assigned to you for row-by-row review and confirmation.`
        : `${row.stem_name || row.stem_id} passed row review and is ready for Finance invoice processing.`,
    link: `/payment-collections?tab=variable-charges&stemId=${encodeURIComponent(row.stem_id)}`,
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.updated_at,
  };
}

function variableChargeSupplierNotification(row, state = {}) {
  const notificationKey = `${row.case_id}:supplier:${row.id}:${row.revision}:${row.status}`;
  const invalidated = row.status === 'invalidated';
  return {
    id: `variable_charges:${notificationKey}`,
    source: 'variable_charges',
    sourceId: row.case_id,
    type: invalidated ? 'supplier_reverification_required' : 'supplier_verification_required',
    severity: invalidated ? 'critical' : 'warning',
    title: invalidated ? 'Supplier charges need reverification' : 'Final supplier charges need verification',
    message: `${row.variable_charge_cases?.stem_name || row.stem_id} requires your exact-supplier charge review before its Supplier Invoice can be created.`,
    link: `/payment-collections?tab=variable-charges&stemId=${encodeURIComponent(row.stem_id)}&supplierId=${encodeURIComponent(row.supplier_account_id)}`,
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.updated_at,
  };
}

function specialTermsNotification(row, state = {}) {
  const revisionToken = row.revisionId || row.updatedAt || 'draft';
  return {
    id: `special_terms:${row.termId}:${revisionToken}`,
    source: 'special_terms',
    sourceId: row.termId,
    type: 'approval_required',
    severity: 'warning',
    title: `${row.termName || 'Special Term'} needs approval`,
    message: 'A whole-term revision is waiting for General Manager or Administrator review.',
    link: `/special-terms?termId=${encodeURIComponent(row.termId)}&tab=migration`,
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: row.updatedAt,
  };
}

function specialTermsRelinkNotification(consolidation, term, state = {}) {
  const notificationKey = `relink:${consolidation.id}:${term.termId}:${term.revisionId || term.termLastModifiedAt || 'live'}`;
  return {
    id: `special_terms:${notificationKey}`,
    source: 'special_terms',
    sourceId: term.termId,
    type: term.revisionState === 'Awaiting Approval' ? 'relink_approval_required' : 'clause_relink_required',
    severity: term.revisionState === 'Conflict' ? 'critical' : 'warning',
    title: `${term.termName || 'Special Term'} needs clause relinking`,
    message: `${consolidation.sourceShortName} is being consolidated into ${consolidation.replacementShortName}. Review the governed whole-term replacement.`,
    link: `/special-terms?termId=${encodeURIComponent(term.termId)}&tab=terms&consolidationId=${encodeURIComponent(consolidation.id)}`,
    readAt: state.read_at || null,
    handledAt: state.handled_at || null,
    snoozedUntil: state.snoozed_until || null,
    createdAt: term.revisionLastModifiedAt || term.termLastModifiedAt || consolidation.lastModifiedAt,
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

function unavailableSnapshotFunction(error) {
  return unavailableTable(error)
    || ['42883', '57014', 'PGRST202'].includes(String(error?.code || '').toUpperCase())
    || /load_work_notification_snapshot/i.test(String(error?.message || ''));
}

async function loadLegacyDatabaseSnapshot(client, profileId, queryLimit, now, systemWindow) {
  const router = client.schema('emailrouter');
  const [collaborationResult, growthResult, improvementsResult, collaborationCount, growthCount, improvementsCount, emailRouterAlerts, emailRouterStates, systemEvents, systemStates, variableChargeCases, variableChargeSupplierStages, variableChargeStates, generalManagerRoles, specialTermsStates] = await Promise.all([
    client.from('collaboration_notifications').select('id,item_id,notification_type,title,message,read_at,handled_at,snoozed_until,created_at').eq('user_id', profileId).order('created_at', { ascending: false }).limit(queryLimit),
    client.from('growth_notifications').select('id,source_type,source_id,notification_type,title,message,link,read_at,handled_at,snoozed_until,created_at').eq('user_id', profileId).order('created_at', { ascending: false }).limit(queryLimit),
    client.from('fcos_improvement_notifications').select('id,ticket_id,notification_type,title,message,read_at,handled_at,snoozed_until,created_at').eq('user_id', profileId).order('created_at', { ascending: false }).limit(queryLimit),
    client.from('collaboration_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profileId).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    client.from('growth_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profileId).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    client.from('fcos_improvement_notifications').select('id', { count: 'exact', head: true }).eq('user_id', profileId).is('read_at', null).is('handled_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    router.from('alerts').select('id,alert_code,severity,state,created_at').in('state', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(queryLimit),
    router.from('alert_notification_states').select('alert_id,read_at,handled_at,snoozed_until').eq('user_id', profileId),
    client.from('system_error_events').select('id,dedupe_key,handler,title,message,link,occurrence_count,last_request_id,created_at,last_seen_at').gte('last_seen_at', systemWindow).order('last_seen_at', { ascending: false }).limit(queryLimit),
    client.from('system_error_notification_states').select('event_id,read_at,handled_at,snoozed_until').eq('user_id', profileId),
    client.from('variable_charge_cases').select('id,stem_id,stem_name,workflow_status,assigned_buyer_user_id,revision,due_date,updated_at').in('workflow_status', ['needs_action', 'ready_for_invoice', 'post_invoice_change']).order('updated_at', { ascending: false }).limit(queryLimit),
    client.from('variable_charge_supplier_stages').select('id,case_id,stem_id,supplier_account_id,status,revision,updated_at,variable_charge_cases(stem_name,due_date)').eq('assigned_supplier_user_id', profileId).in('status', ['pending', 'invalidated']).order('updated_at', { ascending: false }).limit(queryLimit),
    client.from('variable_charge_notification_states').select('notification_key,case_id,read_at,handled_at,snoozed_until').eq('user_id', profileId),
    client.from('collaboration_roles').select('user_id').eq('role', 'general_manager').eq('active', true),
    client.from('special_terms_notification_states').select('notification_key,read_at,handled_at,snoozed_until').eq('user_id', profileId),
  ]);
  return {
    collaborationResult,
    growthResult,
    improvementsResult,
    collaborationCount,
    growthCount,
    improvementsCount,
    emailRouterAlerts,
    emailRouterStates,
    systemEvents,
    systemStates,
    variableChargeCases,
    variableChargeSupplierStages,
    variableChargeStates,
    generalManagerRoles,
    specialTermsStates,
  };
}

function snapshotRows(snapshot, key) {
  return { data: Array.isArray(snapshot?.[key]) ? snapshot[key] : [], error: null };
}

async function loadDatabaseSnapshot(client, profileId, queryLimit, now, systemWindow) {
  const { data, error } = await client.rpc('load_work_notification_snapshot', {
    p_user_id: profileId,
    p_query_limit: queryLimit,
    p_now: now,
    p_system_window: systemWindow,
  });
  if (error) {
    if (!unavailableSnapshotFunction(error)) throw error;
    return loadLegacyDatabaseSnapshot(client, profileId, queryLimit, now, systemWindow);
  }
  return {
    collaborationResult: snapshotRows(data, 'collaboration'),
    growthResult: snapshotRows(data, 'growth'),
    improvementsResult: snapshotRows(data, 'improvements'),
    collaborationCount: { count: Number(data?.collaborationUnread || 0), error: null },
    growthCount: { count: Number(data?.growthUnread || 0), error: null },
    improvementsCount: { count: Number(data?.improvementsUnread || 0), error: null },
    emailRouterAlerts: snapshotRows(data, 'emailRouterAlerts'),
    emailRouterStates: snapshotRows(data, 'emailRouterStates'),
    systemEvents: snapshotRows(data, 'systemEvents'),
    systemStates: snapshotRows(data, 'systemStates'),
    variableChargeCases: snapshotRows(data, 'variableChargeCases'),
    variableChargeSupplierStages: snapshotRows(data, 'variableChargeSupplierStages'),
    variableChargeStates: snapshotRows(data, 'variableChargeStates'),
    generalManagerRoles: snapshotRows(data, 'generalManagerRoles'),
    specialTermsStates: snapshotRows(data, 'specialTermsStates'),
  };
}

export async function workNotificationsList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const canViewMarkets = accessContext?.capabilities?.markets === true;
  const limit = Math.max(10, Math.min(Number(body.limit) || 50, 100));
  const queryLimit = Math.min(200, limit * 4);
  const now = new Date().toISOString();
  const systemWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [databaseSnapshot, specialTermsQueue, specialTermsConsolidationQueue, marketAlertEvents] = await Promise.all([
    loadDatabaseSnapshot(client, profile.id, queryLimit, now, systemWindow),
    listSpecialTermApprovalQueue({ limit: queryLimit }).then((data) => ({ data: data.items || [], error: null })).catch((error) => ({ data: [], error })),
    listSpecialTermClauseConsolidations({ includeClosed: false }).then((data) => ({ data: data.consolidations || [], error: null })).catch((error) => ({ data: [], error })),
    canViewMarkets
      ? client.from('market_intelligence_alert_events').select('id,report_id,series_id,alert_type,severity,title,message,created_at').order('created_at', { ascending: false }).limit(queryLimit)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const marketAlertIds = (marketAlertEvents.data || []).map((row) => row.id).filter(Boolean);
  const marketAlertStates = canViewMarkets && marketAlertIds.length
    ? await client.from('market_intelligence_alert_notification_states')
      .select('alert_event_id,read_at,handled_at,snoozed_until')
      .eq('user_id', profile.id)
      .in('alert_event_id', marketAlertIds)
    : { data: [], error: null };
  const {
    collaborationResult,
    growthResult,
    improvementsResult,
    collaborationCount,
    growthCount,
    improvementsCount,
    emailRouterAlerts,
    emailRouterStates,
    systemEvents,
    systemStates,
    variableChargeCases,
    variableChargeSupplierStages,
    variableChargeStates,
    generalManagerRoles,
    specialTermsStates,
  } = databaseSnapshot;

  const unavailableSources = [];
  if (collaborationResult.error) {
    if (!unavailableTable(collaborationResult.error)) throw collaborationResult.error;
    unavailableSources.push('Projects & Tasks');
  }
  if (growthResult.error) {
    if (!unavailableTable(growthResult.error)) throw growthResult.error;
    unavailableSources.push('Growth & Coaching');
  }
  if (improvementsResult.error) {
    if (!unavailableTable(improvementsResult.error)) throw improvementsResult.error;
    unavailableSources.push('FCOS Improvements');
  }
  if (collaborationCount.error && !unavailableTable(collaborationCount.error)) throw collaborationCount.error;
  if (growthCount.error && !unavailableTable(growthCount.error)) throw growthCount.error;
  if (improvementsCount.error && !unavailableTable(improvementsCount.error)) throw improvementsCount.error;
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
  if (variableChargeCases.error) {
    if (!unavailableTable(variableChargeCases.error)) throw variableChargeCases.error;
    unavailableSources.push('Variable Charges');
  }
  if (variableChargeSupplierStages.error) {
    if (!unavailableTable(variableChargeSupplierStages.error)) throw variableChargeSupplierStages.error;
    if (!unavailableSources.includes('Variable Charges')) unavailableSources.push('Variable Charges');
  }
  if (variableChargeStates.error && !unavailableTable(variableChargeStates.error)) throw variableChargeStates.error;
  if (generalManagerRoles.error && !unavailableTable(generalManagerRoles.error)) throw generalManagerRoles.error;
  if (specialTermsQueue.error) unavailableSources.push('Special Terms');
  if (specialTermsConsolidationQueue.error && !unavailableSources.includes('Special Terms')) unavailableSources.push('Special Terms');
  if (specialTermsStates.error && !unavailableTable(specialTermsStates.error)) throw specialTermsStates.error;
  if (marketAlertEvents.error) {
    if (!unavailableTable(marketAlertEvents.error)) throw marketAlertEvents.error;
    unavailableSources.push('Markets');
  }
  if (marketAlertStates.error && !unavailableTable(marketAlertStates.error)) throw marketAlertStates.error;

  const routerStateByAlert = new Map((emailRouterStates.data || []).map((row) => [row.alert_id, row]));
  const routerNotifications = (emailRouterAlerts.data || []).map((row) => emailRouterNotification(row, routerStateByAlert.get(row.id)));
  const systemStateByEvent = new Map((systemStates.data || []).map((row) => [row.event_id, row]));
  const systemNotifications = (systemEvents.data || []).map((row) => systemErrorNotification(row, systemStateByEvent.get(row.id)));
  const marketStateByEvent = new Map((marketAlertStates.data || []).map((row) => [row.alert_event_id, row]));
  const marketNotifications = (marketAlertEvents.data || []).map((row) => marketIntelligenceNotification(row, marketStateByEvent.get(row.id)));
  const generalManagerIds = [...new Set((generalManagerRoles.data || []).map((row) => row.user_id).filter(Boolean))];
  const isGeneralManager = profile.user_type === 'general_manager' && generalManagerIds.length === 1 && generalManagerIds[0] === profile.id;
  const readyRecipient = ['finance', 'administrator'].includes(profile.user_type) || isGeneralManager;
  const specialTermsApprover = profile.user_type === 'administrator' || isGeneralManager;
  const variableChargeStateByKey = new Map((variableChargeStates.data || []).map((row) => [row.notification_key, row]));
  const variableChargeNotifications = (variableChargeCases.data || [])
    .filter((row) => (
      (row.workflow_status === 'ready_for_invoice' && readyRecipient)
      || (['needs_action', 'post_invoice_change'].includes(row.workflow_status) && row.assigned_buyer_user_id === profile.id)
      || (row.workflow_status === 'post_invoice_change' && isGeneralManager)
    ))
    .map((row) => {
      const key = `${row.id}:${row.revision}:${row.workflow_status}`;
      return variableChargeNotification(row, variableChargeStateByKey.get(key));
    });
  const variableChargeSupplierNotifications = (variableChargeSupplierStages.data || []).map((row) => {
    const key = `${row.case_id}:supplier:${row.id}:${row.revision}:${row.status}`;
    return variableChargeSupplierNotification(row, variableChargeStateByKey.get(key));
  });
  const specialTermsStateByKey = new Map((specialTermsStates.data || []).map((row) => [row.notification_key, row]));
  const specialTermsNotifications = specialTermsApprover
    ? (specialTermsQueue.data || []).map((row) => {
        const key = `${row.termId}:${row.revisionId || row.updatedAt || 'draft'}`;
        return specialTermsNotification(row, specialTermsStateByKey.get(key));
      })
    : [];
  const profileEmail = String(profile.email || '').trim().toLowerCase();
  const specialTermsRelinkNotifications = (specialTermsConsolidationQueue.data || []).flatMap((consolidation) => (consolidation.affectedTerms || [])
    .filter((term) => specialTermsApprover || (profileEmail && String(term.ownerEmail || '').trim().toLowerCase() === profileEmail))
    .map((term) => {
      const key = `relink:${consolidation.id}:${term.termId}:${term.revisionId || term.termLastModifiedAt || 'live'}`;
      return specialTermsRelinkNotification(consolidation, term, specialTermsStateByKey.get(key));
    }));

  const notifications = [...(collaborationResult.data || []).map(collaborationNotification), ...(growthResult.data || []).map(growthNotification), ...(improvementsResult.data || []).map(improvementNotification), ...routerNotifications, ...systemNotifications, ...marketNotifications, ...variableChargeNotifications, ...variableChargeSupplierNotifications, ...specialTermsNotifications, ...specialTermsRelinkNotifications]
    .filter((row) => notificationVisible(row, body, now))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);

  return {
    notifications,
    unreadCount: Number(collaborationCount.count || 0) + Number(growthCount.count || 0) + Number(improvementsCount.count || 0) + [...routerNotifications, ...systemNotifications, ...marketNotifications, ...variableChargeNotifications, ...variableChargeSupplierNotifications, ...specialTermsNotifications, ...specialTermsRelinkNotifications].filter((row) => !row.readAt && !row.handledAt && (!row.snoozedUntil || row.snoozedUntil <= now)).length,
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
  const canViewMarkets = accessContext?.capabilities?.markets === true;
  const ids = cleanIds(body.notificationIds);
  const collaborationIds = ids.filter((value) => value.startsWith('collaboration:')).map((value) => value.slice('collaboration:'.length));
  const growthIds = ids.filter((value) => value.startsWith('growth:')).map((value) => value.slice('growth:'.length));
  const improvementIds = ids.filter((value) => value.startsWith('fcos_improvements:')).map((value) => value.slice('fcos_improvements:'.length));
  let emailRouterIds = ids.filter((value) => value.startsWith('email_router:')).map((value) => value.slice('email_router:'.length));
  let systemErrorIds = ids.filter((value) => value.startsWith('system_error:')).map((value) => value.slice('system_error:'.length));
  let variableChargeIds = ids.filter((value) => value.startsWith('variable_charges:')).map((value) => value.slice('variable_charges:'.length));
  let specialTermsIds = ids.filter((value) => value.startsWith('special_terms:')).map((value) => value.slice('special_terms:'.length));
  let marketIntelligenceIds = canViewMarkets
    ? ids.filter((value) => value.startsWith('market_intelligence:')).map((value) => value.slice('market_intelligence:'.length))
    : [];
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
    const [routerResult, systemResult, currentNotifications] = await Promise.all([
      client.schema('emailrouter').from('alerts').select('id').in('state', ['open', 'acknowledged']),
      client.from('system_error_events').select('id').gte('last_seen_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      workNotificationsList({ limit: 100, state: 'active' }, accessContext),
    ]);
    if (routerResult.error && !unavailableTable(routerResult.error)) throw routerResult.error;
    if (systemResult.error && !unavailableTable(systemResult.error)) throw systemResult.error;
    emailRouterIds = (routerResult.data || []).map((row) => row.id);
    systemErrorIds = (systemResult.data || []).map((row) => row.id);
    variableChargeIds = (currentNotifications.notifications || []).filter((row) => row.source === 'variable_charges').map((row) => row.id.slice('variable_charges:'.length));
    specialTermsIds = (currentNotifications.notifications || []).filter((row) => row.source === 'special_terms').map((row) => row.id.slice('special_terms:'.length));
    marketIntelligenceIds = (currentNotifications.notifications || []).filter((row) => row.source === 'markets').map((row) => row.id.slice('market_intelligence:'.length));
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

  const markShipAgentRead = async () => {
    for (const notificationKey of variableChargeIds) {
      const caseId = notificationKey.split(':')[0];
      const { error } = await client.rpc('set_variable_charge_notification_state', {
        p_notification_key: notificationKey,
        p_case_id: caseId,
        p_user_id: profile.id,
        p_state: 'read',
        p_snoozed_until: null,
      });
      if (error && !unavailableTable(error)) throw error;
    }
  };

  const markSpecialTermsRead = async () => {
    for (const notificationKey of specialTermsIds) {
      const { error } = await client.rpc('set_special_terms_notification_state', {
        p_notification_key: notificationKey,
        p_user_id: profile.id,
        p_state: 'read',
        p_snoozed_until: null,
      });
      if (error && !unavailableTable(error)) throw error;
    }
  };

  const markMarketIntelligenceRead = async () => {
    for (const alertEventId of marketIntelligenceIds) {
      const { error } = await client.rpc('set_market_intelligence_alert_notification_state', {
        p_alert_event_id: alertEventId,
        p_user_id: profile.id,
        p_state: 'read',
        p_snoozed_until: null,
      });
      if (error && !unavailableTable(error)) throw error;
    }
  };

  await Promise.all([updateTable('collaboration_notifications', collaborationIds), updateTable('growth_notifications', growthIds), updateTable('fcos_improvement_notifications', improvementIds), markEmailRouterRead(), markSystemErrorsRead(), markShipAgentRead(), markSpecialTermsRead(), markMarketIntelligenceRead()]);
  return workNotificationsList({ limit: body.limit }, accessContext);
}

export async function workNotificationsState(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const canViewMarkets = accessContext?.capabilities?.markets === true;
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
    ['fcos_improvements', ids.filter((value) => value.startsWith('fcos_improvements:')).map((value) => value.slice('fcos_improvements:'.length))],
    ['email_router', ids.filter((value) => value.startsWith('email_router:')).map((value) => value.slice('email_router:'.length))],
    ['system_error', ids.filter((value) => value.startsWith('system_error:')).map((value) => value.slice('system_error:'.length))],
    ['variable_charges', ids.filter((value) => value.startsWith('variable_charges:')).map((value) => value.slice('variable_charges:'.length))],
    ['special_terms', ids.filter((value) => value.startsWith('special_terms:')).map((value) => value.slice('special_terms:'.length))],
    ['market_intelligence', canViewMarkets ? ids.filter((value) => value.startsWith('market_intelligence:')).map((value) => value.slice('market_intelligence:'.length)) : []],
  ];
  let updated = 0;
  for (const [source, sourceIds] of groups) {
    if (!sourceIds.length) continue;
    if (source === 'variable_charges') {
      for (const notificationKey of sourceIds) {
        const caseId = notificationKey.split(':')[0];
        const { data, error } = await client.rpc('set_variable_charge_notification_state', {
          p_notification_key: notificationKey,
          p_case_id: caseId,
          p_user_id: profile.id,
          p_state: state,
          p_snoozed_until: snoozedUntil,
        });
        if (error) throw error;
        updated += Number(data || 0);
      }
      continue;
    }
    if (source === 'special_terms') {
      for (const notificationKey of sourceIds) {
        const { error } = await client.rpc('set_special_terms_notification_state', {
          p_notification_key: notificationKey,
          p_user_id: profile.id,
          p_state: state,
          p_snoozed_until: snoozedUntil,
        });
        if (error) throw error;
        updated += 1;
      }
      continue;
    }
    if (source === 'market_intelligence') {
      for (const alertEventId of sourceIds) {
        const { error } = await client.rpc('set_market_intelligence_alert_notification_state', {
          p_alert_event_id: alertEventId,
          p_user_id: profile.id,
          p_state: state,
          p_snoozed_until: snoozedUntil,
        });
        if (error) throw error;
        updated += 1;
      }
      continue;
    }
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
    if (source === 'fcos_improvements') {
      const current = new Date().toISOString();
      const patch = {
        read_at: state === 'unread' ? null : current,
        handled_at: state === 'handled' ? current : state === 'unhandled' ? null : undefined,
        snoozed_until: state === 'snoozed' ? snoozedUntil : null,
      };
      const { data, error } = await client.from('fcos_improvement_notifications').update(Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))).eq('user_id', profile.id).in('id', sourceIds).select('id');
      if (error) throw error;
      updated += Number(data?.length || 0);
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
