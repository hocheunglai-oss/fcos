export const COLLABORATION_STATUSES = Object.freeze([
  "Backlog",
  "To Do",
  "In Progress",
  "Blocked",
  "In Review",
  "Done",
  "Cancelled",
]);

export const COLLABORATION_PRIORITIES = Object.freeze([
  "Low",
  "Medium",
  "High",
  "Urgent",
]);

export const COLLABORATION_KINDS = Object.freeze([
  "project",
  "task",
  "subtask",
]);

export const COLLABORATION_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const COLLABORATION_ALLOWED_ATTACHMENTS = Object.freeze({
  pdf: Object.freeze(["application/pdf"]),
  doc: Object.freeze(["application/msword"]),
  docx: Object.freeze([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  xls: Object.freeze(["application/vnd.ms-excel"]),
  xlsx: Object.freeze([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  ppt: Object.freeze(["application/vnd.ms-powerpoint"]),
  pptx: Object.freeze([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  rtf: Object.freeze(["application/rtf", "text/rtf"]),
  odt: Object.freeze(["application/vnd.oasis.opendocument.text"]),
  ods: Object.freeze(["application/vnd.oasis.opendocument.spreadsheet"]),
  odp: Object.freeze(["application/vnd.oasis.opendocument.presentation"]),
  csv: Object.freeze(["text/csv", "application/csv"]),
  txt: Object.freeze(["text/plain"]),
  md: Object.freeze(["text/markdown", "text/plain"]),
  eml: Object.freeze(["message/rfc822"]),
  msg: Object.freeze(["application/vnd.ms-outlook"]),
  jpg: Object.freeze(["image/jpeg"]),
  jpeg: Object.freeze(["image/jpeg"]),
  png: Object.freeze(["image/png"]),
  gif: Object.freeze(["image/gif"]),
  webp: Object.freeze(["image/webp"]),
  heic: Object.freeze(["image/heic", "image/heif"]),
  heif: Object.freeze(["image/heif", "image/heic"]),
});

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_BINARY_MIME_TYPES = new Set(["", "application/octet-stream"]);
const LEAF_STATUS_PROGRESS = Object.freeze({
  Backlog: 0,
  "To Do": 0,
  "In Progress": 50,
  Blocked: 50,
  "In Review": 75,
  Done: 100,
  Cancelled: null,
});

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedNullableString(value) {
  const normalized = stringValue(value);
  return normalized || null;
}

function normalizeDateOnly(value, fieldName, errors) {
  const normalized = normalizedNullableString(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isCalendarDate =
    DATE_ONLY_PATTERN.test(normalized) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isCalendarDate) {
    errors.push(`${fieldName} must use YYYY-MM-DD.`);
    return null;
  }
  return normalized;
}

function normalizeIdentifier(value) {
  return normalizedNullableString(value);
}

function lower(value) {
  return String(value || "").toLocaleLowerCase();
}

function attachmentExtension(fileName) {
  const match = String(fileName || "")
    .trim()
    .match(/\.([a-zA-Z0-9]{1,12})$/);
  return match ? match[1].toLocaleLowerCase() : "";
}

function displayFilenameParts(fileName) {
  const value = String(fileName || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const extension = attachmentExtension(value);
  const baseName = extension
    ? value.slice(0, -(extension.length + 1)).trim()
    : value;
  return { baseName: baseName || "attachment", extension };
}

function normalizeUserIds(values) {
  const input = Array.isArray(values) ? values : [values];
  return input
    .map((value) => (typeof value === "object" && value ? value.id : value))
    .map(normalizeIdentifier)
    .filter(Boolean);
}

export function collaborationValidationResult(errors = []) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
  });
}

export function validateCollaborationItemPayload(
  payload = {},
  { partial = false } = {},
) {
  const errors = [];
  const title = normalizedNullableString(payload.title);
  const kind = normalizedNullableString(payload.kind);
  const status = normalizedNullableString(payload.status);
  const priority = normalizedNullableString(payload.priority);
  const ownerId = normalizedNullableString(payload.ownerId);
  const assigneeId = normalizedNullableString(payload.assigneeId);
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const startDate = normalizeDateOnly(payload.startDate, "startDate", errors);
  const dueDate = normalizeDateOnly(payload.dueDate, "dueDate", errors);

  if (!partial || Object.hasOwn(payload, "title")) {
    if (!title) errors.push("title is required.");
    else if (title.length > 255)
      errors.push("title must be 255 characters or fewer.");
  }
  if (!partial || Object.hasOwn(payload, "kind")) {
    if (!COLLABORATION_KINDS.includes(kind))
      errors.push(`kind must be one of: ${COLLABORATION_KINDS.join(", ")}.`);
  }
  if (!partial || Object.hasOwn(payload, "status")) {
    if (!COLLABORATION_STATUSES.includes(status))
      errors.push(
        `status must be one of: ${COLLABORATION_STATUSES.join(", ")}.`,
      );
  }
  if (!partial || Object.hasOwn(payload, "priority")) {
    if (!COLLABORATION_PRIORITIES.includes(priority))
      errors.push(
        `priority must be one of: ${COLLABORATION_PRIORITIES.join(", ")}.`,
      );
  }
  if (!partial || Object.hasOwn(payload, "ownerId")) {
    if (!ownerId) errors.push("ownerId is required.");
  }
  if (description.length > 20000)
    errors.push("description must be 20,000 characters or fewer.");
  if (startDate && dueDate && startDate > dueDate)
    errors.push("dueDate cannot be before startDate.");

  return {
    ...collaborationValidationResult(errors),
    value: {
      title,
      kind,
      status,
      priority,
      ownerId,
      assigneeId,
      description,
      startDate,
      dueDate,
      parentId: normalizedNullableString(payload.parentId),
    },
  };
}

export function normalizeCollaborationItemPayload(payload = {}, options = {}) {
  const result = validateCollaborationItemPayload(payload, options);
  if (!result.ok)
    throw new Error(`Invalid collaboration item: ${result.errors.join(" ")}`);
  return result.value;
}

export function validateCollaborationHierarchy({
  kind,
  parent = null,
  parentId = null,
} = {}) {
  const normalizedKind = normalizedNullableString(kind);
  const suppliedParentId = normalizedNullableString(parentId);
  const parentKind = normalizedNullableString(parent?.kind);
  const actualParentId = normalizedNullableString(parent?.id);
  const errors = [];

  if (!COLLABORATION_KINDS.includes(normalizedKind)) {
    errors.push(`kind must be one of: ${COLLABORATION_KINDS.join(", ")}.`);
    return collaborationValidationResult(errors);
  }
  if (normalizedKind === "project") {
    if (parent || suppliedParentId)
      errors.push("A project cannot have a parent item.");
  } else if (normalizedKind === "task") {
    if (parent && parentKind !== "project")
      errors.push("A task may be standalone or belong directly to a project.");
    if (suppliedParentId && !parent)
      errors.push("A task parent must be loaded and be a project.");
  } else {
    if (!parent) errors.push("A subtask must belong to a task.");
    else if (parentKind !== "task")
      errors.push("A subtask must belong directly to a task.");
    if (suppliedParentId && !actualParentId)
      errors.push("A subtask parent must include an item ID.");
  }
  if (
    parent &&
    suppliedParentId &&
    actualParentId &&
    suppliedParentId !== actualParentId
  ) {
    errors.push("parentId does not match the loaded parent item.");
  }
  if (parent && parent?.archivedAt)
    errors.push("An archived item cannot accept a child item.");
  return collaborationValidationResult(errors);
}

export function canManageCollaborationAssignments({
  item,
  actorId,
  isGeneralManager = false,
} = {}) {
  const normalizedActorId = normalizeIdentifier(actorId);
  return Boolean(
    normalizedActorId &&
      (isGeneralManager ||
        normalizedActorId === normalizeIdentifier(item?.ownerId)),
  );
}

export function canEditCollaborationItem({
  item,
  actorId,
  isGeneralManager = false,
} = {}) {
  const normalizedActorId = normalizeIdentifier(actorId);
  return Boolean(
    normalizedActorId &&
      (isGeneralManager ||
        normalizedActorId === normalizeIdentifier(item?.ownerId) ||
        normalizedActorId === normalizeIdentifier(item?.assigneeId)),
  );
}

export function validateActiveCollaborationAssignee({
  assigneeId = null,
  activeUsers = [],
} = {}) {
  const normalizedAssigneeId = normalizeIdentifier(assigneeId);
  if (!normalizedAssigneeId) return collaborationValidationResult();
  const isActive = activeUsers.some(
    (user) =>
      normalizeIdentifier(typeof user === "object" ? user?.id : user) ===
        normalizedAssigneeId &&
      (typeof user !== "object" || user?.active !== false),
  );
  return isActive
    ? collaborationValidationResult()
    : collaborationValidationResult([
        "assigneeId must identify an active FCOS user.",
      ]);
}

export function collaborationLeafProgress(status) {
  return Object.hasOwn(LEAF_STATUS_PROGRESS, status)
    ? LEAF_STATUS_PROGRESS[status]
    : null;
}

export function calculateCollaborationProgress({ status, children = [] } = {}) {
  const activeChildren = children.filter(
    (child) => child?.status !== "Cancelled",
  );
  if (activeChildren.length === 0) return collaborationLeafProgress(status);
  const childProgress = activeChildren.map((child) => {
    const value = Number(child?.progress);
    return Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : collaborationLeafProgress(child?.status);
  });
  const knownProgress = childProgress.filter((value) => value !== null);
  if (knownProgress.length === 0) return null;
  return (
    Math.round(
      (knownProgress.reduce((sum, value) => sum + value, 0) /
        knownProgress.length) *
        100,
    ) / 100
  );
}

export function validateCollaborationCompletion({ item, children = [] } = {}) {
  if (item?.status !== "Done") return collaborationValidationResult();
  const incompleteChild = children.find(
    (child) => child?.status !== "Cancelled" && child?.status !== "Done",
  );
  return incompleteChild
    ? collaborationValidationResult([
        `Cannot mark this item Done while child ${incompleteChild.key || incompleteChild.id || "work"} is ${incompleteChild.status || "not complete"}.`,
      ])
    : collaborationValidationResult();
}

export function collaborationAvailableDisplayFilename(
  fileName,
  existingNames = [],
) {
  const { baseName, extension } = displayFilenameParts(fileName);
  const existing = new Set(existingNames.map((value) => lower(value)));
  for (let suffix = 0; suffix < 10000; suffix += 1) {
    const candidate = `${baseName}${suffix ? `-${suffix}` : ""}${extension ? `.${extension}` : ""}`;
    if (!existing.has(lower(candidate))) return candidate;
  }
  throw new Error("Unable to allocate a unique attachment filename.");
}

export function validateCollaborationAttachment({
  fileName,
  mimeType = "",
  size,
} = {}) {
  const errors = [];
  const normalizedFileName = normalizedNullableString(fileName);
  const extension = attachmentExtension(normalizedFileName);
  const normalizedMimeType = lower(mimeType);
  const acceptedMimes = COLLABORATION_ALLOWED_ATTACHMENTS[extension];

  if (!normalizedFileName) errors.push("fileName is required.");
  if (!extension || !acceptedMimes)
    errors.push("This file type is not allowed.");
  if (!Number.isInteger(size) || size <= 0)
    errors.push("size must be a positive whole number of bytes.");
  else if (size > COLLABORATION_MAX_ATTACHMENT_BYTES)
    errors.push("Attachment size must not exceed 20 MiB.");
  if (
    acceptedMimes &&
    !GENERIC_BINARY_MIME_TYPES.has(normalizedMimeType) &&
    !acceptedMimes.includes(normalizedMimeType)
  ) {
    errors.push(
      `mimeType ${normalizedMimeType} does not match the .${extension} file extension.`,
    );
  }

  return {
    ...collaborationValidationResult(errors),
    value: {
      fileName: normalizedFileName,
      extension,
      mimeType: normalizedMimeType || null,
      size,
    },
  };
}

export function collaborationNotificationRecipients({
  recipientIds = [],
  actorId = null,
} = {}) {
  const excludedActorId = normalizeIdentifier(actorId);
  const seen = new Set();
  return normalizeUserIds(recipientIds).filter((recipientId) => {
    if (recipientId === excludedActorId || seen.has(recipientId)) return false;
    seen.add(recipientId);
    return true;
  });
}
