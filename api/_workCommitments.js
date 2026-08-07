import { workNotificationsList } from './_workNotifications.js';

const ACTIVE_WORK_STATUSES = new Set([
  "Backlog",
  "To Do",
  "In Progress",
  "Blocked",
  "In Review",
]);

const ACTIVE_COACHING_ACTION_STATUSES = new Set([
  "To Do",
  "In Progress",
  "Blocked",
]);

const PAYMENT_COLLECTION_RECONCILIATION_ISSUES = new Set([
  'payment_posting_pending',
  'payment_partially_posted',
  'payment_posting_mismatch',
  'payment_posting_overdue',
  'advice_overdue',
  'reopened',
  'balance_unavailable',
  'manual_closure_mismatch',
]);

const DISPUTE_ACCOUNTING_STAGES = new Set([
  'Approved - Pending Accounting',
  'Accounting In Progress',
  'Settled - Ready to Close',
]);

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function hongKongDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function dateOnly(value) {
  if (!value) return null;
  const matched = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return matched?.[0] || null;
}

function urgencyFor(dueAt, today = hongKongDate()) {
  const dueDate = dateOnly(dueAt);
  if (!dueDate) return "no_due_date";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due_today";
  const due = new Date(`${dueDate}T00:00:00+08:00`);
  const current = new Date(`${today}T00:00:00+08:00`);
  const days = Math.round((due.getTime() - current.getTime()) / 86_400_000);
  return days <= 7 ? "coming_week" : "later";
}

function unavailableTable(error) {
  return (
    error?.code === "42P01" ||
    /does not exist|schema cache/i.test(String(error?.message || ""))
  );
}

function ensureResult(result) {
  if (result?.error && !unavailableTable(result.error)) throw result.error;
  return result?.data || [];
}

async function safeNotifications(accessContext) {
  try {
    return await workNotificationsList({ limit: 100, state: 'active' }, accessContext);
  } catch {
    return { notifications: [], unavailableSources: ['Notifications'] };
  }
}

function collectionDueAt(item) {
  if (item.status === 'Payment Advice Received') return item.advice_verification_date || item.next_follow_up_date;
  if (item.status === 'Promise to Pay') return item.promised_payment_date || item.next_follow_up_date;
  if (item.status === 'On Hold') return item.on_hold_review_date || item.next_follow_up_date;
  return item.next_follow_up_date;
}

function collectionUrgency(item) {
  if (PAYMENT_COLLECTION_RECONCILIATION_ISSUES.has(item.reconciliation_state)) return 'needs_action';
  if (item.status === 'To Contact' && !collectionDueAt(item)) return 'needs_action';
  if (item.status === 'Awaiting Buyer' && !collectionDueAt(item)) return 'waiting';
  return null;
}

function collectionTitle(item) {
  const snapshotName = item.payment_reconciliation_snapshot?.stemName
    || item.latest_payment_snapshot?.stemName
    || item.latest_payment_snapshot?.stem_name;
  return snapshotName ? `Collect ${snapshotName}` : 'Payment collection follow-up';
}

function disputeCommitment(caseRow, profile, capabilities) {
  const stage = caseRow.workflow_status || 'Draft';
  const submittedByUser = caseRow.submitted_by === profile.id;
  if (stage === 'Pending Approval' && capabilities.disputeApprove) {
    return {
      subtitle: 'Commercial approval required',
      urgency: 'needs_action',
      actionLabel: 'Review dispute',
    };
  }
  if (DISPUTE_ACCOUNTING_STAGES.has(stage) && capabilities.disputeAccount) {
    return {
      subtitle: stage === 'Settled - Ready to Close' ? 'Final closure required' : 'Accounting action required',
      urgency: 'needs_action',
      actionLabel: stage === 'Settled - Ready to Close' ? 'Close dispute' : 'Open accounting work',
    };
  }
  if (submittedByUser && ['Draft', 'Revision Requested', 'Rejected'].includes(stage)) {
    return {
      subtitle: stage === 'Draft' ? 'Continue trader preparation' : `${stage} · Trader action required`,
      urgency: 'needs_action',
      actionLabel: 'Continue dispute',
    };
  }
  if (submittedByUser && ['Pending Approval', ...DISPUTE_ACCOUNTING_STAGES].includes(stage)) {
    return {
      subtitle: `${stage} · Waiting for the next department`,
      urgency: 'waiting',
      actionLabel: 'View dispute',
    };
  }
  return null;
}

function normalizeCommitment(commitment, today) {
  return {
    ...commitment,
    dueAt: commitment.dueAt || null,
    urgency: commitment.urgency || urgencyFor(commitment.dueAt, today),
  };
}

function sortCommitments(left, right) {
  const rank = {
    overdue: 0,
    due_today: 1,
    needs_action: 2,
    coming_week: 3,
    waiting: 4,
    later: 5,
    no_due_date: 6,
  };
  return (
    (rank[left.urgency] ?? 9) - (rank[right.urgency] ?? 9) ||
    String(left.dueAt || "9999-12-31").localeCompare(
      String(right.dueAt || "9999-12-31"),
    ) ||
    String(left.title || "").localeCompare(String(right.title || ""))
  );
}

export async function workCommitmentsList(_body = {}, accessContext) {
  const { client, profile, capabilities = {} } = accessContext;
  const today = hongKongDate();
  const [itemsResult, goalsResult, relationshipsResult, collectionsResult, shipAgentCasesResult, disputesResult, hedgeClosesResult, improvementTicketsResult, improvementProposalsResult, generalManagerRoleResult, notificationsResult] = await Promise.all([
    client
      .from("collaboration_items")
      .select(
        "id,item_key,item_type,title,status,priority,due_date,owner_user_id,owner_name,assignee_user_id,assignee_name,project_id,archived_at,updated_at",
      )
      .or(`owner_user_id.eq.${profile.id},assignee_user_id.eq.${profile.id}`)
      .is("archived_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(250),
    client
      .from("growth_goals")
      .select(
        "id,title,status,progress,employee_id,primary_manager_id,active_version,revision,updated_at",
      )
      .or(`employee_id.eq.${profile.id},primary_manager_id.eq.${profile.id}`)
      .in("status", [
        "Pending Approval",
        "Active",
        "Completion Review",
        "Cancellation Requested",
        "Revision Requested",
      ])
      .order("updated_at", { ascending: false })
      .limit(250),
    client
      .from("growth_coaching_relationships")
      .select("id,participant_one_id,participant_two_id,status")
      .or(
        `participant_one_id.eq.${profile.id},participant_two_id.eq.${profile.id}`,
      )
      .in("status", ["Pending", "Active"])
      .limit(100),
    capabilities.paymentCollections
      ? client
          .from('buyer_invoice_collection_items')
          .select('stem_id,status,owner_user_id,owner_name,latest_note,next_follow_up_date,promised_payment_date,promised_amount,on_hold_review_date,advice_verification_date,reconciliation_state,verified_receivable_balance,latest_payment_snapshot,payment_reconciliation_snapshot,last_reconciled_at,updated_at')
          .eq('owner_user_id', profile.id)
          .neq('status', 'Paid / Closed')
          .order('updated_at', { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    capabilities.paymentCollections
      ? client
          .from('ship_agent_charge_cases')
          .select('id,stem_id,stem_name,workflow_status,due_date,assigned_buyer_user_id,revision,updated_at')
          .eq('assigned_buyer_user_id', profile.id)
          .in('workflow_status', ['needs_action', 'post_invoice_change'])
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    capabilities.disputes
      ? client
          .from('dispute_beta_cases')
          .select('id,stem_id,stem_name,buyer_name,supplier_names,workflow_status,approval_status,submitted_by,submitted_by_email,updated_at')
          .neq('workflow_status', 'Closed')
          .order('updated_at', { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    capabilities.hedgeDesk && (capabilities.hedgeCloseApprove || capabilities.hedgeSettlementManage)
      ? client
          .from('hedge_month_closes')
          .select('id,report_month,revision,status,finalized_by_id,approved_by_id,updated_date')
          .in('status', ['pending_approval', 'ready', 'failed', 'sending'])
          .order('updated_date', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    client
      .from('fcos_improvement_tickets')
      .select('id,ticket_key,ticket_type,title,status,priority,reporter_user_id,assignee_user_id,assignee_name,updated_at')
      .not('status', 'in', '(Closed,Rejected)')
      .order('updated_at', { ascending: false })
      .limit(250),
    client
      .from('fcos_improvement_proposals')
      .select('id,ticket_id,change_type,created_at')
      .eq('approval_state', 'pending')
      .order('created_at', { ascending: true })
      .limit(250),
    client
      .from('collaboration_roles')
      .select('user_id')
      .eq('user_id', profile.id)
      .eq('role', 'general_manager')
      .eq('active', true)
      .maybeSingle(),
    safeNotifications(accessContext),
  ]);

  const items = ensureResult(itemsResult);
  const goals = ensureResult(goalsResult);
  const relationships = ensureResult(relationshipsResult);
  const collections = ensureResult(collectionsResult);
  const shipAgentCases = ensureResult(shipAgentCasesResult);
  const disputes = ensureResult(disputesResult);
  const hedgeCloses = ensureResult(hedgeClosesResult);
  const improvementTickets = ensureResult(improvementTicketsResult);
  const improvementProposals = ensureResult(improvementProposalsResult);
  const generalManagerRole = ensureResult(generalManagerRoleResult);
  const isGeneralManager = generalManagerRole?.user_id === profile.id;
  const goalIds = goals.map((goal) => goal.id);
  const relationshipIds = relationships.map((relationship) => relationship.id);

  const [versionsResult, checkpointsResult, sessionsResult] = await Promise.all(
    [
      goalIds.length
        ? client
            .from("growth_goal_versions")
            .select("goal_id,version,deadline")
            .in("goal_id", goalIds)
        : Promise.resolve({ data: [], error: null }),
      goalIds.length
        ? client
            .from("growth_goal_checkpoints")
            .select(
              "id,goal_id,goal_version,due_date,expected_result,tracking_state,completed_at,updated_at",
            )
            .in("goal_id", goalIds)
            .is("completed_at", null)
            .order("due_date", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      relationshipIds.length
        ? client
            .from("growth_coaching_sessions")
            .select(
              "id,relationship_id,scheduled_at,duration_minutes,status,revision,updated_at",
            )
            .in("relationship_id", relationshipIds)
            .in("status", ["Scheduled", "Awaiting Confirmation"])
            .order("scheduled_at", { ascending: true })
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ],
  );

  const versions = ensureResult(versionsResult);
  const checkpoints = ensureResult(checkpointsResult);
  const sessions = ensureResult(sessionsResult);
  const sessionIds = sessions.map((session) => session.id);
  const [actionsResult, confirmationsResult] = await Promise.all([
    relationshipIds.length
      ? client
          .from("growth_coaching_actions")
          .select(
            "id,session_id,owner_id,title,due_date,status,published_item_id,proposal_status,revision,updated_at",
          )
          .eq("owner_id", profile.id)
          .in("status", [...ACTIVE_COACHING_ACTION_STATUSES])
          .in("proposal_status", ["not_required", "accepted"])
          .order("due_date", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? client
          .from("growth_coaching_confirmations")
          .select("session_id,participant_id,confirmed_at")
          .in("session_id", sessionIds)
          .eq("participant_id", profile.id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const actions = ensureResult(actionsResult);
  const confirmations = ensureResult(confirmationsResult);
  const versionByGoal = new Map(
    versions.map((version) => [
      `${version.goal_id}:${version.version}`,
      version,
    ]),
  );
  const confirmationBySession = new Set(
    confirmations.map((row) => row.session_id),
  );
  const commitments = [];

  for (const item of items) {
    if (!ACTIVE_WORK_STATUSES.has(item.status)) continue;
    const isAssignee = item.assignee_user_id === profile.id;
    const isOwner = item.owner_user_id === profile.id;
    commitments.push(
      normalizeCommitment(
        {
          id: `collaboration:${item.id}`,
          source: "collaboration",
          kind: item.item_type,
          title: `${item.item_key} · ${item.title}`,
          subtitle: isAssignee
            ? `Assigned to you · ${item.status}`
            : `Owned by you · ${item.assignee_name ? `Assigned to ${item.assignee_name}` : "Unassigned"}`,
          status: item.status,
          priority: item.priority,
          dueAt: item.due_date,
          urgency:
            isOwner && !isAssignee && item.assignee_user_id ? "waiting" : null,
          link: `/projects-tasks?item=${encodeURIComponent(item.id)}`,
          actionLabel: "Open work item",
        },
        today,
      ),
    );
  }

  for (const goal of goals) {
    const version = versionByGoal.get(`${goal.id}:${goal.active_version}`);
    const managerAction =
      goal.primary_manager_id === profile.id &&
      [
        "Pending Approval",
        "Completion Review",
        "Cancellation Requested",
      ].includes(goal.status);
    if (managerAction) {
      commitments.push(
        normalizeCommitment(
          {
            id: `goal-review:${goal.id}`,
            source: "growth_coaching",
            kind: "goal_review",
            title: goal.title,
            subtitle: `${goal.status} · Manager decision required`,
            status: goal.status,
            dueAt: version?.deadline || null,
            urgency: "needs_action",
            link: "/growth-coaching?tab=reports",
            actionLabel: "Review goal",
          },
          today,
        ),
      );
    }

    if (goal.employee_id !== profile.id || goal.status !== "Active") continue;
    for (const checkpoint of checkpoints.filter(
      (row) =>
        row.goal_id === goal.id && row.goal_version === goal.active_version,
    )) {
      commitments.push(
        normalizeCommitment(
          {
            id: `checkpoint:${checkpoint.id}`,
            source: "growth_coaching",
            kind: "goal_checkpoint",
            title: checkpoint.expected_result || goal.title,
            subtitle: `${goal.title} · ${checkpoint.tracking_state || "Not updated"}`,
            status: checkpoint.tracking_state || "Not updated",
            dueAt: checkpoint.due_date,
            link: "/growth-coaching?tab=growth",
            actionLabel: "Update progress",
          },
          today,
        ),
      );
    }
  }

  for (const session of sessions) {
    if (
      session.status === "Awaiting Confirmation" &&
      !confirmationBySession.has(session.id)
    ) {
      commitments.push(
        normalizeCommitment(
          {
            id: `session-confirm:${session.id}`,
            source: "growth_coaching",
            kind: "session_confirmation",
            title: "Confirm coaching session",
            subtitle: "Shared notes are waiting for your confirmation",
            status: session.status,
            dueAt: session.scheduled_at,
            urgency: "needs_action",
            link: `/growth-coaching?tab=coaching&session=${encodeURIComponent(session.id)}`,
            actionLabel: "Review session",
          },
          today,
        ),
      );
      continue;
    }
    if (session.status === "Scheduled") {
      commitments.push(
        normalizeCommitment(
          {
            id: `session:${session.id}`,
            source: "growth_coaching",
            kind: "coaching_session",
            title: "Upcoming coaching session",
            subtitle: `${session.duration_minutes || 45} minutes · Prepare agenda and private notes`,
            status: session.status,
            dueAt: session.scheduled_at,
            link: `/growth-coaching?tab=coaching&session=${encodeURIComponent(session.id)}`,
            actionLabel: "Prepare session",
          },
          today,
        ),
      );
    }
  }

  for (const action of actions) {
    commitments.push(
      normalizeCommitment(
        {
          id: `coaching-action:${action.id}`,
          source: "growth_coaching",
          kind: "coaching_action",
          title: action.title,
          subtitle: action.published_item_id
            ? "Published to Projects & Tasks"
            : "Private coaching action",
          status: action.status,
          dueAt: action.due_date,
          link: action.published_item_id
            ? `/projects-tasks?item=${encodeURIComponent(action.published_item_id)}`
            : `/growth-coaching?tab=coaching&session=${encodeURIComponent(action.session_id)}`,
          actionLabel: "Open action",
        },
        today,
      ),
    );
  }

  for (const item of collections) {
    const balance = money(item.verified_receivable_balance);
    const detail = [item.status || 'To Contact'];
    if (PAYMENT_COLLECTION_RECONCILIATION_ISSUES.has(item.reconciliation_state)) {
      detail.push(String(item.reconciliation_state || '').replaceAll('_', ' '));
    }
    if (balance != null) detail.push(`Receivable ${balance}`);
    commitments.push(
      normalizeCommitment(
        {
          id: `payment-collection:${item.stem_id}`,
          source: 'payment_collections',
          kind: 'payment_collection',
          title: collectionTitle(item),
          subtitle: detail.join(' · '),
          status: item.status,
          dueAt: collectionDueAt(item),
          urgency: collectionUrgency(item),
          link: `/payment-collections?tab=collections&collectionStemId=${encodeURIComponent(item.stem_id)}`,
          actionLabel: 'Open collection',
        },
        today,
      ),
    );
  }

  for (const item of shipAgentCases) {
    const postInvoice = item.workflow_status === 'post_invoice_change';
    commitments.push(
      normalizeCommitment(
        {
          id: `ship-agent-charges:${item.id}:${item.revision}`,
          source: 'payment_collections',
          kind: 'ship_agent_charges',
          title: `${item.stem_name || item.stem_id} · Ship-agent charges`,
          subtitle: postInvoice
            ? 'Urgent post-invoice change · Document a resolution'
            : 'Row-by-row review and confirmation required',
          status: postInvoice ? 'Post-Invoice Change' : 'Needs Action',
          dueAt: item.due_date,
          urgency: postInvoice ? 'needs_action' : null,
          link: `/payment-collections?tab=ship-agent-charges&stemId=${encodeURIComponent(item.stem_id)}`,
          actionLabel: postInvoice ? 'Resolve change' : 'Review charges',
        },
        today,
      ),
    );
  }

  for (const caseRow of disputes) {
    const next = disputeCommitment(caseRow, profile, capabilities);
    if (!next) continue;
    commitments.push(
      normalizeCommitment(
        {
          id: `dispute:${caseRow.id}`,
          source: 'disputes',
          kind: 'dispute',
          title: caseRow.stem_name ? `Dispute ${caseRow.stem_name}` : 'Dispute workflow',
          subtitle: next.subtitle,
          status: caseRow.workflow_status,
          dueAt: null,
          urgency: next.urgency,
          link: `/disputes?stem=${encodeURIComponent(caseRow.stem_id)}`,
          actionLabel: next.actionLabel,
        },
        today,
      ),
    );
  }

  for (const close of hedgeCloses) {
    const status = String(close.status || '');
    const canAct = status === 'pending_approval'
      ? capabilities.hedgeCloseApprove
      : ['ready', 'failed'].includes(status)
        ? capabilities.hedgeCloseApprove || capabilities.hedgeSettlementManage
        : false;
    if (!canAct && status !== 'sending') continue;
    commitments.push(
      normalizeCommitment(
        {
          id: `hedge-close:${close.id}`,
          source: 'hedge_desk',
          kind: 'hedge_month_close',
          title: `Hedge settlement ${close.report_month}`,
          subtitle: status === 'pending_approval'
            ? `Revision ${close.revision} · Approval required`
            : status === 'failed'
              ? `Revision ${close.revision} · Delivery failed`
              : status === 'ready'
                ? `Revision ${close.revision} · Ready to send`
                : `Revision ${close.revision} · Sending confirmation pending`,
          status,
          dueAt: null,
          urgency: status === 'sending' ? 'waiting' : 'needs_action',
          link: '/hedge-desk?view=settlement',
          actionLabel: status === 'pending_approval' ? 'Review settlement' : 'Open settlement',
        },
        today,
      ),
    );
  }

  const pendingImprovementByTicket = new Map();
  for (const proposal of improvementProposals) {
    if (!pendingImprovementByTicket.has(proposal.ticket_id)) pendingImprovementByTicket.set(proposal.ticket_id, []);
    pendingImprovementByTicket.get(proposal.ticket_id).push(proposal);
  }
  for (const ticket of improvementTickets) {
    const pending = pendingImprovementByTicket.get(ticket.id) || [];
    const belongsToUser = ticket.reporter_user_id === profile.id || ticket.assignee_user_id === profile.id;
    if (!belongsToUser && !(isGeneralManager && pending.length)) continue;
    commitments.push(normalizeCommitment({
      id: `fcos-improvement:${ticket.id}`,
      source: 'fcos_improvements',
      kind: ticket.ticket_type,
      title: `${ticket.ticket_key} · ${ticket.title}`,
      subtitle: isGeneralManager && pending.length
        ? `${pending.length} proposed change${pending.length === 1 ? '' : 's'} awaiting your approval`
        : ticket.assignee_user_id === profile.id
          ? `Assigned to you · ${ticket.status}`
          : `${ticket.status} · ${ticket.assignee_name ? `Assigned to ${ticket.assignee_name}` : 'Unassigned'}`,
      status: ticket.status,
      priority: ticket.priority,
      dueAt: null,
      urgency: isGeneralManager && pending.length ? 'needs_action' : ticket.assignee_user_id === profile.id ? 'needs_action' : 'waiting',
      link: `/fcos-improvements?ticket=${encodeURIComponent(ticket.id)}`,
      actionLabel: isGeneralManager && pending.length ? 'Review proposals' : 'Open ticket',
    }, today));
  }

  for (const notification of notificationsResult.notifications || []) {
    if (!['email_router', 'system_error'].includes(notification.source)) continue;
    if (notification.source === 'email_router' && !capabilities.emailRouter) continue;
    commitments.push(
      normalizeCommitment(
        {
          id: `notification:${notification.id}`,
          source: notification.source,
          kind: notification.type || 'operational_notification',
          title: notification.title,
          subtitle: notification.message || 'Review the recorded operational issue.',
          status: notification.source === 'system_error' ? 'Needs review' : 'Warning',
          dueAt: notification.createdAt,
          urgency: 'needs_action',
          link: notification.link || '/',
          actionLabel: 'Review issue',
        },
        today,
      ),
    );
  }

  commitments.sort(sortCommitments);
  const counts = commitments.reduce((result, item) => {
    result[item.urgency] = (result[item.urgency] || 0) + 1;
    return result;
  }, {});

  return {
    commitments,
    counts,
    sources: [...new Set(commitments.map((item) => item.source))],
    unavailableSources: notificationsResult.unavailableSources || [],
    today,
    generatedAt: new Date().toISOString(),
  };
}

export const workCommitmentInternals = {
  collectionDueAt,
  collectionUrgency,
  dateOnly,
  disputeCommitment,
  hongKongDate,
  sortCommitments,
  urgencyFor,
};
