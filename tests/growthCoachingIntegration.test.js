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
const reportingBatchMigrationUrl = new URL(
  "../supabase/migrations/20260801131500_growth_reporting_lines_batch_save_hotfix.sql",
  import.meta.url,
);
const generalManagerMigrationUrl = new URL(
  "../supabase/migrations/20260801140504_general_manager_reporting_root_self_managed_goals.sql",
  import.meta.url,
);
const generalManagerTransferMigrationUrl = new URL(
  "../supabase/migrations/20260801150451_general_manager_user_type_transfer.sql",
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

test("reporting-line edits save through one revision-safe atomic batch", async () => {
  const [sql, service, panel, handler] = await Promise.all([
    readFile(reportingBatchMigrationUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
    readFile(new URL("../src/components/admin/ReportingLinesPanel.jsx", import.meta.url), "utf8"),
    readFile(handlerUrl, "utf8"),
  ]);
  assert.match(sql, /function public\.save_growth_reporting_assignments_batch/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('growth_reporting_hierarchy'\)\)/);
  assert.match(sql, /reporting_walk[\s\S]*has_cycle/);
  assert.match(sql, /Validate and revision-lock every requested row before making any change/);
  assert.match(sql, /delete from public\.growth_reporting_assignments[\s\S]*primary_manager_id is null and v_change\.secondary_manager_id is null/);
  assert.match(sql, /insert into public\.growth_reporting_assignments[\s\S]*on conflict \(employee_id\) do update/);
  assert.doesNotMatch(sql, /set primary_manager_id = null\s+where employee_id = any/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function public\.save_growth_reporting_assignments_batch[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.save_growth_reporting_assignments_batch[\s\S]*to service_role/);
  assert.match(service, /client\.rpc\("save_growth_reporting_assignments_batch"/);
  assert.match(handler, /growthReportingLinesSaveBatch: \[\]/);
  assert.match(panel, /Save changes \(\{changedLines\.length\}\)/);
  assert.match(panel, /growthReportingLinesSaveBatch/);
  assert.doesNotMatch(panel, /saveLine/);
});

test("the UUID-backed General Manager is the reporting root with self-managed goals", async () => {
  const [sql, service, panel, page] = await Promise.all([
    readFile(generalManagerMigrationUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
    readFile(new URL("../src/components/admin/ReportingLinesPanel.jsx", import.meta.url), "utf8"),
    readFile(pageUrl, "utf8"),
  ]);

  assert.match(sql, /from public\.collaboration_roles role_row[\s\S]*role_row\.role = 'general_manager'[\s\S]*role_row\.active[\s\S]*profile\.active/);
  assert.match(sql, /Exactly one active UUID-backed General Manager is required/);
  assert.match(sql, /cannot have a Primary or Advisory Manager/);
  assert.match(sql, /v_change\.employee_id = v_general_manager_id[\s\S]*primary_manager_id is not null[\s\S]*secondary_manager_id is not null/);
  assert.match(sql, /when 'self_activate'[\s\S]*v_goal\.employee_id is distinct from v_general_manager_id/);
  assert.match(sql, /when 'self_complete'[\s\S]*Final evidence is required/);
  assert.match(sql, /when 'self_not_achieved'[\s\S]*This outcome needs a note/);
  assert.match(sql, /'self_activated', 'self_completed', 'self_not_achieved'/);
  assert.match(sql, /insert into public\.growth_goal_decisions/);
  assert.match(sql, /insert into public\.growth_events[\s\S]*'goal_' \|\| v_decision_type/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.growth_active_general_manager_id\(\) from public, anon, authenticated/);

  assert.match(service, /isGeneralManager,/);
  assert.match(service, /managerAssignmentRequired: !isGeneralManager/);
  assert.match(service, /goalApprovalMode: isGeneralManager \? "self_managed" : "manager_approval"/);
  assert.match(service, /p_operation: "self_activate"/);
  assert.match(service, /operation = outcome === "complete" \? "self_complete" : "self_not_achieved"/);
  assert.match(service, /if \(isSelfManagedGoal\) \{\s*return \{ goal: saved \};\s*\}\s*const targetId/);

  assert.match(panel, /General Manager · Reporting root/);
  assert.match(panel, /Not required/);
  assert.match(panel, /line\.managerAssignmentRequired !== false/);
  assert.match(page, /goal\.permissions\?\.selfManaged \? 'Activate' : 'Submit'/);
  assert.match(page, /!hasPrimaryManager && !selfManagedGoals/);
  assert.match(page, /GoalHistorySection title="Goal decisions"/);
});

test("General Manager is a protected user type with an atomic successor transfer", async () => {
  const [sql, handler, admin, authModules, portal, updates] = await Promise.all([
    readFile(generalManagerTransferMigrationUrl, "utf8"),
    readFile(handlerUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(new URL("../src/lib/authModules.js", import.meta.url), "utf8"),
    readFile(new URL("../api/_portal.js", import.meta.url), "utf8"),
    readFile(new URL("../api/_fcosUpdates.js", import.meta.url), "utf8"),
  ]);

  assert.match(sql, /'general_manager',[\s\S]*'General Manager'[\s\S]*true,[\s\S]*5/);
  assert.match(sql, /from public\.user_type_module_permissions permission[\s\S]*permission\.user_type_id = 'administrator'/);
  assert.match(sql, /function public\.assign_general_manager_user_type[\s\S]*security invoker/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('fcos_general_manager_assignment'\)\)/);
  assert.match(sql, /if not p_confirm_transfer[\s\S]*Confirm the General Manager transfer/);
  assert.match(sql, /set user_type = 'administrator'[\s\S]*set user_type = 'general_manager'/);
  assert.match(sql, /delete from public\.growth_reporting_assignments[\s\S]*employee_id = v_target\.id/);
  assert.match(sql, /where employee_id = v_target\.id[\s\S]*'Completion Review', 'Cancellation Requested'/);
  assert.match(sql, /function public\.protect_last_active_administrator[\s\S]*user_type in \('administrator', 'general_manager'\)/);
  assert.match(sql, /function public\.save_fcos_update_batch[\s\S]*profile\.user_type in \('administrator', 'general_manager'\)/);
  assert.match(sql, /function public\.cancel_fcos_update_batch[\s\S]*profile\.user_type in \('administrator', 'general_manager'\)/);
  assert.match(sql, /profile\.user_type = 'general_manager'/);
  assert.match(sql, /revoke all on function public\.assign_general_manager_user_type[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(sql, /security definer/i);

  assert.match(handler, /ADMINISTRATIVE_USER_TYPES = new Set\(\['administrator', 'general_manager'\]\)/);
  assert.match(handler, /rpc\('assign_general_manager_user_type'/);
  assert.match(handler, /confirmGeneralManagerTransfer/);
  assert.match(handler, /Transfer General Manager authority to another active user before changing or deleting/);
  assert.match(admin, /Transfer General Manager authority from/);
  assert.match(admin, /edit the successor and select General Manager as their user type/);
  assert.match(admin, /confirmGeneralManagerTransfer: generalManagerTransferPending/);
  assert.match(authModules, /userType === 'administrator' \|\| userType === 'general_manager'/);
  assert.match(portal, /\['administrator', 'general_manager'\]\.includes\(profile\.user_type\)/);
  assert.doesNotMatch(updates, /assigned to Vincent Lee/);
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
  const [app, layout, workspaces, page, admin, handler, methodologies] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(new URL('../src/lib/workspaceStandards.js', import.meta.url), 'utf8'),
    readFile(pageUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(handlerUrl, "utf8"),
    readFile(new URL("../src/lib/pageMethodologies.js", import.meta.url), "utf8"),
  ]);
  assert.match(app, /path="\/growth-coaching" element=\{<GrowthCoaching \/>\}/);
  assert.doesNotMatch(app, /path="\/growth-coaching" element=\{<ModuleGate/);
  assert.ok(layout.indexOf("workspaceNavigation('growth_coaching'") < layout.indexOf("workspaceNavigation('projects_tasks'"));
  assert.ok(workspaces.indexOf("route: '/growth-coaching'") < workspaces.indexOf("route: '/projects-tasks'"));
  assert.match(layout, /<WorkNotifications \/>/);
  assert.match(page, /PageMethodology \{\.\.\.GROWTH_COACHING_METHODOLOGY\}/);
  assert.match(methodologies, /shared notes, actions, files, and decisions remain visible only to the pair/);
  assert.match(admin, /<ReportingLinesPanel \/>/);
  assert.match(handler, /growthCoachingBootstrap: \[\]/);
  assert.match(handler, /growthReportingLineSave: \[\]/);
  assert.match(handler, /growthReportingLinesSaveBatch: \[\]/);
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
  assert.match(page, /GoalHistorySection title="Goal decisions"/);
  assert.match(page, /GoalHistorySection title="Progress history"/);
  assert.match(page, /GoalHistorySection title="Checkpoint evidence"/);
  assert.match(page, /expectedPrivatePrepRevision: numeric\(sessionDraft\.privatePrepRevision\)/);
  assert.match(page, /selectedSession\.status === 'Awaiting Confirmation'/);
  assert.match(page, /busy === 'attachment' \|\| locked \|\| selectedSession\.status === 'Cancelled'/);
});
