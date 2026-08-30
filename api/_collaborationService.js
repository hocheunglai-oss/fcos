import { randomUUID } from "node:crypto";
import {
  COLLABORATION_ALLOWED_ATTACHMENTS,
  COLLABORATION_KINDS,
  COLLABORATION_PRIORITIES,
  COLLABORATION_STATUSES,
  calculateCollaborationProgress,
  canEditCollaborationItem,
  canManageCollaborationAssignments,
  validateCollaborationAttachment,
} from "./_collaboration.js";

const COLLABORATION_BUCKET = "collaboration-files";
const LIST_PAGE_MAX = 200;
const BOARD_PAGE_MAX = 500;
const RELATED_PAGE_MAX = 500;
const PROJECT_OPTIONS_MAX = 500;
const TEMPLATE_OPTIONS_MAX = 200;
const BULK_UPDATE_MAX = 50;
const WORKFLOW_ITEM_FIELDS = ["blocked_reason", "health_status", "health_note"];
const PROJECT_HEALTH_VALUES = Object.freeze(["On track", "At risk", "Blocked"]);
const ITEM_SELECT = [
  "id",
  "sequence_no",
  "item_key",
  "item_type",
  "project_id",
  "parent_id",
  "title",
  "description",
  "status",
  "priority",
  "start_date",
  "due_date",
  "owner_user_id",
  "owner_name",
  "owner_email",
  "assignee_user_id",
  "assignee_name",
  "assignee_email",
  "revision",
  "archived_at",
  "archived_by",
  "archived_by_email",
  "created_by",
  "created_by_email",
  "updated_by",
  "updated_by_email",
  "created_at",
  "updated_at",
].join(",");
const ITEM_SELECT_WITH_WORKFLOW = `${ITEM_SELECT},${WORKFLOW_ITEM_FIELDS.join(",")}`;

function appError(message, status = 500, details = undefined) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanText(value, maxLength = 255) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function nullableId(value) {
  return cleanText(value, 80) || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function requiredUuid(value, label) {
  const id = nullableId(value);
  if (!id || !isUuid(id)) throw appError(`${label} is invalid.`, 400);
  return id;
}

function uniqueIds(values, limit = 50) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => nullableId(value))
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

function hongKongDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function encodeCursor(item) {
  if (!item) return null;
  return Buffer.from(
    JSON.stringify({
      updatedAt: item.updated_at,
      id: item.id,
    }),
  ).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (
      !parsed?.updatedAt ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      !isUuid(parsed.id)
    ) {
      return null;
    }
    return parsed;
  } catch {
    throw appError(
      "The work-list cursor is invalid. Refresh the page and try again.",
      400,
    );
  }
}

function isMissingSchemaError(error) {
  const message = String(error?.message || "");
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST202" ||
    /relation .* does not exist|column .* does not exist|could not find .* function/i.test(
      message,
    )
  );
}

function isMissingRpcError(error) {
  return (
    error?.code === "PGRST202" ||
    /could not find .* function|does not exist/i.test(
      String(error?.message || ""),
    )
  );
}

function normalizePostgrestSearch(value) {
  return cleanText(value, 200)
    .replace(/[(),]/g, " ")
    .replace(/[\\%_]/g, "\\$&")
    .trim();
}

function normalizeWorkflowValues(body = {}, { partial = true } = {}) {
  const values = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const status = has("status") ? cleanText(body.status, 40) : null;
  const blockedReason = has("blockedReason")
    ? cleanText(body.blockedReason, 2000)
    : undefined;
  const projectHealth = has("projectHealth")
    ? cleanText(body.projectHealth, 40)
    : undefined;
  const healthNote = has("healthNote")
    ? cleanText(body.healthNote, 2000)
    : undefined;

  if (
    status === "Blocked" &&
    ((!partial && !blockedReason) ||
      (blockedReason !== undefined && !blockedReason))
  ) {
    throw appError("A blocked reason is required when status is Blocked.", 400);
  }
  if (blockedReason !== undefined)
    values.blocked_reason = blockedReason || null;
  if (projectHealth !== undefined) {
    if (projectHealth && !PROJECT_HEALTH_VALUES.includes(projectHealth)) {
      throw appError("Select a valid project health.", 400);
    }
    values.health_status = projectHealth || null;
  }
  if (healthNote !== undefined) values.health_note = healthNote || null;
  return values;
}

export function normalizeCollaborationWorkflowFields(body = {}, options = {}) {
  return normalizeWorkflowValues(body, { partial: false, ...options });
}

export function validateCollaborationBulkPayload(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length)
    return { ok: false, errors: ["Select at least one work item."] };
  if (items.length > BULK_UPDATE_MAX) {
    return {
      ok: false,
      errors: [`Bulk updates are limited to ${BULK_UPDATE_MAX} work items.`],
    };
  }
  const seen = new Set();
  const errors = [];
  for (const item of items) {
    if (!isUuid(item?.itemId))
      errors.push("Every bulk item must include a valid work item ID.");
    if (seen.has(item?.itemId))
      errors.push("The same work item cannot appear twice in a bulk update.");
    seen.add(item?.itemId);
    if (
      !Number.isInteger(Number(item?.expectedRevision)) ||
      Number(item.expectedRevision) < 1
    ) {
      errors.push("Every bulk item must include its current revision.");
    }
  }
  return { ok: errors.length === 0, errors };
}

function rpcError(error) {
  const message = String(
    error?.message || "Collaboration storage request failed.",
  );
  if (/changed after it was opened/i.test(message))
    return appError(message, 409);
  if (/not found|unavailable/i.test(message)) return appError(message, 404);
  if (
    /only the|active FCOS user|assignee|cannot|required|must|select a valid|complete or cancel/i.test(
      message,
    )
  ) {
    return appError(message, 400);
  }
  return error;
}

async function generalManagerAccess(client, userId) {
  const { data, error } = await client
    .from("collaboration_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "general_manager")
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function itemPermissionShape(row) {
  return {
    ownerId: row?.owner_user_id || null,
    assigneeId: row?.assignee_user_id || null,
  };
}

function activeChildren(item, allRows) {
  if (item.item_type === "project") {
    const tasks = allRows.filter(
      (row) =>
        row.item_type === "task" &&
        row.project_id === item.id &&
        !row.archived_at,
    );
    return tasks.flatMap((task) => {
      const subtasks = allRows.filter(
        (row) =>
          row.item_type === "subtask" &&
          row.parent_id === task.id &&
          !row.archived_at,
      );
      return subtasks.length ? subtasks : [task];
    });
  }
  if (item.item_type === "task") {
    return allRows.filter(
      (row) =>
        row.item_type === "subtask" &&
        row.parent_id === item.id &&
        !row.archived_at,
    );
  }
  return [];
}

function progressFor(item, allRows) {
  const children = activeChildren(item, allRows);
  const progress = calculateCollaborationProgress({
    status: item.status,
    children: children.map((child) => ({ status: child.status })),
  });
  const active = children.filter((child) => child.status !== "Cancelled");
  return {
    percent: progress,
    completed: active.filter((child) => child.status === "Done").length,
    total: active.length,
  };
}

function serializeItem(row, allRows, actor) {
  if (!row) return null;
  const project =
    row.item_type === "project"
      ? row
      : allRows.find((item) => item.id === row.project_id);
  const parent = allRows.find((item) => item.id === row.parent_id);
  const permissionItem = itemPermissionShape(row);
  return {
    id: row.id,
    key: row.item_key,
    kind: row.item_type,
    projectId: row.project_id || null,
    projectKey: project?.item_key || null,
    projectTitle: project?.title || null,
    parentId: row.parent_id || null,
    parentKey: parent?.item_key || null,
    parentTitle: parent?.title || null,
    title: row.title,
    description: row.description || "",
    status: row.status,
    blockedReason: row.blocked_reason || null,
    priority: row.priority,
    projectHealth:
      row.item_type === "project" ? row.health_status || null : null,
    healthNote: row.item_type === "project" ? row.health_note || null : null,
    startDate: row.start_date || null,
    dueDate: row.due_date || null,
    owner: {
      id: row.owner_user_id || null,
      name: row.owner_name || row.owner_email,
      email: row.owner_email,
      active: actor.activeUserIds.has(row.owner_user_id),
    },
    assignee:
      row.assignee_user_id || row.assignee_email
        ? {
            id: row.assignee_user_id || null,
            name: row.assignee_name || row.assignee_email,
            email: row.assignee_email,
            active: actor.activeUserIds.has(row.assignee_user_id),
          }
        : null,
    progress: progressFor(row, allRows),
    revision: Number(row.revision || 0),
    archivedAt: row.archived_at || null,
    archivedByEmail: row.archived_by_email || null,
    createdAt: row.created_at,
    createdByEmail: row.created_by_email,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    permissions: {
      canEdit: canEditCollaborationItem({
        item: permissionItem,
        actorId: actor.userId,
        isGeneralManager: actor.isGeneralManager,
      }),
      canManage: canManageCollaborationAssignments({
        item: permissionItem,
        actorId: actor.userId,
        isGeneralManager: actor.isGeneralManager,
      }),
      canComment: true,
      canUpload: !row.archived_at,
    },
  };
}

function listFilterQuery(query, body, profile, today, { cursor = null } = {}) {
  const scope = cleanText(body.scope || "all", 30).toLowerCase();
  if (scope === "my") {
    query = query.or(
      `owner_user_id.eq.${requiredUuid(profile.id, "Authenticated user")},assignee_user_id.eq.${requiredUuid(profile.id, "Authenticated user")}`,
    );
  }
  if (scope === "projects") query = query.eq("item_type", "project");
  if (body.includeArchived !== true) query = query.is("archived_at", null);
  if (body.kind) query = query.eq("item_type", cleanText(body.kind, 30));
  if (body.projectId) {
    const projectId = requiredUuid(body.projectId, "Project");
    query = query.or(`project_id.eq.${projectId},id.eq.${projectId}`);
  }
  if (body.status) query = query.eq("status", cleanText(body.status, 40));
  if (body.priority) query = query.eq("priority", cleanText(body.priority, 40));
  if (body.ownerId)
    query = query.eq("owner_user_id", requiredUuid(body.ownerId, "Owner"));
  if (body.assigneeId === "unassigned")
    query = query.is("assignee_user_id", null);
  else if (body.assigneeId) {
    query = query.eq(
      "assignee_user_id",
      requiredUuid(body.assigneeId, "Assignee"),
    );
  }
  if (body.dueState === "overdue") {
    query = query
      .lt("due_date", today)
      .not("status", "in", '("Done","Cancelled")');
  }
  if (body.dueState === "due_today") query = query.eq("due_date", today);
  if (body.dueState === "upcoming") query = query.gt("due_date", today);
  if (body.dueState === "no_due") query = query.is("due_date", null);

  const keyword = normalizePostgrestSearch(body.keyword);
  if (keyword) {
    const pattern = `*${keyword}*`;
    query = query.or(
      [
        "item_key",
        "title",
        "description",
        "owner_name",
        "owner_email",
        "assignee_name",
        "assignee_email",
      ]
        .map((field) => `${field}.ilike.${pattern}`)
        .join(","),
    );
  }
  if (cursor) {
    query = query.or(
      `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
    );
  }
  return query;
}

async function selectItems(
  client,
  configure,
  { count = null, head = false } = {},
) {
  const run = async (columns) => {
    let query = client
      .from("collaboration_items")
      .select(columns, count ? { count, head } : undefined);
    return configure(query);
  };
  let result = await run(ITEM_SELECT_WITH_WORKFLOW);
  if (result.error && isMissingSchemaError(result.error)) {
    result = await run(ITEM_SELECT);
    if (!result.error) result.workflowFieldsAvailable = false;
  } else if (!result.error) {
    result.workflowFieldsAvailable = true;
  }
  return result;
}

async function selectOptionalRows(client, table, configure, columns = "*") {
  const result = await configure(client.from(table).select(columns));
  if (result.error && isMissingSchemaError(result.error)) {
    return { data: [], error: null, available: false };
  }
  if (result.error) throw result.error;
  return { data: result.data || [], error: null, available: true };
}

async function activeUsersAndActor(client, profile) {
  const [usersResult, isGeneralManager] = await Promise.all([
    client
      .from("user_profiles")
      .select("id,email,full_name,user_type,active")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .limit(1000),
    generalManagerAccess(client, profile.id),
  ]);
  if (usersResult.error) throw usersResult.error;
  const users = usersResult.data || [];
  return {
    users,
    actor: {
      userId: profile.id,
      isGeneralManager,
      activeUserIds: new Set(users.map((user) => user.id)),
    },
  };
}

async function fetchRowsByIds(client, ids) {
  const unique = uniqueIds(ids, 1000).filter(isUuid);
  if (!unique.length) return { rows: [], workflowFieldsAvailable: true };
  const result = await selectItems(client, (query) => query.in("id", unique));
  if (result.error) throw result.error;
  return {
    rows: result.data || [],
    workflowFieldsAvailable: result.workflowFieldsAvailable,
  };
}

async function loadProgressGraph(client, seedRows) {
  const seed = seedRows || [];
  const projectIds = seed
    .filter((row) => row.item_type === "project")
    .map((row) => row.id);
  const taskIds = seed
    .filter((row) => row.item_type === "task")
    .map((row) => row.id);
  const referencedIds = seed.flatMap((row) => [row.project_id, row.parent_id]);

  const [references, directProjectTasks, directTaskSubtasks] =
    await Promise.all([
      fetchRowsByIds(client, referencedIds),
      projectIds.length
        ? selectItems(client, (query) =>
            query
              .eq("item_type", "task")
              .in("project_id", projectIds)
              .is("archived_at", null),
          )
        : Promise.resolve({ data: [], workflowFieldsAvailable: true }),
      taskIds.length
        ? selectItems(client, (query) =>
            query
              .eq("item_type", "subtask")
              .in("parent_id", taskIds)
              .is("archived_at", null),
          )
        : Promise.resolve({ data: [], workflowFieldsAvailable: true }),
    ]);
  if (directProjectTasks.error) throw directProjectTasks.error;
  if (directTaskSubtasks.error) throw directTaskSubtasks.error;
  const projectTasks = directProjectTasks.data || [];
  const nestedTaskIds = projectTasks.map((row) => row.id);
  const nestedSubtasks = nestedTaskIds.length
    ? await selectItems(client, (query) =>
        query
          .eq("item_type", "subtask")
          .in("parent_id", nestedTaskIds)
          .is("archived_at", null),
      )
    : { data: [], workflowFieldsAvailable: true };
  if (nestedSubtasks.error) throw nestedSubtasks.error;

  const rows = new Map();
  for (const row of [
    ...seed,
    ...references.rows,
    ...projectTasks,
    ...(directTaskSubtasks.data || []),
    ...(nestedSubtasks.data || []),
  ]) {
    rows.set(row.id, row);
  }
  return {
    rows: [...rows.values()],
    workflowFieldsAvailable:
      references.workflowFieldsAvailable &&
      directProjectTasks.workflowFieldsAvailable !== false &&
      directTaskSubtasks.workflowFieldsAvailable !== false &&
      nestedSubtasks.workflowFieldsAvailable !== false,
  };
}

function serializedUser(user) {
  return {
    id: user.id,
    name: user.full_name || user.email,
    email: user.email,
    userType: user.user_type,
  };
}

function serializeFollower(row) {
  return {
    itemId: row.item_id,
    userId: row.user_id,
    name: row.user_name || row.follower_name || row.user_email || null,
    email: row.user_email || row.follower_email || null,
    createdAt: row.created_at || null,
  };
}

function serializeMilestone(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    dueDate: row.due_date || null,
    status: row.status || "To Do",
    description: row.description || "",
    revision: Number(row.revision || 1),
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeTemplate(row, items = []) {
  return {
    id: row.id,
    name: row.title,
    description: row.description || "",
    active: !row.archived_at,
    revision: Number(row.revision || 1),
    ownerUserId: row.created_by || null,
    usageCount: Number(row.usage_count || 0),
    lastUsedAt: row.last_used_at || null,
    items: items
      .filter((item) => item.template_id === row.id)
      .map((item) => ({
        id: item.id,
        parentTemplateItemId: item.parent_template_item_id || null,
        kind: item.item_type,
        order: Number(item.item_order || 0),
        title: item.title,
        description: item.description || "",
        priority: item.priority || "Medium",
        relativeDueDays:
          item.relative_due_days == null
            ? null
            : Number(item.relative_due_days),
      })),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function serializeDependencies(
  client,
  rows = [],
  graphRows = [],
  targetKey = "blocking_item_id",
) {
  const targetIds = uniqueIds(
    rows.map((row) => row[targetKey]),
    1000,
  ).filter(isUuid);
  const known = new Map(graphRows.map((row) => [row.id, row]));
  const missingIds = targetIds.filter((id) => !known.has(id));
  if (missingIds.length) {
    const loaded = await fetchRowsByIds(client, missingIds);
    for (const row of loaded.rows) known.set(row.id, row);
  }
  return rows.map((row) => {
    const target = known.get(row[targetKey]) || null;
    return {
      id: row.id || null,
      itemId: row.blocked_item_id,
      dependsOnItemId: row.blocking_item_id,
      item: target
        ? {
            id: target.id,
            key: target.item_key,
            title: target.title,
            status: target.status,
          }
        : null,
      createdAt: row.created_at || null,
    };
  });
}

async function loadItemForMutation(client, itemId) {
  const result = await selectItems(client, (query) =>
    query.eq("id", itemId).maybeSingle(),
  );
  if (result.error) throw result.error;
  if (!result.data)
    throw appError("The selected work item was not found.", 404);
  return {
    item: result.data,
    workflowFieldsAvailable: result.workflowFieldsAvailable,
  };
}

async function mutationActor(client, profile) {
  const { actor } = await activeUsersAndActor(client, profile);
  return actor;
}

function requireItemEditPermission(item, actor) {
  if (
    !canEditCollaborationItem({
      item: itemPermissionShape(item),
      actorId: actor.userId,
      isGeneralManager: actor.isGeneralManager,
    })
  ) {
    throw appError(
      "Only the owner, assignee, or General Manager can edit this work item.",
      403,
    );
  }
}

function requireItemManagePermission(item, actor) {
  if (
    !canManageCollaborationAssignments({
      item: itemPermissionShape(item),
      actorId: actor.userId,
      isGeneralManager: actor.isGeneralManager,
    })
  ) {
    throw appError(
      "Only the owner or General Manager can manage this work item.",
      403,
    );
  }
}

export async function collaborationList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const today = hongKongDate();
  const cursor = decodeCursor(body.cursor);
  const pageSize = Math.max(
    20,
    Math.min(
      Number(body.pageSize) || 100,
      body.view === "board" ? BOARD_PAGE_MAX : LIST_PAGE_MAX,
    ),
  );

  const filters = (query, options = {}) =>
    listFilterQuery(query, body, profile, today, options);
  const [pageResult, totalResult, model, projectResult, templatesResult] =
    await Promise.all([
      selectItems(client, (query) =>
        filters(query, { cursor })
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(pageSize + 1),
      ),
      selectItems(client, (query) => filters(query), {
        count: "exact",
        head: true,
      }),
      activeUsersAndActor(client, profile),
      selectItems(client, (query) =>
        query
          .eq("item_type", "project")
          .is("archived_at", null)
          .order("title", { ascending: true })
          .limit(PROJECT_OPTIONS_MAX + 1),
      ),
      selectOptionalRows(client, "collaboration_templates", (query) =>
        query
          .is("archived_at", null)
          .order("title", { ascending: true })
          .limit(TEMPLATE_OPTIONS_MAX),
      ),
    ]);
  for (const result of [pageResult, totalResult, projectResult]) {
    if (result.error) throw result.error;
  }
  const pageRows = (pageResult.data || []).slice(0, pageSize);
  const projectRows = (projectResult.data || []).slice(0, PROJECT_OPTIONS_MAX);
  const graph = await loadProgressGraph(client, [...pageRows, ...projectRows]);
  const allRows = graph.rows;

  return {
    items: pageRows.map((row) => serializeItem(row, allRows, model.actor)),
    nextCursor:
      (pageResult.data || []).length > pageSize
        ? encodeCursor(pageRows.at(-1))
        : null,
    total: Number(totalResult.count || 0),
    users: model.users.map(serializedUser),
    projects: projectRows.map((row) =>
      serializeItem(row, allRows, model.actor),
    ),
    options: {
      statuses: COLLABORATION_STATUSES,
      priorities: COLLABORATION_PRIORITIES,
      kinds: COLLABORATION_KINDS,
      projectHealth: PROJECT_HEALTH_VALUES,
      templates: templatesResult.data.map((row) => serializeTemplate(row)),
      projectOptionsTruncated:
        (projectResult.data || []).length > PROJECT_OPTIONS_MAX,
      templatesAvailable: templatesResult.available,
    },
    currentUser: {
      id: profile.id,
      email: profile.email,
      isGeneralManager: model.actor.isGeneralManager,
    },
    today,
    capped: false,
    workflowFieldsAvailable: graph.workflowFieldsAvailable,
  };
}

export async function collaborationDetail(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = requiredUuid(body.itemId, "Work item");
  const [itemResult, model] = await Promise.all([
    selectItems(client, (query) => query.eq("id", itemId).maybeSingle()),
    activeUsersAndActor(client, profile),
  ]);
  if (itemResult.error) throw itemResult.error;
  const itemRow = itemResult.data;
  if (!itemRow) throw appError("The selected work item was not found.", 404);

  const graph = await loadProgressGraph(client, [itemRow]);
  const allRows = graph.rows;

  const [
    commentsResult,
    attachmentsResult,
    eventsResult,
    followersResult,
    dependenciesResult,
    dependentsResult,
    milestonesResult,
    templatesResult,
    dependencyCandidatesResult,
  ] = await Promise.all([
    client
      .from("collaboration_comments")
      .select(
        "id,item_id,body,revision,author_user_id,author_name,author_email,edited_at,deleted_at,deleted_by_email,created_at,updated_at",
      )
      .eq("item_id", itemId)
      .order("created_at", { ascending: true })
      .limit(RELATED_PAGE_MAX + 1),
    client
      .from("collaboration_attachments")
      .select(
        "id,item_id,comment_id,original_filename,display_filename,content_type,file_extension,content_size,upload_status,uploaded_by,uploaded_by_name,uploaded_by_email,completed_at,deleted_at,created_at",
      )
      .eq("item_id", itemId)
      .in("upload_status", ["pending", "complete"])
      .order("created_at", { ascending: false })
      .limit(RELATED_PAGE_MAX + 1),
    client
      .from("collaboration_events")
      .select(
        "id,item_id,comment_id,attachment_id,event_type,summary,metadata,actor_user_id,actor_name,actor_email,created_at",
      )
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(RELATED_PAGE_MAX + 1),
    selectOptionalRows(client, "collaboration_followers", (query) =>
      query.eq("item_id", itemId).order("created_at", { ascending: true }),
    ),
    selectOptionalRows(client, "collaboration_dependencies", (query) =>
      query
        .eq("blocked_item_id", itemId)
        .order("created_at", { ascending: true }),
    ),
    selectOptionalRows(client, "collaboration_dependencies", (query) =>
      query
        .eq("blocking_item_id", itemId)
        .order("created_at", { ascending: true }),
    ),
    itemRow.item_type === "project"
      ? selectOptionalRows(
          client,
          "collaboration_project_milestones",
          (query) =>
            query
              .eq("project_id", itemId)
              .order("due_date", { ascending: true }),
        )
      : Promise.resolve({ data: [], available: true }),
    selectOptionalRows(client, "collaboration_templates", (query) =>
      query
        .is("archived_at", null)
        .order("title", { ascending: true })
        .limit(TEMPLATE_OPTIONS_MAX),
    ),
    selectItems(client, (query) =>
      query
        .neq("id", itemId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(PROJECT_OPTIONS_MAX),
    ),
  ]);
  for (const result of [
    commentsResult,
    attachmentsResult,
    eventsResult,
    dependencyCandidatesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const comments = (commentsResult.data || []).slice(0, RELATED_PAGE_MAX);
  const attachments = (attachmentsResult.data || []).slice(0, RELATED_PAGE_MAX);
  const events = (eventsResult.data || []).slice(0, RELATED_PAGE_MAX);
  const commentIds = comments.map((comment) => comment.id);
  const mentionsResult = commentIds.length
    ? await client
        .from("collaboration_comment_mentions")
        .select("comment_id,mentioned_user_id")
        .in("comment_id", commentIds)
    : { data: [], error: null };
  if (mentionsResult.error) throw mentionsResult.error;

  const mentionMap = new Map();
  for (const mention of mentionsResult.data || []) {
    if (!mentionMap.has(mention.comment_id))
      mentionMap.set(mention.comment_id, []);
    mentionMap.get(mention.comment_id).push(mention.mentioned_user_id);
  }
  const visibleAttachments = attachments.filter(
    (attachment) =>
      attachment.upload_status === "complete" ||
      attachment.uploaded_by === profile.id,
  );
  const childRows = allRows.filter(
    (row) =>
      (itemRow.item_type === "project" &&
        row.item_type === "task" &&
        row.project_id === itemRow.id) ||
      (itemRow.item_type === "task" &&
        row.item_type === "subtask" &&
        row.parent_id === itemRow.id),
  );

  return {
    item: serializeItem(itemRow, allRows, model.actor),
    currentUser: {
      id: profile.id,
      email: profile.email,
      isGeneralManager: model.actor.isGeneralManager,
    },
    children: childRows.map((row) => serializeItem(row, allRows, model.actor)),
    comments: comments.map((comment) => ({
      id: comment.id,
      itemId: comment.item_id,
      body: comment.deleted_at ? "" : comment.body,
      revision: Number(comment.revision || 0),
      author: {
        id: comment.author_user_id || null,
        name: comment.author_name || comment.author_email,
        email: comment.author_email,
      },
      mentionedUserIds: mentionMap.get(comment.id) || [],
      editedAt: comment.edited_at || null,
      deletedAt: comment.deleted_at || null,
      deletedByEmail: comment.deleted_by_email || null,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      canEdit:
        !comment.deleted_at &&
        (comment.author_user_id === profile.id || model.actor.isGeneralManager),
    })),
    attachments: visibleAttachments.map((attachment) => ({
      id: attachment.id,
      itemId: attachment.item_id,
      commentId: attachment.comment_id || null,
      originalFilename: attachment.original_filename,
      displayFilename: attachment.display_filename,
      contentType: attachment.content_type,
      extension: attachment.file_extension,
      size: Number(attachment.content_size || 0),
      status: attachment.upload_status,
      uploader: {
        id: attachment.uploaded_by || null,
        name: attachment.uploaded_by_name || attachment.uploaded_by_email,
        email: attachment.uploaded_by_email,
      },
      completedAt: attachment.completed_at || null,
      createdAt: attachment.created_at,
      canDelete:
        attachment.upload_status === "complete" &&
        (attachment.uploaded_by === profile.id ||
          itemRow.owner_user_id === profile.id ||
          model.actor.isGeneralManager),
      previewable:
        attachment.content_type === "application/pdf" ||
        attachment.content_type.startsWith("image/") ||
        attachment.content_type.startsWith("text/") ||
        attachment.content_type === "message/rfc822",
    })),
    events,
    users: model.users.map(serializedUser),
    projects: allRows
      .filter((row) => row.item_type === "project" && !row.archived_at)
      .map((row) => serializeItem(row, allRows, model.actor)),
    dependencyCandidates: (dependencyCandidatesResult.data || []).map((row) =>
      serializeItem(
        row,
        [...allRows, ...(dependencyCandidatesResult.data || [])],
        model.actor,
      ),
    ),
    followers: followersResult.data.map((row) => {
      const user = model.users.find(
        (candidate) => candidate.id === row.user_id,
      );
      return serializeFollower({
        ...row,
        user_name: user?.full_name || row.user_name,
        user_email: user?.email || row.user_email,
      });
    }),
    dependencies: await serializeDependencies(
      client,
      dependenciesResult.data,
      allRows,
    ),
    dependents: await serializeDependencies(
      client,
      dependentsResult.data,
      allRows,
      "blocked_item_id",
    ),
    milestones: milestonesResult.data.map(serializeMilestone),
    templates: templatesResult.data.map((row) => serializeTemplate(row)),
    relatedTruncation: {
      comments: (commentsResult.data || []).length > RELATED_PAGE_MAX,
      attachments: (attachmentsResult.data || []).length > RELATED_PAGE_MAX,
      events: (eventsResult.data || []).length > RELATED_PAGE_MAX,
    },
    enhancementsAvailable: {
      followers: followersResult.available,
      dependencies: dependenciesResult.available && dependentsResult.available,
      milestones: milestonesResult.available,
      templates: templatesResult.available,
    },
    workflowFieldsAvailable:
      itemResult.workflowFieldsAvailable && graph.workflowFieldsAvailable,
  };
}

function createValues(body, profile) {
  const kind = COLLABORATION_KINDS.includes(body.kind) ? body.kind : "task";
  const title = cleanText(body.title, 255);
  if (!title) throw appError("Title is required.", 400);
  const description = String(body.description || "");
  if (description.length > 20000)
    throw appError("Description must be 20,000 characters or fewer.", 400);
  const status = COLLABORATION_STATUSES.includes(body.status)
    ? body.status
    : "To Do";
  const priority = COLLABORATION_PRIORITIES.includes(body.priority)
    ? body.priority
    : "Medium";
  return {
    item_type: kind,
    title,
    description,
    status,
    priority,
    start_date: cleanText(body.startDate, 10) || null,
    due_date: cleanText(body.dueDate, 10) || null,
    project_id: nullableId(body.projectId),
    parent_id: nullableId(body.parentId),
    assignee_user_id: nullableId(body.assigneeId),
    owner_user_id: profile.id,
  };
}

export async function collaborationCreate(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const workflowValues = normalizeWorkflowValues(body, { partial: false });
  const { data, error } = await client.rpc("create_collaboration_item", {
    p_values: { ...createValues(body, profile), ...workflowValues },
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) throw rpcError(error);
  return collaborationDetail({ itemId: data.item.id }, accessContext);
}

function updateValues(body) {
  const values = {};
  const copy = (browserKey, databaseKey = browserKey) => {
    if (Object.prototype.hasOwnProperty.call(body, browserKey))
      values[databaseKey] = body[browserKey];
  };
  copy("title");
  copy("description");
  copy("status");
  copy("priority");
  copy("startDate", "start_date");
  copy("dueDate", "due_date");
  copy("assigneeId", "assignee_user_id");
  copy("projectId", "project_id");
  copy("parentId", "parent_id");
  if (values.title != null) values.title = cleanText(values.title, 255);
  if (values.description != null)
    values.description = String(values.description);
  if (values.status != null && !COLLABORATION_STATUSES.includes(values.status))
    throw appError("Select a valid status.", 400);
  if (
    values.priority != null &&
    !COLLABORATION_PRIORITIES.includes(values.priority)
  )
    throw appError("Select a valid priority.", 400);
  return values;
}

export async function collaborationUpdate(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = requiredUuid(body.itemId, "Work item");
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    throw appError("Refresh the work item before saving.", 409);
  const workflowValues = normalizeWorkflowValues(body, { partial: true });
  const { data, error } = await client.rpc("save_collaboration_item", {
    p_item_id: itemId,
    p_values: { ...updateValues(body), ...workflowValues },
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (error) {
    const translated = rpcError(error);
    if (translated.status === 409) {
      const latest = await collaborationDetail({ itemId }, accessContext).catch(
        () => null,
      );
      translated.details = latest;
    }
    throw translated;
  }
  return collaborationDetail({ itemId: data.item.id }, accessContext);
}

export async function collaborationArchive(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = nullableId(body.itemId);
  const expectedRevision = Number(body.expectedRevision);
  if (!itemId) throw appError("Work item is required.", 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    throw appError(
      "Refresh the work item before changing its archive state.",
      409,
    );
  const { data, error } = await client.rpc("set_collaboration_item_archived", {
    p_item_id: itemId,
    p_archived: body.archived === true,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (error) throw rpcError(error);
  return {
    ...(await collaborationDetail({ itemId: data.item.id }, accessContext)),
    affectedItems: Number(data.affectedItems || 0),
  };
}

async function tryOptionalRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error && isMissingRpcError(error))
    return { available: false, data: null };
  if (error) throw rpcError(error);
  return { available: true, data };
}

function mutationConflict(
  message = "This work item changed after it was opened. Refresh and review the latest update.",
) {
  return appError(message, 409);
}

export async function collaborationFollowerToggle(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = requiredUuid(body.itemId, "Work item");
  const { item } = await loadItemForMutation(client, itemId);
  if (item.archived_at)
    throw appError("Restore this work item before following it.", 400);
  const rpc = await tryOptionalRpc(client, "save_collaboration_follower", {
    p_item_id: itemId,
    p_follow: body.following !== false,
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (!rpc.available) {
    throw appError(
      "Collaboration followers are not available. Apply the collaboration workflow migration first.",
      503,
    );
  }
  return collaborationDetail({ itemId }, accessContext);
}

export async function collaborationDependencySave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = requiredUuid(body.itemId, "Work item");
  const dependsOnItemId = requiredUuid(body.dependsOnItemId, "Dependency");
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw mutationConflict(
      "Refresh the work item before changing its dependencies.",
    );
  }
  if (itemId === dependsOnItemId)
    throw appError("A work item cannot depend on itself.", 400);
  const [source, target, actor] = await Promise.all([
    loadItemForMutation(client, itemId),
    loadItemForMutation(client, dependsOnItemId),
    mutationActor(client, profile),
  ]);
  requireItemManagePermission(source.item, actor);
  if (source.item.archived_at || target.item.archived_at) {
    throw appError(
      "Archived work items cannot be linked as dependencies.",
      400,
    );
  }
  if (Number(source.item.revision) !== expectedRevision)
    throw mutationConflict();
  const rpc = await tryOptionalRpc(client, "save_collaboration_dependency", {
    p_item_id: itemId,
    p_blocked_by_item_id: dependsOnItemId,
    p_remove: false,
    p_actor_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (!rpc.available) {
    throw appError(
      "Collaboration dependencies are not available. Apply the collaboration workflow migration first.",
      503,
    );
  }
  return collaborationDetail({ itemId }, accessContext);
}

export async function collaborationDependencyRemove(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = requiredUuid(body.itemId, "Work item");
  const dependsOnItemId = requiredUuid(body.dependsOnItemId, "Dependency");
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw mutationConflict(
      "Refresh the work item before changing its dependencies.",
    );
  }
  const [source, actor] = await Promise.all([
    loadItemForMutation(client, itemId),
    mutationActor(client, profile),
  ]);
  requireItemManagePermission(source.item, actor);
  if (Number(source.item.revision) !== expectedRevision)
    throw mutationConflict();
  const rpc = await tryOptionalRpc(client, "save_collaboration_dependency", {
    p_item_id: itemId,
    p_blocked_by_item_id: dependsOnItemId,
    p_remove: true,
    p_actor_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (!rpc.available) {
    throw appError(
      "Collaboration dependencies are not available. Apply the collaboration workflow migration first.",
      503,
    );
  }
  return collaborationDetail({ itemId }, accessContext);
}

export async function collaborationMilestoneSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const projectId = requiredUuid(body.projectId, "Project");
  const expectedProjectRevision = Number(body.expectedProjectRevision);
  if (
    !Number.isInteger(expectedProjectRevision) ||
    expectedProjectRevision < 1
  ) {
    throw mutationConflict("Refresh the project before saving a milestone.");
  }
  const [project, actor] = await Promise.all([
    loadItemForMutation(client, projectId),
    mutationActor(client, profile),
  ]);
  if (project.item.item_type !== "project")
    throw appError("Milestones can only be saved on a project.", 400);
  requireItemManagePermission(project.item, actor);
  if (Number(project.item.revision) !== expectedProjectRevision)
    throw mutationConflict();
  const title = cleanText(body.title, 255);
  const description = cleanText(body.description, 5000);
  const dueDate = cleanText(body.dueDate, 10) || null;
  const status = cleanText(body.status || "To Do", 40);
  if (!title) throw appError("Milestone title is required.", 400);
  if (!dueDate) throw appError("Milestone due date is required.", 400);
  if (
    !["To Do", "In Progress", "At Risk", "Done", "Cancelled"].includes(status)
  ) {
    throw appError("Select a valid milestone status.", 400);
  }
  const milestoneId = body.milestoneId
    ? requiredUuid(body.milestoneId, "Milestone")
    : null;
  const expectedRevision = milestoneId ? Number(body.expectedRevision) : null;
  if (
    milestoneId &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw mutationConflict("Refresh the milestone before saving.");
  }
  const rpc = await tryOptionalRpc(client, "save_collaboration_milestone", {
    p_values: {
      id: milestoneId,
      project_id: projectId,
      title,
      description,
      due_date: dueDate,
      status,
      expected_revision: expectedRevision || 0,
      expected_project_revision: expectedProjectRevision,
    },
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (!rpc.available) {
    throw appError(
      "Project milestones are not available. Apply the collaboration workflow migration first.",
      503,
    );
  }
  return collaborationDetail({ itemId: projectId }, accessContext);
}

export async function collaborationTemplateList(body = {}, accessContext) {
  const { client } = accessContext;
  const includeInactive = body.includeInactive === true;
  const result = await selectOptionalRows(
    client,
    "collaboration_templates",
    (query) => {
      if (!includeInactive) query = query.is("archived_at", null);
      return query
        .order("title", { ascending: true })
        .limit(TEMPLATE_OPTIONS_MAX);
    },
  );
  const templateIds = result.data.map((row) => row.id);
  const itemsResult = templateIds.length
    ? await selectOptionalRows(
        client,
        "collaboration_template_items",
        (query) =>
          query
            .in("template_id", templateIds)
            .order("item_order", { ascending: true }),
      )
    : { data: [], available: result.available };
  return {
    templates: result.data.map((row) =>
      serializeTemplate(row, itemsResult.data),
    ),
    available: result.available && itemsResult.available,
  };
}

export async function collaborationTemplateSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const templateId = body.templateId
    ? requiredUuid(body.templateId, "Template")
    : null;
  if (body.mode === "use") {
    if (!templateId) throw appError("Select a project template.", 400);
    const projectBody = { ...(body.project || {}), kind: "project" };
    const project = {
      ...createValues(projectBody, profile),
      ...normalizeWorkflowValues(projectBody, { partial: false }),
    };
    const rpc = await tryOptionalRpc(client, "save_collaboration_template", {
      p_values: { mode: "use", id: templateId, project },
      p_actor_id: profile.id,
      p_actor_email: profile.email,
    });
    if (!rpc.available) {
      throw appError(
        "Reusable templates are not available. Apply the collaboration workflow migration first.",
        503,
      );
    }
    return collaborationDetail({ itemId: rpc.data.project.id }, accessContext);
  }
  const expectedRevision = templateId ? Number(body.expectedRevision) : null;
  if (
    templateId &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw mutationConflict("Refresh the template before saving.");
  }
  const name = cleanText(body.name, 255);
  const description = cleanText(body.description, 5000);
  if (!name) throw appError("Template name is required.", 400);
  const templateItems = (Array.isArray(body.items) ? body.items : [])
    .slice(0, 100)
    .map((item, index) => {
      const kind = cleanText(
        item.kind || item.itemType || "task",
        30,
      ).toLowerCase();
      const title = cleanText(item.title, 255);
      if (!title) throw appError("Every template task needs a title.", 400);
      if (!["task", "subtask"].includes(kind))
        throw appError("Template work must be a task or subtask.", 400);
      return {
        id: item.id && isUuid(item.id) ? item.id : undefined,
        parent_template_item_id: item.parentTemplateItemId || null,
        item_type: kind,
        item_order: Number.isInteger(Number(item.order))
          ? Number(item.order)
          : index,
        title,
        description: cleanText(item.description, 20000),
        priority: COLLABORATION_PRIORITIES.includes(item.priority)
          ? item.priority
          : "Medium",
        relative_due_days:
          item.relativeDueDays == null
            ? null
            : Math.max(0, Math.min(3650, Number(item.relativeDueDays))),
      };
    });
  const rpc = await tryOptionalRpc(client, "save_collaboration_template", {
    p_values: {
      mode: "save",
      id: templateId,
      title: name,
      description,
      archived: body.active === false,
      expected_revision: expectedRevision || 0,
      items: templateItems,
    },
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (!rpc.available) {
    throw appError(
      "Reusable templates are not available. Apply the collaboration workflow migration first.",
      503,
    );
  }
  return collaborationTemplateList({}, accessContext);
}

export async function collaborationBulkUpdate(body = {}, accessContext) {
  const validation = validateCollaborationBulkPayload(body);
  if (!validation.ok) throw appError(validation.errors.join(" "), 400);
  const results = [];
  for (const change of body.items) {
    try {
      const detail = await collaborationUpdate(
        {
          ...change.values,
          itemId: change.itemId,
          expectedRevision: change.expectedRevision,
        },
        accessContext,
      );
      results.push({
        itemId: change.itemId,
        ok: true,
        revision: detail.item.revision,
      });
    } catch (error) {
      const status = Number(error.status || 500);
      results.push({
        itemId: change.itemId,
        ok: false,
        status,
        message: status < 500 && error.message ? error.message : "Unable to update this work item.",
        latest: error.status === 409 ? error.details?.item || null : null,
      });
    }
  }
  return {
    results,
    updated: results.filter((result) => result.ok).length,
    conflicts: results.filter((result) => result.status === 409),
    failed: results.filter((result) => !result.ok),
  };
}

export async function collaborationCommentSave(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = nullableId(body.itemId);
  if (!itemId) throw appError("Work item is required.", 400);
  const commentId = nullableId(body.commentId);
  const expectedRevision = commentId ? Number(body.expectedRevision) : null;
  if (
    commentId &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw appError("Refresh the comment before saving.", 409);
  }
  const { data, error } = await client.rpc("save_collaboration_comment", {
    p_item_id: itemId,
    p_comment_id: commentId,
    p_body: String(body.body || ""),
    p_mentioned_user_ids: uniqueIds(body.mentionedUserIds, 20),
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (error) throw rpcError(error);
  return collaborationDetail({ itemId: data.comment.item_id }, accessContext);
}

export async function collaborationCommentDelete(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = nullableId(body.itemId);
  const commentId = nullableId(body.commentId);
  const expectedRevision = Number(body.expectedRevision);
  if (!itemId || !commentId)
    throw appError("Work item and comment are required.", 400);
  const { data, error } = await client.rpc("delete_collaboration_comment", {
    p_item_id: itemId,
    p_comment_id: commentId,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
  });
  if (error) throw rpcError(error);
  return collaborationDetail({ itemId: data.comment.item_id }, accessContext);
}

export async function collaborationAttachmentPrepare(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = nullableId(body.itemId);
  if (!itemId) throw appError("Work item is required.", 400);
  const validation = validateCollaborationAttachment({
    fileName: body.fileName,
    mimeType: body.contentType,
    size: Number(body.size),
  });
  if (!validation.ok) throw appError(validation.errors.join(" "), 400);

  const storagePath = `${itemId}/${randomUUID()}.${validation.value.extension}`;
  const contentType =
    !validation.value.mimeType ||
    validation.value.mimeType === "application/octet-stream"
      ? COLLABORATION_ALLOWED_ATTACHMENTS[validation.value.extension][0]
      : validation.value.mimeType;
  const { data: attachment, error: attachmentError } = await client.rpc(
    "prepare_collaboration_attachment",
    {
      p_item_id: itemId,
      p_comment_id: nullableId(body.commentId),
      p_original_filename: validation.value.fileName,
      p_content_type: contentType,
      p_file_extension: validation.value.extension,
      p_content_size: validation.value.size,
      p_storage_path: storagePath,
      p_actor_user_id: profile.id,
      p_actor_email: profile.email,
    },
  );
  if (attachmentError) throw rpcError(attachmentError);

  const { data: signed, error: signedError } = await client.storage
    .from(COLLABORATION_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signedError || !signed?.token) {
    await client
      .from("collaboration_attachments")
      .delete()
      .eq("id", attachment.id);
    throw appError("Private file upload is temporarily unavailable.", 503);
  }
  return {
    attachmentId: attachment.id,
    itemId,
    displayFilename: attachment.display_filename,
    contentType,
    path: signed.path,
    token: signed.token,
    bucket: COLLABORATION_BUCKET,
    expiresAt: attachment.upload_expires_at,
  };
}

export async function collaborationAttachmentComplete(
  body = {},
  accessContext,
) {
  const { client, profile } = accessContext;
  const attachmentId = nullableId(body.attachmentId);
  if (!attachmentId) throw appError("Attachment is required.", 400);
  const { data: attachment, error: rowError } = await client
    .from("collaboration_attachments")
    .select(
      "id,item_id,storage_path,content_size,content_type,upload_status,uploaded_by",
    )
    .eq("id", attachmentId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (
    !attachment ||
    attachment.upload_status !== "pending" ||
    attachment.uploaded_by !== profile.id
  ) {
    throw appError("The pending attachment was not found.", 404);
  }

  const { data: info, error: infoError } = await client.storage
    .from(COLLABORATION_BUCKET)
    .info(attachment.storage_path);
  if (infoError || !info)
    throw appError(
      "The uploaded file could not be verified. Upload it again.",
      409,
    );
  if (Number(info.size || 0) !== Number(attachment.content_size)) {
    await client.storage
      .from(COLLABORATION_BUCKET)
      .remove([attachment.storage_path])
      .catch(() => null);
    throw appError(
      "The uploaded file size does not match the selected file.",
      409,
    );
  }

  const { data, error } = await client.rpc(
    "complete_collaboration_attachment",
    {
      p_attachment_id: attachmentId,
      p_actor_user_id: profile.id,
      p_actor_email: profile.email,
    },
  );
  if (error) throw rpcError(error);
  return collaborationDetail(
    { itemId: data.attachment.item_id },
    accessContext,
  );
}

export async function collaborationAttachmentUrl(body = {}, accessContext) {
  const { client } = accessContext;
  const attachmentId = nullableId(body.attachmentId);
  if (!attachmentId) throw appError("Attachment is required.", 400);
  const { data: attachment, error } = await client
    .from("collaboration_attachments")
    .select("id,storage_path,display_filename,content_type,upload_status")
    .eq("id", attachmentId)
    .eq("upload_status", "complete")
    .maybeSingle();
  if (error) throw error;
  if (!attachment)
    throw appError("The selected attachment is unavailable.", 404);

  const download = body.download === true ? attachment.display_filename : false;
  const { data: signed, error: signedError } = await client.storage
    .from(COLLABORATION_BUCKET)
    .createSignedUrl(
      attachment.storage_path,
      300,
      download ? { download } : undefined,
    );
  if (signedError || !signed?.signedUrl)
    throw appError("The private file link could not be created.", 503);
  return {
    url: signed.signedUrl,
    expiresIn: 300,
    displayFilename: attachment.display_filename,
    contentType: attachment.content_type,
  };
}

export async function collaborationAttachmentDelete(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const attachmentId = nullableId(body.attachmentId);
  if (!attachmentId) throw appError("Attachment is required.", 400);
  const { data: current, error: currentError } = await client
    .from("collaboration_attachments")
    .select("id,item_id,storage_path,upload_status")
    .eq("id", attachmentId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.upload_status !== "complete")
    throw appError("The selected attachment is unavailable.", 404);

  const { data, error } = await client.rpc("delete_collaboration_attachment", {
    p_attachment_id: attachmentId,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) throw rpcError(error);
  const { error: removeError } = await client.storage
    .from(COLLABORATION_BUCKET)
    .remove([current.storage_path]);
  if (!removeError) {
    await client
      .from("collaboration_attachments")
      .update({ storage_removed_at: new Date().toISOString() })
      .eq("id", attachmentId);
  }
  return {
    ...(await collaborationDetail(
      { itemId: data.attachment.item_id },
      accessContext,
    )),
    storageCleanupPending: Boolean(removeError),
  };
}

export async function collaborationNotificationsList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const limit = Math.max(10, Math.min(Number(body.limit) || 30, 100));
  const [notificationsResult, countResult] = await Promise.all([
    client
      .from("collaboration_notifications")
      .select(
        "id,item_id,event_id,notification_type,title,message,read_at,created_at",
      )
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    client
      .from("collaboration_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .is("read_at", null),
  ]);
  if (notificationsResult.error) throw notificationsResult.error;
  if (countResult.error) throw countResult.error;
  return {
    notifications: (notificationsResult.data || []).map((row) => ({
      id: row.id,
      itemId: row.item_id,
      eventId: row.event_id || null,
      type: row.notification_type,
      title: row.title,
      message: row.message,
      readAt: row.read_at || null,
      createdAt: row.created_at,
    })),
    unreadCount: Number(countResult.count || 0),
  };
}

export async function collaborationNotificationsRead(body = {}, accessContext) {
  const { client, profile } = accessContext;
  let query = client
    .from("collaboration_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .is("read_at", null);
  const notificationIds = uniqueIds(body.notificationIds, 100);
  if (notificationIds.length) query = query.in("id", notificationIds);
  const { error } = await query;
  if (error) throw error;
  return collaborationNotificationsList({}, accessContext);
}

export async function collaborationDailyMaintenance(client) {
  const today = hongKongDate();
  const { data: created, error } = await client.rpc(
    "create_collaboration_due_notifications",
    {
      p_today: today,
    },
  );
  if (error) throw error;

  const cutoff = new Date().toISOString();
  const { data: staleRows, error: staleError } = await client
    .from("collaboration_attachments")
    .select("id,storage_path")
    .eq("upload_status", "pending")
    .lt("upload_expires_at", cutoff)
    .limit(100);
  if (staleError) throw staleError;
  if (staleRows?.length) {
    await client.storage
      .from(COLLABORATION_BUCKET)
      .remove(staleRows.map((row) => row.storage_path))
      .catch(() => null);
    const { error: deleteError } = await client
      .from("collaboration_attachments")
      .delete()
      .in(
        "id",
        staleRows.map((row) => row.id),
      );
    if (deleteError) throw deleteError;
  }

  const { data: deletedRows, error: deletedError } = await client
    .from("collaboration_attachments")
    .select("id,storage_path")
    .eq("upload_status", "deleted")
    .is("storage_removed_at", null)
    .limit(100);
  if (deletedError) throw deletedError;
  let deletedFilesRemoved = 0;
  if (deletedRows?.length) {
    const { error: removeDeletedError } = await client.storage
      .from(COLLABORATION_BUCKET)
      .remove(deletedRows.map((row) => row.storage_path));
    if (!removeDeletedError) {
      const { error: markRemovedError } = await client
        .from("collaboration_attachments")
        .update({ storage_removed_at: new Date().toISOString() })
        .in(
          "id",
          deletedRows.map((row) => row.id),
        );
      if (markRemovedError) throw markRemovedError;
      deletedFilesRemoved = deletedRows.length;
    }
  }
  return {
    today,
    notificationsCreated: Number(created || 0),
    pendingUploadsRemoved: staleRows?.length || 0,
    deletedFilesRemoved,
  };
}
