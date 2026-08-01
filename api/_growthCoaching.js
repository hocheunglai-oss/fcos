export const GROWTH_GOAL_STATUSES = Object.freeze([
  "Draft",
  "Pending Approval",
  "Revision Requested",
  "Active",
  "Completion Review",
  "Completed",
  "Not Achieved",
  "Cancellation Requested",
]);

export const GROWTH_SESSION_STATUSES = Object.freeze([
  "Scheduled",
  "Awaiting Confirmation",
  "Confirmed",
  "Cancelled",
]);

export const GROWTH_MEASUREMENT_TYPES = Object.freeze([
  "numeric",
  "milestones",
  "outcome_rubric",
]);

export const GROWTH_CHECKPOINT_STATES = Object.freeze([
  "On Track",
  "At Risk",
  "Off Track",
]);

export const COACHING_RELATIONSHIP_STATUSES = Object.freeze([
  "Pending",
  "Active",
  "Declined",
  "Ended",
  "Cancelled",
]);

export const GROWTH_NOTIFICATION_TIMINGS = Object.freeze([
  "seven_days_before",
  "one_day_before",
  "due_today",
  "overdue_weekly",
]);

export const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_OR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_EVIDENCE_LENGTH = 10_000;
const MAX_CHECKPOINTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value) {
  return stringValue(value) || null;
}

function normalizedId(value) {
  const id = nullableString(value);
  return id && UUID_OR_ID_PATTERN.test(id) ? id : null;
}

function dateFromDateOnly(value) {
  const dateOnly = stringValue(value);
  if (!DATE_ONLY_PATTERN.test(dateOnly)) return null;
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function normalizeDateOnly(value, field, errors) {
  const dateOnly = nullableString(value);
  if (!dateOnly) return null;
  if (!dateFromDateOnly(dateOnly)) {
    errors.push(`${field} must use a real YYYY-MM-DD date.`);
    return null;
  }
  return dateOnly;
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validationResult(errors, value = undefined) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    ...(value === undefined ? {} : { value }),
  });
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => (typeof value === "object" && value ? value.id : value))
    .map(normalizedId)
    .filter(Boolean))];
}

function titleValue(value, field, errors, { required = true } = {}) {
  const title = nullableString(value);
  if (required && !title) errors.push(`${field} is required.`);
  if (title && title.length > MAX_TITLE_LENGTH) {
    errors.push(`${field} must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  return title;
}

function percentage(value) {
  const number = numberValue(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

export function validateGrowthGoalStatus(value) {
  const status = nullableString(value);
  return validationResult(
    GROWTH_GOAL_STATUSES.includes(status)
      ? []
      : [`Goal status must be one of: ${GROWTH_GOAL_STATUSES.join(", ")}.`],
    status,
  );
}

export function validateGrowthSessionStatus(value) {
  const status = nullableString(value);
  return validationResult(
    GROWTH_SESSION_STATUSES.includes(status)
      ? []
      : [`Session status must be one of: ${GROWTH_SESSION_STATUSES.join(", ")}.`],
    status,
  );
}

export function validateGrowthMeasurementType(value) {
  const type = nullableString(value);
  return validationResult(
    GROWTH_MEASUREMENT_TYPES.includes(type)
      ? []
      : [`Measurement type must be one of: ${GROWTH_MEASUREMENT_TYPES.join(", ")}.`],
    type,
  );
}

export function calculateNumericGoalProgress({
  baseline,
  target,
  current = baseline,
  direction,
} = {}) {
  const normalizedBaseline = numberValue(baseline);
  const normalizedTarget = numberValue(target);
  const normalizedCurrent = numberValue(current);
  const normalizedDirection = nullableString(direction);
  if (
    normalizedBaseline === null ||
    normalizedTarget === null ||
    normalizedCurrent === null ||
    !["increase", "decrease"].includes(normalizedDirection) ||
    normalizedBaseline === normalizedTarget
  ) {
    return null;
  }
  const expectedDirection = normalizedTarget > normalizedBaseline ? "increase" : "decrease";
  if (normalizedDirection !== expectedDirection) return null;
  const ratio = normalizedDirection === "increase"
    ? (normalizedCurrent - normalizedBaseline) / (normalizedTarget - normalizedBaseline)
    : (normalizedBaseline - normalizedCurrent) / (normalizedBaseline - normalizedTarget);
  return Math.max(0, Math.min(100, Math.round(ratio * 10_000) / 100));
}

export function validateNumericGoalMeasurement(measurement = {}) {
  const errors = [];
  const baseline = numberValue(measurement.baseline);
  const target = numberValue(measurement.target);
  const current = numberValue(measurement.current ?? measurement.baseline);
  const unit = nullableString(measurement.unit);
  const direction = nullableString(measurement.direction);

  if (baseline === null) errors.push("Numeric baseline must be a finite number.");
  if (target === null) errors.push("Numeric target must be a finite number.");
  if (current === null) errors.push("Numeric current value must be a finite number.");
  if (!unit) errors.push("Numeric unit is required.");
  else if (unit.length > 80) errors.push("Numeric unit must be 80 characters or fewer.");
  if (!["increase", "decrease"].includes(direction)) {
    errors.push("Numeric direction must be increase or decrease.");
  }
  if (baseline !== null && target !== null && baseline === target) {
    errors.push("Numeric target must differ from baseline.");
  }
  if (
    baseline !== null &&
    target !== null &&
    direction &&
    ((direction === "increase" && target < baseline) ||
      (direction === "decrease" && target > baseline))
  ) {
    errors.push("Numeric direction must match the baseline and target.");
  }

  const value = {
    type: "numeric",
    baseline,
    target,
    current,
    unit,
    direction,
    progress: calculateNumericGoalProgress({ baseline, target, current, direction }),
  };
  return validationResult(errors, value);
}

export function calculateMilestoneGoalProgress(milestones = []) {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  const total = milestones.reduce((sum, milestone) => {
    const weight = numberValue(milestone?.weight);
    const progress = percentage(milestone?.progress ?? (milestone?.completed ? 100 : 0));
    return weight === null || progress === null ? Number.NaN : sum + (weight * progress) / 100;
  }, 0);
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null;
}

export function validateMilestoneGoalMeasurement(measurement = {}) {
  const errors = [];
  const input = Array.isArray(measurement.milestones) ? measurement.milestones : [];
  if (!input.length) errors.push("At least one weighted milestone is required.");
  if (input.length > MAX_CHECKPOINTS) errors.push(`At most ${MAX_CHECKPOINTS} milestones are allowed.`);
  const seenIds = new Set();
  const milestones = input.map((milestone, index) => {
    const label = titleValue(milestone?.label, `Milestone ${index + 1} label`, errors);
    const id = normalizedId(milestone?.id) || `milestone-${index + 1}`;
    const weight = numberValue(milestone?.weight);
    const progress = percentage(milestone?.progress ?? (milestone?.completed ? 100 : 0));
    if (seenIds.has(id)) errors.push(`Milestone ${index + 1} ID is duplicated.`);
    seenIds.add(id);
    if (weight === null || weight <= 0 || weight > 100) {
      errors.push(`Milestone ${index + 1} weight must be greater than 0 and no more than 100.`);
    }
    if (progress === null) errors.push(`Milestone ${index + 1} progress must be between 0 and 100.`);
    return { id, label, weight, progress };
  });
  const totalWeight = milestones.reduce((sum, milestone) => sum + (milestone.weight || 0), 0);
  if (milestones.length && Math.abs(totalWeight - 100) > 0.000001) {
    errors.push("Milestone weights must total exactly 100%.");
  }
  return validationResult(errors, {
    type: "milestones",
    milestones,
    progress: calculateMilestoneGoalProgress(milestones),
  });
}

export function calculateOutcomeRubricProgress(levels = [], currentLevelId) {
  const selected = (Array.isArray(levels) ? levels : [])
    .find((level) => String(level?.id) === String(currentLevelId));
  return selected ? percentage(selected.progress) : null;
}

export function validateOutcomeRubricGoalMeasurement(measurement = {}) {
  const errors = [];
  const input = Array.isArray(measurement.levels) ? measurement.levels : [];
  const currentLevelId = normalizedId(measurement.currentLevelId);
  if (input.length < 2) errors.push("An outcome rubric needs at least two achievement levels.");
  if (input.length > 10) errors.push("An outcome rubric allows at most 10 achievement levels.");
  const seenIds = new Set();
  let previousProgress = -1;
  const levels = input.map((level, index) => {
    const id = normalizedId(level?.id) || `level-${index + 1}`;
    const label = titleValue(level?.label, `Outcome level ${index + 1} label`, errors);
    const evidence = nullableString(level?.evidence);
    const progress = percentage(level?.progress);
    if (seenIds.has(id)) errors.push(`Outcome level ${index + 1} ID is duplicated.`);
    seenIds.add(id);
    if (progress === null) errors.push(`Outcome level ${index + 1} progress must be between 0 and 100.`);
    else if (progress <= previousProgress) errors.push("Outcome level progress must strictly increase.");
    if (progress !== null) previousProgress = progress;
    if (!evidence) errors.push(`Outcome level ${index + 1} evidence standard is required.`);
    else if (evidence.length > MAX_EVIDENCE_LENGTH) {
      errors.push(`Outcome level ${index + 1} evidence standard is too long.`);
    }
    return { id, label, evidence, progress };
  });
  if (!currentLevelId) errors.push("Current outcome level is required.");
  else if (!levels.some((level) => level.id === currentLevelId)) {
    errors.push("Current outcome level must be defined in the rubric.");
  }
  return validationResult(errors, {
    type: "outcome_rubric",
    levels,
    currentLevelId,
    progress: calculateOutcomeRubricProgress(levels, currentLevelId),
  });
}

export function validateGoalMeasurement(measurement = {}) {
  const type = nullableString(measurement.type);
  if (type === "numeric") return validateNumericGoalMeasurement(measurement);
  if (type === "milestones") return validateMilestoneGoalMeasurement(measurement);
  if (type === "outcome_rubric") return validateOutcomeRubricGoalMeasurement(measurement);
  return validationResult([
    `Measurement type must be one of: ${GROWTH_MEASUREMENT_TYPES.join(", ")}.`,
  ]);
}

export function validateGoalCheckpoints({
  checkpoints,
  deadline,
  requireAtLeastOne = true,
} = {}) {
  const errors = [];
  const normalizedDeadline = normalizeDateOnly(deadline, "deadline", errors);
  const input = Array.isArray(checkpoints) ? checkpoints : [];
  if (requireAtLeastOne && !input.length) errors.push("At least one progress checkpoint is required.");
  if (input.length > MAX_CHECKPOINTS) errors.push(`At most ${MAX_CHECKPOINTS} checkpoints are allowed.`);
  const seenDates = new Set();
  const value = input.map((checkpoint, index) => {
    const prefix = `Checkpoint ${index + 1}`;
    const dueDate = normalizeDateOnly(checkpoint?.dueDate, `${prefix} due date`, errors);
    const expectedResult = titleValue(checkpoint?.expectedResult, `${prefix} expected result`, errors);
    const actualResult = nullableString(checkpoint?.actualResult);
    const evidence = nullableString(checkpoint?.evidence);
    const state = nullableString(checkpoint?.state);
    if (dueDate && normalizedDeadline && dueDate >= normalizedDeadline) {
      errors.push(`${prefix} must be before the goal deadline.`);
    }
    if (dueDate && seenDates.has(dueDate)) errors.push(`${prefix} due date is duplicated.`);
    if (dueDate) seenDates.add(dueDate);
    if (actualResult && actualResult.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`${prefix} actual result is too long.`);
    }
    if (evidence && evidence.length > MAX_EVIDENCE_LENGTH) errors.push(`${prefix} evidence is too long.`);
    if (state && !GROWTH_CHECKPOINT_STATES.includes(state)) {
      errors.push(`${prefix} state must be one of: ${GROWTH_CHECKPOINT_STATES.join(", ")}.`);
    }
    return { dueDate, expectedResult, actualResult, evidence, state };
  });
  return validationResult(errors, value);
}

export function validateGrowthGoalPayload(payload = {}, { partial = false } = {}) {
  const errors = [];
  const title = titleValue(payload.title, "Goal title", errors, { required: !partial || Object.hasOwn(payload, "title") });
  const status = nullableString(payload.status);
  const deadline = normalizeDateOnly(payload.deadline, "deadline", errors);
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  if ((!partial || Object.hasOwn(payload, "status")) && !GROWTH_GOAL_STATUSES.includes(status)) {
    errors.push(`Goal status must be one of: ${GROWTH_GOAL_STATUSES.join(", ")}.`);
  }
  if (!partial || Object.hasOwn(payload, "deadline")) {
    if (!deadline) errors.push("deadline is required.");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) errors.push("description is too long.");
  const measurementResult = (!partial || Object.hasOwn(payload, "measurement"))
    ? validateGoalMeasurement(payload.measurement)
    : validationResult([], null);
  errors.push(...measurementResult.errors);
  const checkpointResult = (!partial || Object.hasOwn(payload, "checkpoints") || Object.hasOwn(payload, "deadline"))
    ? validateGoalCheckpoints({ checkpoints: payload.checkpoints, deadline, requireAtLeastOne: !partial })
    : validationResult([], []);
  errors.push(...checkpointResult.errors);
  return validationResult(errors, {
    title,
    status,
    deadline,
    description,
    measurement: measurementResult.value,
    checkpoints: checkpointResult.value,
  });
}

export function validateReportingLinePayload({
  employeeId,
  primaryManagerId = null,
  secondaryManagerId = null,
  activeUserIds = [],
} = {}) {
  const errors = [];
  const employee = normalizedId(employeeId);
  const primaryManager = nullableString(primaryManagerId) ? normalizedId(primaryManagerId) : null;
  const secondaryManager = nullableString(secondaryManagerId) ? normalizedId(secondaryManagerId) : null;
  const activeIds = new Set(uniqueIds(activeUserIds));
  if (!employee) errors.push("employeeId must be a valid FCOS user ID.");
  else if (!activeIds.has(employee)) errors.push("Employee must be an active FCOS user.");
  for (const [label, managerId] of [["Primary manager", primaryManager], ["Advisory Manager", secondaryManager]]) {
    if (managerId && !activeIds.has(managerId)) errors.push(`${label} must be an active FCOS user.`);
  }
  if (nullableString(primaryManagerId) && !primaryManager) errors.push("Primary manager ID is invalid.");
  if (nullableString(secondaryManagerId) && !secondaryManager) errors.push("Advisory Manager ID is invalid.");
  if (employee && primaryManager === employee) errors.push("An employee cannot be their own primary manager.");
  if (employee && secondaryManager === employee) errors.push("An employee cannot be their own Advisory Manager.");
  if (primaryManager && primaryManager === secondaryManager) {
    errors.push("Primary and advisory managers must be different people.");
  }
  return validationResult(errors, { employeeId: employee, primaryManagerId: primaryManager, secondaryManagerId: secondaryManager });
}

export function validateReportingLines({ assignments = [], activeUserIds = [] } = {}) {
  const errors = [];
  const normalizedAssignments = [];
  const seenEmployees = new Set();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const result = validateReportingLinePayload({ ...assignment, activeUserIds });
    errors.push(...result.errors);
    if (!result.value.employeeId) continue;
    if (seenEmployees.has(result.value.employeeId)) {
      errors.push(`Employee ${result.value.employeeId} has more than one reporting assignment.`);
      continue;
    }
    seenEmployees.add(result.value.employeeId);
    normalizedAssignments.push(result.value);
  }
  const primaryByEmployee = new Map(
    normalizedAssignments
      .filter((assignment) => assignment.primaryManagerId)
      .map((assignment) => [assignment.employeeId, assignment.primaryManagerId]),
  );
  for (const employeeId of primaryByEmployee.keys()) {
    const path = [];
    const visited = new Set();
    let current = employeeId;
    while (primaryByEmployee.has(current)) {
      if (visited.has(current)) {
        const cycleStart = path.indexOf(current);
        errors.push(`Primary reporting cycle detected: ${[...path.slice(cycleStart), current].join(" -> ")}.`);
        break;
      }
      visited.add(current);
      path.push(current);
      current = primaryByEmployee.get(current);
    }
  }
  return validationResult(errors, normalizedAssignments);
}

export function canonicalCoachingPairKey(firstUserId, secondUserId) {
  const first = normalizedId(firstUserId);
  const second = normalizedId(secondUserId);
  if (!first || !second) throw new Error("Coaching participants must use valid FCOS user IDs.");
  if (first === second) throw new Error("A coaching relationship requires two different participants.");
  return [first, second].sort((left, right) => left.localeCompare(right)).join(":");
}

function relationshipParticipantIds(relationship = {}) {
  return uniqueIds([
    relationship.participantOneId,
    relationship.participantTwoId,
    relationship.inviterId,
    relationship.inviteeId,
  ]);
}

export function canAccessCoachingRelationship({ relationship, actorId, isActive = true } = {}) {
  const actor = normalizedId(actorId);
  return Boolean(actor && isActive && relationshipParticipantIds(relationship).includes(actor));
}

export function canManageCoachingRelationship({ relationship, actorId, isActive = true } = {}) {
  if (!canAccessCoachingRelationship({ relationship, actorId, isActive })) return false;
  return !["Declined", "Cancelled"].includes(nullableString(relationship?.status));
}

export function canAccessCoachingSession({ relationship, session, actorId, isActive = true } = {}) {
  if (!session || nullableString(session.relationshipId) !== nullableString(relationship?.id)) return false;
  return canAccessCoachingRelationship({ relationship, actorId, isActive });
}

export function isCoachingSessionLocked(session = {}) {
  return nullableString(session.status) === "Confirmed" || Boolean(session.lockedAt);
}

export function canEditCoachingSessionContent({
  relationship,
  session,
  actorId,
  contentAuthorId,
  isActive = true,
} = {}) {
  const actor = normalizedId(actorId);
  const author = normalizedId(contentAuthorId);
  return Boolean(
    actor &&
      author === actor &&
      !isCoachingSessionLocked(session) &&
      canAccessCoachingSession({ relationship, session, actorId: actor, isActive }),
  );
}

export function shouldInvalidateCoachingConfirmations({ session, sharedContentChanged = false } = {}) {
  return Boolean(
    sharedContentChanged &&
      !isCoachingSessionLocked(session) &&
      (nullableString(session?.confirmedByFirstAt) || nullableString(session?.confirmedBySecondAt)),
  );
}

export function invalidateCoachingConfirmations(session = {}) {
  if (!shouldInvalidateCoachingConfirmations({ session, sharedContentChanged: true })) {
    return { ...session, confirmationsInvalidated: false };
  }
  return {
    ...session,
    status: "Awaiting Confirmation",
    confirmedByFirstAt: null,
    confirmedBySecondAt: null,
    confirmationsInvalidated: true,
  };
}

export function canConfirmCoachingSession({ relationship, session, actorId, isActive = true } = {}) {
  return Boolean(
    !isCoachingSessionLocked(session) &&
      ["Scheduled", "Awaiting Confirmation"].includes(nullableString(session?.status)) &&
      canAccessCoachingSession({ relationship, session, actorId, isActive }),
  );
}

function hongKongDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function dateOnlyFromParts(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDateOnlyDays(dateOnly, days) {
  const date = dateFromDateOnly(dateOnly);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function hongKongDateOnly(value = new Date()) {
  const parts = hongKongDateParts(value);
  return parts ? dateOnlyFromParts(parts) : null;
}

export function growthReminderTiming({ dueDate, now = new Date() } = {}) {
  const normalizedDueDate = dateFromDateOnly(dueDate) ? dueDate : null;
  const today = hongKongDateOnly(now);
  if (!normalizedDueDate || !today) return { shouldSend: false, timing: null, today, daysUntilDue: null };
  const daysUntilDue = Math.round((dateFromDateOnly(normalizedDueDate) - dateFromDateOnly(today)) / DAY_MS);
  let timing = null;
  if (daysUntilDue === 7) timing = "seven_days_before";
  else if (daysUntilDue === 1) timing = "one_day_before";
  else if (daysUntilDue === 0) timing = "due_today";
  else if (daysUntilDue < 0 && Math.abs(daysUntilDue) % 7 === 0) timing = "overdue_weekly";
  return { shouldSend: Boolean(timing), timing, today, daysUntilDue };
}

export function isHongKongWeekdayDigestTime({ now = new Date(), hour = 8, minute = 30 } = {}) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HONG_KONG_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return !["Sat", "Sun"].includes(values.weekday) && Number(values.hour) === hour && Number(values.minute) === minute;
}

function hongKongGraphDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

export function buildGrowthCoachingCalendarEvent({
  relationship,
  session,
  publicUrl,
  transactionId,
} = {}) {
  const participantOne = relationship?.participantOne || {};
  const participantTwo = relationship?.participantTwo || {};
  const firstName = titleValue(participantOne.name, "First participant name", [], { required: false }) || "Participant 1";
  const secondName = titleValue(participantTwo.name, "Second participant name", [], { required: false }) || "Participant 2";
  const start = hongKongGraphDateTime(session?.startsAt);
  const end = hongKongGraphDateTime(session?.endsAt);
  const baseUrl = String(publicUrl || "").trim().replace(/\/$/, "");
  const sessionId = normalizedId(session?.id);
  const id = nullableString(transactionId);
  if (!start || !end || new Date(session.endsAt) <= new Date(session.startsAt)) {
    throw new Error("A coaching calendar event needs a valid start before its end.");
  }
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error("A secure FCOS public URL is required.");
  if (!id) throw new Error("A calendar transaction ID is required.");
  const attendees = [participantOne, participantTwo]
    .filter((participant) => nullableString(participant.email))
    .map((participant) => ({
      emailAddress: { address: nullableString(participant.email), name: nullableString(participant.name) || "FCOS user" },
      type: "required",
    }));
  return {
    transactionId: id,
    subject: `FCOS 1:1: ${firstName} and ${secondName}`,
    body: {
      contentType: "text",
      content: `This 1:1 is managed in FCOS.\nOpen FCOS: ${baseUrl}${sessionId ? `/growth-coaching/session/${sessionId}` : "/growth-coaching"}`,
    },
    start: { dateTime: start, timeZone: HONG_KONG_TIME_ZONE },
    end: { dateTime: end, timeZone: HONG_KONG_TIME_ZONE },
    attendees,
    showAs: "busy",
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function redactGrowthEmailPayload(payload = {}) {
  const title = nullableString(payload.title) || "FCOS Growth & Coaching update";
  const dueDate = dateFromDateOnly(payload.dueDate) ? payload.dueDate : null;
  const progress = percentage(payload.progress);
  const actionUrl = String(payload.actionUrl || "").trim();
  return {
    title: title.slice(0, MAX_TITLE_LENGTH),
    dueDate,
    progress,
    actionUrl: /^https:\/\//i.test(actionUrl) ? actionUrl : null,
  };
}

export function buildGrowthNotificationEmail({ notification = {}, publicUrl } = {}) {
  const safe = redactGrowthEmailPayload({
    ...notification,
    actionUrl: notification.actionUrl || publicUrl,
  });
  const detailLines = [safe.title];
  if (safe.dueDate) detailLines.push(`Date: ${safe.dueDate}`);
  if (safe.progress !== null) detailLines.push(`Progress: ${safe.progress}%`);
  const text = ["FCOS Growth & Coaching", ...detailLines, safe.actionUrl ? `Open FCOS: ${safe.actionUrl}` : ""].filter(Boolean).join("\n");
  const html = [
    "<h2>FCOS Growth &amp; Coaching</h2>",
    `<p>${escapeHtml(safe.title)}</p>`,
    safe.dueDate ? `<p>Date: ${escapeHtml(safe.dueDate)}</p>` : "",
    safe.progress !== null ? `<p>Progress: ${escapeHtml(safe.progress)}%</p>` : "",
    safe.actionUrl ? `<p><a href="${escapeHtml(safe.actionUrl)}">Open FCOS</a></p>` : "",
  ].filter(Boolean).join("");
  return { subject: `FCOS: ${safe.title}`, text, html, safe };
}
