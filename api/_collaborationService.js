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
    if (!parsed?.updatedAt || !parsed?.id) return null;
    return parsed;
  } catch {
    throw appError(
      "The work-list cursor is invalid. Refresh the page and try again.",
      400,
    );
  }
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
    priority: row.priority,
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

function itemMatches(row, body, today, actorId) {
  const scope = cleanText(body.scope || "all", 30).toLowerCase();
  if (
    scope === "my" &&
    row.owner_user_id !== actorId &&
    row.assignee_user_id !== actorId
  )
    return false;
  if (scope === "projects" && row.item_type !== "project") return false;
  if (body.includeArchived !== true && row.archived_at) return false;
  if (body.includeArchived === false && row.archived_at) return false;
  if (body.kind && row.item_type !== body.kind) return false;
  if (
    body.projectId &&
    row.project_id !== body.projectId &&
    row.id !== body.projectId
  )
    return false;
  if (body.status && row.status !== body.status) return false;
  if (body.priority && row.priority !== body.priority) return false;
  if (body.ownerId && row.owner_user_id !== body.ownerId) return false;
  if (body.assigneeId === "unassigned" && row.assignee_user_id) return false;
  if (
    body.assigneeId &&
    body.assigneeId !== "unassigned" &&
    row.assignee_user_id !== body.assigneeId
  )
    return false;
  if (
    body.dueState === "overdue" &&
    (!row.due_date ||
      row.due_date >= today ||
      ["Done", "Cancelled"].includes(row.status))
  )
    return false;
  if (body.dueState === "due_today" && row.due_date !== today) return false;
  if (body.dueState === "upcoming" && (!row.due_date || row.due_date <= today))
    return false;
  if (body.dueState === "no_due" && row.due_date) return false;

  const keyword = cleanText(body.keyword, 200).toLocaleLowerCase();
  if (keyword) {
    const haystack = [
      row.item_key,
      row.title,
      row.description,
      row.owner_name,
      row.owner_email,
      row.assignee_name,
      row.assignee_email,
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  return true;
}

async function collaborationModel(client, profile) {
  const [itemsResult, usersResult, isGeneralManager] = await Promise.all([
    client.from("collaboration_items").select(ITEM_SELECT).limit(5000),
    client
      .from("user_profiles")
      .select("id,email,full_name,user_type,active")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .limit(1000),
    generalManagerAccess(client, profile.id),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (usersResult.error) throw usersResult.error;
  const activeUsers = usersResult.data || [];
  return {
    rows: itemsResult.data || [],
    users: activeUsers,
    actor: {
      userId: profile.id,
      isGeneralManager,
      activeUserIds: new Set(activeUsers.map((user) => user.id)),
    },
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

export async function collaborationList(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const model = await collaborationModel(client, profile);
  const today = hongKongDate();
  const cursor = decodeCursor(body.cursor);
  const pageSize = Math.max(
    20,
    Math.min(Number(body.pageSize) || 100, body.view === "board" ? 500 : 200),
  );

  let filtered = model.rows
    .filter((row) => itemMatches(row, body, today, profile.id))
    .sort(
      (left, right) =>
        String(right.updated_at).localeCompare(String(left.updated_at)) ||
        String(right.id).localeCompare(String(left.id)),
    );
  const total = filtered.length;

  if (cursor) {
    filtered = filtered.filter(
      (row) =>
        String(row.updated_at).localeCompare(cursor.updatedAt) < 0 ||
        (row.updated_at === cursor.updatedAt &&
          String(row.id).localeCompare(cursor.id) < 0),
    );
  }

  const page = filtered.slice(0, pageSize);
  const projects = model.rows
    .filter((row) => row.item_type === "project" && !row.archived_at)
    .sort((left, right) => left.title.localeCompare(right.title));

  return {
    items: page.map((row) => serializeItem(row, model.rows, model.actor)),
    nextCursor:
      filtered.length > page.length ? encodeCursor(page.at(-1)) : null,
    total,
    users: model.users.map(serializedUser),
    projects: projects.map((row) =>
      serializeItem(row, model.rows, model.actor),
    ),
    options: {
      statuses: COLLABORATION_STATUSES,
      priorities: COLLABORATION_PRIORITIES,
      kinds: COLLABORATION_KINDS,
    },
    currentUser: {
      id: profile.id,
      email: profile.email,
      isGeneralManager: model.actor.isGeneralManager,
    },
    today,
    capped: model.rows.length >= 5000,
  };
}

export async function collaborationDetail(body = {}, accessContext) {
  const { client, profile } = accessContext;
  const itemId = nullableId(body.itemId);
  if (!itemId) throw appError("Work item is required.", 400);

  const model = await collaborationModel(client, profile);
  const itemRow = model.rows.find((row) => row.id === itemId);
  if (!itemRow) throw appError("The selected work item was not found.", 404);

  const [commentsResult, attachmentsResult, eventsResult] = await Promise.all([
    client
      .from("collaboration_comments")
      .select(
        "id,item_id,body,revision,author_user_id,author_name,author_email,edited_at,deleted_at,deleted_by_email,created_at,updated_at",
      )
      .eq("item_id", itemId)
      .order("created_at", { ascending: true }),
    client
      .from("collaboration_attachments")
      .select(
        "id,item_id,comment_id,original_filename,display_filename,content_type,file_extension,content_size,upload_status,uploaded_by,uploaded_by_name,uploaded_by_email,completed_at,deleted_at,created_at",
      )
      .eq("item_id", itemId)
      .in("upload_status", ["pending", "complete"])
      .order("created_at", { ascending: false }),
    client
      .from("collaboration_events")
      .select(
        "id,item_id,comment_id,attachment_id,event_type,summary,metadata,actor_user_id,actor_name,actor_email,created_at",
      )
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  for (const result of [commentsResult, attachmentsResult, eventsResult]) {
    if (result.error) throw result.error;
  }

  const commentIds = (commentsResult.data || []).map((comment) => comment.id);
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
  const visibleAttachments = (attachmentsResult.data || []).filter(
    (attachment) =>
      attachment.upload_status === "complete" ||
      attachment.uploaded_by === profile.id,
  );
  const childRows = model.rows.filter(
    (row) =>
      (itemRow.item_type === "project" &&
        row.item_type === "task" &&
        row.project_id === itemRow.id) ||
      (itemRow.item_type === "task" &&
        row.item_type === "subtask" &&
        row.parent_id === itemRow.id),
  );

  return {
    item: serializeItem(itemRow, model.rows, model.actor),
    children: childRows.map((row) =>
      serializeItem(row, model.rows, model.actor),
    ),
    comments: (commentsResult.data || []).map((comment) => ({
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
    events: eventsResult.data || [],
    users: model.users.map(serializedUser),
    projects: model.rows
      .filter((row) => row.item_type === "project" && !row.archived_at)
      .map((row) => serializeItem(row, model.rows, model.actor)),
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
  const { data, error } = await client.rpc("create_collaboration_item", {
    p_values: createValues(body, profile),
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
  const itemId = nullableId(body.itemId);
  const expectedRevision = Number(body.expectedRevision);
  if (!itemId) throw appError("Work item is required.", 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    throw appError("Refresh the work item before saving.", 409);
  const { data, error } = await client.rpc("save_collaboration_item", {
    p_item_id: itemId,
    p_values: updateValues(body),
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
