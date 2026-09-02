import assert from "node:assert/strict";
import test from "node:test";
import {
  COACHING_RELATIONSHIP_STATUSES,
  GROWTH_CHECKPOINT_STATES,
  GROWTH_GOAL_STATUSES,
  GROWTH_MEASUREMENT_TYPES,
  GROWTH_NOTIFICATION_TIMINGS,
  GROWTH_SESSION_STATUSES,
  HONG_KONG_TIME_ZONE,
  buildGrowthCoachingCalendarEvent,
  buildGrowthNotificationEmail,
  calculateMilestoneGoalProgress,
  calculateNumericGoalProgress,
  calculateOutcomeRubricProgress,
  canAccessCoachingRelationship,
  canAccessCoachingSession,
  canConfirmCoachingSession,
  canEditCoachingSessionContent,
  canonicalCoachingPairKey,
  growthReminderTiming,
  invalidateCoachingConfirmations,
  isCoachingSessionLocked,
  isHongKongWeekdayDigestTime,
  redactGrowthEmailPayload,
  shouldInvalidateCoachingConfirmations,
  validateGoalCheckpoints,
  validateGoalMeasurement,
  validateGrowthGoalPayload,
  validateReportingLinePayload,
  validateReportingLines,
} from "../api/_growthCoaching.js";

test("exports the agreed Growth & Coaching vocabulary", () => {
  assert.deepEqual(GROWTH_GOAL_STATUSES, [
    "Draft", "Pending Approval", "Revision Requested", "Active",
    "Completion Review", "Completed", "Not Achieved", "Cancellation Requested",
  ]);
  assert.deepEqual(GROWTH_SESSION_STATUSES, ["Scheduled", "Awaiting Confirmation", "Confirmed", "Cancelled"]);
  assert.deepEqual(GROWTH_MEASUREMENT_TYPES, ["numeric", "milestones", "outcome_rubric"]);
  assert.deepEqual(GROWTH_CHECKPOINT_STATES, ["On Track", "At Risk", "Off Track"]);
  assert.deepEqual(COACHING_RELATIONSHIP_STATUSES, ["Pending", "Active", "Declined", "Ended", "Cancelled"]);
  assert.deepEqual(GROWTH_NOTIFICATION_TIMINGS, ["seven_days_before", "one_day_before", "due_today", "overdue_weekly"]);
  assert.equal(HONG_KONG_TIME_ZONE, "Asia/Hong_Kong");
});

test("calculates and validates measurable numeric goals", () => {
  assert.equal(calculateNumericGoalProgress({ baseline: 10, target: 20, current: 15, direction: "increase" }), 50);
  assert.equal(calculateNumericGoalProgress({ baseline: 20, target: 10, current: 12, direction: "decrease" }), 80);
  assert.equal(calculateNumericGoalProgress({ baseline: 10, target: 20, current: 12, direction: "decrease" }), null);
  const valid = validateGoalMeasurement({ type: "numeric", baseline: 10, target: 20, current: 25, unit: "customers", direction: "increase" });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.progress, 100);
  const invalid = validateGoalMeasurement({ type: "numeric", baseline: 10, target: 10, unit: "orders", direction: "increase" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /target must differ/);
});

test("enforces weighted milestone totals and outcome-rubric evidence", () => {
  assert.equal(calculateMilestoneGoalProgress([
    { weight: 60, progress: 50 }, { weight: 40, completed: true },
  ]), 70);
  const validMilestones = validateGoalMeasurement({
    type: "milestones",
    milestones: [{ label: "First release", weight: 40, progress: 100 }, { label: "Second release", weight: 60, progress: 50 }],
  });
  assert.equal(validMilestones.ok, true);
  assert.equal(validMilestones.value.progress, 70);
  assert.match(
    validateGoalMeasurement({ type: "milestones", milestones: [{ label: "Only", weight: 99, progress: 0 }] }).errors.join(" "),
    /total exactly 100%/,
  );
  const rubric = validateGoalMeasurement({
    type: "outcome_rubric",
    currentLevelId: "achieved",
    levels: [
      { id: "starting", label: "Starting", progress: 0, evidence: "No evidence yet" },
      { id: "achieved", label: "Achieved", progress: 100, evidence: "Signed customer outcome" },
    ],
  });
  assert.equal(rubric.ok, true);
  assert.equal(calculateOutcomeRubricProgress(rubric.value.levels, "achieved"), 100);
  assert.match(
    validateGoalMeasurement({ type: "outcome_rubric", currentLevelId: "missing", levels: [{ id: "one", label: "One", progress: 50, evidence: "Evidence" }] }).errors.join(" "),
    /at least two achievement levels/,
  );
});

test("requires a deadline and distinct in-deadline checkpoints for a formal goal", () => {
  const valid = validateGrowthGoalPayload({
    title: "Reduce overdue exposure",
    status: "Draft",
    deadline: "2026-12-31",
    measurement: { type: "numeric", baseline: 20, target: 10, current: 20, unit: "days", direction: "decrease" },
    checkpoints: [{ dueDate: "2026-09-30", expectedResult: "First reduction", state: "On Track" }],
  });
  assert.equal(valid.ok, true);
  const invalid = validateGoalCheckpoints({
    deadline: "2026-12-31",
    checkpoints: [
      { dueDate: "2026-12-31", expectedResult: "Too late" },
      { dueDate: "2026-12-31", expectedResult: "Duplicate" },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /before the goal deadline/);
  assert.match(invalid.errors.join(" "), /due date is duplicated/);
});

test("validates active reporting assignments and rejects primary cycles", () => {
  const activeUserIds = ["alice", "ben", "chris", "dora"];
  assert.equal(validateReportingLinePayload({ employeeId: "alice", primaryManagerId: "ben", secondaryManagerId: "chris", activeUserIds }).ok, true);
  assert.match(
    validateReportingLinePayload({ employeeId: "alice", primaryManagerId: "alice", activeUserIds }).errors.join(" "),
    /cannot be their own primary manager/,
  );
  assert.match(
    validateReportingLinePayload({ employeeId: "alice", primaryManagerId: "ben", secondaryManagerId: "ben", activeUserIds }).errors.join(" "),
    /Primary and advisory managers must be different people/,
  );
  const cycle = validateReportingLines({
    activeUserIds,
    assignments: [
      { employeeId: "alice", primaryManagerId: "ben" },
      { employeeId: "ben", primaryManagerId: "chris" },
      { employeeId: "chris", primaryManagerId: "alice" },
    ],
  });
  assert.equal(cycle.ok, false);
  assert.match(cycle.errors.join(" "), /Primary reporting cycle detected/);
});

test("uses a canonical private coaching pair and restricts relationship and session access", () => {
  assert.equal(canonicalCoachingPairKey("ben", "alice"), "alice:ben");
  assert.throws(() => canonicalCoachingPairKey("alice", "alice"), /two different participants/);
  const relationship = { id: "relationship-1", participantOneId: "alice", participantTwoId: "ben", status: "Active" };
  const session = { id: "session-1", relationshipId: "relationship-1", status: "Scheduled" };
  assert.equal(canAccessCoachingRelationship({ relationship, actorId: "alice" }), true);
  assert.equal(canAccessCoachingRelationship({ relationship, actorId: "manager" }), false);
  assert.equal(canAccessCoachingSession({ relationship, session, actorId: "ben" }), true);
  assert.equal(canAccessCoachingSession({ relationship, session: { ...session, relationshipId: "other" }, actorId: "ben" }), false);
  assert.equal(canAccessCoachingRelationship({ relationship, actorId: "alice", isActive: false }), false);
});

test("preserves equal coaching ownership, locks confirmed notes, and invalidates confirmation after shared change", () => {
  const relationship = { id: "relationship-1", participantOneId: "alice", participantTwoId: "ben", status: "Active" };
  const session = { id: "session-1", relationshipId: "relationship-1", status: "Awaiting Confirmation", confirmedByFirstAt: "2026-07-31T01:00:00Z" };
  assert.equal(canEditCoachingSessionContent({ relationship, session, actorId: "alice", contentAuthorId: "alice" }), true);
  assert.equal(canEditCoachingSessionContent({ relationship, session, actorId: "ben", contentAuthorId: "alice" }), false);
  assert.equal(canConfirmCoachingSession({ relationship, session, actorId: "ben" }), true);
  assert.equal(shouldInvalidateCoachingConfirmations({ session, sharedContentChanged: true }), true);
  assert.equal(shouldInvalidateCoachingConfirmations({ session, sharedContentChanged: false }), false);
  const reset = invalidateCoachingConfirmations(session);
  assert.equal(reset.confirmedByFirstAt, null);
  assert.equal(reset.confirmationsInvalidated, true);
  const confirmed = { ...session, status: "Confirmed", lockedAt: "2026-07-31T02:00:00Z" };
  assert.equal(isCoachingSessionLocked(confirmed), true);
  assert.equal(canEditCoachingSessionContent({ relationship, session: confirmed, actorId: "alice", contentAuthorId: "alice" }), false);
  assert.equal(canConfirmCoachingSession({ relationship, session: confirmed, actorId: "ben" }), false);
});

test("calculates Hong Kong reminder timings and weekday digest timing", () => {
  assert.deepEqual(
    growthReminderTiming({ dueDate: "2026-08-07", now: new Date("2026-07-30T16:30:00Z") }),
    { shouldSend: true, timing: "seven_days_before", today: "2026-07-31", daysUntilDue: 7 },
  );
  assert.equal(growthReminderTiming({ dueDate: "2026-08-01", now: new Date("2026-07-30T16:30:00Z") }).timing, "one_day_before");
  assert.equal(growthReminderTiming({ dueDate: "2026-07-25", now: new Date("2026-07-31T16:30:00Z") }).timing, "overdue_weekly");
  assert.equal(isHongKongWeekdayDigestTime({ now: new Date("2026-08-03T00:30:00Z") }), true);
  assert.equal(isHongKongWeekdayDigestTime({ now: new Date("2026-08-01T00:30:00Z") }), false);
});

test("builds Outlook events with only neutral FCOS content", () => {
  const event = buildGrowthCoachingCalendarEvent({
    relationship: {
      participantOne: { name: "Alice", email: "alice@example.com" },
      participantTwo: { name: "Ben", email: "ben@example.com" },
      privateNotes: "must never leave FCOS",
    },
    session: {
      id: "session-1",
      startsAt: "2026-08-04T01:00:00Z",
      endsAt: "2026-08-04T01:45:00Z",
      agenda: "Private agenda must never leave FCOS",
      sharedNotes: "Confidential notes",
    },
    publicUrl: "https://fcos.example.com/",
    transactionId: "growth-session-1-v1",
  });
  assert.equal(event.subject, "FCOS 1:1: Alice and Ben");
  assert.equal(event.start.timeZone, "Asia/Hong_Kong");
  assert.equal(event.start.dateTime, "2026-08-04T09:00:00");
  assert.match(event.body.content, /Open FCOS/);
  assert.doesNotMatch(JSON.stringify(event), /agenda|Confidential|privateNotes/i);
  assert.equal(event.attendees.length, 2);
});

test("redacts email payloads to allowed notification details", () => {
  const safe = redactGrowthEmailPayload({
    title: "Prepare goal checkpoint",
    dueDate: "2026-08-05",
    progress: 40,
    actionUrl: "https://fcos.example.com/growth-coaching",
    privateNote: "Do not disclose this",
    attachmentName: "private.pdf",
    recipientEmail: "person@example.com",
  });
  assert.deepEqual(safe, {
    title: "Prepare goal checkpoint",
    dueDate: "2026-08-05",
    progress: 40,
    actionUrl: "https://fcos.example.com/growth-coaching",
  });
  const email = buildGrowthNotificationEmail({
    notification: { ...safe, sharedNotes: "Never email this", recipientEmail: "person@example.com" },
  });
  assert.match(email.text, /Prepare goal checkpoint/);
  assert.doesNotMatch(`${email.text}${email.html}`, /Never email|person@example\.com|private\.pdf/);
  assert.match(email.html, /Open FCOS/);
});
