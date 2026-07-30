import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260730073240_projects_tasks_collaboration.sql",
  import.meta.url,
);
const functionUrl = new URL("../api/functions/[name].js", import.meta.url);
const serviceUrl = new URL("../api/_collaborationService.js", import.meta.url);
const appUrl = new URL("../src/App.jsx", import.meta.url);
const layoutUrl = new URL("../src/components/Layout.jsx", import.meta.url);
const vercelUrl = new URL("../vercel.json", import.meta.url);

test("collaboration migration creates service-only workflow storage and a private file bucket", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "collaboration_items",
    "collaboration_comments",
    "collaboration_comment_mentions",
    "collaboration_attachments",
    "collaboration_events",
    "collaboration_notifications",
    "collaboration_roles",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on table public\\.${table} from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(`grant all on table public\\.${table} to service_role`, "i"),
    );
  }
  assert.match(
    sql,
    /'collaboration-files',\s*'collaboration-files',\s*false,\s*20971520/is,
  );
  assert.match(sql, /lower\(email\) = 'vincent@cosulich\.com\.hk'/i);
  assert.match(sql, /role = 'general_manager'/i);
});

test("collaboration writes are revisioned, transactional, and permission checked", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /create or replace function public\.create_collaboration_item/i,
  );
  assert.match(
    sql,
    /create or replace function public\.save_collaboration_item/i,
  );
  assert.match(sql, /for update;/i);
  assert.match(
    sql,
    /p_expected_revision is null or p_expected_revision <> v_current\.revision/i,
  );
  assert.match(
    sql,
    /Only the owner or General Manager can assign or move this work item/i,
  );
  assert.match(
    sql,
    /Only the owner, assignee, or General Manager can edit this work item/i,
  );
  assert.match(
    sql,
    /Complete or cancel every active child before marking this item Done/i,
  );
  assert.match(
    sql,
    /v_current\.item_type = 'project'[\s\S]*child\.item_type = 'task'/i,
  );
  assert.match(sql, /with recursive descendants/i);
  assert.match(sql, /Restore the parent Project before restoring this Task/i);
  assert.match(sql, /Restore the parent Task before restoring this Subtask/i);
  assert.match(
    sql,
    /create or replace function public\.save_collaboration_comment/i,
  );
  assert.match(
    sql,
    /create or replace function public\.prepare_collaboration_attachment/i,
  );
  assert.match(
    sql,
    /create or replace function public\.create_collaboration_due_notifications/i,
  );
});

test("collaboration APIs are authenticated but cannot be hidden by module permissions", async () => {
  const source = await readFile(functionUrl, "utf8");
  for (const handler of [
    "collaborationList",
    "collaborationDetail",
    "collaborationCreate",
    "collaborationUpdate",
    "collaborationArchive",
    "collaborationCommentSave",
    "collaborationAttachmentPrepare",
    "collaborationNotificationsList",
  ]) {
    assert.match(source, new RegExp(`${handler}: \\[\\]`));
  }
  assert.match(source, /AUTH_EXEMPT_HANDLERS[\s\S]*'collaborationDailyCron'/);
  assert.match(
    source,
    /function collaborationDailyCron[\s\S]*requireCronAuthorization/,
  );
  assert.match(
    source,
    /from\('collaboration_events'\)[\s\S]*source: 'Projects & Tasks'/,
  );
});

test("attachment APIs use signed direct upload and short-lived private preview URLs", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(
    source,
    /createSignedUploadUrl\(storagePath, \{ upsert: false \}\)/,
  );
  assert.match(source, /\.info\(attachment\.storage_path\)/);
  assert.match(
    source,
    /createSignedUrl\(\s*attachment\.storage_path,\s*300,/,
  );
  assert.match(source, /validateCollaborationAttachment/);
  assert.doesNotMatch(source, /contentBase64|base64,/);
});

test("Projects & Tasks is a universal FCOS route with daily notification maintenance", async () => {
  const [appSource, layoutSource, vercelSource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(vercelUrl, "utf8"),
  ]);
  assert.match(
    appSource,
    /path="\/projects-tasks" element=\{<ProjectsTasks \/>\}/,
  );
  assert.doesNotMatch(
    appSource,
    /path="\/projects-tasks" element=\{<ModuleGate/,
  );
  assert.match(
    layoutSource,
    /to: '\/projects-tasks', label: 'Projects & Tasks'/,
  );
  assert.match(layoutSource, /<CollaborationNotifications \/>/);
  assert.match(
    vercelSource,
    /"path": "\/api\/functions\/collaborationDailyCron"/,
  );
  assert.match(vercelSource, /"schedule": "0 1 \* \* \*"/);
});
