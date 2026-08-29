import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCheck2,
  Lightbulb,
  MailSearch,
  ReceiptText,
  RefreshCw,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import { useNavigationAwareRequest } from "@/hooks/useNavigationAwareRequest";
import PageHeader from "@/components/common/PageHeader";
import PageMethodology from "@/components/common/PageMethodology";
import StateBlock from "@/components/common/StateBlock";
import WorkspaceViewBar from "@/components/common/WorkspaceViewBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MY_COMMITMENTS_METHODOLOGY } from "@/lib/pageMethodologies";

const SECTIONS = [
  { key: "needs_action", label: "Needs action", icon: CircleDot },
  { key: "overdue", label: "Overdue", icon: AlertCircle },
  { key: "due_today", label: "Due today", icon: Clock3 },
  { key: "coming_week", label: "Coming seven days", icon: CalendarClock },
  { key: "waiting", label: "Waiting for others", icon: UserRoundCheck },
  { key: "later", label: "Later", icon: CheckCircle2 },
  { key: "no_due_date", label: "No due date", icon: CheckCircle2 },
];

const SOURCES = [
  { key: "all", label: "All", icon: UserRoundCheck },
  { key: "collaboration", label: "Projects & Tasks", icon: CircleDot },
  { key: "growth_coaching", label: "Growth & Coaching", icon: UserRoundCheck },
  { key: "fcos_improvements", label: "FCOS Improvements", icon: Lightbulb },
  { key: "payment_collections", label: "Payment Collections", icon: ReceiptText },
  { key: "disputes", label: "Disputes", icon: FileCheck2 },
  { key: "hedge_desk", label: "Hedge Desk", icon: ChartNoAxesCombined },
  { key: "markets", label: "Markets", icon: ChartNoAxesCombined },
  { key: "xero_portal", label: "Xero", icon: ReceiptText },
  { key: "special_terms", label: "Special Terms", icon: FileCheck2 },
  { key: "email_router", label: "Email Router", icon: MailSearch },
  { key: "system_error", label: "System Errors", icon: TriangleAlert },
];

function formatDue(value) {
  if (!value) return "No due date";
  const date = new Date(
    String(value).length === 10 ? `${value}T00:00:00+08:00` : value,
  );
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(String(value).length > 10
      ? { hour: "2-digit", minute: "2-digit" }
      : {}),
  }).format(date);
}

function sourceLabel(source) {
  return SOURCES.find((item) => item.key === source)?.label || source || "Work";
}

function sourceBadgeClass(source) {
  if (source === "system_error") return "border-red-200 bg-red-50 text-red-800";
  if (source === "email_router") return "border-amber-200 bg-amber-50 text-amber-900";
  if (source === "payment_collections") return "border-cyan-200 bg-cyan-50 text-cyan-900";
  if (source === "disputes") return "border-orange-200 bg-orange-50 text-orange-900";
  if (source === "hedge_desk") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (source === "markets") return "border-teal-200 bg-teal-50 text-teal-900";
  if (source === "xero_portal") return "border-sky-200 bg-sky-50 text-sky-900";
  if (source === "special_terms") return "border-indigo-200 bg-indigo-50 text-indigo-900";
  if (source === "growth_coaching") return "border-violet-200 bg-violet-50 text-violet-800";
  if (source === "fcos_improvements") return "border-cyan-200 bg-cyan-50 text-cyan-900";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function sectionTone(key) {
  if (key === "overdue") return "border-red-200 bg-red-50 text-red-800";
  if (key === "due_today" || key === "needs_action")
    return "border-amber-200 bg-amber-50 text-amber-900";
  if (key === "waiting")
    return "border-violet-200 bg-violet-50 text-violet-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function MyCommitments() {
  const navigate = useNavigate();
  const { request: requestCommitments } = useNavigationAwareRequest("collaboration");
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ commitments: [], counts: {} });
  const requestedSource = searchParams.get('source');
  const scope = SOURCES.some((item) => item.key === requestedSource) ? requestedSource : 'all';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ background = false, force = background } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      await requestCommitments({
        name: "workCommitmentsList",
        force,
        apply: (response) => {
          if (response.data?.error) throw new Error(response.data.error);
          setData(response.data || { commitments: [], counts: {} });
        },
      });
    } catch (loadError) {
      setError(loadError?.message || "Unable to load your commitments.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestCommitments]);

  useEffect(() => {
    load();
  }, [load]);

  const commitments = useMemo(
    () =>
      (data.commitments || []).filter(
        (item) => scope === "all" || item.source === scope,
      ),
    [data.commitments, scope],
  );
  const visibleSources = useMemo(() => {
    const available = new Set(data.sources || (data.commitments || []).map((item) => item.source));
    return SOURCES
      .filter((item) => item.key === "all" || available.has(item.key))
      .map((item) => ({
        id: item.key,
        label: item.label,
        icon: item.icon,
        count: item.key === 'all'
          ? (data.commitments || []).length
          : (data.commitments || []).filter((commitment) => commitment.source === item.key).length,
      }));
  }, [data.commitments, data.sources]);

  const changeScope = (nextScope) => {
    const next = new URLSearchParams(searchParams);
    if (nextScope === 'all') next.delete('source');
    else next.set('source', nextScope);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="workspace-collaboration space-y-5">
      <PageHeader
        icon={UserRoundCheck}
        eyebrow="Daily Work"
        title="My Commitments"
        description="Your operational work, approvals, development checkpoints, coaching actions, and sessions in one place."
        actions={(
          <>
            <PageMethodology {...MY_COMMITMENTS_METHODOLOGY} />
            <Button
              type="button"
              variant="outline"
              onClick={() => load({ background: true })}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")}
              />
              Refresh
            </Button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SECTIONS.slice(0, 5).map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className={cn("rounded-lg border px-4 py-3", sectionTone(key))}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span>{label}</span>
              <Icon className="h-4 w-4" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {Number(data.counts?.[key] || 0)}
            </div>
          </div>
        ))}
      </div>

      <WorkspaceViewBar views={visibleSources} value={scope} onValueChange={changeScope} />

      {data.unavailableSources?.length ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{data.unavailableSources.join(", ")} could not be checked. Other commitments remain current.</span>
        </div>
      ) : null}

      {loading ? (
        <StateBlock
          icon={RefreshCw}
          title="Loading commitments"
          description="Collecting your current work and decisions."
        />
      ) : error ? (
        <StateBlock
          icon={AlertCircle}
          title="My Commitments is unavailable"
          description={error}
          action={
            <Button variant="outline" onClick={() => load()}>
              Try again
            </Button>
          }
        />
      ) : commitments.length ? (
        <div className="space-y-5">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const rows = commitments.filter((item) => item.urgency === key);
            if (!rows.length) return null;
            return (
              <section key={key}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{label}</h2>
                  <Badge variant="outline">{rows.length}</Badge>
                </div>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {rows.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                      onClick={() => navigate(item.link)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {item.title}
                          </span>
                          <Badge variant="outline" className={cn("text-[10px]", sourceBadgeClass(item.source))}>
                            {sourceLabel(item.source)}
                          </Badge>
                          {item.priority && (
                            <Badge variant="outline" className="text-[10px]">
                              {item.priority}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {item.subtitle}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span className="text-right">
                          <span className="block font-medium text-foreground">{item.actionLabel || "Open"}</span>
                          <span className="block">{formatDue(item.dueAt)}</span>
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <StateBlock
          icon={CheckCircle2}
          title="No active commitments"
          description="There is nothing requiring your attention in the selected view."
        />
      )}
    </div>
  );
}
