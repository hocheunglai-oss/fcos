import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { calculateMilestoneGoalProgress, calculateNumericGoalProgress, calculateOutcomeRubricProgress, canonicalCoachingPairKey, hongKongDateOnly, validateGrowthGoalPayload, validateReportingLinePayload, validateReportingLines } from "./_growthCoaching.js";
import { COLLABORATION_ALLOWED_ATTACHMENTS, collaborationAvailableDisplayFilename, validateCollaborationAttachment } from "./_collaboration.js";
import { growthCalendarCancel, growthCalendarConfigured, growthCalendarCreate, growthCalendarEventPayload, growthCalendarGet, growthCalendarUpdate } from "./_growthOutlook.js";
import { isExternalActionEnabled } from "./_externalActionGates.js";
import { sendWithSmtp, smtpAuthenticatedFromAddress } from "./_smtp.js";

const BUCKET = "growth-coaching-files";
const PUBLIC_PATH = "/growth-coaching";
const EMAIL_CATEGORIES = new Set(["invitations", "goal_decisions", "completion_requests", "session_confirmations", "routine_digest"]);

function appError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value, max = 20_000) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function id(value) {
  const result = text(value, 80);
  return result || null;
}

function revision(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function dateOnly(value) {
  const result = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function rpcError(error, fallback = "Growth & Coaching storage request failed.") {
  const message = String(error?.message || fallback);
  if (/changed after it was opened/i.test(message)) return appError(message, 409);
  if (/not found|unavailable/i.test(message)) return appError(message, 404);
  if (/required|cannot|must|only|active FCOS|valid|cycle|different/i.test(message)) {
    return appError(message, 400);
  }
  if (error?.code === "42P01" || /schema cache|does not exist/i.test(message)) {
    return appError("Growth & Coaching storage is not ready. Apply the latest Supabase migration.", 503);
  }
  return error;
}

async function activeUsers(client) {
  const { data, error } = await client.from("user_profiles").select("id,email,full_name,user_type,active").eq("active", true).order("full_name", { ascending: true });
  if (error) throw rpcError(error);
  return data || [];
}

function userShape(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || row.email,
    full_name: row.full_name || row.email,
    active: row.active !== false,
  };
}

function profileName(profile) {
  return profile.full_name || profile.email;
}

function pairIds(first, second) {
  canonicalCoachingPairKey(first, second);
  return [first, second].sort((left, right) => left.localeCompare(right));
}

function relationshipIncludes(row, userId) {
  return row?.participant_one_id === userId || row?.participant_two_id === userId;
}

async function relationshipForActor(client, relationshipId, actorId, { activeOnly = false } = {}) {
  const { data, error } = await client.from("growth_coaching_relationships").select("*").eq("id", relationshipId).maybeSingle();
  if (error) throw rpcError(error);
  if (!data || !relationshipIncludes(data, actorId)) {
    throw appError("The coaching relationship is unavailable.", 404);
  }
  if (activeOnly && data.status !== "Active") {
    throw appError("This coaching relationship is not active.", 400);
  }
  return data;
}

async function sessionForActor(client, sessionId, actorId, options = {}) {
  const { data, error } = await client.from("growth_coaching_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The coaching session is unavailable.", 404);
  const relationship = await relationshipForActor(client, data.relationship_id, actorId, options);
  return { session: data, relationship };
}

async function goalForViewer(client, goalId, actorId) {
  const { data: goal, error } = await client.from("growth_goals").select("*").eq("id", goalId).maybeSingle();
  if (error) throw rpcError(error);
  if (!goal) throw appError("The development goal is unavailable.", 404);
  const assignments = await reportingAssignments(client);
  const visible = visibleEmployeeIds(assignments, actorId);
  if (!visible.has(goal.employee_id)) throw appError("The development goal is unavailable.", 404);
  return { goal, assignments };
}

async function reportingAssignments(client) {
  const { data, error } = await client.from("growth_reporting_assignments").select("*");
  if (error) throw rpcError(error);
  return data || [];
}

function visibleEmployeeIds(assignments, viewerId) {
  const primaryByEmployee = new Map(assignments.filter((row) => row.primary_manager_id).map((row) => [row.employee_id, row.primary_manager_id]));
  const visible = new Set([viewerId]);
  for (const row of assignments) {
    if (row.secondary_manager_id === viewerId) visible.add(row.employee_id);
    let current = row.employee_id;
    const seen = new Set();
    while (primaryByEmployee.has(current) && !seen.has(current)) {
      seen.add(current);
      const manager = primaryByEmployee.get(current);
      if (manager === viewerId) {
        visible.add(row.employee_id);
        break;
      }
      current = manager;
    }
  }
  return visible;
}

function normalizeMeasurement(raw = {}) {
  const typeValue = raw.type === "outcome" ? "outcome_rubric" : raw.type;
  if (typeValue === "numeric") {
    const currentValue = raw.currentValue ?? raw.current;
    return {
      type: "numeric",
      baseline: Number(raw.baseline),
      target: Number(raw.target),
      current: Number(currentValue === "" || currentValue == null ? raw.baseline : currentValue),
      unit: text(raw.unit, 80),
      direction: raw.direction,
    };
  }
  if (typeValue === "milestones") {
    return {
      type: "milestones",
      milestones: (raw.milestones || []).map((row, index) => ({
        id: id(row.id) || `milestone-${index + 1}`,
        label: text(row.label || row.title, 255),
        weight: Number(row.weight),
        progress: Number(row.progress || 0),
      })),
    };
  }
  const source = raw.levels || raw.rubric || [];
  const denominator = Math.max(1, source.length - 1);
  const levels = source.map((row, index) => ({
    id: id(row.id) || `level-${index + 1}`,
    label: text(row.label || row.level, 255),
    evidence: text(row.evidence, 10_000),
    progress: row.progress == null ? Math.round((index / denominator) * 100) : Number(row.progress),
  }));
  return {
    type: "outcome_rubric",
    levels,
    currentLevelId: id(raw.currentLevelId) || levels[0]?.id || null,
  };
}

function normalizeCheckpoints(rows = []) {
  return rows.map((row) => ({
    id: id(row.id) || randomUUID(),
    dueDate: dateOnly(row.dueDate || row.date),
    expectedResult: text(row.expectedResult, 255),
    actualResult: text(row.actualResult),
    evidence: text(row.evidence, 10_000),
    state: row.state
      ? {
          "On track": "On Track",
          "At risk": "At Risk",
          "Off track": "Off Track",
        }[row.state] || row.state
      : null,
  }));
}

function goalProgress(measurement) {
  if (measurement?.type === "numeric") return calculateNumericGoalProgress(measurement) ?? 0;
  if (measurement?.type === "milestones") return calculateMilestoneGoalProgress(measurement.milestones) ?? 0;
  if (measurement?.type === "outcome_rubric") {
    return calculateOutcomeRubricProgress(measurement.levels, measurement.currentLevelId) ?? 0;
  }
  return 0;
}

function hkGraphDateTime(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
}

function parseHongKongDateTime(value) {
  const raw = text(value, 40);
  const explicitZone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw);
  const parsed = new Date(explicitZone ? raw : `${raw}+08:00`);
  return parsed;
}

async function eventRow(client, { subjectType, subjectId, eventType, actor, targetUserId = null, summary, metadata = {} }) {
  const { data, error } = await client
    .from("growth_events")
    .insert({
      subject_type: subjectType,
      subject_id: subjectId,
      event_type: eventType,
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      target_user_id: targetUserId,
      summary,
      metadata,
    })
    .select("id")
    .single();
  if (error) throw rpcError(error);
  return data;
}

function publicUrl() {
  return String(process.env.FCOS_PUBLIC_URL || "").replace(/\/$/, "");
}

async function sendNotificationEmail(client, { user, eventId, category, dedupeKey, title, dueDate = null, progress = null }) {
  const { data: preferences } = await client.from("growth_email_preferences").select("*").eq("user_id", user.id).maybeSingle();
  if (preferences?.[category] === false || !isExternalActionEnabled("email_delivery") || !isExternalActionEnabled("growth_coaching_email")) return;
  const { data: reserved, error: reserveError } = await client
    .from("growth_email_deliveries")
    .insert({
      user_id: user.id,
      event_id: eventId,
      delivery_type: category,
      dedupe_key: dedupeKey,
      status: "reserved",
    })
    .select("id")
    .maybeSingle();
  if (reserveError?.code === "23505" || !reserved) return;
  if (reserveError) return;
  const url = publicUrl();
  const safeTitle = text(title, 255);
  const details = ["FCOS Growth & Coaching", safeTitle, dueDate ? `Date: ${dueDate}` : "", progress != null ? `Progress: ${progress}%` : "", url ? `Open FCOS: ${url}${PUBLIC_PATH}` : ""].filter(Boolean);
  const html = details.map((line, index) => (index === 0 ? `<h2>${line}</h2>` : `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`)).join("");
  try {
    const senderName = text(process.env.FCOS_GROWTH_SENDER_NAME || "FCOS", 100);
    const from = smtpAuthenticatedFromAddress({}, `${senderName} <${process.env.SMTP_USER || ""}>`);
    await sendWithSmtp({
      from,
      to: user.email,
      subject: `FCOS: ${safeTitle}`,
      text: details.join("\n"),
      html,
    });
    await client
      .from("growth_email_deliveries")
      .update({
        status: "sent",
        attempt_count: 1,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", reserved.id);
  } catch (error) {
    await client
      .from("growth_email_deliveries")
      .update({
        status: "failed",
        attempt_count: 1,
        last_error: text(error?.message || "Delivery failed.", 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", reserved.id);
  }
}

async function notify(client, { actor, user, subjectType, subjectId, eventType, notificationType, title, message = "", category, dedupeKey, metadata = {}, dueDate = null, progress = null }) {
  if (!user?.id || user.id === actor?.id) return null;
  const event = await eventRow(client, {
    subjectType,
    subjectId,
    eventType,
    actor,
    targetUserId: user.id,
    summary: text(title, 255),
    metadata,
  });
  const { error } = await client.from("growth_notifications").insert({
    user_id: user.id,
    source_type: subjectType,
    source_id: subjectId,
    event_id: event.id,
    notification_type: notificationType,
    title: text(title, 255),
    message: text(message, 500),
    link: PUBLIC_PATH,
    dedupe_key: dedupeKey,
  });
  if (error?.code !== "23505") {
    if (error) throw rpcError(error);
    if (EMAIL_CATEGORIES.has(category)) {
      const promise = sendNotificationEmail(client, {
        user,
        eventId: event.id,
        category,
        dedupeKey,
        title,
        dueDate,
        progress,
      }).catch(() => null);
      try {
        waitUntil(promise);
      } catch {
        void promise;
      }
    }
  }
  return event;
}

async function sendRoutineDigests(client, today) {
  if (!isExternalActionEnabled("email_delivery") || !isExternalActionEnabled("growth_coaching_email")) return { status: "disabled", sent: 0, failed: 0 };
  const windowStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const { data: notifications, error } = await client.from("growth_notifications").select("user_id,notification_type,title,message").in("notification_type", ["goal_due", "coaching_action_due"]).gte("created_at", windowStart);
  if (error) throw rpcError(error);
  const byUser = new Map();
  for (const row of notifications || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  if (!byUser.size) return { status: "complete", sent: 0, failed: 0 };
  const { data: users, error: userError } = await client
    .from("user_profiles")
    .select("id,email,full_name,active")
    .in("id", [...byUser.keys()])
    .eq("active", true);
  if (userError) throw rpcError(userError);
  const { data: preferences, error: preferenceError } = await client
    .from("growth_email_preferences")
    .select("user_id,routine_digest")
    .in("user_id", [...byUser.keys()]);
  if (preferenceError) throw rpcError(preferenceError);
  const preferenceByUser = new Map((preferences || []).map((row) => [row.user_id, row]));
  let sent = 0;
  let failed = 0;
  for (const user of users || []) {
    if (preferenceByUser.get(user.id)?.routine_digest === false) continue;
    const dedupeKey = `growth-digest:${today}:${user.id}`;
    const { data: delivery, error: reserveError } = await client
      .from("growth_email_deliveries")
      .insert({
        user_id: user.id,
        delivery_type: "routine_digest",
        dedupe_key: dedupeKey,
        status: "reserved",
      })
      .select("id")
      .maybeSingle();
    if (reserveError?.code === "23505" || !delivery) continue;
    if (reserveError) {
      failed += 1;
      continue;
    }
    const items = byUser.get(user.id) || [];
    const url = publicUrl();
    const lines = ["FCOS Growth & Coaching reminder digest", `Date: ${today}`, ...items.map((row) => `- ${text(row.message || row.title, 255)}`), url ? `Open FCOS: ${url}${PUBLIC_PATH}` : ""].filter(Boolean);
    try {
      const from = smtpAuthenticatedFromAddress({}, `${text(process.env.FCOS_GROWTH_SENDER_NAME || "FCOS", 100)} <${process.env.SMTP_USER || ""}>`);
      await sendWithSmtp({
        from,
        to: user.email,
        subject: `FCOS Growth & Coaching reminders - ${today}`,
        text: lines.join("\n"),
        html: lines.map((line, index) => (index === 0 ? `<h2>${line}</h2>` : `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`)).join(""),
      });
      await client
        .from("growth_email_deliveries")
        .update({
          status: "sent",
          attempt_count: 1,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      sent += 1;
    } catch (sendError) {
      await client
        .from("growth_email_deliveries")
        .update({
          status: "failed",
          attempt_count: 1,
          last_error: text(sendError?.message || "Delivery failed.", 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      failed += 1;
    }
  }
  return { status: failed ? "partial_failure" : "complete", sent, failed };
}

function serializeRelationship(row, users, calendarByRelationship, viewerId) {
  const partnerId = row.participant_one_id === viewerId ? row.participant_two_id : row.participant_one_id;
  const partner = users.get(partnerId);
  const sync = calendarByRelationship.get(row.id);
  return {
    id: row.id,
    status: row.status,
    cadence: row.cadence,
    customCadenceDays: row.custom_cadence_days,
    revision: Number(row.revision || 0),
    inviterId: row.inviter_id,
    participantOneId: row.participant_one_id,
    participantTwoId: row.participant_two_id,
    partner: partner ? userShape(partner) : { id: partnerId, fullName: "Inactive user", active: false },
    partnerName: partner?.full_name || partner?.email || "Inactive user",
    calendarStatus: sync?.status || (growthCalendarConfigured() ? "Pending" : "Unavailable"),
    calendar: sync || null,
    endedAt: row.ended_at,
  };
}

function serializeGoal(goal, version, checkpoints, permissions, updates = [], decisions = [], users = new Map()) {
  const measurement = version?.measurement || {};
  return {
    id: goal.id,
    ownerId: goal.employee_id,
    planId: goal.plan_id,
    employeeId: goal.employee_id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    revision: Number(goal.revision || 0),
    activeVersion: goal.active_version,
    approvedVersion: goal.approved_version,
    deadline: version?.deadline || null,
    measurement,
    measureType: measurement.type,
    checkpoints: checkpoints.map((row) => ({
      id: row.id,
      date: row.due_date,
      dueDate: row.due_date,
      expectedResult: row.expected_result,
      actualResult: row.actual_result,
      evidence: row.evidence,
      state: row.tracking_state,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
      overdue: !row.completed_at && row.due_date < hongKongDateOnly(),
    })),
    progress: Number(goal.progress ?? goalProgress(measurement)),
    completionEvidence: goal.completion_evidence,
    completionNote: goal.completion_note,
    updates: updates.map((row) => ({
      id: row.id,
      checkpointId: row.checkpoint_id,
      currentValue: row.current_value,
      actualResult: row.actual_result,
      evidence: row.evidence,
      state: row.tracking_state,
      comment: row.comment,
      submittedBy: row.submitted_by,
      submittedByName: profileName(users.get(row.submitted_by) || { email: "Inactive user" }),
      submittedAt: row.submitted_at,
    })),
    decisions: decisions.map((row) => ({
      id: row.id,
      goalVersion: row.goal_version,
      type: row.decision_type,
      note: row.note,
      actorId: row.actor_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
    })),
    updatedAt: goal.updated_at,
    permissions,
  };
}

export async function growthReportingLinesList(body = {}, accessContext) {
  const { client } = accessContext;
  const [users, assignments] = await Promise.all([activeUsers(client), reportingAssignments(client)]);
  const byId = new Map(users.map((row) => [row.id, row]));
  const validation = validateReportingLines({
    assignments: assignments.map((row) => ({
      employeeId: row.employee_id,
      primaryManagerId: row.primary_manager_id,
      secondaryManagerId: row.secondary_manager_id,
    })),
    activeUserIds: users.map((row) => row.id),
  });
  const byEmployee = new Map(assignments.map((row) => [row.employee_id, row]));
  const lines = users.map((user) => {
    const row = byEmployee.get(user.id);
    const path = [];
    let current = row?.primary_manager_id;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      path.push(byId.get(current)?.full_name || byId.get(current)?.email || "Inactive user");
      current = byEmployee.get(current)?.primary_manager_id;
    }
    return {
      userId: user.id,
      user: userShape(user),
      primaryManagerId: row?.primary_manager_id || null,
      secondaryManagerId: row?.secondary_manager_id || null,
      revision: Number(row?.revision || 0),
      valid: !validation.errors.some((issue) => issue.includes(user.id)),
      path: path.join(" > "),
    };
  });
  return {
    users: users.map(userShape),
    reportingLines: lines,
    setupGaps: lines.filter((row) => !row.primaryManagerId).map((row) => row.userId),
    validationIssues: validation.errors,
  };
}

export async function growthReportingLineSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const users = await activeUsers(client);
  const validation = validateReportingLinePayload({
    employeeId: body.userId || body.employeeId,
    primaryManagerId: body.primaryManagerId,
    secondaryManagerId: body.secondaryManagerId,
    activeUserIds: users.map((row) => row.id),
  });
  if (!validation.ok) throw appError(validation.errors.join(" "), 400);
  const { data, error } = await client.rpc("save_growth_reporting_assignment", {
    p_employee_id: validation.value.employeeId,
    p_primary_manager_id: validation.value.primaryManagerId,
    p_secondary_manager_id: validation.value.secondaryManagerId,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) throw rpcError(error);
  return { reportingLine: data };
}

export async function growthCoachingBootstrap(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const [usersRaw, assignments, relationshipsResult, preferencesResult] = await Promise.all([activeUsers(client), reportingAssignments(client), client.from("growth_coaching_relationships").select("*").or(`participant_one_id.eq.${profile.id},participant_two_id.eq.${profile.id}`).order("updated_at", { ascending: false }), client.from("growth_email_preferences").select("*").eq("user_id", profile.id).maybeSingle()]);
  if (relationshipsResult.error) throw rpcError(relationshipsResult.error);
  if (preferencesResult.error) throw rpcError(preferencesResult.error);
  const users = new Map(usersRaw.map((row) => [row.id, row]));
  const visibleEmployees = visibleEmployeeIds(assignments, profile.id);
  const visibleIds = [...visibleEmployees];
  const plansResult = await client.from("growth_development_plans").select("*").in("employee_id", visibleIds).is("archived_at", null).order("updated_at", { ascending: false });
  if (plansResult.error) throw rpcError(plansResult.error);
  const goalsResult = await client.from("growth_goals").select("*").in("employee_id", visibleIds).order("updated_at", { ascending: false });
  if (goalsResult.error) throw rpcError(goalsResult.error);
  const goals = goalsResult.data || [];
  const goalIds = goals.map((row) => row.id);
  const [versionsResult, checkpointsResult, updatesResult, decisionsResult, evidenceLinksResult] = goalIds.length ? await Promise.all([client.from("growth_goal_versions").select("*").in("goal_id", goalIds), client.from("growth_goal_checkpoints").select("*").in("goal_id", goalIds), client.from("growth_goal_updates").select("*").in("goal_id", goalIds).order("submitted_at", { ascending: false }), client.from("growth_goal_decisions").select("*").in("goal_id", goalIds).order("created_at", { ascending: false }), client.from("growth_goal_collaboration_evidence").select("goal_id,item_id,linked_at,linked_by").in("goal_id", goalIds)]) : Array.from({ length: 5 }, () => ({ data: [], error: null }));
  if (versionsResult.error) throw rpcError(versionsResult.error);
  if (checkpointsResult.error) throw rpcError(checkpointsResult.error);
  if (updatesResult.error) throw rpcError(updatesResult.error);
  if (decisionsResult.error) throw rpcError(decisionsResult.error);
  if (evidenceLinksResult.error) throw rpcError(evidenceLinksResult.error);
  const versions = new Map((versionsResult.data || []).map((row) => [`${row.goal_id}:${row.version}`, row]));
  const checkpoints = checkpointsResult.data || [];
  const updates = updatesResult.data || [];
  const decisions = decisionsResult.data || [];
  const relationships = relationshipsResult.data || [];
  const relationshipIds = relationships.map((row) => row.id);
  const sessionsResult = relationshipIds.length ? await client.from("growth_coaching_sessions").select("id,relationship_id,scheduled_at,duration_minutes,status,locked_at,revision,created_at,updated_at").in("relationship_id", relationshipIds).order("scheduled_at", { ascending: false }).limit(100) : { data: [], error: null };
  if (sessionsResult.error) throw rpcError(sessionsResult.error);
  const sessions = sessionsResult.data || [];
  const sessionIds = sessions.map((row) => row.id);
  const requestedSessionId = id(body.sessionId);
  if (requestedSessionId && !sessionIds.includes(requestedSessionId)) {
    throw appError("The coaching session is unavailable.", 404);
  }
  const requestedSessionResult = requestedSessionId ? await client.from("growth_coaching_sessions").select("shared_notes,decisions,shared_revision").eq("id", requestedSessionId).maybeSingle() : { data: null, error: null };
  if (requestedSessionResult.error) throw rpcError(requestedSessionResult.error);
  const contentSessionIds = requestedSessionId ? [requestedSessionId] : [];
  const [agendaResult, notesResult, confirmationsResult, actionsResult, attachmentsResult, calendarsResult] = await Promise.all([
    contentSessionIds.length ? client.from("growth_coaching_agenda_items").select("*").in("session_id", contentSessionIds).order("item_order") : Promise.resolve({ data: [], error: null }),
    contentSessionIds.length ? client.from("growth_coaching_notes").select("*").in("session_id", contentSessionIds) : Promise.resolve({ data: [], error: null }),
    contentSessionIds.length ? client.from("growth_coaching_confirmations").select("*").in("session_id", contentSessionIds) : Promise.resolve({ data: [], error: null }),
    contentSessionIds.length ? client.from("growth_coaching_actions").select("*").in("session_id", contentSessionIds).order("due_date") : Promise.resolve({ data: [], error: null }),
    contentSessionIds.length ? client.from("growth_attachments").select("*").in("session_id", contentSessionIds).eq("upload_status", "complete") : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? client.from("growth_calendar_sync").select("*").in("session_id", sessionIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [agendaResult, notesResult, confirmationsResult, actionsResult, attachmentsResult, calendarsResult]) {
    if (result.error) throw rpcError(result.error);
  }
  const publishedItemIds = [...new Set((actionsResult.data || []).map((row) => row.published_item_id).filter(Boolean))];
  const publishedItemsResult = publishedItemIds.length ? await client.from("collaboration_items").select("id,item_key,title,status,due_date,assignee_user_id,archived_at").in("id", publishedItemIds) : { data: [], error: null };
  if (publishedItemsResult.error) throw rpcError(publishedItemsResult.error);
  const publishedItems = new Map((publishedItemsResult.data || []).map((row) => [row.id, row]));
  const calendarByRelationship = new Map();
  for (const row of calendarsResult.data || []) {
    if (!calendarByRelationship.has(row.relationship_id)) {
      calendarByRelationship.set(row.relationship_id, {
        id: row.id,
        status: row.status,
        revision: row.revision,
        errorCode: row.last_error_code,
      });
    }
  }
  const assignment = assignments.find((row) => row.employee_id === profile.id);
  const serializedGoals = goals.map((goal) => ({
    ...serializeGoal(
      goal,
      versions.get(`${goal.id}:${goal.active_version}`),
      checkpoints.filter((row) => row.goal_id === goal.id && row.goal_version === goal.active_version),
      {
        canEdit: goal.employee_id === profile.id,
        canSubmit: goal.employee_id === profile.id && Boolean(assignment?.primary_manager_id),
        canApprove: goal.primary_manager_id === profile.id,
      },
      updates.filter((row) => row.goal_id === goal.id),
      decisions.filter((row) => row.goal_id === goal.id),
      users,
    ),
    evidenceLinks: (evidenceLinksResult.data || []).filter((row) => row.goal_id === goal.id).map((row) => ({ itemId: row.item_id, linkedAt: row.linked_at })),
  }));
  const reportEmployeeIds = [...visibleEmployees].filter((userId) => userId !== profile.id);
  const directReports = reportEmployeeIds.map((userId) => {
    const reportAssignment = assignments.find((row) => row.employee_id === userId);
    const person = users.get(userId) || { id: userId, active: false };
    return {
      ...userShape(person),
      primaryManagerId: reportAssignment?.primary_manager_id || null,
      secondaryManagerId: reportAssignment?.secondary_manager_id || null,
      relationshipRole: reportAssignment?.primary_manager_id === profile.id ? "Primary manager" : reportAssignment?.secondary_manager_id === profile.id ? "Secondary manager" : "Higher manager",
      goals: serializedGoals.filter((goal) => goal.employeeId === userId),
    };
  });
  return {
    currentUser: userShape({ ...profile, active: true }),
    users: usersRaw.map(userShape),
    primaryManager: assignment?.primary_manager_id
      ? userShape(
          users.get(assignment.primary_manager_id) || {
            id: assignment.primary_manager_id,
            active: false,
          },
        )
      : null,
    secondaryManager: assignment?.secondary_manager_id
      ? userShape(
          users.get(assignment.secondary_manager_id) || {
            id: assignment.secondary_manager_id,
            active: false,
          },
        )
      : null,
    reportingLine: {
      primaryManagerId: assignment?.primary_manager_id || null,
      secondaryManagerId: assignment?.secondary_manager_id || null,
    },
    directReports,
    plans: (plansResult.data || [])
      .filter((row) => row.employee_id === profile.id)
      .map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        title: row.title,
        description: row.description,
        periodType: row.period_type,
        startDate: row.start_date,
        endDate: row.end_date,
        closeoutStatus: row.closeout_status || "Open",
        closedAt: row.closed_at || null,
        carriedForwardPlanId: row.carried_forward_plan_id || null,
        revision: Number(row.revision || 0),
      })),
    goals: serializedGoals.filter((goal) => goal.employeeId === profile.id),
    relationships: relationships.map((row) => serializeRelationship(row, users, calendarByRelationship, profile.id)),
    sessions: sessions.map((session) => {
      const sessionDetail = session.id === requestedSessionId ? { ...session, ...(requestedSessionResult.data || {}) } : session;
      const relationship = relationships.find((row) => row.id === session.relationship_id);
      const confirmations = (confirmationsResult.data || []).filter((row) => row.session_id === session.id);
      const privatePrep = (notesResult.data || []).find((row) => row.session_id === session.id && row.note_type === "private_preparation" && row.author_id === profile.id);
      return {
        id: session.id,
        relationshipId: session.relationship_id,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        status: session.status,
        lockedAt: session.locked_at,
        revision: Number(session.revision || 0),
        contentLoaded: session.id === requestedSessionId,
        content: {
          agenda: (agendaResult.data || [])
            .filter((row) => row.session_id === session.id)
            .map((row) => ({
              id: row.id,
              text: row.topic,
              mode: row.prompt_type,
              authorId: row.author_id,
              canEdit: row.author_id === profile.id && !session.locked_at,
            })),
          privatePrep: privatePrep?.body || "",
          privatePrepRevision: Number(privatePrep?.revision || 0),
          sharedNotes: sessionDetail.shared_notes || "",
          decisions: sessionDetail.decisions || "",
          addenda: (notesResult.data || [])
            .filter((row) => row.session_id === session.id && row.note_type === "addendum")
            .map((row) => ({
              id: row.id,
              authorId: row.author_id,
              body: row.body,
              createdAt: row.created_at,
            })),
        },
        confirmations: confirmations.map((row) => ({
          participantId: row.participant_id,
          userId: row.participant_id,
          confirmedAt: row.confirmed_at,
          sharedRevision: row.shared_revision,
        })),
        confirmedByMe: confirmations.some((row) => row.participant_id === profile.id),
        confirmedByFirstAt: confirmations.find((row) => row.participant_id === relationship?.participant_one_id)?.confirmed_at || null,
        confirmedBySecondAt: confirmations.find((row) => row.participant_id === relationship?.participant_two_id)?.confirmed_at || null,
        actions: (actionsResult.data || [])
          .filter((row) => row.session_id === session.id)
          .map((row) => {
            const publishedItem = publishedItems.get(row.published_item_id);
            return {
              id: row.id,
              sessionId: row.session_id,
              ownerId: row.owner_id,
              title: row.title,
              dueDate: row.due_date,
              status: publishedItem?.status || row.status,
              privateStatus: row.status,
              revision: Number(row.revision || 0),
              publishedItemId: row.published_item_id,
              publishedTaskId: row.published_item_id,
              publishedTask: publishedItem
                ? {
                    id: publishedItem.id,
                    key: publishedItem.item_key,
                    title: publishedItem.title,
                    status: publishedItem.status,
                    dueDate: publishedItem.due_date,
                    archived: Boolean(publishedItem.archived_at),
                  }
                : null,
              acceptanceStatus: row.proposal_status === "pending" ? "Pending" : row.proposal_status === "declined" ? "Declined" : "Accepted",
              proposedBy: row.proposed_by || row.created_by,
              acceptedAt: row.proposal_responded_at || null,
              canRespond: row.proposed_for === profile.id && row.proposal_status === "pending",
              canEdit: row.owner_id === profile.id && ["not_required", "accepted"].includes(row.proposal_status) && !row.published_item_id,
            };
          }),
        attachments: (attachmentsResult.data || [])
          .filter((row) => row.session_id === session.id)
          .map((row) => ({
            id: row.id,
            displayName: row.display_filename,
            contentType: row.content_type,
            size: row.content_size,
          })),
      };
    }),
    emailPreferences: {
      invitations: preferencesResult.data?.invitations !== false,
      goal_decisions: preferencesResult.data?.goal_decisions !== false,
      completion_requests: preferencesResult.data?.completion_requests !== false,
      session_confirmations: preferencesResult.data?.session_confirmations !== false,
      routine_digest: preferencesResult.data?.routine_digest !== false,
      revision: Number(preferencesResult.data?.revision || 0),
    },
    capabilities: {
      canDraftGoals: true,
      canSubmitGoals: Boolean(assignment?.primary_manager_id),
      coachingPrivate: true,
    },
  };
}

export async function growthPlanSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const titleValue = text(body.title, 255);
  const startDate = dateOnly(body.startDate);
  const endDate = dateOnly(body.endDate);
  const periodType = ["annual", "half_yearly", "custom"].includes(body.periodType) ? body.periodType : "custom";
  if (!titleValue || !startDate || !endDate || endDate < startDate) {
    throw appError("Plan title and a valid date range are required.", 400);
  }
  if (!body.id) {
    const { data, error } = await client
      .from("growth_development_plans")
      .insert({
        employee_id: profile.id,
        title: titleValue,
        description: text(body.description),
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw rpcError(error);
    await eventRow(client, {
      subjectType: "plan",
      subjectId: data.id,
      eventType: "plan_created",
      actor: profile,
      targetUserId: profile.id,
      summary: "Development plan created.",
      metadata: { periodType },
    });
    return { plan: data };
  }
  const { data: current, error: currentError } = await client.from("growth_development_plans").select("*").eq("id", body.id).eq("employee_id", profile.id).maybeSingle();
  if (currentError) throw rpcError(currentError);
  if (!current) throw appError("The development plan is unavailable.", 404);
  if (Number(current.revision) !== revision(body.expectedRevision)) {
    throw appError("The development plan changed after it was opened.", 409, {
      current,
    });
  }
  const { data, error } = await client
    .from("growth_development_plans")
    .update({
      title: titleValue,
      description: text(body.description),
      period_type: periodType,
      start_date: startDate,
      end_date: endDate,
      revision: current.revision + 1,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .eq("revision", current.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The development plan changed after it was opened.", 409);
  return { plan: data };
}

export async function growthPlanCloseout(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const mode = body.mode === "carry_forward" ? "carry_forward" : "close";
  const { data, error } = await client.rpc("save_growth_plan_closeout", {
    p_plan_id: id(body.planId),
    p_mode: mode,
    p_target_start_date: mode === "carry_forward" ? dateOnly(body.targetStartDate) : null,
    p_target_end_date: mode === "carry_forward" ? dateOnly(body.targetEndDate) : null,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
  });
  if (error) throw rpcError(error);
  return data;
}

export async function growthGoalEvidenceOptions(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const goalId = id(body.goalId);
  const { goal } = await goalForViewer(client, goalId, profile.id);
  if (goal.employee_id !== profile.id) {
    throw appError("Only the employee may select task evidence for this goal.", 403);
  }
  const query = text(body.query, 120);
  let itemsQuery = client.from("collaboration_items").select("id,item_key,title,status,due_date,completed_at:updated_at").eq("status", "Done").is("archived_at", null).order("updated_at", { ascending: false }).limit(100);
  if (query) {
    const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    itemsQuery = itemsQuery.or(`item_key.ilike.${pattern},title.ilike.${pattern}`);
  }
  const [itemsResult, linksResult] = await Promise.all([itemsQuery, client.from("growth_goal_collaboration_evidence").select("item_id,linked_at").eq("goal_id", goalId)]);
  if (itemsResult.error) throw rpcError(itemsResult.error);
  if (linksResult.error) throw rpcError(linksResult.error);
  const linked = new Map((linksResult.data || []).map((row) => [row.item_id, row]));
  return {
    items: (itemsResult.data || []).map((row) => ({
      id: row.id,
      key: row.item_key,
      title: row.title,
      status: row.status,
      dueDate: row.due_date,
      completedAt: row.completed_at,
      linked: linked.has(row.id),
      linkedAt: linked.get(row.id)?.linked_at || null,
    })),
  };
}

export async function growthGoalEvidenceSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { data, error } = await client.rpc("save_growth_goal_evidence_link", {
    p_goal_id: id(body.goalId),
    p_item_id: id(body.itemId),
    p_remove: body.remove === true,
    p_actor_id: profile.id,
  });
  if (error) throw rpcError(error);
  return data;
}

export async function growthGoalSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const measurement = normalizeMeasurement(body.measurement || {});
  const checkpoints = normalizeCheckpoints(body.checkpoints || []);
  const validation = validateGrowthGoalPayload({
    title: body.title,
    description: body.description,
    status: "Draft",
    deadline: body.deadline,
    measurement,
    checkpoints,
  });
  if (!validation.ok) throw appError(validation.errors.join(" "), 400);
  const { data, error } = await client.rpc("save_growth_goal_draft", {
    p_values: {
      id: id(body.id),
      planId: id(body.planId),
      title: validation.value.title,
      description: validation.value.description,
      deadline: validation.value.deadline,
      measurement: validation.value.measurement,
      expectedRevision: revision(body.expectedRevision),
    },
    p_checkpoints: validation.value.checkpoints.map((row, index) => ({
      id: checkpoints[index]?.id || randomUUID(),
      ...row,
    })),
    p_actor_id: profile.id,
  });
  if (error) throw rpcError(error);
  return data;
}

async function goalDecisionContext(client, goalId, profile) {
  const { goal } = await goalForViewer(client, goalId, profile.id);
  const isEmployee = goal.employee_id === profile.id;
  const isPrimaryManager = goal.primary_manager_id === profile.id;
  return { goal, isEmployee, isPrimaryManager };
}

export async function growthGoalSubmit(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { goal, isEmployee } = await goalDecisionContext(client, id(body.goalId), profile);
  if (!isEmployee) throw appError("Only the employee may submit this goal.", 403);
  if (!goal.primary_manager_id) throw appError("A primary manager is required before submission.", 400);
  if (!["Draft", "Revision Requested"].includes(goal.status)) {
    throw appError("This goal is not ready for submission.", 400);
  }
  if (Number(goal.revision) !== revision(body.expectedRevision)) {
    throw appError("The goal changed after it was opened.", 409, {
      current: goal,
    });
  }
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("growth_goals")
    .update({
      status: "Pending Approval",
      revision: goal.revision + 1,
      updated_by: profile.id,
      updated_at: now,
    })
    .eq("id", goal.id)
    .eq("revision", goal.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The goal changed after it was opened.", 409);
  await client.from("growth_goal_versions").update({ submitted_at: now }).eq("goal_id", goal.id).eq("version", goal.active_version);
  const { data: manager } = await client.from("user_profiles").select("id,email,full_name").eq("id", goal.primary_manager_id).eq("active", true).maybeSingle();
  await notify(client, {
    actor: profile,
    user: manager,
    subjectType: "goal",
    subjectId: goal.id,
    eventType: "goal_submitted",
    notificationType: "goal_approval",
    title: "Development goal awaiting approval",
    message: "A direct report submitted a development goal.",
    category: "goal_decisions",
    dedupeKey: `goal:${goal.id}:submitted:${data.revision}`,
    metadata: { status: data.status, version: goal.active_version },
  });
  return { goal: data };
}

export async function growthGoalDecision(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { goal, isPrimaryManager } = await goalDecisionContext(client, id(body.goalId), profile);
  if (!isPrimaryManager) throw appError("Only the current primary manager may decide this goal.", 403);
  if (goal.status !== "Pending Approval") throw appError("This goal is not pending approval.", 400);
  if (Number(goal.revision) !== revision(body.expectedRevision)) {
    throw appError("The goal changed after it was opened.", 409, {
      current: goal,
    });
  }
  const approved = body.decision === "approve";
  if (!approved && !text(body.note, 10_000)) throw appError("A revision request needs a note.", 400);
  const nextStatus = approved ? "Active" : "Revision Requested";
  const { data, error } = await client.rpc("decide_growth_goal", {
    p_goal_id: goal.id,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
    p_operation: approved ? "approve" : "revision",
    p_note: text(body.note, 10_000),
    p_evidence: "",
  });
  if (error) throw rpcError(error);
  const saved = data?.goal;
  if (!saved) throw appError("The goal decision could not be saved.", 503);
  const { data: employee } = await client.from("user_profiles").select("id,email,full_name").eq("id", goal.employee_id).eq("active", true).maybeSingle();
  await notify(client, {
    actor: profile,
    user: employee,
    subjectType: "goal",
    subjectId: goal.id,
    eventType: approved ? "goal_approved" : "goal_revision_requested",
    notificationType: "goal_decision",
    title: approved ? "Development goal approved" : "Development goal revision requested",
    message: approved ? "Your development goal is active." : "Your primary manager requested a revision.",
    category: "goal_decisions",
    dedupeKey: `goal:${goal.id}:decision:${saved.revision}`,
    metadata: { status: nextStatus, version: goal.active_version },
  });
  return { goal: saved };
}

export async function growthGoalProgressSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { goal, isEmployee, isPrimaryManager } = await goalDecisionContext(client, id(body.goalId), profile);
  const expectedRevision = revision(body.expectedRevision);
  if (Number(goal.revision) !== expectedRevision) {
    throw appError("The goal changed after it was opened.", 409, {
      current: goal,
    });
  }
  if (!isEmployee) {
    if (!isPrimaryManager) throw appError("Only the current primary manager may comment on this goal.", 403);
    const comment = text(body.comment, 10_000);
    if (!comment) throw appError("A manager comment is required.", 400);
    if (!["Active", "Completion Review"].includes(goal.status)) {
      throw appError("Manager comments are available for active or completion-review goals.", 400);
    }
    const { data, error } = await client.rpc("save_growth_goal_progress", {
      p_goal_id: goal.id,
      p_expected_revision: expectedRevision,
      p_actor_id: profile.id,
      p_mode: "manager_comment",
      p_measurement: null,
      p_progress: null,
      p_checkpoint_id: null,
      p_actual_result: "",
      p_evidence: "",
      p_tracking_state: null,
      p_comment: comment,
    });
    if (error) throw rpcError(error);
    await eventRow(client, {
      subjectType: "goal",
      subjectId: goal.id,
      eventType: "manager_comment_added",
      actor: profile,
      targetUserId: goal.employee_id,
      summary: "Manager comment added to a development goal.",
      metadata: { status: goal.status },
    });
    return data;
  }
  if (goal.status !== "Active") throw appError("Only an active goal accepts progress updates.", 400);
  const checkpointId = body.checkpointId === "__none__" ? null : id(body.checkpointId);
  const trackingState =
    {
      "On track": "On Track",
      "At risk": "At Risk",
      "Off track": "Off Track",
    }[body.state] ||
    body.state ||
    null;
  if (trackingState && !["On Track", "At Risk", "Off Track"].includes(trackingState)) {
    throw appError("Select a valid progress signal.", 400);
  }
  const { data: version, error: versionError } = await client.from("growth_goal_versions").select("measurement").eq("goal_id", goal.id).eq("version", goal.active_version).single();
  if (versionError) throw rpcError(versionError);
  const measurement = { ...(version?.measurement || {}) };
  if (measurement.type === "numeric") {
    if (body.currentValue === "" || body.currentValue == null || !Number.isFinite(Number(body.currentValue))) {
      throw appError("Enter the current numeric result.", 400);
    }
    measurement.current = Number(body.currentValue);
  } else if (measurement.type === "milestones") {
    const incoming = Array.isArray(body.milestoneProgress) ? body.milestoneProgress : [];
    const byId = new Map(incoming.map((row) => [id(row.id), Number(row.progress)]));
    if (!measurement.milestones?.length || byId.size !== measurement.milestones.length) {
      throw appError("Record progress for every weighted milestone.", 400);
    }
    measurement.milestones = measurement.milestones.map((row) => {
      const value = byId.get(id(row.id));
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw appError("Milestone progress must be between 0 and 100.", 400);
      }
      return { ...row, progress: value };
    });
  } else if (measurement.type === "outcome_rubric") {
    const currentLevelId = id(body.currentLevelId);
    if (!currentLevelId || !measurement.levels?.some((row) => id(row.id) === currentLevelId)) {
      throw appError("Select a defined outcome level.", 400);
    }
    measurement.currentLevelId = currentLevelId;
  } else {
    throw appError("The goal measurement is unavailable.", 503);
  }
  const progress = goalProgress(measurement);
  const { data, error } = await client.rpc("save_growth_goal_progress", {
    p_goal_id: goal.id,
    p_expected_revision: expectedRevision,
    p_actor_id: profile.id,
    p_mode: "employee_progress",
    p_measurement: measurement,
    p_progress: progress,
    p_checkpoint_id: checkpointId,
    p_actual_result: text(body.actualResult),
    p_evidence: text(body.evidence, 10_000),
    p_tracking_state: trackingState,
    p_comment: text(body.comment, 10_000),
  });
  if (error) throw rpcError(error);
  await eventRow(client, {
    subjectType: "goal",
    subjectId: goal.id,
    eventType: "goal_progress_saved",
    actor: profile,
    targetUserId: goal.primary_manager_id,
    summary: "Development goal progress updated.",
    metadata: {
      progress,
      hasEvidence: Boolean(text(body.evidence)),
      hasCheckpoint: Boolean(checkpointId),
    },
  });
  return data;
}

export async function growthGoalCompletion(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { goal, isEmployee, isPrimaryManager } = await goalDecisionContext(client, id(body.goalId), profile);
  if (Number(goal.revision) !== revision(body.expectedRevision)) {
    throw appError("The goal changed after it was opened.", 409, {
      current: goal,
    });
  }
  const outcome = body.outcome;
  let nextStatus;
  if (outcome === "request_completion") {
    if (!isEmployee || goal.status !== "Active") throw appError("Only the employee may request completion for an active goal.", 403);
    if (!text(body.evidence, 10_000)) throw appError("Final evidence is required.", 400);
    nextStatus = "Completion Review";
  } else if (outcome === "request_cancellation") {
    if (!isEmployee || !["Active", "Revision Requested"].includes(goal.status)) {
      throw appError("Only the employee may request cancellation.", 403);
    }
    if (!text(body.note, 10_000)) throw appError("A cancellation request needs a reason.", 400);
    nextStatus = "Cancellation Requested";
  } else if (["complete", "not_achieved"].includes(outcome)) {
    if (!isPrimaryManager) throw appError("Only the current primary manager may confirm the outcome.", 403);
    if (goal.status !== "Completion Review") {
      throw appError("The manager can record an outcome only during completion review.", 400);
    }
    if (outcome === "complete" && !text(goal.completion_evidence, 10_000)) {
      throw appError("Employee completion evidence is required.", 400);
    }
    if (outcome === "not_achieved" && !text(body.note, 10_000)) {
      throw appError("This outcome needs a note.", 400);
    }
    nextStatus = outcome === "complete" ? "Completed" : "Not Achieved";
  } else if (outcome === "cancel") {
    if (!isPrimaryManager) throw appError("Only the current primary manager may approve cancellation.", 403);
    if (goal.status !== "Cancellation Requested") {
      throw appError("Cancellation can be approved only after an employee request.", 400);
    }
    nextStatus = "Not Achieved";
  } else {
    throw appError("Select a valid completion outcome.", 400);
  }
  const { data, error } = await client.rpc("decide_growth_goal", {
    p_goal_id: goal.id,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
    p_operation: outcome,
    p_note: text(body.note, 10_000),
    p_evidence: text(body.evidence, 10_000),
  });
  if (error) throw rpcError(error);
  const saved = data?.goal;
  const decisionType = data?.decisionType;
  if (!saved || !decisionType) throw appError("The goal outcome could not be saved.", 503);
  const targetId = isEmployee ? goal.primary_manager_id : goal.employee_id;
  const { data: target } = await client.from("user_profiles").select("id,email,full_name").eq("id", targetId).eq("active", true).maybeSingle();
  await notify(client, {
    actor: profile,
    user: target,
    subjectType: "goal",
    subjectId: goal.id,
    eventType: `goal_${decisionType}`,
    notificationType: "goal_completion",
    title: outcome === "request_completion" ? "Development goal completion review requested" : "Development goal outcome updated",
    message: outcome === "request_completion" ? "A direct report submitted final evidence." : "A development goal outcome was recorded.",
    category: "completion_requests",
    dedupeKey: `goal:${goal.id}:completion:${saved.revision}`,
    metadata: { status: nextStatus },
  });
  return { goal: saved };
}

export async function coachingRelationshipInvite(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const inviteeId = id(body.inviteeId);
  if (!inviteeId || inviteeId === profile.id) throw appError("Select another active user.", 400);
  const { data: invitee, error: inviteeError } = await client.from("user_profiles").select("id,email,full_name,active").eq("id", inviteeId).eq("active", true).maybeSingle();
  if (inviteeError) throw rpcError(inviteeError);
  if (!invitee) throw appError("The selected coaching partner is inactive or unavailable.", 400);
  const [one, two] = pairIds(profile.id, invitee.id);
  const cadence = ["weekly", "fortnightly", "monthly", "custom"].includes(body.cadence) ? body.cadence : "fortnightly";
  const customCadenceDays = cadence === "custom" ? Number(body.customCadenceDays) : null;
  if (cadence === "custom" && (!Number.isInteger(customCadenceDays) || customCadenceDays < 1 || customCadenceDays > 90)) {
    throw appError("Custom cadence must be between 1 and 90 days.", 400);
  }
  const { data, error } = await client
    .from("growth_coaching_relationships")
    .insert({
      participant_one_id: one,
      participant_two_id: two,
      inviter_id: profile.id,
      calendar_owner_id: profile.id,
      cadence,
      custom_cadence_days: customCadenceDays,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw appError("An active coaching relationship or invitation already exists for this pair.", 409);
  if (error) throw rpcError(error);
  await notify(client, {
    actor: profile,
    user: invitee,
    subjectType: "coaching_relationship",
    subjectId: data.id,
    eventType: "coaching_invited",
    notificationType: "coaching_invitation",
    title: "New coaching invitation",
    message: "An FCOS user invited you to a private coaching relationship.",
    category: "invitations",
    dedupeKey: `relationship:${data.id}:invite`,
    metadata: { cadence, customCadenceDays },
  });
  return { relationship: data };
}

export async function coachingRelationshipRespond(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const relationship = await relationshipForActor(client, id(body.relationshipId), profile.id);
  if (relationship.status !== "Pending" || relationship.inviter_id === profile.id) {
    throw appError("Only the invited participant may respond to this invitation.", 403);
  }
  if (Number(relationship.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching invitation changed after it was opened.", 409, { current: relationship });
  }
  const accepted = body.response === "accept";
  if (!accepted && body.response !== "decline") throw appError("Select accept or decline.", 400);
  const { data, error } = await client
    .from("growth_coaching_relationships")
    .update({
      status: accepted ? "Active" : "Declined",
      responded_at: new Date().toISOString(),
      revision: relationship.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", relationship.id)
    .eq("revision", relationship.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The coaching invitation changed after it was opened.", 409);
  const { data: inviter } = await client.from("user_profiles").select("id,email,full_name").eq("id", relationship.inviter_id).eq("active", true).maybeSingle();
  await notify(client, {
    actor: profile,
    user: inviter,
    subjectType: "coaching_relationship",
    subjectId: relationship.id,
    eventType: accepted ? "coaching_accepted" : "coaching_declined",
    notificationType: "coaching_response",
    title: accepted ? "Coaching invitation accepted" : "Coaching invitation declined",
    message: accepted ? "Your private coaching relationship is active." : "Your coaching invitation was declined.",
    category: "invitations",
    dedupeKey: `relationship:${relationship.id}:response:${data.revision}`,
    metadata: { status: data.status },
  });
  return { relationship: data };
}

export async function coachingRelationshipEnd(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const relationship = await relationshipForActor(client, id(body.relationshipId), profile.id);
  if (!["Pending", "Active"].includes(relationship.status)) throw appError("This relationship has already ended.", 400);
  if (Number(relationship.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching relationship changed after it was opened.", 409, { current: relationship });
  }
  const { data, error } = await client
    .from("growth_coaching_relationships")
    .update({
      status: relationship.status === "Pending" ? "Cancelled" : "Ended",
      ended_at: new Date().toISOString(),
      ended_by: profile.id,
      revision: relationship.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", relationship.id)
    .eq("revision", relationship.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The coaching relationship changed after it was opened.", 409);
  await eventRow(client, {
    subjectType: "coaching_relationship",
    subjectId: relationship.id,
    eventType: "coaching_ended",
    actor: profile,
    summary: "Coaching relationship ended.",
    metadata: { status: data.status },
  });
  return { relationship: data };
}

async function calendarEventForSession(client, relationship, session) {
  const participantIds = [relationship.participant_one_id, relationship.participant_two_id];
  const { data: people, error } = await client.from("user_profiles").select("id,email,full_name,active").in("id", participantIds);
  if (error) throw rpcError(error);
  const byId = new Map((people || []).map((row) => [row.id, row]));
  const organizer = byId.get(relationship.calendar_owner_id);
  const attendeeId = relationship.calendar_owner_id === relationship.participant_one_id ? relationship.participant_two_id : relationship.participant_one_id;
  const attendee = byId.get(attendeeId);
  if (!organizer?.active || !attendee?.active) throw appError("Both coaching participants need active FCOS mailboxes.", 400);
  const end = new Date(new Date(session.scheduled_at).getTime() + session.duration_minutes * 60_000);
  return {
    organizer,
    attendee,
    payload: growthCalendarEventPayload({
      subject: `FCOS 1:1: ${organizer.full_name || organizer.email} and ${attendee.full_name || attendee.email}`,
      startDateTime: hkGraphDateTime(session.scheduled_at),
      endDateTime: hkGraphDateTime(end),
      attendeeEmail: attendee.email,
      attendeeName: attendee.full_name || attendee.email,
      fcosUrl: `${publicUrl()}${PUBLIC_PATH}`,
      transactionId: `growth-${session.id}`,
    }),
  };
}

async function synchronizeSessionCalendar(client, relationship, session, { force = false } = {}) {
  const eventInfo = await calendarEventForSession(client, relationship, session);
  let { data: sync, error: syncError } = await client.from("growth_calendar_sync").select("*").eq("session_id", session.id).maybeSingle();
  if (syncError) throw rpcError(syncError);
  const base = {
    relationship_id: relationship.id,
    session_id: session.id,
    organizer_user_id: eventInfo.organizer.id,
    organizer_email: eventInfo.organizer.email,
    transaction_id: `growth-${session.id}`,
    fcos_schedule: {
      scheduledAt: session.scheduled_at,
      durationMinutes: session.duration_minutes,
    },
    last_attempt_at: new Date().toISOString(),
  };
  if (!growthCalendarConfigured()) {
    const payload = {
      ...base,
      status: "Unavailable",
      last_error_code: "OUTLOOK_NOT_CONFIGURED",
    };
    const result = sync
      ? await client
          .from("growth_calendar_sync")
          .update({
            ...payload,
            revision: sync.revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sync.id)
          .select("*")
          .single()
      : await client.from("growth_calendar_sync").insert(payload).select("*").single();
    if (result.error) throw rpcError(result.error);
    return result.data;
  }
  try {
    let graphEvent;
    if (sync?.outlook_event_id) {
      const remote = await growthCalendarGet({
        organizerEmail: sync.organizer_email,
        eventId: sync.outlook_event_id,
      });
      if (!force && sync.outlook_etag && remote?.["@odata.etag"] && remote["@odata.etag"] !== sync.outlook_etag) {
        const { data, error } = await client
          .from("growth_calendar_sync")
          .update({
            ...base,
            status: "Conflict",
            outlook_schedule: { start: remote.start, end: remote.end },
            outlook_etag: remote["@odata.etag"],
            last_error_code: "OUTLOOK_EVENT_CONFLICT",
            revision: sync.revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sync.id)
          .select("*")
          .single();
        if (error) throw rpcError(error);
        return data;
      }
      graphEvent = await growthCalendarUpdate({
        organizerEmail: eventInfo.organizer.email,
        eventId: sync.outlook_event_id,
        expectedEtag: sync.outlook_etag,
        event: eventInfo.payload,
      });
    } else {
      graphEvent = await growthCalendarCreate({
        organizerEmail: eventInfo.organizer.email,
        event: eventInfo.payload,
      });
    }
    const payload = {
      ...base,
      status: "Synced",
      outlook_event_id: graphEvent?.id || sync?.outlook_event_id,
      outlook_etag: graphEvent?.["@odata.etag"] || null,
      outlook_schedule: {
        start: graphEvent?.start || null,
        end: graphEvent?.end || null,
      },
      last_error_code: null,
    };
    const result = sync
      ? await client
          .from("growth_calendar_sync")
          .update({
            ...payload,
            revision: sync.revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sync.id)
          .select("*")
          .single()
      : await client.from("growth_calendar_sync").insert(payload).select("*").single();
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    const status = error.code === "OUTLOOK_EVENT_CONFLICT" ? "Conflict" : ["OUTLOOK_NOT_CONFIGURED", "EXTERNAL_ACTION_GATE_DISABLED"].includes(error.code) ? "Unavailable" : "Failed";
    const payload = {
      ...base,
      status,
      last_error_code: error.code || "OUTLOOK_CALENDAR_FAILED",
    };
    const result = sync
      ? await client
          .from("growth_calendar_sync")
          .update({
            ...payload,
            revision: sync.revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sync.id)
          .select("*")
          .single()
      : await client.from("growth_calendar_sync").insert(payload).select("*").single();
    if (result.error) throw rpcError(result.error);
    return result.data;
  }
}

async function synchronizeSessionCalendarSafely(client, relationship, session, options = {}) {
  try {
    return await synchronizeSessionCalendar(client, relationship, session, options);
  } catch (error) {
    const status = ["OUTLOOK_NOT_CONFIGURED", "EXTERNAL_ACTION_GATE_DISABLED"].includes(error.code) ? "Unavailable" : "Failed";
    const fallback = {
      relationship_id: relationship.id,
      session_id: session.id,
      organizer_user_id: relationship.calendar_owner_id,
      organizer_email: "",
      transaction_id: `growth-${session.id}`,
      status,
      fcos_schedule: {
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
      },
      last_error_code: error.code || "OUTLOOK_CALENDAR_FAILED",
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const { data: current } = await client.from("growth_calendar_sync").select("id,revision").eq("session_id", session.id).maybeSingle();
      const result = current
        ? await client
            .from("growth_calendar_sync")
            .update({
              ...fallback,
              revision: current.revision + 1,
            })
            .eq("id", current.id)
            .select("*")
            .single()
        : await client.from("growth_calendar_sync").insert(fallback).select("*").single();
      if (!result.error && result.data) return result.data;
    } catch {
      // Calendar telemetry must never roll back the FCOS coaching record.
    }
    return {
      ...fallback,
      errorCode: fallback.last_error_code,
    };
  }
}

export async function coachingSessionSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const relationship = await relationshipForActor(client, id(body.relationshipId), profile.id, { activeOnly: true });
  const scheduledAt = parseHongKongDateTime(body.scheduledAt);
  const durationMinutes = Math.max(15, Math.min(Number(body.durationMinutes || 45), 240));
  if (Number.isNaN(scheduledAt.getTime())) throw appError("A valid session date and time is required.", 400);
  if (scheduledAt.getTime() > Date.now() + 90 * 86_400_000) {
    throw appError("Sessions may be scheduled within the rolling 90-day calendar horizon.", 400);
  }
  let session;
  if (body.id) {
    const context = await sessionForActor(client, id(body.id), profile.id, {
      activeOnly: true,
    });
    if (context.session.relationship_id !== relationship.id) {
      throw appError("The selected session does not belong to this coaching relationship.", 400);
    }
    if (context.session.locked_at) throw appError("A confirmed session is locked.", 400);
    if (Number(context.session.revision) !== revision(body.expectedRevision)) {
      throw appError("The coaching session changed after it was opened.", 409, {
        current: context.session,
      });
    }
    const { data, error } = await client
      .from("growth_coaching_sessions")
      .update({
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
        revision: context.session.revision + 1,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.session.id)
      .eq("revision", context.session.revision)
      .select("*")
      .maybeSingle();
    if (error) throw rpcError(error);
    if (!data) throw appError("The coaching session changed after it was opened.", 409);
    session = data;
  } else {
    const { count, error: countError } = await client.from("growth_coaching_sessions").select("id", { count: "exact", head: true }).eq("relationship_id", relationship.id).gte("scheduled_at", new Date().toISOString());
    if (countError) throw rpcError(countError);
    if (Number(count || 0) >= 12) throw appError("A relationship may have at most 12 future sessions.", 400);
    const { data, error } = await client
      .from("growth_coaching_sessions")
      .insert({
        relationship_id: relationship.id,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw rpcError(error);
    session = data;
  }
  if (!body.id && body.carryForwardFromSessionId) {
    const sourceContext = await sessionForActor(client, id(body.carryForwardFromSessionId), profile.id);
    if (sourceContext.session.relationship_id !== relationship.id) {
      throw appError("Agenda topics can only carry forward within the same coaching relationship.", 400);
    }
    const { data: sourceAgenda, error: sourceAgendaError } = await client.from("growth_coaching_agenda_items").select("id,author_id,item_order,topic,prompt_type").eq("session_id", sourceContext.session.id).order("item_order");
    if (sourceAgendaError) throw rpcError(sourceAgendaError);
    if (sourceAgenda?.length) {
      const { error: carryError } = await client.from("growth_coaching_agenda_items").insert(
        sourceAgenda.map((row, index) => ({
          session_id: session.id,
          author_id: row.author_id,
          item_order: index,
          topic: row.topic,
          prompt_type: row.prompt_type,
          rolled_over_from_agenda_item_id: row.id,
          rolled_over_at: new Date().toISOString(),
          rolled_over_by: profile.id,
        })),
      );
      if (carryError) throw rpcError(carryError);
    }
  }
  const calendar = await synchronizeSessionCalendarSafely(client, relationship, session);
  await eventRow(client, {
    subjectType: "coaching_session",
    subjectId: session.id,
    eventType: body.id ? "session_rescheduled" : "session_scheduled",
    actor: profile,
    summary: body.id ? "Coaching session rescheduled." : "Coaching session scheduled.",
    metadata: { calendarStatus: calendar.status, durationMinutes },
  });
  return { session, calendar };
}

export async function coachingSessionCancel(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { session } = await sessionForActor(client, id(body.sessionId), profile.id, { activeOnly: true });
  if (Number(session.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching session changed after it was opened.", 409, {
      current: session,
    });
  }
  if (session.status === "Cancelled") return { session, calendarStatus: "Synced" };
  if (session.locked_at || session.status === "Confirmed") {
    throw appError("A confirmed coaching session is locked and cannot be cancelled.", 400);
  }
  if (!["Scheduled", "Awaiting Confirmation"].includes(session.status)) {
    throw appError("This coaching session cannot be cancelled in its current state.", 400);
  }
  const { data: saved, error } = await client
    .from("growth_coaching_sessions")
    .update({
      status: "Cancelled",
      revision: session.revision + 1,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("revision", session.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!saved) throw appError("The coaching session changed after it was opened.", 409);
  let calendarStatus = "Synced";
  const { data: sync } = await client.from("growth_calendar_sync").select("*").eq("session_id", session.id).maybeSingle();
  if (sync?.outlook_event_id) {
    try {
      await growthCalendarCancel({
        organizerEmail: sync.organizer_email,
        eventId: sync.outlook_event_id,
        expectedEtag: sync.outlook_etag,
      });
      await client
        .from("growth_calendar_sync")
        .update({
          status: "Synced",
          last_error_code: null,
          revision: sync.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sync.id);
    } catch (calendarError) {
      calendarStatus = calendarError.code === "OUTLOOK_NOT_CONFIGURED" ? "Unavailable" : "Failed";
      await client
        .from("growth_calendar_sync")
        .update({
          status: calendarStatus,
          last_error_code: calendarError.code || "OUTLOOK_CALENDAR_FAILED",
          revision: sync.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sync.id);
    }
  }
  await eventRow(client, {
    subjectType: "coaching_session",
    subjectId: session.id,
    eventType: "session_cancelled",
    actor: profile,
    summary: "Coaching session cancelled.",
    metadata: { calendarStatus },
  });
  return { session: saved, calendarStatus };
}

export async function coachingSessionContentSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { session, relationship } = await sessionForActor(client, id(body.sessionId), profile.id);
  if (session.status === "Cancelled") throw appError("A cancelled coaching session is read-only.", 400);
  if (Number(session.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching session changed after it was opened.", 409, {
      current: session,
    });
  }
  const kind = body.contentType;
  if (session.locked_at && !(kind === "shared" && text(body.addendum))) {
    throw appError("Confirmed session content is locked. Add an append-only correction instead.", 400);
  }
  if (kind === "privatePrep") {
    const { data, error } = await client.rpc("save_growth_private_preparation", {
      p_session_id: session.id,
      p_expected_revision: revision(body.expectedPrivatePrepRevision),
      p_actor_id: profile.id,
      p_body: text(body.privatePrep),
    });
    if (error) throw rpcError(error);
    return data;
  }
  if (!["agenda", "shared"].includes(kind)) {
    throw appError("Select a valid session content type.", 400);
  }
  const addendum = text(body.addendum);
  const rpcContentType = session.locked_at && addendum ? "addendum" : kind;
  const { data, error } = await client.rpc("save_growth_coaching_session_content", {
    p_session_id: session.id,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
    p_content_type: rpcContentType,
    p_payload:
      rpcContentType === "agenda"
        ? { agenda: Array.isArray(body.agenda) ? body.agenda : [] }
        : rpcContentType === "addendum"
          ? { addendum }
          : {
              sharedNotes: text(body.sharedNotes),
              decisions: text(body.decisions),
            },
  });
  if (error) throw rpcError(error);
  await eventRow(client, {
    subjectType: "coaching_session",
    subjectId: session.id,
    eventType: rpcContentType === "addendum" ? "session_addendum_added" : `session_${kind}_saved`,
    actor: profile,
    summary: rpcContentType === "addendum" ? "Append-only session correction added." : "Coaching session content updated.",
    metadata: {
      contentType: rpcContentType,
      confirmationsCleared: rpcContentType !== "addendum",
      relationshipId: relationship.id,
    },
  });
  return data;
}

export async function coachingSessionConfirm(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { session, relationship } = await sessionForActor(client, id(body.sessionId), profile.id);
  if (session.locked_at) throw appError("This session is already confirmed and locked.", 400);
  if (Number(session.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching session changed after it was opened.", 409, {
      current: session,
    });
  }
  const { data, error } = await client.rpc("confirm_growth_coaching_session", {
    p_session_id: session.id,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
  });
  if (error) throw rpcError(error);
  if (!data?.locked) {
    const otherId = relationship.participant_one_id === profile.id ? relationship.participant_two_id : relationship.participant_one_id;
    const { data: other } = await client.from("user_profiles").select("id,email,full_name").eq("id", otherId).eq("active", true).maybeSingle();
    await notify(client, {
      actor: profile,
      user: other,
      subjectType: "coaching_session",
      subjectId: session.id,
      eventType: "session_confirmation_requested",
      notificationType: "session_confirmation",
      title: "Coaching session confirmation requested",
      message: "Your coaching partner confirmed the shared session record.",
      category: "session_confirmations",
      dedupeKey: `session:${session.id}:confirm:${session.revision}:${otherId}`,
      metadata: { scheduledAt: session.scheduled_at },
      dueDate: session.scheduled_at?.slice(0, 10),
    });
  }
  return data;
}

export async function coachingActionSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { session, relationship } = await sessionForActor(client, id(body.sessionId), profile.id);
  const ownerId = id(body.ownerId) || profile.id;
  if (![relationship.participant_one_id, relationship.participant_two_id].includes(ownerId)) {
    throw appError("A coaching action owner must be one of the two participants.", 400);
  }
  const titleValue = text(body.title, 255);
  const dueDate = dateOnly(body.dueDate);
  const status = ["To Do", "In Progress", "Blocked", "Done", "Cancelled"].includes(body.status) ? body.status : "To Do";
  if (!titleValue || !dueDate) throw appError("Action title and due date are required.", 400);
  if (!body.id) {
    const proposedForPartner = ownerId !== profile.id;
    const { data, error } = await client
      .from("growth_coaching_actions")
      .insert({
        session_id: session.id,
        owner_id: ownerId,
        title: titleValue,
        due_date: dueDate,
        status,
        proposed_by: proposedForPartner ? profile.id : null,
        proposed_for: proposedForPartner ? ownerId : null,
        proposal_status: proposedForPartner ? "pending" : "not_required",
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw rpcError(error);
    if (proposedForPartner) {
      const { data: owner } = await client.from("user_profiles").select("id,email,full_name").eq("id", ownerId).eq("active", true).maybeSingle();
      await notify(client, {
        actor: profile,
        user: owner,
        subjectType: "coaching_action",
        subjectId: data.id,
        eventType: "coaching_action_proposed",
        notificationType: "coaching_action_proposal",
        title: "Coaching action proposed",
        message: "Your coaching partner proposed a private follow-up action for you.",
        category: "session_confirmations",
        dedupeKey: `coaching-action:${data.id}:proposed:${data.revision}`,
        metadata: { dueDate: data.due_date },
        dueDate: data.due_date,
      });
    }
    return { action: data };
  }
  const { data: current, error: currentError } = await client.from("growth_coaching_actions").select("*").eq("id", id(body.id)).eq("session_id", session.id).maybeSingle();
  if (currentError) throw rpcError(currentError);
  if (!current) throw appError("The coaching action is unavailable.", 404);
  if (current.owner_id !== profile.id) throw appError("Only the action owner may edit it.", 403);
  if (current.proposal_status === "pending") {
    throw appError("Accept or decline the proposed action before editing it.", 400);
  }
  if (current.proposal_status === "declined") {
    throw appError("A declined coaching action cannot be edited. Create a new proposal instead.", 400);
  }
  if (current.published_item_id) {
    throw appError("The published Projects & Tasks item is now authoritative.", 400);
  }
  if (Number(current.revision) !== revision(body.expectedRevision)) {
    throw appError("The coaching action changed after it was opened.", 409, {
      current,
    });
  }
  const { data, error } = await client
    .from("growth_coaching_actions")
    .update({
      title: titleValue,
      owner_id: ownerId,
      due_date: dueDate,
      status,
      proposed_by: ownerId !== current.owner_id ? profile.id : current.proposed_by,
      proposed_for: ownerId !== current.owner_id ? ownerId : current.proposed_for,
      proposal_status: ownerId !== current.owner_id ? "pending" : current.proposal_status,
      proposal_note: ownerId !== current.owner_id ? "" : current.proposal_note,
      proposal_responded_at: ownerId !== current.owner_id ? null : current.proposal_responded_at,
      proposal_responded_by: ownerId !== current.owner_id ? null : current.proposal_responded_by,
      revision: current.revision + 1,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .eq("revision", current.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The coaching action changed after it was opened.", 409);
  if (ownerId !== current.owner_id) {
    const { data: owner } = await client.from("user_profiles").select("id,email,full_name").eq("id", ownerId).eq("active", true).maybeSingle();
    await notify(client, {
      actor: profile,
      user: owner,
      subjectType: "coaching_action",
      subjectId: data.id,
      eventType: "coaching_action_proposed",
      notificationType: "coaching_action_proposal",
      title: "Coaching action proposed",
      message: "Your coaching partner proposed a private follow-up action for you.",
      category: "session_confirmations",
      dedupeKey: `coaching-action:${data.id}:proposed:${data.revision}`,
      metadata: { dueDate: data.due_date },
      dueDate: data.due_date,
    });
  }
  return { action: data };
}

export async function coachingActionProposalRespond(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const response = body.response === "accept" ? "accept" : body.response === "decline" ? "decline" : null;
  if (!response) throw appError("Accept or decline the proposed action.", 400);
  const { data, error } = await client.rpc("respond_growth_coaching_action_proposal", {
    p_action_id: id(body.actionId),
    p_response: response,
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
  });
  if (error) throw rpcError(error);
  return data;
}

export async function coachingActionPublish(body = {}, accessContext) {
  const { client, profile } = accessContext;
  if (body.confirmedPublicVisibility !== true) {
    throw appError("Confirm that the task becomes visible to every FCOS user.", 400);
  }
  const { data, error } = await client.rpc("publish_growth_coaching_action", {
    p_action_id: id(body.actionId),
    p_expected_revision: revision(body.expectedRevision),
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) throw rpcError(error);
  return data;
}

async function attachmentScope(client, body, profile, { write = false } = {}) {
  if (body.sessionId) {
    const { session } = await sessionForActor(client, id(body.sessionId), profile.id);
    if (write && (session.status === "Cancelled" || session.status === "Confirmed" || session.locked_at)) {
      throw appError("Attachments cannot be added to a cancelled or confirmed coaching session.", 400);
    }
    return { sessionId: id(body.sessionId), goalId: null };
  }
  if (body.goalId) {
    const { goal } = await goalForViewer(client, id(body.goalId), profile.id);
    if (write && goal.employee_id !== profile.id) {
      throw appError("Only the employee may add files to their development goal.", 403);
    }
    return { sessionId: null, goalId: id(body.goalId) };
  }
  throw appError("A goal or coaching session is required.", 400);
}

async function attachmentForActor(client, attachmentId, profile, { write = false } = {}) {
  const { data, error } = await client.from("growth_attachments").select("*").eq("id", attachmentId).maybeSingle();
  if (error) throw rpcError(error);
  if (!data || data.upload_status === "deleted") throw appError("The attachment is unavailable.", 404);
  await attachmentScope(client, { sessionId: data.session_id, goalId: data.goal_id }, profile, { write });
  return data;
}

export async function growthAttachmentPrepare(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const scope = await attachmentScope(client, body, profile, { write: true });
  const validation = validateCollaborationAttachment({
    fileName: body.fileName,
    mimeType: body.contentType,
    size: Number(body.size),
  });
  if (!validation.ok) throw appError(validation.errors.join(" "), 400);
  const entityId = scope.sessionId || scope.goalId;
  const { data: existing, error: existingError } = await client
    .from("growth_attachments")
    .select("display_filename")
    .eq(scope.sessionId ? "session_id" : "goal_id", entityId)
    .in("upload_status", ["pending", "complete"]);
  if (existingError) throw rpcError(existingError);
  const displayFilename = collaborationAvailableDisplayFilename({
    fileName: validation.value.fileName,
    existingNames: (existing || []).map((row) => row.display_filename),
  });
  const contentType = !validation.value.mimeType || validation.value.mimeType === "application/octet-stream" ? COLLABORATION_ALLOWED_ATTACHMENTS[validation.value.extension][0] : validation.value.mimeType;
  const storagePath = `${scope.sessionId ? "sessions" : "goals"}/${entityId}/${randomUUID()}.${validation.value.extension}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { data: attachment, error } = await client
    .from("growth_attachments")
    .insert({
      goal_id: scope.goalId,
      session_id: scope.sessionId,
      uploaded_by: profile.id,
      display_filename: displayFilename,
      original_filename: validation.value.fileName,
      storage_path: storagePath,
      content_type: contentType,
      content_size: validation.value.size,
      upload_expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error) throw rpcError(error);
  const { data: signed, error: signedError } = await client.storage.from(BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
  if (signedError || !signed?.token) {
    await client.from("growth_attachments").delete().eq("id", attachment.id);
    throw appError("Private file upload is temporarily unavailable.", 503);
  }
  return {
    attachmentId: attachment.id,
    revision: attachment.revision,
    displayFilename,
    contentType,
    path: signed.path,
    token: signed.token,
    bucket: BUCKET,
    expiresAt,
  };
}

export async function growthAttachmentComplete(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const attachment = await attachmentForActor(client, id(body.attachmentId), profile, { write: true });
  if (attachment.uploaded_by !== profile.id || attachment.upload_status !== "pending") {
    throw appError("The pending attachment is unavailable.", 404);
  }
  if (Number(attachment.revision) !== revision(body.expectedRevision)) {
    throw appError("The pending attachment changed after it was opened.", 409);
  }
  const { data: info, error: infoError } = await client.storage.from(BUCKET).info(attachment.storage_path);
  if (infoError || Number(info?.size || 0) !== Number(attachment.content_size)) {
    await client.storage
      .from(BUCKET)
      .remove([attachment.storage_path])
      .catch(() => null);
    await client.from("growth_attachments").update({ upload_status: "failed" }).eq("id", attachment.id);
    throw appError("The uploaded file size did not match the prepared upload.", 400);
  }
  const { data, error } = await client
    .from("growth_attachments")
    .update({
      upload_status: "complete",
      completed_at: new Date().toISOString(),
      revision: attachment.revision + 1,
    })
    .eq("id", attachment.id)
    .eq("revision", attachment.revision)
    .select("*")
    .maybeSingle();
  if (error) throw rpcError(error);
  if (!data) throw appError("The pending attachment changed after it was opened.", 409);
  await eventRow(client, {
    subjectType: data.session_id ? "coaching_session" : "goal",
    subjectId: data.session_id || data.goal_id,
    eventType: "attachment_uploaded",
    actor: profile,
    summary: "Private attachment uploaded.",
    metadata: { contentType: data.content_type, size: data.content_size },
  });
  return { attachment: { id: data.id, displayName: data.display_filename } };
}

export async function growthAttachmentUrl(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const attachment = await attachmentForActor(client, id(body.attachmentId), profile);
  if (attachment.upload_status !== "complete") throw appError("The attachment is not ready.", 400);
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(attachment.storage_path, 300, {
    download: body.download === true ? attachment.display_filename : false,
  });
  if (error || !data?.signedUrl) throw appError("Private file preview is temporarily unavailable.", 503);
  return {
    url: data.signedUrl,
    signedUrl: data.signedUrl,
    displayFilename: attachment.display_filename,
    contentType: attachment.content_type,
    expiresIn: 300,
  };
}

export async function growthEmailPreferencesSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const preferences = body.preferences || {};
  const { data: current, error: currentError } = await client.from("growth_email_preferences").select("*").eq("user_id", profile.id).maybeSingle();
  if (currentError) throw rpcError(currentError);
  if (Number(current?.revision || 0) !== revision(body.expectedRevision)) {
    throw appError("Email preferences changed after they were opened.", 409, {
      current,
    });
  }
  const values = Object.fromEntries([...EMAIL_CATEGORIES].map((key) => [key, preferences[key] !== false]));
  const result = current
    ? await client
        .from("growth_email_preferences")
        .update({
          ...values,
          revision: current.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", profile.id)
        .eq("revision", current.revision)
        .select("*")
        .single()
    : await client
        .from("growth_email_preferences")
        .insert({
          user_id: profile.id,
          ...values,
        })
        .select("*")
        .single();
  if (result.error) throw rpcError(result.error);
  return { preferences: result.data };
}

export async function coachingCalendarRetry(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const relationship = await relationshipForActor(client, id(body.relationshipId), profile.id, { activeOnly: true });
  const { data: sessions, error } = await client
    .from("growth_coaching_sessions")
    .select("*")
    .eq("relationship_id", relationship.id)
    .neq("status", "Cancelled")
    .gte("scheduled_at", new Date().toISOString())
    .lte("scheduled_at", new Date(Date.now() + 90 * 86_400_000).toISOString())
    .order("scheduled_at")
    .limit(12);
  if (error) throw rpcError(error);
  const results = [];
  for (const session of sessions || []) {
    results.push(await synchronizeSessionCalendarSafely(client, relationship, session));
  }
  return {
    calendar: results,
    status: results.some((row) => row.status === "Failed") ? "Failed" : results[0]?.status || "Pending",
  };
}

export async function coachingCalendarResolve(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const relationship = await relationshipForActor(client, id(body.relationshipId), profile.id, { activeOnly: true });
  const { data: sync, error } = await client.from("growth_calendar_sync").select("*").eq("relationship_id", relationship.id).eq("status", "Conflict").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw rpcError(error);
  if (!sync) throw appError("No Outlook calendar conflict is awaiting a decision.", 404);
  const { data: session, error: sessionError } = await client.from("growth_coaching_sessions").select("*").eq("id", sync.session_id).single();
  if (sessionError) throw rpcError(sessionError);
  if (body.resolution === "replace_with_fcos") {
    const result = await synchronizeSessionCalendarSafely(client, relationship, session, { force: true });
    return { calendar: result };
  }
  if (body.resolution !== "keep_outlook") throw appError("Select an Outlook conflict resolution.", 400);
  const remote = await growthCalendarGet({
    organizerEmail: sync.organizer_email,
    eventId: sync.outlook_event_id,
  });
  const startValue = remote?.start?.dateTime;
  const endValue = remote?.end?.dateTime;
  if (!startValue || !endValue) throw appError("Outlook did not return a usable event schedule.", 503);
  const start = new Date(`${startValue}${/[zZ]|[+-]\d\d:\d\d$/.test(startValue) ? "" : "+08:00"}`);
  const end = new Date(`${endValue}${/[zZ]|[+-]\d\d:\d\d$/.test(endValue) ? "" : "+08:00"}`);
  const durationMinutes = Math.round((end - start) / 60_000);
  if (Number.isNaN(start.getTime()) || durationMinutes < 15 || durationMinutes > 240) {
    throw appError("The Outlook schedule is outside the supported session range.", 400);
  }
  const { data: saved, error: saveError } = await client
    .from("growth_coaching_sessions")
    .update({
      scheduled_at: start.toISOString(),
      duration_minutes: durationMinutes,
      revision: session.revision + 1,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("revision", session.revision)
    .select("*")
    .single();
  if (saveError) throw rpcError(saveError);
  const { data: calendar, error: calendarError } = await client
    .from("growth_calendar_sync")
    .update({
      status: "Synced",
      outlook_etag: remote["@odata.etag"] || sync.outlook_etag,
      fcos_schedule: { scheduledAt: saved.scheduled_at, durationMinutes },
      outlook_schedule: { start: remote.start, end: remote.end },
      last_error_code: null,
      revision: sync.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sync.id)
    .select("*")
    .single();
  if (calendarError) throw rpcError(calendarError);
  return { session: saved, calendar };
}

export async function growthCoachingDailyMaintenance(client) {
  const today = hongKongDateOnly();
  const { data: created, error } = await client.rpc("create_growth_due_notifications", { p_today: today });
  if (error) throw rpcError(error);
  const { data: stalePaths, error: cleanupError } = await client.rpc("cleanup_growth_pending_attachments");
  if (cleanupError) throw rpcError(cleanupError);
  if (stalePaths?.length) {
    await client.storage
      .from(BUCKET)
      .remove(stalePaths)
      .catch(() => null);
  }
  const digest = await sendRoutineDigests(client, today);
  return {
    today,
    notificationsCreated: Number(created || 0),
    pendingUploadsRemoved: stalePaths?.length || 0,
    emailDigestStatus: digest.status,
    emailDigestsSent: digest.sent,
    emailDigestsFailed: digest.failed,
  };
}

export async function growthCalendarCancelForSession(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const { session } = await sessionForActor(client, id(body.sessionId), profile.id, { activeOnly: true });
  const { data: sync } = await client.from("growth_calendar_sync").select("*").eq("session_id", session.id).maybeSingle();
  if (sync?.outlook_event_id) {
    await growthCalendarCancel({
      organizerEmail: sync.organizer_email,
      eventId: sync.outlook_event_id,
      expectedEtag: sync.outlook_etag,
    });
  }
  return { cancelled: true };
}
