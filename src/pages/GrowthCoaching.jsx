import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUpRight, ArrowUp, BadgeCheck, BookOpen, CalendarClock, CalendarDays, Check, CheckCircle2, ClipboardCheck, FileText, Goal, Handshake, History, Loader2, Lock, MessageSquareText, Pencil, Plus, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Target, Upload, UserPlus, Users, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';

const NONE = '__none__';
const MEASURE_TYPES = [
  { value: 'numeric', label: 'Numeric result' },
  { value: 'milestones', label: 'Weighted milestones' },
  { value: 'outcome', label: 'Outcome rubric' },
];
const CADENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

function errorText(response, fallback = 'The request could not be completed.') {
  return response?.data?.error || response?.error || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function userName(user) {
  if (!user) return 'Unassigned';
  return user.fullName || user.full_name || user.name || user.email || 'Unnamed user';
}

function formatDate(value, includeTime = false) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(parsed);
}

function dateValue(value) {
  return value ? String(value).slice(0, 10) : '';
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(value) {
  return Math.max(0, Math.min(100, Math.round(numeric(value))));
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function goalQualityChecks(draft = {}) {
  const checks = [];
  const add = (ok, label) => checks.push({ ok: Boolean(ok), label });
  add(String(draft.title || '').trim().length >= 8, 'A specific outcome-focused title');
  add(String(draft.description || '').trim().length >= 20, 'Why the goal matters');
  add(Boolean(draft.deadline), 'A target deadline');
  add(asArray(draft.checkpoints).length > 0 && asArray(draft.checkpoints).every((item) => item.date && String(item.expectedResult || '').trim()), 'Dated checkpoints with expected results');
  if (draft.measureType === 'numeric') {
    add(optionalNumber(draft.baseline) !== undefined && optionalNumber(draft.target) !== undefined && Boolean(String(draft.unit || '').trim()), 'Baseline, target, and measurement unit');
  } else if (draft.measureType === 'milestones') {
    add(asArray(draft.milestones).length > 0 && asArray(draft.milestones).every((item) => String(item.label || '').trim()) && asArray(draft.milestones).reduce((sum, item) => sum + numeric(item.weight), 0) === 100, 'Named milestones weighted to 100%');
  } else {
    add(asArray(draft.rubric).length >= 2 && asArray(draft.rubric).every((item) => String(item.label || '').trim() && String(item.evidence || '').trim()), 'At least two evidence-backed achievement levels');
  }
  return checks;
}

function managerGoalMatches(goal, filter) {
  if (filter === 'all') return true;
  if (filter === 'needs_action') return ['Pending Approval', 'Completion Review', 'Cancellation Requested'].includes(goal.status);
  if (filter === 'at_risk') return asArray(goal.checkpoints).some((checkpoint) => checkpoint.overdue || ['at risk', 'off track'].includes(String(checkpoint.state || '').toLowerCase()));
  if (filter === 'stale') {
    if (goal.status !== 'Active') return false;
    const lastUpdate = asArray(goal.updates)[0]?.submittedAt;
    return !lastUpdate || Date.now() - new Date(lastUpdate).getTime() > 30 * 86_400_000;
  }
  return true;
}

function goalMeasurement(goal = {}) {
  return goal.measurement || goal.measurementConfig || {};
}

function goalMeasureType(goal = {}) {
  const type = goal.measureType || goal.measure_type || goalMeasurement(goal).type;
  return type === 'outcome_rubric' ? 'outcome' : type || 'numeric';
}

function cadenceLabel(relationship = {}) {
  const cadence = relationship.cadence || 'fortnightly';
  if (cadence === 'custom') {
    const days = optionalNumber(relationship.customCadenceDays || relationship.custom_cadence_days);
    return days ? `Every ${days} days` : 'Custom cadence';
  }
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

function statusTone(status) {
  return (
    {
      Draft: 'border-slate-200 bg-slate-50 text-slate-700',
      'Pending Approval': 'border-amber-200 bg-amber-50 text-amber-800',
      'Revision Requested': 'border-orange-200 bg-orange-50 text-orange-800',
      Active: 'border-blue-200 bg-blue-50 text-blue-800',
      'Completion Review': 'border-violet-200 bg-violet-50 text-violet-800',
      Completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      'Not Achieved': 'border-red-200 bg-red-50 text-red-800',
      'Cancellation Requested': 'border-slate-300 bg-slate-100 text-slate-700',
    }[status] || 'border-slate-200 bg-slate-50 text-slate-700'
  );
}

function syncTone(status) {
  return (
    {
      Synced: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      Pending: 'border-amber-200 bg-amber-50 text-amber-800',
      Conflict: 'border-red-200 bg-red-50 text-red-800',
      Failed: 'border-red-200 bg-red-50 text-red-800',
      Unavailable: 'border-slate-200 bg-slate-100 text-slate-700',
    }[status] || 'border-slate-200 bg-slate-50 text-slate-700'
  );
}

function makePlanDraft(plan = {}) {
  return {
    id: plan.id || null,
    revision: numeric(plan.revision),
    title: plan.title || '',
    periodType: plan.periodType || plan.period_type || 'annual',
    startDate: dateValue(plan.startDate || plan.start_date),
    endDate: dateValue(plan.endDate || plan.end_date),
    description: plan.description || '',
  };
}

function makeGoalDraft(goal = {}, planId = '') {
  const measurement = goalMeasurement(goal);
  const measureType = goalMeasureType(goal);
  return {
    id: goal.id || null,
    revision: numeric(goal.revision),
    planId: goal.planId || goal.plan_id || planId || '',
    title: goal.title || '',
    description: goal.description || '',
    measureType,
    baseline: measurement.baseline ?? goal.baseline ?? '',
    target: measurement.target ?? goal.target ?? '',
    unit: measurement.unit ?? goal.unit ?? '',
    direction: ['increase', 'decrease'].includes(measurement.direction || goal.direction) ? measurement.direction || goal.direction : 'increase',
    currentValue: measurement.current ?? measurement.currentValue ?? goal.currentValue ?? '',
    deadline: dateValue(goal.deadline),
    milestones: asArray(measurement.milestones || goal.milestones).map((item) => ({
      id: item.id || crypto.randomUUID(),
      label: item.label || item.title || '',
      weight: item.weight ?? '',
      progress: item.progress ?? 0,
      dueDate: dateValue(item.dueDate),
      evidence: item.evidence || '',
    })),
    rubric: asArray(measurement.levels || measurement.rubric || goal.levels || goal.rubric).map((item) => ({
      id: item.id || crypto.randomUUID(),
      label: item.label || item.level || '',
      evidence: item.evidence || '',
      progress: item.progress ?? '',
    })),
    currentLevelId: measurement.currentLevelId || goal.currentLevelId || '',
    checkpoints: asArray(goal.checkpoints).map((item) => ({
      id: item.id || crypto.randomUUID(),
      date: dateValue(item.date || item.dueDate),
      expectedResult: item.expectedResult || '',
      actualResult: item.actualResult || '',
      evidence: item.evidence || '',
      state:
        {
          'On Track': 'On track',
          'At Risk': 'At risk',
          'Off Track': 'Off track',
        }[item.state] ||
        item.state ||
        'On track',
    })),
  };
}

function makeSessionDraft(session = {}, relationshipId = '') {
  const contents = session.content || session.contents || {};
  return {
    id: session.id || null,
    revision: numeric(session.revision),
    relationshipId: session.relationshipId || relationshipId || '',
    carryForwardFromSessionId: '',
    scheduledAt: session.scheduledAt || session.scheduled_at || '',
    durationMinutes: numeric(session.durationMinutes || session.duration_minutes, 45),
    agenda: asArray(contents.agenda || session.agenda).map((item) => ({
      id: item.id || crypto.randomUUID(),
      text: item.text || item.title || '',
      mode: item.mode || 'guided',
      authorId: item.authorId || '',
      canEdit: item.canEdit !== false,
    })),
    privatePrep: contents.privatePrep || session.privatePrep || '',
    privatePrepRevision: numeric(contents.privatePrepRevision || session.privatePrepRevision),
    sharedNotes: contents.sharedNotes || session.sharedNotes || '',
    decisions: contents.decisions || session.decisions || '',
    addendum: '',
  };
}

function makeGoalProgressDraft(goal = {}) {
  const measurement = goalMeasurement(goal);
  const measureType = goalMeasureType(goal);
  return {
    currentValue: measurement.current ?? measurement.currentValue ?? '',
    milestoneProgress:
      measureType === 'milestones'
        ? asArray(measurement.milestones).map((item) => ({
            id: item.id,
            label: item.label || item.title || 'Milestone',
            progress: item.progress ?? 0,
          }))
        : [],
    currentLevelId: measureType === 'outcome' ? measurement.currentLevelId || '' : '',
    checkpointId: NONE,
    actualResult: '',
    evidence: '',
    state: 'On track',
    comment: '',
  };
}

function EmptyMetricRow({ children }) {
  return <div className="rounded-lg border border-border bg-card p-4 shadow-sm">{children}</div>;
}

function GoalStatusBadge({ status }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', statusTone(status))}>
      {status || 'Draft'}
    </Badge>
  );
}

function SectionTitle({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default function GrowthCoaching() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState({});
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = ['growth', 'reports', 'coaching', 'settings'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'growth';
  const [tab, setTab] = useState(initialTab);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalActionOpen, setGoalActionOpen] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [planDraft, setPlanDraft] = useState(makePlanDraft());
  const [goalDraft, setGoalDraft] = useState(makeGoalDraft());
  const [sessionDraft, setSessionDraft] = useState(makeSessionDraft());
  const [inviteeId, setInviteeId] = useState(NONE);
  const [inviteCadence, setInviteCadence] = useState('fortnightly');
  const [inviteCustomCadenceDays, setInviteCustomCadenceDays] = useState('');
  const [emailPreferences, setEmailPreferences] = useState({});
  const [reportFilter, setReportFilter] = useState('needs_action');
  const [goalEvidenceOptions, setGoalEvidenceOptions] = useState([]);

  const currentUserId = user?.id || data.currentUser?.id || data.viewer?.id;
  const users = useMemo(() => asArray(data.users || data.activeUsers), [data]);
  const plans = useMemo(() => asArray(data.plans || data.growthPlans), [data]);
  const goals = useMemo(() => asArray(data.goals || data.growthGoals), [data]);
  const directReports = useMemo(() => asArray(data.directReports || data.reports), [data]);
  const relationships = useMemo(() => asArray(data.relationships || data.coachingRelationships), [data]);
  const sessions = useMemo(() => asArray(data.sessions || data.coachingSessions), [data]);
  const capabilities = data.capabilities || {};
  const selectedRelationship = relationships.find((item) => item.id === selectedRelationshipId) || relationships[0] || null;
  const selectedSession = sessions.find((item) => item.id === selectedSessionId) || null;
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);

  const load = useCallback(
    async ({ background = false } = {}) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError('');
      const response = await appClient.functions.invoke('growthCoachingBootstrap', selectedSessionId ? { sessionId: selectedSessionId } : {}, { force: true });
      if (response.data?.error) {
        setError(errorText(response));
      } else {
        const next = response.data || {};
        setData(next);
        setEmailPreferences(next.emailPreferences || next.preferences || {});
      }
      setLoading(false);
      setRefreshing(false);
    },
    [selectedSessionId],
  );

  useEffect(() => {
    load({ background: Boolean(selectedSessionId) });
  }, [load, selectedSessionId]);

  useEffect(() => {
    const requestedSession = searchParams.get('session');
    if (requestedSession && sessions.some((session) => session.id === requestedSession)) {
      setSelectedSessionId(requestedSession);
      const session = sessions.find((item) => item.id === requestedSession);
      setSelectedRelationshipId(session?.relationshipId || null);
      setSessionDraft(makeSessionDraft(session, session?.relationshipId));
    }
  }, [searchParams, sessions]);

  useEffect(() => {
    if (selectedRelationshipId || !relationships[0]?.id) return;
    setSelectedRelationshipId(relationships[0].id);
  }, [relationships, selectedRelationshipId]);

  const invoke = async (name, payload, success, key = name) => {
    setBusy(key);
    const response = await appClient.functions.invoke(name, payload, {
      force: true,
    });
    if (response.data?.error) {
      toast({
        variant: 'destructive',
        title: 'Change was not saved',
        description: errorText(response),
      });
      if (response.data?.current) await load({ background: true });
      setBusy('');
      return null;
    }
    toast({ title: success });
    await load({ background: true });
    setBusy('');
    return response.data || {};
  };

  const goalsWithProgress = useMemo(
    () =>
      goals.map((goal) => ({
        ...goal,
        progress: pct(goal.progress ?? goal.progressPercent ?? goal.derivedProgress),
      })),
    [goals],
  );
  const hasPrimaryManager = Boolean(data.primaryManager || data.primaryManagerId || data.reportingLine?.primaryManagerId);
  const selfManagedGoals = data.capabilities?.goalApprovalMode === 'self_managed';
  const milestonesWeight = useMemo(() => goalDraft.milestones.reduce((total, item) => total + numeric(item.weight), 0), [goalDraft.milestones]);
  const goalQuality = useMemo(() => goalQualityChecks(goalDraft), [goalDraft]);
  const visibleDirectReports = useMemo(
    () =>
      directReports
        .map((report) => ({
          ...report,
          goals: asArray(report.goals || report.goalSummaries).filter((goal) => managerGoalMatches(goal, reportFilter)),
        }))
        .filter((report) => reportFilter === 'all' || report.goals.length),
    [directReports, reportFilter],
  );
  const sessionBaseline = useMemo(() => makeSessionDraft(selectedSession || {}, selectedRelationship?.id), [selectedRelationship?.id, selectedSession]);
  const sessionDirty = Boolean(selectedSession && JSON.stringify(sessionDraft) !== JSON.stringify(sessionBaseline));

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('fcos:dirty-state', {
        detail: {
          key: 'growth-coaching',
          dirty: planOpen || goalOpen || sessionOpen || sessionDirty,
          message: 'You have unsaved Growth & Coaching changes.',
        },
      }),
    );
    return () =>
      window.dispatchEvent(
        new CustomEvent('fcos:dirty-state', {
          detail: { key: 'growth-coaching', dirty: false },
        }),
      );
  }, [goalOpen, planOpen, sessionDirty, sessionOpen]);

  const savePlan = async () => {
    if (!planDraft.title.trim() || !planDraft.startDate || !planDraft.endDate) {
      toast({
        variant: 'destructive',
        title: 'Plan title and dates are required.',
      });
      return;
    }
    const result = await invoke('growthPlanSave', { ...planDraft, expectedRevision: planDraft.revision }, 'Development plan saved', 'plan-save');
    if (result) {
      setPlanOpen(false);
      setPlanDraft(makePlanDraft());
    }
  };

  const closePlan = async (plan, mode) => {
    const carrying = mode === 'carry_forward';
    if (!window.confirm(carrying ? 'Close this plan and carry its unfinished goals into a new plan?' : 'Close this development plan? Its goal history will remain available.')) return;
    let targetStartDate = null;
    let targetEndDate = null;
    if (carrying) {
      const start = new Date(`${plan.endDate}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start);
      const originalStart = new Date(`${plan.startDate}T00:00:00Z`);
      const originalEnd = new Date(`${plan.endDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + Math.max(1, Math.round((originalEnd - originalStart) / 86_400_000)));
      targetStartDate = start.toISOString().slice(0, 10);
      targetEndDate = end.toISOString().slice(0, 10);
    }
    await invoke(
      'growthPlanCloseout',
      {
        planId: plan.id,
        mode,
        targetStartDate,
        targetEndDate,
        expectedRevision: numeric(plan.revision),
      },
      carrying ? 'Plan closed and unfinished goals carried forward' : 'Development plan closed',
      `plan-close-${plan.id}`,
    );
  };

  const saveGoal = async () => {
    if (!goalDraft.planId || !goalDraft.title.trim() || !goalDraft.deadline || !goalDraft.checkpoints.length) {
      toast({
        variant: 'destructive',
        title: 'Choose a plan, add a title, deadline, and at least one checkpoint.',
      });
      return;
    }
    if (goalDraft.measureType === 'milestones' && milestonesWeight !== 100) {
      toast({
        variant: 'destructive',
        title: 'Milestone weights must total 100%.',
      });
      return;
    }
    if (goalDraft.measureType === 'outcome' && !goalDraft.rubric.filter((item) => item.label.trim()).length) {
      toast({
        variant: 'destructive',
        title: 'Add at least one outcome rubric level.',
      });
      return;
    }
    const measurement =
      goalDraft.measureType === 'numeric'
        ? {
            type: 'numeric',
            baseline: goalDraft.baseline,
            target: goalDraft.target,
            unit: goalDraft.unit,
            direction: goalDraft.direction,
            currentValue: goalDraft.currentValue,
          }
        : goalDraft.measureType === 'milestones'
          ? {
              type: 'milestones',
              milestones: goalDraft.milestones.map((item) => ({
                id: item.id,
                label: item.label,
                weight: item.weight,
                progress: optionalNumber(item.progress) ?? 0,
              })),
            }
          : {
              type: 'outcome',
              levels: goalDraft.rubric.map((item) => ({
                id: item.id,
                label: item.label,
                evidence: item.evidence,
                progress: optionalNumber(item.progress),
              })),
              currentLevelId: goalDraft.currentLevelId || null,
            };
    const result = await invoke(
      'growthGoalSave',
      {
        id: goalDraft.id,
        planId: goalDraft.planId,
        title: goalDraft.title,
        description: goalDraft.description,
        deadline: goalDraft.deadline,
        measurement,
        checkpoints: goalDraft.checkpoints,
        expectedRevision: goalDraft.revision,
      },
      'Goal saved',
      'goal-save',
    );
    if (result) {
      setGoalOpen(false);
      setGoalDraft(makeGoalDraft());
    }
  };

  const submitGoal = async (goal) => {
    if (!hasPrimaryManager && !selfManagedGoals) {
      toast({
        variant: 'destructive',
        title: 'A primary manager is required before a goal can be submitted.',
      });
      return;
    }
    await invoke('growthGoalSubmit', { goalId: goal.id, expectedRevision: numeric(goal.revision) }, selfManagedGoals ? 'Goal activated' : 'Goal submitted for manager approval', `goal-submit-${goal.id}`);
  };

  const decideGoal = async (decision) => {
    const target = goalActionOpen?.goal;
    if (!target) return;
    const result = await invoke(
      'growthGoalDecision',
      {
        goalId: target.id,
        decision,
        note: goalActionOpen.note || '',
        expectedRevision: numeric(target.revision),
      },
      decision === 'approve' ? 'Goal approved' : 'Revision requested',
      `goal-decision-${target.id}`,
    );
    if (result) setGoalActionOpen(null);
  };

  const saveProgress = async () => {
    const target = goalActionOpen?.goal;
    if (!target) return;
    const payload = goalActionOpen.progress || {};
    const result = await invoke(
      'growthGoalProgressSave',
      {
        goalId: target.id,
        currentValue: optionalNumber(payload.currentValue),
        milestoneProgress: asArray(payload.milestoneProgress).map((item) => ({
          id: item.id,
          progress: pct(item.progress),
        })),
        currentLevelId: payload.currentLevelId || null,
        checkpointId: payload.checkpointId || null,
        actualResult: payload.actualResult || '',
        evidence: payload.evidence || '',
        state: payload.state || 'On track',
        comment: payload.comment || '',
        expectedRevision: numeric(target.revision),
      },
      goalActionOpen?.type === 'manager_comment' ? 'Manager comment saved' : 'Progress update saved',
      `goal-progress-${target.id}`,
    );
    if (result) setGoalActionOpen(null);
  };

  const completeGoal = async (outcome) => {
    const target = goalActionOpen?.goal;
    if (!target) return;
    if (target.permissions?.selfManaged && outcome === 'complete' && !(goalActionOpen.evidence || '').trim()) {
      toast({ variant: 'destructive', title: 'Final evidence is required to complete this goal.' });
      return;
    }
    if (target.permissions?.selfManaged && outcome === 'not_achieved' && !(goalActionOpen.note || '').trim()) {
      toast({ variant: 'destructive', title: 'A decision note is required to mark this goal not achieved.' });
      return;
    }
    const result = await invoke(
      'growthGoalCompletion',
      {
        goalId: target.id,
        outcome,
        evidence: goalActionOpen.evidence || '',
        note: goalActionOpen.note || '',
        expectedRevision: numeric(target.revision),
      },
      outcome === 'request_completion' ? 'Completion evidence submitted' : outcome === 'request_cancellation' ? 'Cancellation requested' : outcome === 'complete' ? 'Goal completed' : outcome === 'cancel' ? 'Cancellation approved' : 'Goal marked not achieved',
      `goal-completion-${target.id}`,
    );
    if (result) setGoalActionOpen(null);
  };

  const openGoalProgress = async (goal) => {
    setGoalActionOpen({
      type: 'progress',
      goal,
      progress: makeGoalProgressDraft(goal),
    });
    const response = await appClient.functions.invoke('growthGoalEvidenceOptions', { goalId: goal.id }, { force: true });
    setGoalEvidenceOptions(response.data?.error ? [] : asArray(response.data?.items));
  };

  const toggleGoalEvidence = async (goal, item) => {
    const response = await appClient.functions.invoke('growthGoalEvidenceSave', { goalId: goal.id, itemId: item.id, remove: item.linked }, { force: true });
    if (response.data?.error) {
      toast({
        variant: 'destructive',
        title: 'Task evidence was not changed',
        description: errorText(response),
      });
      return;
    }
    setGoalEvidenceOptions((current) => current.map((candidate) => (candidate.id === item.id ? { ...candidate, linked: !item.linked } : candidate)));
  };

  const invite = async () => {
    if (!inviteeId || inviteeId === NONE) {
      toast({ variant: 'destructive', title: 'Select a coaching partner.' });
      return;
    }
    const customCadenceDays = optionalNumber(inviteCustomCadenceDays);
    if (inviteCadence === 'custom' && (!Number.isInteger(customCadenceDays) || customCadenceDays < 1 || customCadenceDays > 90)) {
      toast({
        variant: 'destructive',
        title: 'Custom cadence must be a whole number from 1 to 90 days.',
      });
      return;
    }
    const result = await invoke(
      'coachingRelationshipInvite',
      {
        inviteeId,
        cadence: inviteCadence,
        customCadenceDays: inviteCadence === 'custom' ? customCadenceDays : null,
      },
      'Coaching invitation sent',
      'coach-invite',
    );
    if (result) {
      setInviteOpen(false);
      setInviteeId(NONE);
      setInviteCadence('fortnightly');
      setInviteCustomCadenceDays('');
    }
  };

  const respondToInvite = (relationship, response) =>
    invoke(
      'coachingRelationshipRespond',
      {
        relationshipId: relationship.id,
        response,
        expectedRevision: numeric(relationship.revision),
      },
      response === 'accept' ? 'Coaching relationship accepted' : 'Coaching invitation declined',
      `coach-response-${relationship.id}`,
    );
  const endRelationship = (relationship) =>
    invoke(
      'coachingRelationshipEnd',
      {
        relationshipId: relationship.id,
        expectedRevision: numeric(relationship.revision),
      },
      'Coaching relationship ended',
      `coach-end-${relationship.id}`,
    );

  const saveSession = async () => {
    if (!sessionDraft.relationshipId || !sessionDraft.scheduledAt) {
      toast({
        variant: 'destructive',
        title: 'A relationship and scheduled time are required.',
      });
      return;
    }
    const result = await invoke(
      'coachingSessionSave',
      {
        id: sessionDraft.id,
        relationshipId: sessionDraft.relationshipId,
        scheduledAt: sessionDraft.scheduledAt,
        durationMinutes: numeric(sessionDraft.durationMinutes, 45),
        carryForwardFromSessionId: sessionDraft.carryForwardFromSessionId || null,
        expectedRevision: sessionDraft.revision,
      },
      'Session saved',
      'session-save',
    );
    if (result) {
      setSessionOpen(false);
      setSessionDraft(makeSessionDraft());
    }
  };

  const saveSessionContent = async (kind) => {
    if (!selectedSession) return;
    const payload =
      kind === 'agenda'
        ? { agenda: sessionDraft.agenda }
        : kind === 'privatePrep'
          ? {
              privatePrep: sessionDraft.privatePrep,
              expectedPrivatePrepRevision: numeric(sessionDraft.privatePrepRevision),
            }
          : {
              sharedNotes: sessionDraft.sharedNotes,
              decisions: sessionDraft.decisions,
              addendum: sessionDraft.addendum || null,
            };
    const result = await invoke(
      'coachingSessionContentSave',
      {
        sessionId: selectedSession.id,
        contentType: kind,
        ...payload,
        expectedRevision: numeric(selectedSession.revision),
      },
      kind === 'privatePrep' ? 'Private preparation saved' : 'Session content saved',
      `session-content-${kind}`,
    );
    if (kind === 'privatePrep' && result?.privatePrepRevision != null) {
      setSessionDraft((draft) => ({
        ...draft,
        privatePrepRevision: numeric(result.privatePrepRevision),
      }));
    }
  };

  const confirmSession = () =>
    selectedSession &&
    invoke(
      'coachingSessionConfirm',
      {
        sessionId: selectedSession.id,
        expectedRevision: numeric(selectedSession.revision),
      },
      'Session confirmation recorded',
      `session-confirm-${selectedSession.id}`,
    );
  const cancelSession = () => {
    if (!selectedSession || !window.confirm('Cancel this coaching session and its Outlook event?')) return;
    invoke(
      'coachingSessionCancel',
      {
        sessionId: selectedSession.id,
        expectedRevision: numeric(selectedSession.revision),
      },
      'Session cancelled',
      `session-cancel-${selectedSession.id}`,
    );
  };

  const saveAction = async (action = {}) => {
    if (!selectedSession) return;
    const result = await invoke(
      'coachingActionSave',
      {
        sessionId: action.sessionId || selectedSession.id,
        id: action.id || null,
        title: action.title || '',
        ownerId: action.ownerId || currentUserId,
        dueDate: action.dueDate || '',
        status: action.status || 'To Do',
        expectedRevision: numeric(action.revision),
      },
      'Coaching action saved',
      `coach-action-${action.id || 'new'}`,
    );
    return result;
  };

  const publishAction = async (action) => {
    if (!window.confirm('Publish this action to Projects & Tasks? The task title, owner, and due date will become visible to every FCOS user. Coaching notes will not be copied.')) return;
    await invoke(
      'coachingActionPublish',
      {
        actionId: action.id,
        expectedRevision: numeric(action.revision),
        confirmedPublicVisibility: true,
      },
      'Action published to Projects & Tasks',
      `coach-publish-${action.id}`,
    );
  };

  const respondToAction = async (action, response) => {
    await invoke(
      'coachingActionProposalRespond',
      {
        actionId: action.id,
        response,
        expectedRevision: numeric(action.revision),
      },
      response === 'accept' ? 'Coaching action accepted' : 'Coaching action declined',
      `coach-action-response-${action.id}`,
    );
  };

  const uploadAttachment = async (file) => {
    if (!file || !selectedSession) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Files must be 20 MB or smaller.',
      });
      return;
    }
    setBusy('attachment');
    const prepared = await appClient.functions.invoke(
      'growthAttachmentPrepare',
      {
        sessionId: selectedSession.id,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      },
      { force: true },
    );
    if (prepared.data?.error) {
      toast({
        variant: 'destructive',
        title: 'File could not be prepared',
        description: errorText(prepared),
      });
      setBusy('');
      return;
    }
    if (!prepared.data?.bucket || !prepared.data?.path || !prepared.data?.token) {
      toast({
        variant: 'destructive',
        title: 'Private upload details were not returned.',
      });
      setBusy('');
      return;
    }
    try {
      const upload = await supabase.storage.from(prepared.data.bucket).uploadToSignedUrl(prepared.data.path, prepared.data.token, file, {
        contentType: prepared.data.contentType,
      });
      if (upload.error) throw new Error(upload.error.message || 'The file upload was rejected.');
      const completed = await appClient.functions.invoke(
        'growthAttachmentComplete',
        {
          attachmentId: prepared.data?.attachmentId || prepared.data?.id,
          expectedRevision: numeric(prepared.data?.revision),
        },
        { force: true },
      );
      if (completed.data?.error) throw new Error(errorText(completed));
      toast({ title: 'Attachment uploaded' });
      await load({ background: true });
    } catch (uploadError) {
      toast({
        variant: 'destructive',
        title: 'Attachment was not completed',
        description: uploadError.message || 'Try again.',
      });
    }
    setBusy('');
  };

  const openAttachment = async (attachment) => {
    const response = await appClient.functions.invoke('growthAttachmentUrl', { attachmentId: attachment.id }, { force: true });
    if (response.data?.error || !(response.data?.url || response.data?.signedUrl)) {
      toast({
        variant: 'destructive',
        title: 'Preview unavailable',
        description: errorText(response),
      });
      return;
    }
    window.open(response.data.url || response.data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const savePreferences = () =>
    invoke(
      'growthEmailPreferencesSave',
      {
        preferences: emailPreferences,
        expectedRevision: numeric(emailPreferences.revision),
      },
      'Email preferences saved',
      'email-preferences',
    );
  const calendarAction = (action) =>
    selectedRelationship &&
    invoke(
      action === 'retry' ? 'coachingCalendarRetry' : 'coachingCalendarResolve',
      {
        relationshipId: selectedRelationship.id,
        resolution: action === 'outlook' ? 'keep_outlook' : action === 'fcos' ? 'replace_with_fcos' : undefined,
        expectedRevision: numeric(selectedRelationship.revision),
      },
      action === 'retry' ? 'Calendar sync retry requested' : 'Calendar conflict choice saved',
      `calendar-${action}`,
    );
  const selectSession = (sessionId) => {
    if (sessionDirty && !window.confirm('Discard unsaved changes and open another coaching session?')) return false;
    setSelectedSessionId(sessionId);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('tab', 'coaching');
        next.set('session', sessionId);
        return next;
      },
      { replace: true },
    );
    return true;
  };

  if (loading) return <StateBlock icon={Loader2} title="Loading Growth & Coaching" description="Preparing your goals, direct reports, and coaching relationships." />;
  if (error)
    return (
      <StateBlock
        icon={AlertCircle}
        title="Growth & Coaching unavailable"
        description={error}
        action={
          <Button variant="outline" onClick={() => load()}>
            Try again
          </Button>
        }
      />
    );

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          icon={Target}
          eyebrow="Daily Work"
          title="Growth & Coaching"
          description="Personal development goals and private, equal-participant coaching."
          actions={
            <>
              <Button type="button" variant="outline" onClick={() => setMethodologyOpen(true)} className="gap-2">
                <BookOpen className="h-4 w-4" />
                Methodology
              </Button>
              <Button type="button" variant="outline" onClick={() => load({ background: true })} disabled={refreshing} className="gap-2">
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </>
          }
        />

        {!hasPrimaryManager && !selfManagedGoals && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Primary manager not configured</AlertTitle>
            <AlertDescription>You can create and edit development goals, but cannot submit them until an Administrator assigns a primary manager.</AlertDescription>
          </Alert>
        )}

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setSearchParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.set('tab', value);
                if (value !== 'coaching') next.delete('session');
                return next;
              },
              { replace: true },
            );
          }}
          className="space-y-5"
        >
          <div className="overflow-x-auto pb-1">
            <TabsList className="h-auto min-w-max">
              <TabsTrigger value="growth">My Growth</TabsTrigger>
              <TabsTrigger value="reports">Direct Reports</TabsTrigger>
              <TabsTrigger value="coaching">Coaching</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="growth" className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <EmptyMetricRow>
                <div className="text-xs font-medium text-muted-foreground">Active goals</div>
                <div className="mt-1 text-2xl font-semibold">{goals.filter((goal) => goal.status === 'Active').length}</div>
              </EmptyMetricRow>
              <EmptyMetricRow>
                <div className="text-xs font-medium text-muted-foreground">Pending approval</div>
                <div className="mt-1 text-2xl font-semibold">{goals.filter((goal) => goal.status === 'Pending Approval').length}</div>
              </EmptyMetricRow>
              <EmptyMetricRow>
                <div className="text-xs font-medium text-muted-foreground">Checkpoints at risk</div>
                <div className="mt-1 text-2xl font-semibold">{goals.flatMap((goal) => asArray(goal.checkpoints)).filter((checkpoint) => ['at risk', 'off track'].includes(String(checkpoint.state || '').toLowerCase())).length}</div>
              </EmptyMetricRow>
              <EmptyMetricRow>
                <div className="text-xs font-medium text-muted-foreground">Completed</div>
                <div className="mt-1 text-2xl font-semibold">{goals.filter((goal) => goal.status === 'Completed').length}</div>
              </EmptyMetricRow>
            </div>

            <SectionTitle
              icon={Goal}
              title="Development Plans"
              description="Use more than one plan when your role needs annual, half-yearly, or focused development work."
              action={
                <Button
                  type="button"
                  onClick={() => {
                    setPlanDraft(makePlanDraft());
                    setPlanOpen(true);
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  New plan
                </Button>
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.map((plan) => {
                const planGoals = goalsWithProgress.filter((goal) => (goal.planId || goal.plan_id) === plan.id);
                const progress = planGoals.length ? Math.round(planGoals.reduce((total, goal) => total + goal.progress, 0) / planGoals.length) : 0;
                return (
                  <DevelopmentPlanCard
                    key={plan.id}
                    plan={plan}
                    planGoals={planGoals}
                    progress={progress}
                    onEdit={() => {
                      setPlanDraft(makePlanDraft(plan));
                      setPlanOpen(true);
                    }}
                    onGoal={() => {
                      setGoalDraft(makeGoalDraft({}, plan.id));
                      setGoalOpen(true);
                    }}
                    onClose={(mode) => closePlan(plan, mode)}
                    busy={busy === `plan-close-${plan.id}`}
                  />
                );
              })}
              {!plans.length && <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground lg:col-span-2">Create a development plan to begin setting measurable goals.</div>}
            </div>

            <SectionTitle
              icon={ClipboardCheck}
              title="Goals"
              description="Each goal needs a measurable result, deadline, and progress checkpoints."
              action={
                plans.length ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setGoalDraft(makeGoalDraft({}, plans[0].id));
                      setGoalOpen(true);
                    }}
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    New goal
                  </Button>
                ) : null
              }
            />
            <div className="space-y-3">
              {goalsWithProgress.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  plan={plans.find((plan) => plan.id === (goal.planId || goal.plan_id))}
                  onEdit={() => {
                    setGoalDraft(makeGoalDraft(goal));
                    setGoalOpen(true);
                  }}
                  onSubmit={() => submitGoal(goal)}
                  onProgress={() => openGoalProgress(goal)}
                  onCompletion={() =>
                    setGoalActionOpen({
                      type: 'completion',
                      goal,
                      evidence: '',
                      note: '',
                    })
                  }
                  onDecision={() => setGoalActionOpen({ type: 'decision', goal, note: '' })}
                  busy={busy}
                  currentUserId={currentUserId}
                />
              ))}
              {!goals.length && <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">Goals appear here once they have been drafted.</div>}
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-5">
            <SectionTitle icon={Users} title="Direct Reports" description="Review formal goals, checkpoint evidence, and completion requests for your current direct reports." />
            <Tabs value={reportFilter} onValueChange={setReportFilter}>
              <TabsList className="h-auto w-full sm:w-auto">
                <TabsTrigger value="needs_action" className="flex-1 sm:flex-none">
                  Needs decision
                </TabsTrigger>
                <TabsTrigger value="at_risk" className="flex-1 sm:flex-none">
                  At risk
                </TabsTrigger>
                <TabsTrigger value="stale" className="flex-1 sm:flex-none">
                  No recent update
                </TabsTrigger>
                <TabsTrigger value="all" className="flex-1 sm:flex-none">
                  All
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-3">
              {visibleDirectReports.map((report) => {
                const reportGoals = asArray(report.goals || report.goalSummaries);
                return (
                  <div key={report.id || report.userId} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-semibold">{userName(report)}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {report.email || 'Direct report'} · {report.relationshipRole || 'Management-chain visibility'}
                        </p>
                      </div>
                      <Badge variant="outline" className={report.primaryManagerId ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                        {report.primaryManagerId ? 'Primary reporting line active' : 'Reporting line needs setup'}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Active goals</div>
                        <div className="mt-1 font-semibold">{reportGoals.filter((goal) => goal.status === 'Active').length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Awaiting decision</div>
                        <div className="mt-1 font-semibold">{reportGoals.filter((goal) => ['Pending Approval', 'Completion Review', 'Cancellation Requested'].includes(goal.status)).length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Average progress</div>
                        <div className="mt-1 font-semibold">{reportGoals.length ? `${Math.round(reportGoals.reduce((sum, goal) => sum + pct(goal.progress ?? goal.progressPercent), 0) / reportGoals.length)}%` : 'No goals'}</div>
                      </div>
                    </div>
                    {reportGoals.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {reportGoals.map((goal) => (
                          <ReportGoalRow
                            key={goal.id}
                            goal={goal}
                            onDecision={() =>
                              setGoalActionOpen({
                                type: 'decision',
                                goal,
                                note: '',
                              })
                            }
                            onComment={() =>
                              setGoalActionOpen({
                                type: 'manager_comment',
                                goal,
                                progress: { comment: '' },
                              })
                            }
                            onCompletion={() =>
                              setGoalActionOpen({
                                type: 'completion_manager',
                                goal,
                                evidence: goal.completionEvidence || '',
                                note: '',
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!visibleDirectReports.length && <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">{directReports.length ? 'No direct-report goals match this review queue.' : 'No direct reports are assigned to you. Reporting lines are maintained in Admin Control.'}</div>}
            </div>
          </TabsContent>

          <TabsContent value="coaching" className="space-y-5">
            <SectionTitle
              icon={Handshake}
              title="Coaching Relationships"
              description="Coaching is private, equal-participant, and separate from formal reporting lines."
              action={
                <Button type="button" onClick={() => setInviteOpen(true)} className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Invite partner
                </Button>
              }
            />
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-2">
                {relationships.map((relationship) => (
                  <button
                    type="button"
                    key={relationship.id}
                    onClick={() => {
                      setSelectedRelationshipId(relationship.id);
                      setSelectedSessionId(null);
                    }}
                    className={cn('w-full rounded-lg border p-3 text-left transition-colors', selectedRelationship?.id === relationship.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{relationship.partnerName || userName(relationship.partner || userById.get(relationship.partnerId))}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {relationship.status || 'Pending'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {cadenceLabel(relationship)} · {relationship.inviterId === currentUserId ? 'You invited' : 'Partner invited'}
                    </div>
                  </button>
                ))}
                {!relationships.length && <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Invite a colleague to begin a private coaching relationship.</div>}
              </div>
              <CoachingWorkspace
                relationship={selectedRelationship}
                sessions={sessions.filter((session) => (session.relationshipId || session.relationship_id) === selectedRelationship?.id)}
                selectedSession={selectedSession}
                onSelectSession={selectSession}
                onNewSession={() => {
                  setSessionDraft(makeSessionDraft({}, selectedRelationship?.id));
                  setSessionOpen(true);
                }}
                onRespond={respondToInvite}
                onEnd={endRelationship}
                onCalendar={calendarAction}
                sessionDraft={sessionDraft}
                setSessionDraft={setSessionDraft}
                onSaveContent={saveSessionContent}
                onConfirm={confirmSession}
                onCancelSession={cancelSession}
                onSaveAction={saveAction}
                onPublishAction={publishAction}
                onRespondAction={respondToAction}
                onUpload={() => fileInputRef.current?.click()}
                onOpenAttachment={openAttachment}
                busy={busy}
                currentUserId={currentUserId}
                users={users}
              />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-5">
            <SectionTitle icon={MessageSquareText} title="Notification Preferences" description="In-app notifications remain on. You may control growth and coaching email categories here." />
            <div className="max-w-2xl rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
              {[
                ['goal_decisions', 'Goal decisions', 'Approval, revision, and completion decisions.'],
                ['completion_requests', 'Completion requests', 'Goal completion and cancellation review requests.'],
                ['invitations', 'Coaching invitations', 'New invitations and partner responses.'],
                ['session_confirmations', 'Session confirmations', 'Requests to confirm shared session notes.'],
                ['routine_digest', 'Routine reminder digest', 'Weekday deadline and overdue reminders at 08:30 Hong Kong time.'],
              ].map(([key, label, description]) => (
                <div key={key} className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div>
                    <Label>{label}</Label>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                  <Switch
                    checked={emailPreferences[key] !== false}
                    onCheckedChange={(checked) =>
                      setEmailPreferences((current) => ({
                        ...current,
                        [key]: checked,
                      }))
                    }
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button type="button" onClick={savePreferences} disabled={busy === 'email-preferences'} className="gap-2">
                  {busy === 'email-preferences' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save preferences
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            uploadAttachment(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        <PlanDialog open={planOpen} onOpenChange={setPlanOpen} draft={planDraft} setDraft={setPlanDraft} onSave={savePlan} busy={busy === 'plan-save'} />
        <GoalDialog open={goalOpen} onOpenChange={setGoalOpen} draft={goalDraft} setDraft={setGoalDraft} plans={plans} onSave={saveGoal} busy={busy === 'goal-save'} milestonesWeight={milestonesWeight} qualityChecks={goalQuality} />
        <GoalActionDialog state={goalActionOpen} setState={setGoalActionOpen} onDecision={decideGoal} onProgress={saveProgress} onCompletion={completeGoal} evidenceOptions={goalEvidenceOptions} onToggleEvidence={toggleGoalEvidence} busy={busy} />
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} users={users.filter((candidate) => candidate.id !== currentUserId && candidate.active !== false)} inviteeId={inviteeId} setInviteeId={setInviteeId} cadence={inviteCadence} setCadence={setInviteCadence} customCadenceDays={inviteCustomCadenceDays} setCustomCadenceDays={setInviteCustomCadenceDays} onInvite={invite} busy={busy === 'coach-invite'} />
        <SessionDialog open={sessionOpen} onOpenChange={setSessionOpen} draft={sessionDraft} setDraft={setSessionDraft} relationships={relationships.filter((relationship) => relationship.status === 'Active' || relationship.status === 'Accepted')} sessions={sessions} onSave={saveSession} busy={busy === 'session-save'} />
        <MethodologyDialog open={methodologyOpen} onOpenChange={setMethodologyOpen} />
      </div>
    </TooltipProvider>
  );
}

function DevelopmentPlanCard({ plan, planGoals, progress, onEdit, onGoal, onClose, busy }) {
  const closed = plan.closeoutStatus && plan.closeoutStatus !== 'Open';
  const ended = Boolean(plan.endDate && plan.endDate <= new Date().toISOString().slice(0, 10));
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{plan.title}</h3>
            {closed && <Badge variant="outline">{plan.closeoutStatus}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(plan.startDate || plan.start_date)} to {formatDate(plan.endDate || plan.end_date)}
          </p>
        </div>
        {!closed && (
          <Button type="button" size="icon" variant="outline" title="Edit plan" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
      {plan.description && <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Progress value={progress} />
        <span className="w-9 text-right text-xs font-medium">{progress}%</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {planGoals.length} goal{planGoals.length === 1 ? '' : 's'} · Average goal progress
        </span>
        <div className="flex flex-wrap gap-2">
          {!closed && (
            <Button type="button" size="sm" variant="outline" onClick={onGoal} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Goal
            </Button>
          )}
          {!closed && ended && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onClose('close')}>
              Close plan
            </Button>
          )}
          {!closed && ended && (
            <Button type="button" size="sm" disabled={busy} onClick={() => onClose('carry_forward')}>
              Carry forward
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalRow({ goal, plan, onEdit, onSubmit, onProgress, onCompletion, onDecision, busy, currentUserId }) {
  const state = goal.status || 'Draft';
  const checkpoints = asArray(goal.checkpoints);
  const decisions = asArray(goal.decisions);
  const updates = asArray(goal.updates);
  const checkpointCount = checkpoints.length;
  const today = new Date().toISOString().slice(0, 10);
  const nextCheckpoint = [...checkpoints].filter((checkpoint) => !checkpoint.completedAt && String(checkpoint.date || checkpoint.dueDate || '') >= today).sort((left, right) => String(left.date || left.dueDate || '').localeCompare(String(right.date || right.dueDate || '')))[0] || [...checkpoints].filter((checkpoint) => !checkpoint.completedAt).sort((left, right) => String(left.date || left.dueDate || '').localeCompare(String(right.date || right.dueDate || '')))[0];
  const latestUpdate = [...updates].sort((left, right) => String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')))[0];
  const isOwner = (goal.ownerId || goal.employeeId) === currentUserId;
  const canApprove = goal.permissions?.canApprove === true;
  const canEdit = isOwner && (['Draft', 'Revision Requested'].includes(state) || (goal.permissions?.selfManaged && state === 'Active'));
  const riskState = String(latestUpdate?.state || '').toLowerCase();
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{goal.title}</h3>
            <GoalStatusBadge status={state} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan?.title || 'Development plan'} · Deadline {formatDate(goal.deadline)}
          </p>
          {goal.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{goal.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          {isOwner && ['Draft', 'Revision Requested'].includes(state) && (
            <Button type="button" size="sm" onClick={onSubmit} disabled={busy === `goal-submit-${goal.id}`}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {goal.permissions?.selfManaged ? 'Activate' : 'Submit'}
            </Button>
          )}
          {canApprove && state === 'Pending Approval' && (
            <Button type="button" size="sm" onClick={onDecision}>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Review
            </Button>
          )}
          {isOwner && state === 'Active' && (
            <Button type="button" size="sm" variant="outline" onClick={onProgress}>
              <History className="mr-1.5 h-3.5 w-3.5" />
              Progress
            </Button>
          )}
          {isOwner && state === 'Active' && (
            <Button type="button" size="sm" onClick={onCompletion}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Complete
            </Button>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>Measured progress</span>
            <span className="font-medium text-foreground">{goal.progress}%</span>
          </div>
          <Progress value={goal.progress} />
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="block">Checkpoints</span>
          <span className="font-medium text-foreground">{checkpointCount}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="block">Next checkpoint</span>
          <span className="font-medium text-foreground">{nextCheckpoint ? formatDate(nextCheckpoint.date || nextCheckpoint.dueDate) : 'None'}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="block">Latest progress signal</span>
          <span className={cn('font-medium', riskState === 'off track' ? 'text-red-700' : riskState === 'at risk' ? 'text-amber-700' : 'text-foreground')}>{latestUpdate?.state || 'Not updated'}</span>
        </div>
      </div>
      {checkpoints.length || decisions.length || updates.length ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <GoalHistorySection title="Checkpoints">
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span>{formatDate(checkpoint.date || checkpoint.dueDate)}</span>
                  <span className={checkpoint.overdue ? 'font-medium text-red-700' : 'text-muted-foreground'}>{checkpoint.state || 'Not updated'}</span>
                </div>
                <p className="mt-1 text-sm">{checkpoint.expectedResult || 'Checkpoint'}</p>
                {checkpoint.actualResult && <p className="mt-1 text-xs text-muted-foreground">Actual: {checkpoint.actualResult}</p>}
                {checkpoint.evidence && <p className="mt-1 text-xs text-muted-foreground">Evidence: {checkpoint.evidence}</p>}
              </div>
            ))}
          </GoalHistorySection>
          <GoalHistorySection title="Goal decisions">
            {decisions.map((decision) => (
              <div key={decision.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    {decision.actorName || 'Manager'} · {String(decision.type || 'Decision').replaceAll('_', ' ')}
                  </span>
                  <span>{formatDate(decision.createdAt || decision.created_at, true)}</span>
                </div>
                {decision.note && <p className="mt-1 text-sm">{decision.note}</p>}
              </div>
            ))}
          </GoalHistorySection>
          <GoalHistorySection title="Progress history">
            {updates.map((update) => (
              <div key={update.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    {update.submittedByName || 'Update'}
                    {update.state ? ` · ${update.state}` : ''}
                  </span>
                  <span>{formatDate(update.submittedAt || update.submitted_at, true)}</span>
                </div>
                {update.currentValue !== null && update.currentValue !== undefined && <p className="mt-1 text-xs">Current value: {update.currentValue}</p>}
                {update.actualResult && <p className="mt-1 text-xs">Actual: {update.actualResult}</p>}
                {update.evidence && <p className="mt-1 text-xs">Evidence: {update.evidence}</p>}
                {update.comment && <p className="mt-1 text-sm">{update.comment}</p>}
              </div>
            ))}
          </GoalHistorySection>
        </div>
      ) : null}
    </div>
  );
}

function GoalHistorySection({ title, children }) {
  const entries = asArray(children).filter(Boolean);
  return (
    <section className="min-w-0 rounded-md bg-muted/20 p-3">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{entries.length ? entries : <p className="text-xs text-muted-foreground">No entries yet.</p>}</div>
    </section>
  );
}

function ReportGoalRow({ goal, onDecision, onComment, onCompletion }) {
  const checkpoints = asArray(goal.checkpoints);
  const updates = asArray(goal.updates);
  const decisions = asArray(goal.decisions);
  const canApprove = goal.permissions?.canApprove === true;
  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">{goal.title}</h4>
            <GoalStatusBadge status={goal.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Due {formatDate(goal.deadline)} · {pct(goal.progress ?? goal.progressPercent)}% complete
          </p>
          {goal.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{goal.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove && goal.status === 'Pending Approval' && (
            <Button type="button" size="sm" variant="outline" onClick={onDecision}>
              Review
            </Button>
          )}
          {canApprove && ['Active', 'Completion Review'].includes(goal.status) && (
            <Button type="button" size="sm" variant="outline" onClick={onComment}>
              Comment
            </Button>
          )}
          {canApprove && ['Completion Review', 'Cancellation Requested'].includes(goal.status) && (
            <Button type="button" size="sm" onClick={onCompletion}>
              Decide outcome
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <GoalHistorySection title="Checkpoint evidence">
          {checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} className="rounded-md border border-border px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-1">
                <span>{formatDate(checkpoint.date || checkpoint.dueDate)}</span>
                <span>{checkpoint.state || 'Not updated'}</span>
              </div>
              <p className="mt-1 text-sm">{checkpoint.expectedResult}</p>
              {checkpoint.actualResult && <p className="mt-1 text-muted-foreground">Actual: {checkpoint.actualResult}</p>}
              {checkpoint.evidence && <p className="mt-1 text-muted-foreground">Evidence: {checkpoint.evidence}</p>}
            </div>
          ))}
        </GoalHistorySection>
        <GoalHistorySection title="Progress and comments">
          {updates.map((update) => (
            <div key={update.id} className="rounded-md border border-border px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-1 text-muted-foreground">
                <span>
                  {update.submittedByName || 'Update'}
                  {update.state ? ` · ${update.state}` : ''}
                </span>
                <span>{formatDate(update.submittedAt || update.submitted_at, true)}</span>
              </div>
              {update.actualResult && <p className="mt-1">Actual: {update.actualResult}</p>}
              {update.evidence && <p className="mt-1">Evidence: {update.evidence}</p>}
              {update.comment && <p className="mt-1 text-sm">{update.comment}</p>}
            </div>
          ))}
        </GoalHistorySection>
        <GoalHistorySection title="Decisions">
          {decisions.map((decision) => (
            <div key={decision.id} className="rounded-md border border-border px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-1 text-muted-foreground">
                <span>
                  {decision.actorName || 'Manager'} · {String(decision.type || 'Decision').replaceAll('_', ' ')}
                </span>
                <span>{formatDate(decision.createdAt || decision.created_at, true)}</span>
              </div>
              {decision.note && <p className="mt-1 text-sm">{decision.note}</p>}
            </div>
          ))}
        </GoalHistorySection>
      </div>
    </section>
  );
}

function CoachingWorkspace({ relationship, sessions, selectedSession, onSelectSession, onNewSession, onRespond, onEnd, onCalendar, sessionDraft, setSessionDraft, onSaveContent, onConfirm, onCancelSession, onSaveAction, onPublishAction, onRespondAction, onUpload, onOpenAttachment, busy, currentUserId, users }) {
  const [sessionStage, setSessionStage] = useState('before');
  if (!relationship) return <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">Select a coaching relationship to manage its sessions.</div>;
  const status = relationship.status || 'Pending';
  const sessionContents = selectedSession?.content || selectedSession?.contents || {};
  const sessionActions = asArray(selectedSession?.actions || sessionContents.actions);
  const relationshipActions = sessions
    .flatMap((session) => asArray(session.actions || session.content?.actions))
    .filter((action, index, values) => values.findIndex((candidate) => candidate.id === action.id) === index)
    .filter((action) => !['Done', 'Cancelled'].includes(action.status) || action.sessionId === selectedSession?.id);
  const participantUsers = [users.find((candidate) => candidate.id === currentUserId), users.find((candidate) => candidate.id === relationship.partner?.id)].filter(Boolean);
  const attachments = asArray(selectedSession?.attachments);
  const addenda = asArray(sessionContents.addenda);
  const confirmations = asArray(selectedSession?.confirmations);
  const ownConfirmation = confirmations.some((entry) => (entry.userId || entry.user_id) === currentUserId && entry.confirmedAt);
  const locked = Boolean(selectedSession?.lockedAt || selectedSession?.isLocked || selectedSession?.status === 'Confirmed');
  const calendarStatus = relationship.calendarStatus || relationship.calendar?.status || 'Unavailable';
  const openSession = (session) => {
    if (onSelectSession(session.id) === false) return;
    setSessionDraft(makeSessionDraft(session, relationship.id));
    setSessionStage('before');
  };
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{relationship.partnerName || userName(relationship.partner)}</h2>
              <Badge variant="outline" className={status === 'Active' || status === 'Accepted' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                {status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{cadenceLabel(relationship)} cadence · Both participants have equal control.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {status === 'Pending' && (
              <>
                <Button type="button" size="sm" onClick={() => onRespond(relationship, 'accept')} disabled={busy === `coach-response-${relationship.id}`}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Accept
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onRespond(relationship, 'decline')}>
                  Decline
                </Button>
              </>
            )}
            {(status === 'Active' || status === 'Accepted') && (
              <Button type="button" size="sm" onClick={onNewSession}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Session
              </Button>
            )}
            <Button type="button" size="icon" variant="outline" title="End coaching relationship" onClick={() => onEnd(relationship)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className={syncTone(calendarStatus)}>
            <CalendarDays className="mr-1 h-3 w-3" />
            Outlook: {calendarStatus}
          </Badge>
          {calendarStatus === 'Conflict' && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => onCalendar('outlook')}>
                Keep Outlook schedule
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => onCalendar('fcos')}>
                Replace with FCOS
              </Button>
            </>
          )}
          {['Failed', 'Unavailable', 'Pending'].includes(calendarStatus) && (
            <Button type="button" size="sm" variant="outline" onClick={() => onCalendar('retry')} disabled={busy === 'calendar-retry'}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Retry sync
            </Button>
          )}
        </div>
      </div>
      <div className="grid min-h-[520px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b border-border p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">SESSIONS</div>
          <div className="space-y-1">
            {sessions.map((session) => (
              <button type="button" key={session.id} onClick={() => openSession(session)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm', selectedSession?.id === session.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
                <div className="font-medium">{formatDate(session.scheduledAt || session.scheduled_at, true)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{session.status || 'Scheduled'}</div>
              </button>
            ))}
            {!sessions.length && <p className="px-3 py-6 text-xs text-muted-foreground">No sessions yet.</p>}
          </div>
        </aside>
        <main className="min-w-0 p-4">
          {!selectedSession ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <CalendarClock className="mb-3 h-8 w-8 opacity-30" />
              Select a session to prepare, capture shared notes, and confirm it together.
            </div>
          ) : !selectedSession.contentLoaded ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Loader2 className="mb-3 h-8 w-8 animate-spin opacity-60" />
              Loading the selected session&apos;s private and shared content.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold">{formatDate(selectedSession.scheduledAt || selectedSession.scheduled_at, true)}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSession.durationMinutes || selectedSession.duration_minutes || 45} minutes · {locked ? 'Confirmed and locked' : selectedSession.status === 'Cancelled' ? 'Cancelled' : 'Open for both participants'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {locked ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                      <Lock className="mr-1 h-3 w-3" />
                      Locked
                    </Badge>
                  ) : (
                    selectedSession.status === 'Awaiting Confirmation' && (
                      <Button type="button" size="sm" onClick={onConfirm} disabled={busy === `session-confirm-${selectedSession.id}`}>
                        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
                        {ownConfirmation ? 'Confirmed by you' : 'Confirm session'}
                      </Button>
                    )
                  )}
                  {!locked && selectedSession.status !== 'Cancelled' && (
                    <Button type="button" size="sm" variant="outline" onClick={onCancelSession} disabled={busy === `session-cancel-${selectedSession.id}`}>
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
              <Tabs value={sessionStage} onValueChange={setSessionStage} className="space-y-4">
                <TabsList className="grid h-auto w-full grid-cols-3">
                  <TabsTrigger value="before">Before</TabsTrigger>
                  <TabsTrigger value="during">During</TabsTrigger>
                  <TabsTrigger value="after">After</TabsTrigger>
                </TabsList>
                <TabsContent value="before" className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">
                      <Lock className="mr-1 h-3 w-3" />
                      Private to you
                    </Badge>
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
                      <Users className="mr-1 h-3 w-3" />
                      Agenda shared with both
                    </Badge>
                  </div>
                  <SessionContent title="Agenda" icon={MessageSquareText} description="Add guided prompts or free topics. Each participant keeps authorship of their entries." onSave={() => onSaveContent('agenda')} disabled={locked || selectedSession.status === 'Cancelled'} busy={busy === 'session-content-agenda'}>
                    <AgendaEditor items={sessionDraft.agenda} setItems={(agenda) => setSessionDraft((draft) => ({ ...draft, agenda }))} disabled={locked || selectedSession.status === 'Cancelled'} />
                  </SessionContent>
                  <SessionContent title="Private preparation" icon={Lock} description="Private to you. Your coaching partner cannot see this preparation." onSave={() => onSaveContent('privatePrep')} disabled={locked || selectedSession.status === 'Cancelled'} busy={busy === 'session-content-privatePrep'}>
                    <Textarea
                      rows={4}
                      value={sessionDraft.privatePrep}
                      disabled={locked || selectedSession.status === 'Cancelled'}
                      onChange={(event) =>
                        setSessionDraft((draft) => ({
                          ...draft,
                          privatePrep: event.target.value,
                        }))
                      }
                      placeholder="Wins, challenges, feedback, or support you would like to discuss."
                    />
                  </SessionContent>
                </TabsContent>
                <TabsContent value="during" className="space-y-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
                      <Users className="mr-1 h-3 w-3" />
                      Shared with both participants
                    </Badge>
                    <span>Saving shared content clears prior confirmations.</span>
                  </div>
                  <SessionContent title={locked ? 'Shared discussion correction' : 'Shared discussion'} icon={Users} description={locked ? 'Confirmed notes are locked. Corrections are appended without changing the confirmed record.' : 'Shared notes and decisions are visible to both participants. Editing after a confirmation asks both to confirm again.'} onSave={() => onSaveContent('shared')} disabled={selectedSession.status === 'Cancelled' || (locked && !sessionDraft.addendum.trim())} busy={busy === 'session-content-shared'}>
                    <div className="space-y-3">
                      <Textarea
                        rows={4}
                        value={sessionDraft.sharedNotes}
                        disabled={locked || selectedSession.status === 'Cancelled'}
                        onChange={(event) =>
                          setSessionDraft((draft) => ({
                            ...draft,
                            sharedNotes: event.target.value,
                          }))
                        }
                        placeholder="Discussion notes"
                      />
                      <Textarea
                        rows={3}
                        value={sessionDraft.decisions}
                        disabled={locked || selectedSession.status === 'Cancelled'}
                        onChange={(event) =>
                          setSessionDraft((draft) => ({
                            ...draft,
                            decisions: event.target.value,
                          }))
                        }
                        placeholder="Decisions and commitments"
                      />
                      {locked && (
                        <>
                          {addenda.map((item) => (
                            <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                              <div className="mb-1 text-xs text-muted-foreground">{formatDate(item.createdAt, true)}</div>
                              {item.body}
                            </div>
                          ))}
                          <Textarea
                            rows={2}
                            value={sessionDraft.addendum}
                            onChange={(event) =>
                              setSessionDraft((draft) => ({
                                ...draft,
                                addendum: event.target.value,
                              }))
                            }
                            placeholder="Add an append-only correction"
                          />
                        </>
                      )}
                    </div>
                  </SessionContent>
                </TabsContent>
                <TabsContent value="after" className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    <span>Review commitments, evidence, and the shared record before both participants confirm.</span>
                    {selectedSession.status === 'Awaiting Confirmation' && !locked && (
                      <Button type="button" size="sm" onClick={onConfirm} disabled={busy === `session-confirm-${selectedSession.id}`}>
                        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
                        {ownConfirmation ? 'Confirmed by you' : 'Confirm session'}
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-5 xl:grid-cols-2">
                    <SessionContent title="Private actions" icon={CheckCircle2} description="Actions remain within the coaching relationship unless the owner explicitly publishes one." onSave={null}>
                      <ActionsPanel actions={relationshipActions.length ? relationshipActions : sessionActions} users={participantUsers} currentUserId={currentUserId} onSave={onSaveAction} onPublish={onPublishAction} onRespond={onRespondAction} locked={selectedSession.status === 'Cancelled'} />
                    </SessionContent>
                    <SessionContent title="Attachments" icon={FileText} description="Files are private to the two coaching participants and use short-lived previews." onSave={null}>
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <button type="button" key={attachment.id} className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpenAttachment(attachment)}>
                            <span className="truncate">{attachment.displayName || attachment.fileName || 'Attachment'}</span>
                            <ArrowUpRight className="h-4 w-4 shrink-0" />
                          </button>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={onUpload} disabled={busy === 'attachment' || locked || selectedSession.status === 'Cancelled'} className="gap-1.5">
                          {busy === 'attachment' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          Upload file
                        </Button>
                      </div>
                    </SessionContent>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SessionContent({ icon: Icon, title, description, children, onSave, disabled, busy }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">{title}</h4>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {onSave && (
          <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={disabled || busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function AgendaEditor({ items, setItems, disabled }) {
  const add = (mode) => setItems([...items, { id: crypto.randomUUID(), text: '', mode, authorId: '', canEdit: true }]);
  const update = (id, text) => setItems(items.map((item) => (item.id === id ? { ...item, text } : item)));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };
  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const readOnly = disabled || item.canEdit === false;
        return (
          <div key={item.id} className="flex gap-2">
            <Badge variant="outline" className="h-8 shrink-0 text-[10px]">
              {item.canEdit === false ? 'Partner' : item.mode === 'guided' ? 'Prompt' : 'Topic'}
            </Badge>
            <Input value={item.text} disabled={readOnly} onChange={(event) => update(item.id, event.target.value)} placeholder={item.mode === 'guided' ? 'Wins, challenges, growth, feedback, or support' : 'Agenda topic'} />
            <div className="flex shrink-0">
              <Button type="button" size="icon" variant="ghost" disabled={disabled || index === 0} title="Move agenda item up" onClick={() => move(index, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" disabled={disabled || index === items.length - 1} title="Move agenda item down" onClick={() => move(index, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" disabled={readOnly} title="Remove agenda item" onClick={() => setItems(items.filter((candidate) => candidate.id !== item.id))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => add('guided')}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Guided prompt
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => add('free')}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Free topic
        </Button>
      </div>
    </div>
  );
}

function ActionsPanel({ actions, users, currentUserId, onSave, onPublish, onRespond, locked }) {
  const [draft, setDraft] = useState({
    title: '',
    dueDate: '',
    status: 'To Do',
    ownerId: currentUserId,
  });
  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div key={action.id} className="rounded-md border border-border p-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-medium">{action.title}</span>
              {action.dueDate && <span className="ml-2 text-xs text-muted-foreground">Due {formatDate(action.dueDate)}</span>}
              <div className="mt-1 text-xs text-muted-foreground">
                Owner: {userName(users.find((candidate) => candidate.id === action.ownerId))}
                {action.publishedTask && ` · ${action.publishedTask.key} is authoritative`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {action.acceptanceStatus === 'Pending' && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  Awaiting acceptance
                </Badge>
              )}
              <Badge variant="outline">{action.status || 'To Do'}</Badge>
              {action.canRespond && (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => onRespond(action, 'decline')}>
                    Decline
                  </Button>
                  <Button type="button" size="sm" onClick={() => onRespond(action, 'accept')}>
                    Accept
                  </Button>
                </>
              )}
              {action.canEdit && !locked && (
                <Select value={action.status || 'To Do'} onValueChange={(status) => onSave({ ...action, status, sessionId: action.sessionId })}>
                  <SelectTrigger className="h-8 w-[125px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="To Do">To Do</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Blocked">Blocked</SelectItem>
                    <SelectItem value="Done">Done</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {action.ownerId === currentUserId && action.acceptanceStatus !== 'Pending' && !action.publishedTaskId && (
                <Button type="button" size="sm" variant="outline" onClick={() => onPublish(action)}>
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                  Publish
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
      {!locked && (
        <div className="grid gap-2 rounded-md border border-dashed border-border p-2 sm:grid-cols-[minmax(0,1fr)_150px_170px_auto]">
          <Input value={draft.title} placeholder="Follow-up action" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          <Select value={draft.ownerId || currentUserId} onValueChange={(ownerId) => setDraft((current) => ({ ...current, ownerId }))}>
            <SelectTrigger>
              <SelectValue placeholder="Action owner" />
            </SelectTrigger>
            <SelectContent>
              {users.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.id === currentUserId ? 'Me' : userName(candidate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={draft.dueDate}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              if (!draft.title.trim()) return;
              const result = await onSave(draft);
              if (result)
                setDraft({
                  title: '',
                  dueDate: '',
                  status: 'To Do',
                  ownerId: currentUserId,
                });
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function PlanDialog({ open, onOpenChange, draft, setDraft, onSave, busy }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.id ? 'Edit development plan' : 'New development plan'}</DialogTitle>
          <DialogDescription>Plans provide the time frame for several independently approved goals.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div>
            <Label htmlFor="plan-title">Plan title</Label>
            <Input
              id="plan-title"
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="2026 Commercial Development"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Period</Label>
              <Select value={draft.periodType} onValueChange={(periodType) => setDraft((current) => ({ ...current, periodType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="half_yearly">Half-yearly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="plan-start">Start date</Label>
              <Input
                id="plan-start"
                type="date"
                value={draft.startDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="plan-end">End date</Label>
              <Input
                id="plan-end"
                type="date"
                value={draft.endDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="plan-description">Development focus</Label>
            <Textarea
              id="plan-description"
              rows={4}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="What development outcomes should this plan support?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalDialog({ open, onOpenChange, draft, setDraft, plans, onSave, busy, milestonesWeight, qualityChecks }) {
  const addCheckpoint = () =>
    setDraft((current) => ({
      ...current,
      checkpoints: [
        ...current.checkpoints,
        {
          id: crypto.randomUUID(),
          date: '',
          expectedResult: '',
          actualResult: '',
          evidence: '',
          state: 'On track',
        },
      ],
    }));
  const updateCheckpoint = (id, key, value) =>
    setDraft((current) => ({
      ...current,
      checkpoints: current.checkpoints.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  const updateMetricList = (key, id, field, value) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id ? 'Edit goal' : 'New measurable goal'}</DialogTitle>
          <DialogDescription>Changes to approved targets, dates, measurements, or checkpoints require manager approval again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div>
              <Label>Development plan</Label>
              <Select value={draft.planId || NONE} onValueChange={(planId) => setDraft((current) => ({ ...current, planId }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    .filter((plan) => !plan.closeoutStatus || plan.closeoutStatus === 'Open')
                    .map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline</Label>
              <Input
                type="date"
                value={draft.deadline}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    deadline: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div>
            <Label>Goal title</Label>
            <Input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Improve quarterly gross margin discipline"
            />
          </div>
          <div>
            <Label>Why this matters</Label>
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3">
              <Label>Measurement method</Label>
              <p className="mt-1 text-xs text-muted-foreground">Choose one measurable method for this goal.</p>
            </div>
            <Select value={draft.measureType} onValueChange={(measureType) => setDraft((current) => ({ ...current, measureType }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEASURE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.measureType === 'numeric' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div>
                  <Label>Baseline</Label>
                  <Input
                    type="number"
                    value={draft.baseline}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        baseline: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>Target</Label>
                  <Input
                    type="number"
                    value={draft.target}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        target: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Input
                    value={draft.unit}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        unit: event.target.value,
                      }))
                    }
                    placeholder="% / USD / days"
                  />
                </div>
                <div>
                  <Label>Direction</Label>
                  <Select value={draft.direction} onValueChange={(direction) => setDraft((current) => ({ ...current, direction }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="increase">Increase</SelectItem>
                      <SelectItem value="decrease">Decrease</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {draft.measureType === 'milestones' && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Weighted milestones</Label>
                  <Badge variant="outline" className={milestonesWeight === 100 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                    {milestonesWeight}% of 100%
                  </Badge>
                </div>
                {draft.milestones.map((item) => (
                  <div key={item.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_auto]">
                    <Input value={item.label} placeholder="Milestone" onChange={(event) => updateMetricList('milestones', item.id, 'label', event.target.value)} />
                    <Input type="number" min="0" max="100" value={item.weight} placeholder="Weight" onChange={(event) => updateMetricList('milestones', item.id, 'weight', event.target.value)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Remove milestone"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          milestones: current.milestones.filter((entry) => entry.id !== item.id),
                        }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      milestones: [
                        ...current.milestones,
                        {
                          id: crypto.randomUUID(),
                          label: '',
                          weight: '',
                          progress: 0,
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add milestone
                </Button>
              </div>
            )}
            {draft.measureType === 'outcome' && (
              <div className="mt-3 space-y-2">
                <Label>Evidence-backed outcome rubric</Label>
                {draft.rubric.map((item) => (
                  <div key={item.id} className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                    <Input value={item.label} placeholder="Achievement level" onChange={(event) => updateMetricList('rubric', item.id, 'label', event.target.value)} />
                    <Input value={item.evidence} placeholder="Observable evidence" onChange={(event) => updateMetricList('rubric', item.id, 'evidence', event.target.value)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Remove rubric level"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          rubric: current.rubric.filter((entry) => entry.id !== item.id),
                        }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      rubric: [
                        ...current.rubric,
                        {
                          id: crypto.randomUUID(),
                          label: '',
                          evidence: '',
                          progress: '',
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add level
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <Label>Progress checkpoints</Label>
                <p className="mt-1 text-xs text-muted-foreground">At least one checkpoint is required before the goal deadline.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addCheckpoint}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Checkpoint
              </Button>
            </div>
            <div className="space-y-3">
              {draft.checkpoints.map((checkpoint) => (
                <div key={checkpoint.id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[145px_minmax(0,1fr)_170px_auto]">
                  <Input type="date" value={checkpoint.date} onChange={(event) => updateCheckpoint(checkpoint.id, 'date', event.target.value)} />
                  <Input value={checkpoint.expectedResult} placeholder="Expected result" onChange={(event) => updateCheckpoint(checkpoint.id, 'expectedResult', event.target.value)} />
                  <Select value={checkpoint.state} onValueChange={(state) => updateCheckpoint(checkpoint.id, 'state', state)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="On track">On track</SelectItem>
                      <SelectItem value="At risk">At risk</SelectItem>
                      <SelectItem value="Off track">Off track</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Remove checkpoint"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        checkpoints: current.checkpoints.filter((item) => item.id !== checkpoint.id),
                      }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {!draft.checkpoints.length && <p className="text-sm text-muted-foreground">No checkpoints added yet.</p>}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label>Goal quality check</Label>
              <Badge variant="outline">
                {qualityChecks.filter((check) => check.ok).length}/{qualityChecks.length} ready
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {qualityChecks.map((check) => (
                <div key={check.label} className={cn('flex items-start gap-2 text-xs', check.ok ? 'text-emerald-700' : 'text-amber-800')}>
                  {check.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{check.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalActionDialog({ state, setState, onDecision, onProgress, onCompletion, evidenceOptions, onToggleEvidence, busy }) {
  const goal = state?.goal;
  if (!goal) return null;
  const progress = state.progress || {};
  const measurement = goalMeasurement(goal);
  const measureType = goalMeasureType(goal);
  const milestones = asArray(measurement.milestones);
  const levels = asArray(measurement.levels || measurement.rubric);
  const updateProgress = (key, value) =>
    setState((current) => ({
      ...current,
      progress: { ...current.progress, [key]: value },
    }));
  const updateMilestoneProgress = (id, value) =>
    setState((current) => ({
      ...current,
      progress: {
        ...current.progress,
        milestoneProgress: asArray(current.progress?.milestoneProgress).map((item) => (item.id === id ? { ...item, progress: value } : item)),
      },
    }));

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && setState(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{state.type === 'decision' ? 'Review goal' : state.type === 'progress' ? 'Record progress' : state.type === 'manager_comment' ? 'Manager comment' : goal.permissions?.selfManaged ? 'Record goal outcome' : 'Completion review'}</DialogTitle>
          <DialogDescription>{goal.title}</DialogDescription>
        </DialogHeader>
        {state.type === 'decision' && (
          <div className="space-y-3">
            <Label>Review note</Label>
            <Textarea
              rows={4}
              value={state.note}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              placeholder="Explain approval or the revision requested."
            />
          </div>
        )}
        {state.type === 'progress' && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {measureType === 'numeric' && (
                <div>
                  <Label>Current value</Label>
                  <Input type="number" value={progress.currentValue ?? ''} onChange={(event) => updateProgress('currentValue', event.target.value)} />
                </div>
              )}
              {measureType === 'milestones' && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Milestone progress</Label>
                  {milestones.map((milestone) => {
                    const value = asArray(progress.milestoneProgress).find((item) => item.id === milestone.id)?.progress ?? milestone.progress ?? 0;
                    return (
                      <div key={milestone.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
                        <span className="self-center text-sm">{milestone.label || milestone.title || 'Milestone'}</span>
                        <Input type="number" min="0" max="100" value={value} onChange={(event) => updateMilestoneProgress(milestone.id, event.target.value)} aria-label={`${milestone.label || milestone.title || 'Milestone'} progress`} />
                      </div>
                    );
                  })}
                </div>
              )}
              {measureType === 'outcome' && (
                <div className="sm:col-span-2">
                  <Label>Current outcome level</Label>
                  <Select value={progress.currentLevelId || undefined} onValueChange={(value) => updateProgress('currentLevelId', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose achieved level" />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((level) => (
                        <SelectItem key={level.id} value={level.id}>
                          {level.label || level.level || 'Outcome level'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={measureType === 'numeric' ? '' : 'sm:col-span-2'}>
                <Label>Checkpoint</Label>
                <Select value={progress.checkpointId || NONE} onValueChange={(value) => updateProgress('checkpointId', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose checkpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>General update</SelectItem>
                    {asArray(goal.checkpoints).map((checkpoint) => (
                      <SelectItem key={checkpoint.id} value={checkpoint.id}>
                        {formatDate(checkpoint.date || checkpoint.dueDate)} · {checkpoint.expectedResult || 'Checkpoint'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Actual result</Label>
              <Textarea rows={3} value={progress.actualResult} onChange={(event) => updateProgress('actualResult', event.target.value)} />
            </div>
            <div>
              <Label>Evidence</Label>
              <Textarea rows={3} value={progress.evidence} onChange={(event) => updateProgress('evidence', event.target.value)} />
            </div>
            <div className="rounded-md border border-border p-3">
              <Label>Completed task evidence</Label>
              <p className="mt-1 text-xs text-muted-foreground">These references remain private to authorized goal viewers. The public task does not reveal this goal.</p>
              <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                {evidenceOptions.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 rounded border border-border px-2 py-1.5 text-sm">
                    <Checkbox checked={item.linked} onCheckedChange={() => onToggleEvidence(goal, item)} />
                    <span>
                      <span className="font-medium">{item.key}</span> · {item.title}
                    </span>
                  </label>
                ))}
                {!evidenceOptions.length && <div className="text-xs text-muted-foreground">No completed Projects & Tasks records are available.</div>}
              </div>
            </div>
            <div>
              <Label>Signal</Label>
              <Select value={progress.state || 'On track'} onValueChange={(value) => updateProgress('state', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="On track">On track</SelectItem>
                  <SelectItem value="At risk">At risk</SelectItem>
                  <SelectItem value="Off track">Off track</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {state.type === 'manager_comment' && (
          <div className="space-y-3">
            <Label>Comment for the employee</Label>
            <Textarea rows={4} value={progress.comment || ''} onChange={(event) => updateProgress('comment', event.target.value)} placeholder="Comment on progress, evidence, support, or next steps." />
          </div>
        )}
        {['completion', 'completion_manager'].includes(state.type) && (
          <div className="space-y-3">
            <div>
              <Label>Final evidence{goal.permissions?.selfManaged ? ' (required to complete)' : ''}</Label>
              <Textarea
                rows={4}
                value={state.evidence}
                readOnly={state.type === 'completion_manager'}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    evidence: event.target.value,
                  }))
                }
                placeholder="Describe the final measurable result and evidence."
              />
            </div>
            <div>
              <Label>{state.type === 'completion_manager' ? 'Decision note' : goal.permissions?.selfManaged ? 'Decision note (required when not achieved)' : 'Note or cancellation reason'}</Label>
              <Textarea
                rows={3}
                value={state.note}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {state.type === 'decision' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onDecision('revision')} disabled={busy === `goal-decision-${goal.id}`}>
                Request revision
              </Button>
              <Button type="button" onClick={() => onDecision('approve')} disabled={busy === `goal-decision-${goal.id}`}>
                Approve
              </Button>
            </>
          ) : ['progress', 'manager_comment'].includes(state.type) ? (
            <Button type="button" onClick={onProgress} disabled={busy === `goal-progress-${goal.id}`}>
              {state.type === 'manager_comment' ? 'Save comment' : 'Save progress'}
            </Button>
          ) : state.type === 'completion_manager' ? (
            goal.status === 'Cancellation Requested' ? (
              <Button type="button" onClick={() => onCompletion('cancel')} disabled={busy === `goal-completion-${goal.id}`}>
                Approve cancellation
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onCompletion('not_achieved')} disabled={busy === `goal-completion-${goal.id}`}>
                  Mark not achieved
                </Button>
                <Button type="button" onClick={() => onCompletion('complete')} disabled={busy === `goal-completion-${goal.id}`}>
                  Confirm complete
                </Button>
              </>
            )
          ) : goal.permissions?.selfManaged ? (
            <>
              <Button type="button" variant="outline" onClick={() => onCompletion('not_achieved')} disabled={busy === `goal-completion-${goal.id}`}>
                Mark not achieved
              </Button>
              <Button type="button" onClick={() => onCompletion('complete')} disabled={busy === `goal-completion-${goal.id}`}>
                Complete goal
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onCompletion('request_cancellation')} disabled={busy === `goal-completion-${goal.id}`}>
                Request cancellation
              </Button>
              <Button type="button" onClick={() => onCompletion('request_completion')} disabled={busy === `goal-completion-${goal.id}`}>
                Submit for review
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange, users, inviteeId, setInviteeId, cadence, setCadence, customCadenceDays, setCustomCadenceDays, onInvite, busy }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a coaching partner</DialogTitle>
          <DialogDescription>Coaching is a private, equal relationship. Your colleague must accept before either of you can create sessions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Colleague</Label>
            <Select value={inviteeId} onValueChange={setInviteeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select active FCOS user" />
              </SelectTrigger>
              <SelectContent>
                {users.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {userName(candidate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Suggested cadence</Label>
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cadence === 'custom' && (
              <div className="mt-3">
                <Label>Every how many days?</Label>
                <Input type="number" min="1" max="90" step="1" inputMode="numeric" value={customCadenceDays} onChange={(event) => setCustomCadenceDays(event.target.value)} placeholder="1 to 90" />
                <p className="mt-1 text-xs text-muted-foreground">Use a whole number from 1 to 90 days.</p>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Fortnightly sessions are suggested; both participants can manage the schedule after acceptance.</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onInvite} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionDialog({ open, onOpenChange, draft, setDraft, relationships, sessions, onSave, busy }) {
  const previousSessions = sessions.filter((session) => session.relationshipId === draft.relationshipId && session.id !== draft.id && session.status !== 'Cancelled');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule coaching session</DialogTitle>
          <DialogDescription>FCOS is the schedule authority. Outlook synchronization is requested only after you save.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Relationship</Label>
            <Select
              value={draft.relationshipId || NONE}
              onValueChange={(relationshipId) =>
                setDraft((current) => ({
                  ...current,
                  relationshipId,
                  carryForwardFromSessionId: '',
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select relationship" />
              </SelectTrigger>
              <SelectContent>
                {relationships.map((relationship) => (
                  <SelectItem key={relationship.id} value={relationship.id}>
                    {relationship.partnerName || userName(relationship.partner)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={draft.scheduledAt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    scheduledAt: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Minutes</Label>
              <Input
                type="number"
                min="15"
                max="180"
                step="15"
                value={draft.durationMinutes}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    durationMinutes: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          {!draft.id && previousSessions.length > 0 && (
            <div>
              <Label>Carry forward agenda</Label>
              <Select
                value={draft.carryForwardFromSessionId || NONE}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    carryForwardFromSessionId: value === NONE ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Start with a new agenda</SelectItem>
                  {previousSessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      Carry topics from {formatDate(session.scheduledAt, true)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Open actions remain visible across the relationship and are not duplicated.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MethodologyDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Growth & Coaching Methodology</DialogTitle>
          <DialogDescription>How FCOS separates accountable development from private peer coaching.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="font-semibold">Formal development goals</h3>
            <p className="mt-1 text-muted-foreground">Employees author their own goals. Every goal is measurable, has a deadline and checkpoint, and is approved independently by the primary manager. The active UUID-backed General Manager is the reporting hierarchy root, needs no manager assignment, and activates their own goals without a self-notification. An Advisory Manager may read goals but cannot comment, approve, or complete them. Changes to an approved measurement, deadline, or checkpoint create a new approval revision.</p>
          </section>
          <section>
            <h3 className="font-semibold">Progress and completion</h3>
            <p className="mt-1 text-muted-foreground">Employees submit evidence and on-track signals. Managers comment and decide approval or completion. The General Manager records self-managed completion with final evidence or marks a goal not achieved with a note. Missed checkpoints and deadlines remain visible as overdue, while plans can contain several concurrent goals. Completed Projects & Tasks records may be linked as private goal evidence. Ended plans are explicitly closed or carried forward.</p>
          </section>
          <section>
            <h3 className="font-semibold">Equal-participant coaching</h3>
            <p className="mt-1 text-muted-foreground">Any two active users may coach one another after mutual acceptance. Neither person has seniority. Preparation notes are private; shared notes, decisions, actions, and attachments are visible only to the pair. Both must confirm a completed session before shared notes lock. Corrections are append-only. The session workspace separates preparation, live discussion, and follow-up; unfinished agenda topics may be carried forward. Assigning a coaching action to the other participant creates a proposal they must accept, and a published action is thereafter controlled by Projects & Tasks.</p>
          </section>
          <section>
            <h3 className="font-semibold">Calendar and notifications</h3>
            <p className="mt-1 text-muted-foreground">FCOS owns the schedule and requests a neutral Outlook event. Calendar conflicts never overwrite silently. In-app notifications remain active; email categories can be disabled in Settings. External messages and calendar changes are never triggered automatically by opening this page.</p>
          </section>
          <section>
            <h3 className="font-semibold">Visibility and boundaries</h3>
            <p className="mt-1 text-muted-foreground">Development goals follow the reporting hierarchy. Coaching contents are visible only to the two participants, including no Administrator or General Manager override. This module does not create performance ratings, rankings, compensation decisions, or Salesforce changes.</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
