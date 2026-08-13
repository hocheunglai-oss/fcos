import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { workCommitmentInternals } from "../api/_workCommitments.js";

const migrationUrl = new URL(
  "../supabase/migrations/20260731150148_collaboration_growth_workflow_improvements.sql",
  import.meta.url,
);
const collaborationServiceUrl = new URL("../api/_collaborationService.js", import.meta.url);
const growthServiceUrl = new URL("../api/_growthCoachingService.js", import.meta.url);
const notificationServiceUrl = new URL("../api/_workNotifications.js", import.meta.url);
const projectsPageUrl = new URL("../src/pages/ProjectsTasks.jsx", import.meta.url);
const growthPageUrl = new URL("../src/pages/GrowthCoaching.jsx", import.meta.url);
const commitmentsPageUrl = new URL("../src/pages/MyCommitments.jsx", import.meta.url);

test("unified commitments use Hong Kong due-date urgency and deterministic ordering", () => {
  assert.equal(workCommitmentInternals.urgencyFor("2026-07-30", "2026-07-31"), "overdue");
  assert.equal(workCommitmentInternals.urgencyFor("2026-07-31", "2026-07-31"), "due_today");
  assert.equal(workCommitmentInternals.urgencyFor("2026-08-05", "2026-07-31"), "coming_week");
  assert.equal(workCommitmentInternals.urgencyFor(null, "2026-07-31"), "no_due_date");
  const rows = [
    { title: "Later", urgency: "later", dueAt: "2026-09-01" },
    { title: "Decision", urgency: "needs_action", dueAt: null },
    { title: "Overdue", urgency: "overdue", dueAt: "2026-07-20" },
  ].sort(workCommitmentInternals.sortCommitments);
  assert.deepEqual(rows.map((row) => row.title), ["Overdue", "Decision", "Later"]);
});

test("operational commitments prioritize reconciliation and exact role actions", () => {
  assert.equal(workCommitmentInternals.collectionUrgency({
    status: "Awaiting Buyer",
    reconciliation_state: "payment_posting_mismatch",
  }), "needs_action");
  assert.equal(workCommitmentInternals.collectionUrgency({
    status: "Awaiting Buyer",
    reconciliation_state: "open",
  }), "waiting");
  assert.equal(workCommitmentInternals.collectionDueAt({
    status: "Payment Advice Received",
    advice_verification_date: "2026-08-05",
    next_follow_up_date: "2026-08-10",
  }), "2026-08-05");

  const profile = { id: "user-1" };
  assert.deepEqual(
    workCommitmentInternals.disputeCommitment(
      { workflow_status: "Pending Approval", submitted_by: "user-2" },
      profile,
      { disputeApprove: true, disputeAccount: false },
    ),
    {
      subtitle: "Commercial approval required",
      urgency: "needs_action",
      actionLabel: "Review dispute",
    },
  );
  assert.equal(
    workCommitmentInternals.disputeCommitment(
      { workflow_status: "Approved - Pending Accounting", submitted_by: "user-2" },
      profile,
      { disputeApprove: false, disputeAccount: false },
    ),
    null,
  );
});

test("workflow improvement migration is service-only, revision-aware, and identity based", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "collaboration_followers",
    "collaboration_dependencies",
    "collaboration_project_milestones",
    "collaboration_templates",
    "collaboration_template_items",
    "growth_goal_collaboration_evidence",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`, "i"));
  }
  assert.match(sql, /unique \(blocked_item_id, blocking_item_id\)/i);
  assert.match(sql, /This work item changed after it was opened/i);
  assert.match(sql, /circular blocker/i);
  assert.match(sql, /Only completed Projects & Tasks work may be linked as goal evidence/i);
  assert.match(sql, /status = case when p_response = 'decline' then 'Cancelled'/i);
  assert.match(sql, /p_target_start_date \+ greatest\(v_version\.deadline - v_source\.start_date, 0\)/i);
});

test("Projects & Tasks exposes coordination, templates, and controlled bulk updates", async () => {
  const [service, page] = await Promise.all([
    readFile(collaborationServiceUrl, "utf8"),
    readFile(projectsPageUrl, "utf8"),
  ]);
  assert.match(service, /blocked_item_id/);
  assert.match(service, /blocking_item_id/);
  assert.match(service, /save_collaboration_follower/);
  assert.match(service, /save_collaboration_milestone/);
  assert.match(service, /collaborationBulkUpdate/);
  assert.match(page, /Blocked reason/);
  assert.match(page, /Project milestones/);
  assert.match(page, /Save as template/);
  assert.match(page, /Update selected/);
  assert.match(page, /Dependencies and blockers/);
});

test("coaching loads confidential content only for the selected session", async () => {
  const [service, page] = await Promise.all([
    readFile(growthServiceUrl, "utf8"),
    readFile(growthPageUrl, "utf8"),
  ]);
  assert.match(service, /const contentSessionIds = requestedSessionId \? \[requestedSessionId\] : \[\]/);
  assert.match(service, /\.in\("session_id", contentSessionIds\)/);
  assert.match(service, /contentLoaded: session\.id === requestedSessionId/);
  assert.match(page, /selectedSessionId \? \{ sessionId: selectedSessionId \} : \{\}/);
  assert.match(page, /Loading the selected session/);
  assert.match(page, /TabsTrigger value="before"/);
  assert.match(page, /TabsTrigger value="during"/);
  assert.match(page, /TabsTrigger value="after"/);
});

test("notifications and commitments are actionable from one universal workspace", async () => {
  const [notifications, commitments] = await Promise.all([
    readFile(notificationServiceUrl, "utf8"),
    readFile(commitmentsPageUrl, "utf8"),
  ]);
  assert.match(notifications, /handled_at/);
  assert.match(notifications, /snoozed_until/);
  assert.match(notifications, /set_work_notification_state/);
  assert.match(notifications, /listSpecialTermApprovalQueue/);
  assert.match(notifications, /special_terms_notification_states/);
  assert.match(notifications, /set_special_terms_notification_state/);
  const commitmentService = await readFile(new URL('../api/_workCommitments.js', import.meta.url), 'utf8');
  assert.match(commitmentService, /notification\.source === 'special_terms'/);
  assert.match(commitmentService, /Review Special Term/);
  assert.match(commitments, /key: "special_terms", label: "Special Terms"/);
  assert.match(commitments, /My Commitments/);
  assert.match(commitments, /Needs action/);
  assert.match(commitments, /Waiting for others/);
  assert.match(commitments, /Payment Collections/);
  assert.match(commitments, /Disputes/);
  assert.match(commitments, /Hedge Desk/);
  assert.match(commitments, /System Errors/);
  assert.match(commitments, /item\.actionLabel/);
});
