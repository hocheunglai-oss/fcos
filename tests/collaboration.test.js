import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLABORATION_ALLOWED_ATTACHMENTS,
  COLLABORATION_KINDS,
  COLLABORATION_MAX_ATTACHMENT_BYTES,
  COLLABORATION_PRIORITIES,
  COLLABORATION_STATUSES,
  calculateCollaborationProgress,
  canEditCollaborationItem,
  canManageCollaborationAssignments,
  collaborationAvailableDisplayFilename,
  collaborationLeafProgress,
  collaborationNotificationRecipients,
  normalizeCollaborationItemPayload,
  validateActiveCollaborationAssignee,
  validateCollaborationAttachment,
  validateCollaborationCompletion,
  validateCollaborationHierarchy,
  validateCollaborationItemPayload,
} from "../api/_collaboration.js";
import {
  normalizeCollaborationWorkflowFields,
  validateCollaborationBulkPayload,
} from "../api/_collaborationService.js";

test("exports the agreed status, priority, and item-kind vocabulary", () => {
  assert.deepEqual(COLLABORATION_STATUSES, [
    "Backlog",
    "To Do",
    "In Progress",
    "Blocked",
    "In Review",
    "Done",
    "Cancelled",
  ]);
  assert.deepEqual(COLLABORATION_PRIORITIES, [
    "Low",
    "Medium",
    "High",
    "Urgent",
  ]);
  assert.deepEqual(COLLABORATION_KINDS, ["project", "task", "subtask"]);
});

test("normalizes valid item payloads and rejects malformed fields", () => {
  const value = normalizeCollaborationItemPayload({
    title: "  Resolve buyer query  ",
    kind: "task",
    status: "To Do",
    priority: "High",
    ownerId: " owner-1 ",
    assigneeId: " user-2 ",
    description: "  Confirm invoice evidence.  ",
    startDate: "2026-07-30",
    dueDate: "2026-08-01",
  });
  assert.deepEqual(value, {
    title: "Resolve buyer query",
    kind: "task",
    status: "To Do",
    priority: "High",
    ownerId: "owner-1",
    assigneeId: "user-2",
    description: "Confirm invoice evidence.",
    startDate: "2026-07-30",
    dueDate: "2026-08-01",
    parentId: null,
  });

  const invalid = validateCollaborationItemPayload({
    title: "",
    kind: "epic",
    status: "Finished",
    priority: "Now",
    ownerId: "",
    startDate: "2026-08-02",
    dueDate: "2026-08-01",
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /title is required/);
  assert.match(invalid.errors.join(" "), /kind must be one of/);
  assert.match(invalid.errors.join(" "), /dueDate cannot be before startDate/);
  assert.match(
    validateCollaborationItemPayload({
      title: "Valid title",
      kind: "task",
      status: "To Do",
      priority: "Medium",
      ownerId: "owner",
      dueDate: "2026-02-30",
    }).errors.join(" "),
    /dueDate must use YYYY-MM-DD/,
  );
  assert.throws(
    () => normalizeCollaborationItemPayload({ title: "x" }),
    /Invalid collaboration item/,
  );
});

test("validates the project, task, and one-level subtask hierarchy", () => {
  assert.equal(validateCollaborationHierarchy({ kind: "project" }).ok, true);
  assert.equal(validateCollaborationHierarchy({ kind: "task" }).ok, true);
  assert.equal(
    validateCollaborationHierarchy({
      kind: "task",
      parent: { id: "project-1", kind: "project" },
      parentId: "project-1",
    }).ok,
    true,
  );
  assert.equal(
    validateCollaborationHierarchy({
      kind: "subtask",
      parent: { id: "task-1", kind: "task" },
      parentId: "task-1",
    }).ok,
    true,
  );
  assert.match(
    validateCollaborationHierarchy({ kind: "project", parentId: "anything" })
      .errors[0],
    /cannot have a parent/,
  );
  assert.match(
    validateCollaborationHierarchy({
      kind: "task",
      parent: { id: "task-1", kind: "task" },
    }).errors[0],
    /standalone or belong directly to a project/,
  );
  assert.match(
    validateCollaborationHierarchy({
      kind: "subtask",
      parent: { id: "project-1", kind: "project" },
    }).errors[0],
    /belong directly to a task/,
  );
  assert.match(
    validateCollaborationHierarchy({ kind: "subtask" }).errors[0],
    /must belong to a task/,
  );
  assert.match(
    validateCollaborationHierarchy({
      kind: "task",
      parent: { id: "project-1", kind: "project", archivedAt: "2026-07-30" },
    }).errors[0],
    /archived item/,
  );
});

test("enforces assignment and edit permissions around the owner, assignee, and general manager", () => {
  const item = { ownerId: "owner", assigneeId: "assignee" };
  assert.equal(
    canManageCollaborationAssignments({ item, actorId: "owner" }),
    true,
  );
  assert.equal(
    canManageCollaborationAssignments({ item, actorId: "assignee" }),
    false,
  );
  assert.equal(
    canManageCollaborationAssignments({
      item,
      actorId: "other",
      isGeneralManager: true,
    }),
    true,
  );
  assert.equal(canEditCollaborationItem({ item, actorId: "owner" }), true);
  assert.equal(canEditCollaborationItem({ item, actorId: "assignee" }), true);
  assert.equal(canEditCollaborationItem({ item, actorId: "other" }), false);
  assert.equal(
    canEditCollaborationItem({
      item,
      actorId: "other",
      isGeneralManager: true,
    }),
    true,
  );
});

test("requires an assignee to be an active FCOS user and permits unassignment", () => {
  const users = [
    { id: "active", active: true },
    { id: "inactive", active: false },
  ];
  assert.equal(
    validateActiveCollaborationAssignee({ activeUsers: users }).ok,
    true,
  );
  assert.equal(
    validateActiveCollaborationAssignee({
      assigneeId: "active",
      activeUsers: users,
    }).ok,
    true,
  );
  assert.equal(
    validateActiveCollaborationAssignee({
      assigneeId: "inactive",
      activeUsers: users,
    }).ok,
    false,
  );
  assert.equal(
    validateActiveCollaborationAssignee({
      assigneeId: "missing",
      activeUsers: users,
    }).ok,
    false,
  );
});

test("derives leaf and parent progress from non-cancelled work only", () => {
  assert.equal(collaborationLeafProgress("Backlog"), 0);
  assert.equal(collaborationLeafProgress("In Progress"), 50);
  assert.equal(collaborationLeafProgress("In Review"), 75);
  assert.equal(collaborationLeafProgress("Done"), 100);
  assert.equal(collaborationLeafProgress("Cancelled"), null);
  assert.equal(calculateCollaborationProgress({ status: "In Progress" }), 50);
  assert.equal(
    calculateCollaborationProgress({
      status: "To Do",
      children: [
        { status: "Done" },
        { status: "In Progress" },
        { status: "Cancelled" },
      ],
    }),
    75,
  );
  assert.equal(
    calculateCollaborationProgress({
      status: "Cancelled",
      children: [{ status: "Cancelled" }],
    }),
    null,
  );
});

test("prevents completion while an active child is incomplete", () => {
  assert.equal(
    validateCollaborationCompletion({
      item: { status: "Done" },
      children: [
        { key: "TSK-1", status: "Done" },
        { key: "TSK-2", status: "Cancelled" },
      ],
    }).ok,
    true,
  );
  const blocked = validateCollaborationCompletion({
    item: { status: "Done" },
    children: [{ key: "TSK-2", status: "In Review" }],
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /TSK-2 is In Review/);
  assert.equal(
    validateCollaborationCompletion({
      item: { status: "In Progress" },
      children: [{ status: "To Do" }],
    }).ok,
    true,
  );
});

test("requires a concise blocker reason and validates project health metadata", () => {
  assert.throws(
    () => normalizeCollaborationWorkflowFields({ status: "Blocked" }),
    /blocked reason is required/i,
  );
  assert.deepEqual(
    normalizeCollaborationWorkflowFields({
      status: "Blocked",
      blockedReason: "Waiting for supplier evidence.",
      projectHealth: "At risk",
      healthNote: "The commercial deadline may move.",
    }),
    {
      blocked_reason: "Waiting for supplier evidence.",
      health_status: "At risk",
      health_note: "The commercial deadline may move.",
    },
  );
  assert.deepEqual(
    normalizeCollaborationWorkflowFields({ status: "In Progress" }),
    {},
  );
  assert.deepEqual(
    normalizeCollaborationWorkflowFields({
      status: "In Progress",
      blockedReason: "",
    }),
    { blocked_reason: null },
  );
  assert.throws(
    () => normalizeCollaborationWorkflowFields({ projectHealth: "Green" }),
    /valid project health/i,
  );
});

test("validates bounded, revision-safe bulk collaboration updates", () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(
    validateCollaborationBulkPayload({
      items: [
        { itemId: firstId, expectedRevision: 2, values: { status: "In Progress" } },
        { itemId: secondId, expectedRevision: 3, values: { priority: "High" } },
      ],
    }),
    { ok: true, errors: [] },
  );
  assert.equal(
    validateCollaborationBulkPayload({
      items: [
        { itemId: firstId, expectedRevision: 2 },
        { itemId: firstId, expectedRevision: 2 },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateCollaborationBulkPayload({
      items: Array.from({ length: 51 }, (_, index) => ({
        itemId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
        expectedRevision: 1,
      })),
    }).ok,
    false,
  );
});

test("allocates duplicate display filenames without changing the extension", () => {
  assert.equal(
    collaborationAvailableDisplayFilename("Report.pdf", [
      "report.pdf",
      "REPORT-1.PDF",
    ]),
    "Report-2.pdf",
  );
  assert.equal(
    collaborationAvailableDisplayFilename("  Notes?.txt  ", ["Notes.txt"]),
    "Notes-1.txt",
  );
  assert.equal(
    collaborationAvailableDisplayFilename("Evidence", ["evidence"]),
    "Evidence-1",
  );
});

test("validates collaboration attachment types, MIME matching, and the 20 MiB limit", () => {
  assert.equal(COLLABORATION_MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024);
  assert.ok(COLLABORATION_ALLOWED_ATTACHMENTS.pdf.includes("application/pdf"));
  assert.equal(
    validateCollaborationAttachment({
      fileName: "evidence.PDF",
      mimeType: "application/pdf",
      size: 1,
    }).ok,
    true,
  );
  assert.match(
    validateCollaborationAttachment({
      fileName: "empty.pdf",
      mimeType: "application/pdf",
      size: 0,
    }).errors.join(" "),
    /positive whole number/,
  );
  assert.equal(
    validateCollaborationAttachment({
      fileName: "mail.eml",
      mimeType: "",
      size: 123,
    }).ok,
    true,
  );
  assert.match(
    validateCollaborationAttachment({
      fileName: "script.js",
      mimeType: "text/javascript",
      size: 1,
    }).errors.join(" "),
    /not allowed/,
  );
  assert.match(
    validateCollaborationAttachment({
      fileName: "evidence.pdf",
      mimeType: "image/png",
      size: 1,
    }).errors.join(" "),
    /does not match/,
  );
  assert.match(
    validateCollaborationAttachment({
      fileName: "large.pdf",
      mimeType: "application/pdf",
      size: COLLABORATION_MAX_ATTACHMENT_BYTES + 1,
    }).errors.join(" "),
    /20 MiB/,
  );
});

test("deduplicates notification recipients and excludes the actor", () => {
  assert.deepEqual(
    collaborationNotificationRecipients({
      recipientIds: ["owner", "assignee", "owner", { id: "manager" }, "", null],
      actorId: "owner",
    }),
    ["assignee", "manager"],
  );
  assert.deepEqual(
    collaborationNotificationRecipients({ recipientIds: "only-user" }),
    ["only-user"],
  );
});
