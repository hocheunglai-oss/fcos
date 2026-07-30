import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronsUpDown,
  CircleHelp,
  Download,
  Eye,
  FileText,
  FolderKanban,
  History,
  LayoutList,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/common/PageHeader";
import StateBlock from "@/components/common/StateBlock";
import TableShell from "@/components/common/TableShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

const STATUS_FALLBACK = [
  "Backlog",
  "To Do",
  "In Progress",
  "Blocked",
  "In Review",
  "Done",
  "Cancelled",
];
const PRIORITY_FALLBACK = ["Low", "Medium", "High", "Urgent"];
const KIND_FALLBACK = ["project", "task", "subtask"];
const EMPTY_FILTERS = {
  keyword: "",
  kind: "all",
  projectId: "all",
  status: "all",
  priority: "all",
  ownerId: "all",
  assigneeId: "all",
  dueState: "all",
  includeArchived: false,
};

function humanKind(kind) {
  return kind === "project"
    ? "Project"
    : kind === "subtask"
      ? "Subtask"
      : "Task";
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Hong_Kong",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(result, fallback = "The request could not be completed.") {
  return result?.data?.error || result?.error || fallback;
}

function statusClass(status) {
  return (
    {
      Backlog: "border-slate-300 bg-slate-100 text-slate-700",
      "To Do": "border-sky-200 bg-sky-50 text-sky-800",
      "In Progress": "border-blue-200 bg-blue-50 text-blue-800",
      Blocked: "border-red-200 bg-red-50 text-red-800",
      "In Review": "border-violet-200 bg-violet-50 text-violet-800",
      Done: "border-emerald-200 bg-emerald-50 text-emerald-800",
      Cancelled: "border-slate-300 bg-slate-100 text-slate-600",
    }[status] || "border-slate-300 bg-slate-100 text-slate-700"
  );
}

function priorityClass(priority) {
  return (
    {
      Low: "border-slate-300 bg-slate-50 text-slate-700",
      Medium: "border-sky-200 bg-sky-50 text-sky-800",
      High: "border-amber-200 bg-amber-50 text-amber-800",
      Urgent: "border-red-200 bg-red-50 text-red-800",
    }[priority] || "border-slate-300 bg-slate-50 text-slate-700"
  );
}

function StatusBadge({ status }) {
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap", statusClass(status))}
    >
      {status}
    </Badge>
  );
}

function PriorityBadge({ priority }) {
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap", priorityClass(priority))}
    >
      {priority}
    </Badge>
  );
}

function Person({ user, empty = "Unassigned" }) {
  return (
    <span
      className={cn("block truncate text-sm", !user && "text-muted-foreground")}
    >
      {user?.name || user?.email || empty}
    </span>
  );
}

function Progress({ progress }) {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  return (
    <div className="min-w-24">
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{percent}%</span>
        {progress?.total > 0 && (
          <span>
            {progress.completed}/{progress.total}
          </span>
        )}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "All",
  className,
  disabled = false,
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      {label && (
        <Label className="text-xs text-muted-foreground">{label}</Label>
      )}
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SearchableSelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "Select a user",
  searchPlaceholder = "Search by name or email",
  disabled = false,
  className,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      {label && (
        <Label className="text-xs text-muted-foreground">{label}</Label>
      )}
      <Popover
        open={open}
        onOpenChange={(next) => setOpen(disabled ? false : next)}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-9 w-full justify-between px-3 font-normal"
          >
            <span
              className={cn("truncate", !selected && "text-muted-foreground")}
            >
              {selected?.label || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-32px))] p-0"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>No matching user.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.searchText || ""}`}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function signalNotificationsChanged() {
  window.dispatchEvent(
    new CustomEvent("fcos:collaboration-notifications-changed"),
  );
}

function EmptyDetailDraft(item) {
  return {
    title: item?.title || "",
    description: item?.description || "",
    status: item?.status || "To Do",
    priority: item?.priority || "Medium",
    startDate: item?.startDate || "",
    dueDate: item?.dueDate || "",
    assigneeId: item?.assignee?.id || "unassigned",
    projectId: item?.projectId || "none",
    parentId: item?.parentId || "none",
  };
}

function sameDraft(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProjectsTasks() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scope, setScope] = useState("my");
  const [view, setView] = useState("list");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [options, setOptions] = useState({
    statuses: STATUS_FALLBACK,
    priorities: PRIORITY_FALLBACK,
    kinds: KIND_FALLBACK,
  });
  const [today, setToday] = useState("");
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDraft, setDetailDraft] = useState(EmptyDetailDraft());
  const [detailTab, setDetailTab] = useState("description");
  const [savingDetail, setSavingDetail] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    kind: "task",
    title: "",
    description: "",
    status: "To Do",
    priority: "Medium",
    startDate: "",
    dueDate: "",
    projectId: "none",
    parentId: "none",
    assigneeId: "unassigned",
  });
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentMentions, setCommentMentions] = useState([]);
  const [mentionSearch, setMentionSearch] = useState("");
  const [editingComment, setEditingComment] = useState(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const activeStatuses = options.statuses?.length
    ? options.statuses
    : STATUS_FALLBACK;
  const priorities = options.priorities?.length
    ? options.priorities
    : PRIORITY_FALLBACK;
  const kinds = options.kinds?.length ? options.kinds : KIND_FALLBACK;
  const detailItem = detail?.item || null;
  const baselineDraft = useMemo(
    () => EmptyDetailDraft(detailItem),
    [detailItem],
  );
  const detailDirty = Boolean(
    detailItem && !sameDraft(detailDraft, baselineDraft),
  );
  const requestedItemId = searchParams.get("item");

  const setItemQuery = useCallback(
    (itemId) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (itemId) next.set("item", itemId);
          else next.delete("item");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const requestPayload = useCallback(
    (cursor = null) => {
      const compact = {
        scope,
        view,
        pageSize: view === "board" ? 500 : 200,
        includeArchived: filters.includeArchived,
      };
      for (const [key, value] of Object.entries(filters)) {
        if (!value || value === "all" || key === "includeArchived") continue;
        compact[key] = value === "unassigned" ? "unassigned" : value;
      }
      if (cursor) compact.cursor = cursor;
      return compact;
    },
    [filters, scope, view],
  );

  const loadWork = useCallback(
    async ({ append = false, background = false } = {}) => {
      if (append) setLoadingMore(true);
      else if (background) setRefreshing(true);
      else setLoading(true);
      if (!append) setError("");
      const response = await appClient.functions.invoke(
        "collaborationList",
        requestPayload(append ? nextCursor : null),
        { force: true },
      );
      if (response.data?.error) {
        setError(errorText(response));
      } else {
        const data = response.data || {};
        setItems((previous) =>
          append
            ? [
                ...previous,
                ...(data.items || []).filter(
                  (item) => !previous.some((current) => current.id === item.id),
                ),
              ]
            : data.items || [],
        );
        setUsers(data.users || []);
        setProjects(data.projects || []);
        setOptions(
          data.options || {
            statuses: STATUS_FALLBACK,
            priorities: PRIORITY_FALLBACK,
            kinds: KIND_FALLBACK,
          },
        );
        setToday(data.today || "");
        setTotal(Number(data.total || 0));
        setNextCursor(data.nextCursor || null);
      }
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    },
    [nextCursor, requestPayload],
  );

  const loadNotifications = useCallback(async () => {
    const response = await appClient.functions.invoke(
      "collaborationNotificationsList",
      {},
      { force: true },
    );
    if (!response.data?.error) {
      setNotifications(response.data?.notifications || []);
      setUnreadCount(Number(response.data?.unreadCount || 0));
    }
  }, []);

  useEffect(() => {
    loadWork();
  }, [loadWork]);
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);
  useEffect(() => {
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("fcos:dirty-state", {
        detail: {
          key: "projects-tasks",
          dirty: detailDirty || createOpen,
          message: "You have unsaved Projects & Tasks changes.",
        },
      }),
    );
    return () =>
      window.dispatchEvent(
        new CustomEvent("fcos:dirty-state", {
          detail: { key: "projects-tasks", dirty: false },
        }),
      );
  }, [createOpen, detailDirty]);

  const replaceDetail = useCallback((nextDetail) => {
    if (!nextDetail?.item) return;
    setDetail(nextDetail);
    setDetailDraft(EmptyDetailDraft(nextDetail.item));
    setItems((previous) =>
      previous.map((item) =>
        item.id === nextDetail.item.id ? nextDetail.item : item,
      ),
    );
  }, []);

  const openDetail = useCallback(
    async (itemOrId, { syncUrl = true } = {}) => {
      if (detailDirty && !window.confirm("Discard unsaved work-item changes?"))
        return;
      const itemId = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
      if (!itemId) return;
      if (syncUrl) setItemQuery(itemId);
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailTab("description");
      const response = await appClient.functions.invoke(
        "collaborationDetail",
        { itemId },
        { force: true },
      );
      if (response.data?.error) {
        toast({
          variant: "destructive",
          title: "Unable to open work item",
          description: errorText(response),
        });
        setDetailOpen(false);
        if (!syncUrl) setItemQuery(null);
      } else {
        replaceDetail(response.data);
      }
      setDetailLoading(false);
    },
    [detailDirty, replaceDetail, setItemQuery, toast],
  );

  useEffect(() => {
    if (!requestedItemId || detailLoading || detailItem?.id === requestedItemId)
      return;
    openDetail(requestedItemId, { syncUrl: false });
  }, [detailItem?.id, detailLoading, openDetail, requestedItemId]);

  const closeDetail = (open) => {
    if (
      !open &&
      detailDirty &&
      !window.confirm("Discard unsaved work-item changes?")
    )
      return;
    setDetailOpen(open);
    if (!open) {
      setItemQuery(null);
      setDetail(null);
      setEditingComment(null);
      setCommentDraft("");
      setCommentMentions([]);
      setMentionSearch("");
    }
  };

  const saveDetail = async () => {
    if (!detailItem) return;
    setSavingDetail(true);
    const response = await appClient.functions.invoke(
      "collaborationUpdate",
      {
        itemId: detailItem.id,
        expectedRevision: detailItem.revision,
        title: detailDraft.title,
        description: detailDraft.description,
        status: detailDraft.status,
        priority: detailDraft.priority,
        startDate: detailDraft.startDate || null,
        dueDate: detailDraft.dueDate || null,
        ...(detailItem.permissions?.canManage
          ? {
              assigneeId:
                detailDraft.assigneeId === "unassigned"
                  ? null
                  : detailDraft.assigneeId,
              projectId:
                detailDraft.projectId === "none" ? null : detailDraft.projectId,
              parentId:
                detailDraft.parentId === "none" ? null : detailDraft.parentId,
            }
          : {}),
      },
      { force: true },
    );
    if (response.data?.error) {
      const conflict =
        response.data?.error &&
        /changed after it was opened|refresh/i.test(response.data.error);
      toast({
        variant: "destructive",
        title: conflict ? "Work item changed" : "Unable to save",
        description: errorText(response),
      });
      if (conflict) openDetail(detailItem.id);
    } else {
      replaceDetail(response.data);
      toast({
        title: "Work item saved",
        description: "The latest changes are now visible to everyone.",
      });
      loadWork({ background: true });
      signalNotificationsChanged();
    }
    setSavingDetail(false);
  };

  const openCreate = (kind = "task", parent = null) => {
    const parentIsProject = parent?.kind === "project";
    setCreateDraft({
      kind,
      title: "",
      description: "",
      status: "To Do",
      priority: "Medium",
      startDate: "",
      dueDate: "",
      projectId: parentIsProject ? parent.id : parent?.projectId || "none",
      parentId:
        kind === "subtask" && parent?.kind === "task" ? parent.id : "none",
      assigneeId: "unassigned",
    });
    setCreateOpen(true);
  };

  const createItem = async () => {
    if (!createDraft.title.trim()) {
      toast({
        variant: "destructive",
        title: "Title required",
        description: "Enter a concise work-item title.",
      });
      return;
    }
    setCreateSaving(true);
    const response = await appClient.functions.invoke(
      "collaborationCreate",
      {
        kind: createDraft.kind,
        title: createDraft.title,
        description: createDraft.description,
        status: createDraft.status,
        priority: createDraft.priority,
        startDate: createDraft.startDate || null,
        dueDate: createDraft.dueDate || null,
        projectId:
          createDraft.kind === "project" || createDraft.projectId === "none"
            ? null
            : createDraft.projectId,
        parentId:
          createDraft.kind === "subtask" && createDraft.parentId !== "none"
            ? createDraft.parentId
            : null,
        assigneeId:
          createDraft.assigneeId === "unassigned"
            ? null
            : createDraft.assigneeId,
      },
      { force: true },
    );
    if (response.data?.error) {
      toast({
        variant: "destructive",
        title: "Unable to create work item",
        description: errorText(response),
      });
    } else {
      setCreateOpen(false);
      replaceDetail(response.data);
      setDetailOpen(true);
      setItemQuery(response.data.item.id);
      toast({
        title: `${humanKind(createDraft.kind)} created`,
        description: "The item is now visible to every active FCOS user.",
      });
      loadWork({ background: true });
      loadNotifications();
      signalNotificationsChanged();
    }
    setCreateSaving(false);
  };

  const changeArchive = async () => {
    const item = archiveTarget;
    if (!item) return;
    setArchiveSaving(true);
    const response = await appClient.functions.invoke(
      "collaborationArchive",
      {
        itemId: item.id,
        expectedRevision: item.revision,
        archived: !item.archivedAt,
      },
      { force: true },
    );
    if (response.data?.error) {
      toast({
        variant: "destructive",
        title: "Unable to change archive state",
        description: errorText(response),
      });
    } else {
      replaceDetail(response.data);
      toast({
        title: item.archivedAt ? "Work item restored" : "Work item archived",
        description:
          response.data?.affectedItems > 1
            ? `${response.data.affectedItems} related work items were updated.`
            : undefined,
      });
      loadWork({ background: true });
      signalNotificationsChanged();
    }
    setArchiveSaving(false);
    setArchiveTarget(null);
  };

  const updateStatusFromBoard = async (result) => {
    const { destination, draggableId } = result;
    if (!destination || destination.droppableId === result.source?.droppableId)
      return;
    const item = items.find((entry) => entry.id === draggableId);
    if (!item || !item.permissions?.canEdit || item.archivedAt) {
      toast({
        variant: "destructive",
        title: "Status cannot be changed",
        description: "You do not have permission to update this work item.",
      });
      return;
    }
    const response = await appClient.functions.invoke(
      "collaborationUpdate",
      {
        itemId: item.id,
        expectedRevision: item.revision,
        status: destination.droppableId,
      },
      { force: true },
    );
    if (response.data?.error) {
      toast({
        variant: "destructive",
        title: "Board change not saved",
        description: `${errorText(response)} The card has returned to its current status.`,
      });
      loadWork({ background: true });
      return;
    }
    setItems((previous) =>
      previous.map((entry) =>
        entry.id === item.id ? response.data.item : entry,
      ),
    );
    if (detailItem?.id === item.id) replaceDetail(response.data);
    loadNotifications();
    signalNotificationsChanged();
  };

  const saveComment = async () => {
    if (!detailItem || !commentDraft.trim()) return;
    setCommentSaving(true);
    const response = await appClient.functions.invoke(
      "collaborationCommentSave",
      {
        itemId: detailItem.id,
        ...(editingComment
          ? {
              commentId: editingComment.id,
              expectedRevision: editingComment.revision,
            }
          : {}),
        body: commentDraft,
        mentionedUserIds: commentMentions,
      },
      { force: true },
    );
    if (response.data?.error) {
      toast({
        variant: "destructive",
        title: "Unable to save comment",
        description: errorText(response),
      });
    } else {
      replaceDetail(response.data);
      setCommentDraft("");
      setCommentMentions([]);
      setMentionSearch("");
      setEditingComment(null);
      loadNotifications();
      signalNotificationsChanged();
    }
    setCommentSaving(false);
  };

  const deleteComment = async (comment) => {
    if (
      !detailItem ||
      !window.confirm("Remove this comment? The activity record will remain.")
    )
      return;
    const response = await appClient.functions.invoke(
      "collaborationCommentDelete",
      {
        itemId: detailItem.id,
        commentId: comment.id,
        expectedRevision: comment.revision,
      },
      { force: true },
    );
    if (response.data?.error) {
      toast({
        variant: "destructive",
        title: "Unable to remove comment",
        description: errorText(response),
      });
    } else {
      replaceDetail(response.data);
    }
  };

  const uploadFiles = async (files) => {
    if (!detailItem || !files?.length || uploading) return;
    if (!detailItem.permissions?.canUpload) {
      toast({
        variant: "destructive",
        title: "Files cannot be uploaded",
        description: "This archived work item is read-only.",
      });
      return;
    }
    setUploading(true);
    let latest = null;
    const failures = [];
    for (const file of Array.from(files)) {
      const prepared = await appClient.functions.invoke(
        "collaborationAttachmentPrepare",
        {
          itemId: detailItem.id,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        },
        { force: true },
      );
      if (prepared.data?.error) {
        failures.push(`${file.name}: ${errorText(prepared)}`);
        continue;
      }
      const upload = await supabase?.storage
        ?.from(prepared.data.bucket)
        .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, {
          contentType: prepared.data.contentType,
        });
      if (upload?.error) {
        failures.push(
          `${file.name}: ${upload.error.message || "private upload failed"}`,
        );
        continue;
      }
      const completed = await appClient.functions.invoke(
        "collaborationAttachmentComplete",
        { attachmentId: prepared.data.attachmentId },
        { force: true },
      );
      if (completed.data?.error)
        failures.push(`${file.name}: ${errorText(completed)}`);
      else latest = completed.data;
    }
    if (latest) replaceDetail(latest);
    if (failures.length)
      toast({
        variant: "destructive",
        title: "Some files were not uploaded",
        description: failures.slice(0, 2).join(" "),
      });
    else
      toast({
        title: "Files uploaded",
        description: "The private files are linked to this work item.",
      });
    setUploading(false);
  };

  const accessAttachment = async (attachment, download = false) => {
    const previewWindow = download
      ? null
      : window.open("", "_blank", "noopener,noreferrer");
    const response = await appClient.functions.invoke(
      "collaborationAttachmentUrl",
      { attachmentId: attachment.id, download },
      { force: true },
    );
    if (response.data?.error) {
      previewWindow?.close();
      toast({
        variant: "destructive",
        title: "Unable to open file",
        description: errorText(response),
      });
      return;
    }
    if (download) window.location.assign(response.data.url);
    else if (previewWindow) previewWindow.location.href = response.data.url;
    else window.open(response.data.url, "_blank", "noopener,noreferrer");
  };

  const deleteAttachment = async (attachment) => {
    if (!window.confirm(`Remove ${attachment.displayFilename}?`)) return;
    const response = await appClient.functions.invoke(
      "collaborationAttachmentDelete",
      { attachmentId: attachment.id },
      { force: true },
    );
    if (response.data?.error)
      toast({
        variant: "destructive",
        title: "Unable to remove file",
        description: errorText(response),
      });
    else {
      replaceDetail(response.data);
      if (response.data.storageCleanupPending) {
        toast({
          title: "File removed",
          description:
            "The file is no longer available. Private storage cleanup will retry automatically.",
        });
      }
    }
  };

  const markNotificationsRead = async () => {
    const response = await appClient.functions.invoke(
      "collaborationNotificationsRead",
      {},
      { force: true },
    );
    if (!response.data?.error) {
      setNotifications(response.data?.notifications || []);
      setUnreadCount(Number(response.data?.unreadCount || 0));
      signalNotificationsChanged();
    }
  };

  const openNotification = async (notification) => {
    if (!notification.readAt) {
      const response = await appClient.functions.invoke(
        "collaborationNotificationsRead",
        { notificationIds: [notification.id] },
        { force: true },
      );
      if (!response.data?.error) {
        setNotifications(response.data?.notifications || []);
        setUnreadCount(Number(response.data?.unreadCount || 0));
        signalNotificationsChanged();
      }
    }
    setNotificationsOpen(false);
    openDetail(notification.itemId);
  };

  const peopleOptions = useMemo(
    () =>
      users.map((user) => {
        const name = user.name || user.email;
        return {
          value: user.id,
          label: name === user.email ? user.email : `${name} · ${user.email}`,
          searchText: `${name} ${user.email}`,
        };
      }),
    [users],
  );
  const taskOptions = useMemo(
    () => items.filter((item) => item.kind === "task" && !item.archivedAt),
    [items],
  );
  const filteredMentionUsers = useMemo(() => {
    const query = mentionSearch.trim().toLocaleLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      `${user.name || ""} ${user.email || ""}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [mentionSearch, users]);
  const groupedBoard = useMemo(
    () =>
      Object.fromEntries(
        activeStatuses.map((status) => [
          status,
          items.filter((item) => item.status === status),
        ]),
      ),
    [activeStatuses, items],
  );
  const canArchive = detailItem?.permissions?.canManage;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-4">
        <PageHeader
          icon={FolderKanban}
          eyebrow="Daily Work"
          title="Projects & Tasks"
          description="Shared operational work, ownership, progress, files, and decisions."
          meta={
            loading
              ? "Loading work items..."
              : `${total.toLocaleString()} work item${total === 1 ? "" : "s"} matching this view`
          }
          actions={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setNotificationsOpen(true)}
                    aria-label="Open notifications"
                  >
                    <Bell />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Notifications{unreadCount ? ` (${unreadCount})` : ""}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setMethodologyOpen(true)}
                    aria-label="Open methodology"
                  >
                    <CircleHelp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Methodology</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => loadWork({ background: true })}
                    disabled={refreshing}
                    aria-label="Refresh work items"
                  >
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh work items</TooltipContent>
              </Tooltip>
              <Button onClick={() => openCreate("task")}>
                <Plus />
                New task
              </Button>
            </>
          }
        />

        <TableShell bodyClassName="p-4" className="mb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <Tabs value={scope} onValueChange={setScope} className="min-w-0">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="my" className="flex-1 sm:flex-none">
                  My Work
                </TabsTrigger>
                <TabsTrigger value="all" className="flex-1 sm:flex-none">
                  All Work
                </TabsTrigger>
                <TabsTrigger value="projects" className="flex-1 sm:flex-none">
                  Projects
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="inline-flex h-9 rounded-lg bg-muted p-1 text-sm">
              <Button
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                onClick={() => setView("list")}
                title="List view"
              >
                <LayoutList />
                List
              </Button>
              <Button
                size="sm"
                variant={view === "board" ? "secondary" : "ghost"}
                onClick={() => setView("board")}
                title="Board view"
              >
                <FolderKanban />
                Board
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={filters.keyword}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      keyword: event.target.value,
                    }))
                  }
                  className="pl-9"
                  placeholder="Key, title, description, owner, or assignee"
                />
              </div>
            </div>
            <SelectField
              label="Type"
              value={filters.kind}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, kind: value }))
              }
              options={[
                { value: "all", label: "All types" },
                ...kinds.map((kind) => ({
                  value: kind,
                  label: humanKind(kind),
                })),
              ]}
            />
            <SelectField
              label="Project"
              value={filters.projectId}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, projectId: value }))
              }
              options={[
                { value: "all", label: "All projects" },
                ...projects.map((project) => ({
                  value: project.id,
                  label: `${project.key} · ${project.title}`,
                })),
              ]}
            />
            <SelectField
              label="Status"
              value={filters.status}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, status: value }))
              }
              options={[
                { value: "all", label: "All statuses" },
                ...activeStatuses.map((status) => ({
                  value: status,
                  label: status,
                })),
              ]}
            />
            <SelectField
              label="Priority"
              value={filters.priority}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, priority: value }))
              }
              options={[
                { value: "all", label: "All priorities" },
                ...priorities.map((priority) => ({
                  value: priority,
                  label: priority,
                })),
              ]}
            />
            <SearchableSelectField
              label="Owner"
              value={filters.ownerId}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, ownerId: value }))
              }
              options={[
                { value: "all", label: "All owners" },
                ...peopleOptions,
              ]}
            />
            <SearchableSelectField
              label="Assignee"
              value={filters.assigneeId}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, assigneeId: value }))
              }
              options={[
                { value: "all", label: "All assignees" },
                { value: "unassigned", label: "Unassigned" },
                ...peopleOptions,
              ]}
            />
            <SelectField
              label="Due"
              value={filters.dueState}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, dueState: value }))
              }
              options={[
                { value: "all", label: "Any due state" },
                { value: "overdue", label: "Overdue" },
                { value: "due_today", label: "Due today" },
                { value: "upcoming", label: "Upcoming" },
                { value: "no_due", label: "No due date" },
              ]}
            />
            <label className="flex h-9 items-center gap-2 self-end text-sm text-muted-foreground">
              <Checkbox
                checked={filters.includeArchived}
                onCheckedChange={(checked) =>
                  setFilters((current) => ({
                    ...current,
                    includeArchived: checked === true,
                  }))
                }
              />
              Include archived
            </label>
          </div>
        </TableShell>

        {loading ? (
          <StateBlock
            icon={Loader2}
            title="Loading Projects & Tasks..."
            description="Reading shared work, ownership, and current progress."
          />
        ) : error ? (
          <StateBlock
            icon={X}
            title="Projects & Tasks is unavailable"
            description={error}
            action={
              <Button variant="outline" onClick={() => loadWork()}>
                Retry
              </Button>
            }
          />
        ) : view === "list" ? (
          <TableShell
            title="Work items"
            meta={`${items.length.toLocaleString()} loaded`}
            bodyClassName="p-0"
          >
            {items.length ? (
              <div className="overflow-x-auto">
                <Table className="min-w-[1260px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="min-w-72">Title</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        onClick={() => openDetail(item)}
                      >
                        <TableCell className="font-mono text-xs font-medium text-primary">
                          {item.key}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="whitespace-nowrap"
                          >
                            {humanKind(item.kind)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {item.title}
                          </div>
                          {item.archivedAt && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Archived
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="block truncate text-sm">
                            {item.projectTitle || "Standalone"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          <Progress progress={item.progress} />
                        </TableCell>
                        <TableCell>
                          <PriorityBadge priority={item.priority} />
                        </TableCell>
                        <TableCell className="max-w-40">
                          <Person user={item.owner} />
                        </TableCell>
                        <TableCell className="max-w-40">
                          <Person user={item.assignee} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "whitespace-nowrap text-sm",
                            item.dueDate &&
                              item.dueDate < today &&
                              !["Done", "Cancelled"].includes(item.status) &&
                              "font-medium text-red-700",
                          )}
                        >
                          {formatDate(item.dueDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(item.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <StateBlock
                icon={CheckSquare2}
                title="No work items found"
                description="Create a project or task, or adjust the current filters."
              />
            )}
            {nextCursor && (
              <div className="flex justify-center border-t border-border p-3">
                <Button
                  variant="outline"
                  onClick={() => loadWork({ append: true })}
                  disabled={loadingMore}
                >
                  {loadingMore && <Loader2 className="animate-spin" />}Load more
                </Button>
              </div>
            )}
          </TableShell>
        ) : (
          <DragDropContext onDragEnd={updateStatusFromBoard}>
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-[1540px] grid-cols-7 gap-3">
                {activeStatuses.map((status) => (
                  <Droppable droppableId={status} key={status}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "min-h-[34rem] border border-border bg-muted/30",
                          snapshot.isDraggingOver &&
                            "border-primary bg-primary/5",
                        )}
                      >
                        <div className="flex items-center justify-between border-b border-border bg-background px-3 py-2.5">
                          <StatusBadge status={status} />
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {groupedBoard[status]?.length || 0}
                          </span>
                        </div>
                        <div className="space-y-2 p-2">
                          {groupedBoard[status]?.map((item, index) => (
                            <Draggable
                              draggableId={item.id}
                              index={index}
                              key={item.id}
                              isDragDisabled={
                                !item.permissions?.canEdit ||
                                Boolean(item.archivedAt)
                              }
                            >
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  onClick={() => openDetail(item)}
                                  className={cn(
                                    "cursor-pointer border border-border bg-background p-3 shadow-sm transition-shadow hover:shadow",
                                    dragSnapshot.isDragging && "shadow-lg",
                                    item.archivedAt && "opacity-60",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-mono text-xs text-primary">
                                      {item.key}
                                    </span>
                                    <PriorityBadge priority={item.priority} />
                                  </div>
                                  <div className="mt-2 text-sm font-medium leading-5 text-foreground">
                                    {item.title}
                                  </div>
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    {item.projectTitle || "Standalone"}
                                    {item.assignee?.name
                                      ? ` · ${item.assignee.name}`
                                      : ""}
                                  </div>
                                  <div className="mt-3">
                                    <Progress progress={item.progress} />
                                  </div>
                                  {item.dueDate && (
                                    <div
                                      className={cn(
                                        "mt-2 flex items-center gap-1 text-xs",
                                        item.dueDate < today &&
                                          !["Done", "Cancelled"].includes(
                                            item.status,
                                          )
                                          ? "text-red-700"
                                          : "text-muted-foreground",
                                      )}
                                    >
                                      <CalendarDays className="h-3 w-3" />
                                      {formatDate(item.dueDate)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      </div>
                    )}
                  </Droppable>
                ))}
              </div>
            </div>
          </DragDropContext>
        )}

        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!createSaving) setCreateOpen(open);
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create work item</DialogTitle>
              <DialogDescription>
                Projects group tasks. Subtasks belong directly to a task.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Type"
                value={createDraft.kind}
                onValueChange={(kind) =>
                  setCreateDraft((current) => ({
                    ...current,
                    kind,
                    projectId: kind === "project" ? "none" : current.projectId,
                    parentId: kind === "subtask" ? current.parentId : "none",
                  }))
                }
                options={kinds.map((kind) => ({
                  value: kind,
                  label: humanKind(kind),
                }))}
              />
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={createDraft.title}
                  maxLength={255}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  autoFocus
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Description</Label>
                <Textarea
                  value={createDraft.description}
                  rows={5}
                  maxLength={20000}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              {createDraft.kind !== "project" && (
                <SelectField
                  label="Project"
                  value={createDraft.projectId}
                  onValueChange={(projectId) =>
                    setCreateDraft((current) => ({ ...current, projectId }))
                  }
                  options={[
                    { value: "none", label: "No project" },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: `${project.key} · ${project.title}`,
                    })),
                  ]}
                />
              )}
              {createDraft.kind === "subtask" && (
                <SelectField
                  label="Parent task"
                  value={createDraft.parentId}
                  onValueChange={(parentId) => {
                    const parent = taskOptions.find(
                      (task) => task.id === parentId,
                    );
                    setCreateDraft((current) => ({
                      ...current,
                      parentId,
                      projectId: parent?.projectId || current.projectId,
                    }));
                  }}
                  options={[
                    { value: "none", label: "Select a task" },
                    ...taskOptions.map((task) => ({
                      value: task.id,
                      label: `${task.key} · ${task.title}`,
                    })),
                  ]}
                />
              )}
              {createDraft.kind !== "project" && (
                <SearchableSelectField
                  label="Assignee"
                  value={createDraft.assigneeId}
                  onValueChange={(assigneeId) =>
                    setCreateDraft((current) => ({ ...current, assigneeId }))
                  }
                  options={[
                    { value: "unassigned", label: "Unassigned" },
                    ...peopleOptions,
                  ]}
                />
              )}
              <SelectField
                label="Status"
                value={createDraft.status}
                onValueChange={(status) =>
                  setCreateDraft((current) => ({ ...current, status }))
                }
                options={activeStatuses.map((status) => ({
                  value: status,
                  label: status,
                }))}
              />
              <SelectField
                label="Priority"
                value={createDraft.priority}
                onValueChange={(priority) =>
                  setCreateDraft((current) => ({ ...current, priority }))
                }
                options={priorities.map((priority) => ({
                  value: priority,
                  label: priority,
                }))}
              />
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={createDraft.startDate}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      startDate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={createDraft.dueDate}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createSaving}
              >
                Cancel
              </Button>
              <Button onClick={createItem} disabled={createSaving}>
                {createSaving && <Loader2 className="animate-spin" />}Create{" "}
                {humanKind(createDraft.kind)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet open={detailOpen} onOpenChange={closeDetail}>
          <SheetContent
            side="right"
            className="w-full overflow-y-auto p-0 sm:max-w-4xl"
          >
            <div className="flex min-h-full flex-col">
              {detailLoading || !detailItem ? (
                <StateBlock
                  icon={Loader2}
                  title="Opening work item..."
                  description="Loading the current collaboration record."
                />
              ) : (
                <>
                  <SheetHeader className="border-b border-border px-6 pb-4 pt-6 pr-14">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-primary">
                        {detailItem.key}
                      </span>
                      <Badge variant="outline">
                        {humanKind(detailItem.kind)}
                      </Badge>
                      <StatusBadge status={detailItem.status} />
                      {detailItem.archivedAt && (
                        <Badge
                          variant="outline"
                          className="border-slate-300 bg-slate-100 text-slate-700"
                        >
                          Archived
                        </Badge>
                      )}
                    </div>
                    <SheetTitle className="mt-2">{detailItem.title}</SheetTitle>
                    <SheetDescription>
                      Owned by{" "}
                      {detailItem.owner?.name || detailItem.owner?.email} · Last
                      updated {formatDateTime(detailItem.updatedAt)}
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <UserRound className="h-4 w-4" />
                      <span>
                        Assignee:{" "}
                        {detailItem.assignee?.name ||
                          detailItem.assignee?.email ||
                          "Unassigned"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {detailItem.permissions?.canEdit && (
                        <Button
                          size="sm"
                          onClick={saveDetail}
                          disabled={
                            !detailDirty ||
                            savingDetail ||
                            Boolean(detailItem.archivedAt)
                          }
                          title="Save work item"
                        >
                          <Save />
                          Save
                        </Button>
                      )}
                      {canArchive && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setArchiveTarget(detailItem)}
                          disabled={archiveSaving}
                          title={
                            detailItem.archivedAt
                              ? "Restore work item"
                              : "Archive work item"
                          }
                        >
                          {detailItem.archivedAt ? <RotateCcw /> : <Archive />}
                          {detailItem.archivedAt ? "Restore" : "Archive"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Tabs
                    value={detailTab}
                    onValueChange={setDetailTab}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    <div className="overflow-x-auto border-b border-border px-6 pt-3">
                      <TabsList className="h-10">
                        <TabsTrigger value="description">
                          Description
                        </TabsTrigger>
                        <TabsTrigger value="subtasks">
                          Subtasks ({detail.children?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="comments">
                          Comments ({detail.comments?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="files">
                          Files ({detail.attachments?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="activity">Activity</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="description" className="m-0 flex-1 p-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <Label>Title</Label>
                          <Input
                            value={detailDraft.title}
                            disabled={
                              !detailItem.permissions?.canEdit ||
                              Boolean(detailItem.archivedAt)
                            }
                            maxLength={255}
                            onChange={(event) =>
                              setDetailDraft((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label>Description</Label>
                          <Textarea
                            value={detailDraft.description}
                            disabled={
                              !detailItem.permissions?.canEdit ||
                              Boolean(detailItem.archivedAt)
                            }
                            rows={10}
                            maxLength={20000}
                            onChange={(event) =>
                              setDetailDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <SelectField
                          label="Status"
                          value={detailDraft.status}
                          disabled={
                            !detailItem.permissions?.canEdit ||
                            Boolean(detailItem.archivedAt)
                          }
                          onValueChange={(status) =>
                            setDetailDraft((current) => ({
                              ...current,
                              status,
                            }))
                          }
                          options={activeStatuses.map((status) => ({
                            value: status,
                            label: status,
                          }))}
                        />
                        <SelectField
                          label="Priority"
                          value={detailDraft.priority}
                          disabled={
                            !detailItem.permissions?.canEdit ||
                            Boolean(detailItem.archivedAt)
                          }
                          onValueChange={(priority) =>
                            setDetailDraft((current) => ({
                              ...current,
                              priority,
                            }))
                          }
                          options={priorities.map((priority) => ({
                            value: priority,
                            label: priority,
                          }))}
                        />
                        <div className="space-y-1">
                          <Label>Start date</Label>
                          <Input
                            type="date"
                            value={detailDraft.startDate}
                            disabled={
                              !detailItem.permissions?.canEdit ||
                              Boolean(detailItem.archivedAt)
                            }
                            onChange={(event) =>
                              setDetailDraft((current) => ({
                                ...current,
                                startDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Due date</Label>
                          <Input
                            type="date"
                            value={detailDraft.dueDate}
                            disabled={
                              !detailItem.permissions?.canEdit ||
                              Boolean(detailItem.archivedAt)
                            }
                            onChange={(event) =>
                              setDetailDraft((current) => ({
                                ...current,
                                dueDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <SearchableSelectField
                          label="Assignee"
                          value={detailDraft.assigneeId}
                          disabled={
                            !detailItem.permissions?.canManage ||
                            Boolean(detailItem.archivedAt)
                          }
                          onValueChange={(assigneeId) =>
                            setDetailDraft((current) => ({
                              ...current,
                              assigneeId,
                            }))
                          }
                          options={[
                            { value: "unassigned", label: "Unassigned" },
                            ...peopleOptions,
                          ]}
                        />
                        {detailItem.kind !== "project" && (
                          <SelectField
                            label="Project"
                            value={detailDraft.projectId}
                            disabled={
                              !detailItem.permissions?.canManage ||
                              Boolean(detailItem.archivedAt)
                            }
                            onValueChange={(projectId) =>
                              setDetailDraft((current) => ({
                                ...current,
                                projectId,
                              }))
                            }
                            options={[
                              { value: "none", label: "No project" },
                              ...projects.map((project) => ({
                                value: project.id,
                                label: `${project.key} · ${project.title}`,
                              })),
                            ]}
                          />
                        )}
                        {detailItem.kind === "subtask" && (
                          <SelectField
                            label="Parent task"
                            value={detailDraft.parentId}
                            disabled={
                              !detailItem.permissions?.canManage ||
                              Boolean(detailItem.archivedAt)
                            }
                            onValueChange={(parentId) =>
                              setDetailDraft((current) => ({
                                ...current,
                                parentId,
                              }))
                            }
                            options={[
                              { value: "none", label: "Select a task" },
                              ...taskOptions.map((task) => ({
                                value: task.id,
                                label: `${task.key} · ${task.title}`,
                              })),
                            ]}
                          />
                        )}
                      </div>
                      {detailItem.permissions?.canEdit && (
                        <div className="mt-6 flex justify-end">
                          <Button
                            onClick={saveDetail}
                            disabled={
                              !detailDirty ||
                              savingDetail ||
                              Boolean(detailItem.archivedAt)
                            }
                          >
                            {savingDetail && (
                              <Loader2 className="animate-spin" />
                            )}
                            Save changes
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="subtasks" className="m-0 flex-1 p-6">
                      <div className="mb-4 flex justify-between">
                        <div>
                          <h3 className="font-semibold">Related work</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Project tasks and task subtasks are completed
                            independently.
                          </p>
                        </div>
                        {!detailItem.archivedAt &&
                          (detailItem.kind === "project" ||
                            detailItem.kind === "task") && (
                            <Button
                              size="sm"
                              onClick={() =>
                                openCreate(
                                  detailItem.kind === "project"
                                    ? "task"
                                    : "subtask",
                                  detailItem,
                                )
                              }
                            >
                              <Plus />
                              {detailItem.kind === "project"
                                ? "Add task"
                                : "Add subtask"}
                            </Button>
                          )}
                      </div>
                      {detail.children?.length ? (
                        <div className="divide-y divide-border border border-border">
                          {detail.children.map((child) => (
                            <button
                              type="button"
                              key={child.id}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                              onClick={() => openDetail(child)}
                            >
                              <span className="font-mono text-xs text-primary">
                                {child.key}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {child.title}
                              </span>
                              <StatusBadge status={child.status} />
                              <Progress progress={child.progress} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <StateBlock
                          icon={CheckSquare2}
                          title="No related work"
                          description={
                            detailItem.kind === "subtask"
                              ? "Subtasks cannot contain further subtasks."
                              : "Create the first related work item."
                          }
                        />
                      )}
                    </TabsContent>
                    <TabsContent value="comments" className="m-0 flex-1 p-6">
                      <div className="space-y-4">
                        {detail.comments?.length ? (
                          detail.comments.map((comment) => (
                            <div
                              key={comment.id}
                              className="border-b border-border pb-4 last:border-b-0"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium">
                                    {comment.author?.name ||
                                      comment.author?.email}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDateTime(comment.createdAt)}
                                    {comment.editedAt ? " · edited" : ""}
                                  </div>
                                </div>
                                {comment.canEdit && !comment.deletedAt && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                        onClick={() => {
                                          setEditingComment(comment);
                                          setCommentDraft(comment.body);
                                          setCommentMentions(
                                            comment.mentionedUserIds || [],
                                          );
                                          setMentionSearch("");
                                        }}
                                      title="Edit comment"
                                    >
                                      <Pencil />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => deleteComment(comment)}
                                      title="Delete comment"
                                    >
                                      <Trash2 />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {comment.deletedAt ? (
                                <p className="mt-2 text-sm italic text-muted-foreground">
                                  Comment removed
                                </p>
                              ) : (
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                                  {comment.body}
                                </p>
                              )}
                              {comment.mentionedUserIds?.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {comment.mentionedUserIds.map((userId) => {
                                    const user = users.find(
                                      (entry) => entry.id === userId,
                                    );
                                    return (
                                      <Badge
                                        key={userId}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        @{user?.name || userId}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <StateBlock
                            icon={MessageSquare}
                            title="No comments yet"
                            description="Comments, mentions, and decisions are visible to every active user."
                          />
                        )}
                        {detailItem.permissions?.canComment && (
                          <div className="border-t border-border pt-4">
                            <Label>
                              {editingComment ? "Edit comment" : "Add comment"}
                            </Label>
                            <Textarea
                              className="mt-2"
                              value={commentDraft}
                              rows={4}
                              maxLength={10000}
                              onChange={(event) =>
                                setCommentDraft(event.target.value)
                              }
                              placeholder="Add an update, decision, or question"
                            />
                            <div className="mt-3">
                              <div className="mb-2 text-xs font-medium text-muted-foreground">
                                Mention users
                              </div>
                              <div className="relative mb-2">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                  value={mentionSearch}
                                  onChange={(event) =>
                                    setMentionSearch(event.target.value)
                                  }
                                  className="h-9 pl-9"
                                  placeholder="Search by name or email"
                                />
                              </div>
                              <div className="grid max-h-32 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                                {filteredMentionUsers.map((user) => (
                                  <label
                                    key={user.id}
                                    className="flex min-w-0 items-center gap-2 text-sm"
                                  >
                                    <Checkbox
                                      checked={commentMentions.includes(
                                        user.id,
                                      )}
                                      onCheckedChange={(checked) =>
                                        setCommentMentions((current) =>
                                          checked
                                            ? [...current, user.id]
                                            : current.filter(
                                                (id) => id !== user.id,
                                              ),
                                        )
                                      }
                                    />
                                    <span className="truncate">
                                      {user.name || user.email}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                              {editingComment && (
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setEditingComment(null);
                                    setCommentDraft("");
                                    setCommentMentions([]);
                                    setMentionSearch("");
                                  }}
                                >
                                  Cancel
                                </Button>
                              )}
                              <Button
                                onClick={saveComment}
                                disabled={!commentDraft.trim() || commentSaving}
                              >
                                {commentSaving && (
                                  <Loader2 className="animate-spin" />
                                )}
                                {editingComment
                                  ? "Save comment"
                                  : "Post comment"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="files" className="m-0 flex-1 p-6">
                      <div className="space-y-4">
                        <label
                          className={cn(
                            "flex min-h-32 cursor-pointer flex-col items-center justify-center border border-dashed border-border px-5 py-6 text-center transition-colors",
                            dragActive && "border-primary bg-primary/5",
                            (!detailItem.permissions?.canUpload || uploading) &&
                              "cursor-not-allowed opacity-60",
                          )}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (detailItem.permissions?.canUpload)
                              setDragActive(true);
                          }}
                          onDragLeave={() => setDragActive(false)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragActive(false);
                            uploadFiles(event.dataTransfer.files);
                          }}
                        >
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="mt-2 text-sm font-medium">
                            Drop files here or choose files
                          </span>
                          <span className="mt-1 text-xs text-muted-foreground">
                            PDF, Office, images, text, CSV, and email files up
                            to 20 MB
                          </span>
                          <input
                            type="file"
                            className="sr-only"
                            multiple
                            disabled={
                              !detailItem.permissions?.canUpload || uploading
                            }
                            onChange={(event) => {
                              uploadFiles(event.target.files);
                              event.target.value = "";
                            }}
                          />
                        </label>
                        {uploading && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uploading and verifying private files...
                          </div>
                        )}
                        {detail.attachments?.length ? (
                          <div className="divide-y divide-border border border-border">
                            {detail.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="flex items-center gap-3 px-4 py-3"
                              >
                                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {attachment.displayFilename}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {formatBytes(attachment.size)} ·{" "}
                                    {attachment.uploader?.name ||
                                      attachment.uploader?.email}{" "}
                                    · {formatDateTime(attachment.createdAt)}
                                  </div>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  {attachment.previewable && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() =>
                                        accessAttachment(attachment)
                                      }
                                      title="Preview file"
                                    >
                                      <Eye />
                                    </Button>
                                  )}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() =>
                                      accessAttachment(attachment, true)
                                    }
                                    title="Download file"
                                  >
                                    <Download />
                                  </Button>
                                  {attachment.canDelete && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() =>
                                        deleteAttachment(attachment)
                                      }
                                      title="Remove file"
                                    >
                                      <Trash2 />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <StateBlock
                            icon={Upload}
                            title="No files uploaded"
                            description="Upload related evidence, documents, screenshots, or correspondence."
                          />
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="activity" className="m-0 flex-1 p-6">
                      <div className="space-y-0 border border-border">
                        {detail.events?.length ? (
                          detail.events.map((event) => (
                            <div
                              key={event.id}
                              className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0"
                            >
                              <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="text-sm text-foreground">
                                  {event.summary || event.eventType}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {event.actor_name ||
                                    event.actor_email ||
                                    "System"}{" "}
                                  · {formatDateTime(event.created_at)}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <StateBlock
                            icon={History}
                            title="No activity recorded"
                            description="Changes, files, comments, and archive actions will appear here."
                          />
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>

        <AlertDialog
          open={Boolean(archiveTarget)}
          onOpenChange={(open) => {
            if (!open && !archiveSaving) setArchiveTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {archiveTarget?.archivedAt
                  ? "Restore work item?"
                  : "Archive work item?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {archiveTarget?.archivedAt
                  ? "The work item will return to active views."
                  : "The work item will be hidden from normal views. Projects and tasks archive their descendants together."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiveSaving}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={changeArchive}
                disabled={archiveSaving}
              >
                {archiveSaving && <Loader2 className="animate-spin" />}
                {archiveTarget?.archivedAt ? "Restore" : "Archive"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={methodologyOpen} onOpenChange={setMethodologyOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Projects & Tasks Methodology</DialogTitle>
              <DialogDescription>
                How shared work, authority, notifications, and private files
                operate in FCOS.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="font-semibold">Visibility and ownership</h3>
                <p className="mt-1 text-muted-foreground">
                  Every active FCOS user sees every active project, task,
                  subtask, comment, file, progress value, and activity record.
                  The creator remains the owner. Only the owner or the appointed
                  General Manager can assign, move, archive, or restore work.
                </p>
              </section>
              <section>
                <h3 className="font-semibold">Progress and completion</h3>
                <p className="mt-1 text-muted-foreground">
                  Leaf task progress follows its status. Parent progress is
                  calculated from active child work. A project or task cannot be
                  marked Done while any non-cancelled child remains incomplete.
                </p>
              </section>
              <section>
                <h3 className="font-semibold">Collaboration</h3>
                <p className="mt-1 text-muted-foreground">
                  Owners, assignees, and the General Manager can update work
                  details. Every active user can comment, mention colleagues,
                  and upload related files. Comment edits and removals remain
                  visible in activity.
                </p>
              </section>
              <section>
                <h3 className="font-semibold">Notifications</h3>
                <p className="mt-1 text-muted-foreground">
                  FCOS creates in-app notifications for assignments, mentions,
                  relevant updates, due-today work, and overdue work. The person
                  making the change is never notified about their own action.
                </p>
              </section>
              <section>
                <h3 className="font-semibold">Private files</h3>
                <p className="mt-1 text-muted-foreground">
                  Files are stored in a private FCOS bucket and are opened
                  through short-lived links. Uploads are limited to approved
                  business document formats and 20 MB per file. Duplicate
                  display names receive a numeric suffix automatically.
                </p>
              </section>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Notifications</DialogTitle>
              <DialogDescription>
                Assignments, mentions, due work, and relevant updates.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              {notifications.length ? (
                notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    className={cn(
                      "w-full border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted/50",
                      !notification.readAt && "bg-primary/5",
                    )}
                        onClick={() => {
                          openNotification(notification);
                        }}
                  >
                    <div className="text-sm font-medium">
                      {notification.title}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {notification.message}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(notification.createdAt)}
                    </div>
                  </button>
                ))
              ) : (
                <StateBlock
                  icon={Bell}
                  title="No notifications"
                  description="New collaboration activity will appear here."
                />
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={markNotificationsRead}
                disabled={!unreadCount}
              >
                Mark all read
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
