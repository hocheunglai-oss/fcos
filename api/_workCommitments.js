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
  const { client, profile } = accessContext;
  const today = hongKongDate();
  const [itemsResult, goalsResult, relationshipsResult] = await Promise.all([
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
  ]);

  const items = ensureResult(itemsResult);
  const goals = ensureResult(goalsResult);
  const relationships = ensureResult(relationshipsResult);
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

  commitments.sort(sortCommitments);
  const counts = commitments.reduce((result, item) => {
    result[item.urgency] = (result[item.urgency] || 0) + 1;
    return result;
  }, {});

  return {
    commitments,
    counts,
    today,
    generatedAt: new Date().toISOString(),
  };
}

export const workCommitmentInternals = {
  dateOnly,
  hongKongDate,
  sortCommitments,
  urgencyFor,
};
