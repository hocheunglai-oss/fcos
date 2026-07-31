import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260731070915_growth_coaching.sql",
  import.meta.url,
);
const workflowFixMigrationUrl = new URL(
  "../supabase/migrations/20260731082000_growth_coaching_workflow_fixes.sql",
  import.meta.url,
);
const serviceUrl = new URL("../api/_growthCoachingService.js", import.meta.url);
const handlerUrl = new URL("../api/functions/[name].js", import.meta.url);
const appUrl = new URL("../src/App.jsx", import.meta.url);
const layoutUrl = new URL("../src/components/Layout.jsx", import.meta.url);
const pageUrl = new URL("../src/pages/GrowthCoaching.jsx", import.meta.url);
const adminUrl = new URL("../src/pages/AdminControl.jsx", import.meta.url);

test("Growth & Coaching storage is private, revisioned, and service-only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "growth_reporting_assignments",
    "growth_development_plans",
    "growth_goals",
    "growth_goal_versions",
    "growth_goal_checkpoints",
    "growth_coaching_relationships",
    "growth_coaching_sessions",
    "growth_coaching_notes",
    "growth_coaching_actions",
    "growth_attachments",
    "growth_notifications",
    "growth_email_deliveries",
    "growth_calendar_sync",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /alter table public\.%I enable row level security/);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.%I to service_role/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all).* to (anon|authenticated)/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /'growth-coaching-files', 'growth-coaching-files', false, 20971520/);
});

test("reporting lines reject self-management, duplicate managers, inactive users, and cycles", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /growth_reporting_chain_has_cycle/);
  assert.match(sql, /A user cannot manage themselves/);
  assert.match(sql, /Primary and secondary managers must be different/);
  assert.match(sql, /must be an active FCOS user/);
  assert.match(sql, /would create a reporting cycle/);
  assert.match(sql, /p_expected_revision/);
});

test("goal drafts and public-task publication use atomic invoker functions", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /function public\.save_growth_goal_draft[\s\S]*security invoker/);
  assert.match(sql, /function public\.publish_growth_coaching_action[\s\S]*security invoker/);
  assert.match(sql, /public\.create_collaboration_item/);
  assert.match(sql, /'privateContentCopied', false/);
  assert.match(sql, /Only the action owner may publish it/);
});

test("goal decisions, progress, coaching content, and reporting-line transfers are atomic", async () => {
  const [sql, service] = await Promise.all([
    readFile(workflowFixMigrationUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
  ]);
  assert.match(sql, /function public\.save_growth_goal_progress[\s\S]*security invoker/);
  assert.match(sql, /function public\.decide_growth_goal[\s\S]*security invoker/);
  assert.match(sql, /function public\.save_growth_coaching_session_content[\s\S]*security invoker/);
  assert.match(sql, /function public\.save_growth_private_preparation[\s\S]*security invoker/);
  assert.match(sql, /function public\.confirm_growth_coaching_session[\s\S]*security invoker/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('growth_reporting_hierarchy'\)\)/);
  assert.match(sql, /'Draft', 'Pending Approval', 'Revision Requested', 'Active'/);
  assert.match(sql, /delete from public\.growth_coaching_confirmations[\s\S]*return jsonb_build_object/);
  assert.match(sql, /v_goal\.status <> 'Completion Review'/);
  assert.match(sql, /v_goal\.status <> 'Cancellation Requested'/);
  assert.match(sql, /v_session\.status <> 'Awaiting Confirmation'/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.save_growth_goal_progress[\s\S]*from public, anon, authenticated/);
  assert.match(service, /client\.rpc\("decide_growth_goal"/);
  assert.match(service, /client\.rpc\("save_growth_goal_progress"/);
  assert.match(service, /client\.rpc\("save_growth_coaching_session_content"/);
  assert.match(service, /client\.rpc\("save_growth_private_preparation"/);
  assert.match(service, /client\.rpc\("confirm_growth_coaching_session"/);
  assert.match(service, /context\.session\.relationship_id !== relationship\.id/);
});

test("coaching content is fetched only for the authenticated pair without an administrator override", async () => {
  const service = await readFile(serviceUrl, "utf8");
  assert.match(
    service,
    /\.or\(`participant_one_id\.eq\.\$\{profile\.id\},participant_two_id\.eq\.\$\{profile\.id\}`\)/,
  );
  assert.match(service, /relationshipIncludes\(data, actorId\)/);
  assert.match(service, /private_preparation" && row\.author_id === profile\.id/);
  assert.doesNotMatch(service, /user_type.*administrator[\s\S]{0,120}coaching/i);
  assert.match(service, /Only the action owner may edit it/);
  assert.match(service, /Confirm that the task becomes visible to every FCOS user/);
});

test("formal goal authority follows the current primary manager while higher managers remain read-only", async () => {
  const service = await readFile(serviceUrl, "utf8");
  assert.match(service, /goal\.primary_manager_id === profile\.id/);
  assert.match(service, /Only the current primary manager may decide this goal/);
  assert.match(service, /Only the current primary manager may comment on this goal/);
  assert.match(service, /Only the employee may submit this goal/);
  assert.match(service, /visibleEmployeeIds/);
});

test("private files use signed direct upload, 20 MiB validation, and short previews", async () => {
  const service = await readFile(serviceUrl, "utf8");
  assert.match(service, /validateCollaborationAttachment/);
  assert.match(service, /collaborationAvailableDisplayFilename/);
  assert.match(service, /createSignedUploadUrl\(storagePath, \{ upsert: false \}\)/);
  assert.match(service, /createSignedUrl\(attachment\.storage_path, 300/);
  assert.match(service, /Only the employee may add files to their development goal/);
  assert.match(service, /Attachments cannot be added to a cancelled or confirmed coaching session/);
  assert.match(service, /attachmentForActor\([\s\S]*\{ write: true \}/);
  assert.doesNotMatch(service, /contentBase64|data:application/);
});

test("Outlook synchronization is scoped to neutral events and never blocks FCOS session storage", async () => {
  const service = await readFile(serviceUrl, "utf8");
  const outlook = await readFile(new URL("../api/_growthOutlook.js", import.meta.url), "utf8");
  assert.match(outlook, /MICROSOFT_TENANT_ID/);
  assert.match(outlook, /requireExternalActionGate\('outlook_calendar'\)/);
  assert.match(outlook, /Agenda and coaching notes remain private/);
  assert.match(service, /let calendarStatus = "Synced"/);
  assert.match(service, /calendarStatus = calendarError\.code/);
  assert.match(service, /status: "Conflict"/);
  assert.match(service, /keep_outlook/);
  assert.match(service, /replace_with_fcos/);
});

test("Growth & Coaching is universal, sits above Projects & Tasks, and exposes reporting-line administration", async () => {
  const [app, layout, page, admin, handler] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(pageUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(handlerUrl, "utf8"),
  ]);
  assert.match(app, /path="\/growth-coaching" element=\{<GrowthCoaching \/>\}/);
  assert.doesNotMatch(app, /path="\/growth-coaching" element=\{<ModuleGate/);
  assert.ok(layout.indexOf("/growth-coaching") < layout.indexOf("/projects-tasks"));
  assert.match(layout, /<WorkNotifications \/>/);
  assert.match(page, /Coaching contents are visible only to the two participants/);
  assert.match(admin, /<ReportingLinesPanel \/>/);
  assert.match(handler, /growthCoachingBootstrap: \[\]/);
  assert.match(handler, /growthReportingLineSave: \[\]/);
  assert.match(handler, /'growthCoachingDailyCron'/);
});

test("Growth & Coaching preserves measurement shapes and uses the signed-upload client", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /currentValue: measurement\.current \?\? measurement\.currentValue/);
  assert.match(page, /label: item\.label \|\| item\.title/);
  assert.match(page, /measurement\.levels \|\| measurement\.rubric/);
  assert.match(page, /currentLevelId: measurement\.currentLevelId/);
  assert.match(page, /milestoneProgress: asArray\(payload\.milestoneProgress\)/);
  assert.match(page, /currentLevelId: payload\.currentLevelId \|\| null/);
  assert.match(page, /uploadToSignedUrl\(prepared\.data\.path, prepared\.data\.token, file/);
  assert.doesNotMatch(page, /fetch\(uploadUrl/);
  assert.match(page, /customCadenceDays: inviteCadence === 'custom'/);
  assert.match(page, /Every \$\{days\} days/);
  assert.doesNotMatch(page, /<SelectItem value="maintain">Maintain<\/SelectItem>/);
  assert.match(page, /GoalHistorySection title="Manager decisions"/);
  assert.match(page, /GoalHistorySection title="Progress history"/);
  assert.match(page, /GoalHistorySection title="Checkpoint evidence"/);
  assert.match(page, /expectedPrivatePrepRevision: numeric\(sessionDraft\.privatePrepRevision\)/);
  assert.match(page, /selectedSession\.status === 'Awaiting Confirmation'/);
  assert.match(page, /busy === 'attachment' \|\| locked \|\| selectedSession\.status === 'Cancelled'/);
});
