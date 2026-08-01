import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, GitBranch, Loader2, RefreshCw, RotateCcw, Save, Users } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const NONE = '__none__';

function errorText(response, fallback = 'The reporting-line request could not be completed.') {
  return response?.data?.error || response?.error || fallback;
}

function userName(user) {
  if (!user) return 'Unassigned';
  return user.fullName || user.full_name || user.name || user.email || 'Unnamed user';
}

function normalizedPayload(data) {
  return data?.reportingLines || data?.lines || data?.assignments || [];
}

function lineUserId(line) {
  return line.userId || line.employeeId || line.user_id;
}

function lineDraft(line, { clearReportingRoot = false } = {}) {
  return {
    primaryManagerId: clearReportingRoot && line.isGeneralManager ? NONE : line.primaryManagerId || line.primary_manager_id || NONE,
    secondaryManagerId: clearReportingRoot && line.isGeneralManager ? NONE : line.secondaryManagerId || line.secondary_manager_id || NONE,
    expectedRevision: Number(line.revision || 0),
  };
}

function draftsForLines(lines) {
  return Object.fromEntries(lines.map((line) => [lineUserId(line), lineDraft(line, { clearReportingRoot: true })]).filter(([userId]) => Boolean(userId)));
}

/**
 * Service-backed Admin Control panel. The API deliberately owns hierarchy and
 * revision validation; this component only presents the latest server state.
 */
export default function ReportingLinesPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState({});
  const [drafts, setDrafts] = useState({});

  const users = useMemo(() => data?.users || data?.activeUsers || [], [data]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const lines = useMemo(() => normalizedPayload(data), [data]);
  const issues = useMemo(() => data?.issues || data?.validationIssues || [], [data]);
  const gaps = useMemo(() => data?.setupGaps || data?.gaps || lines.filter((line) => line.managerAssignmentRequired !== false && !line.primaryManagerId && !line.primary_manager_id), [data, lines]);
  const changedLines = useMemo(() => lines.filter((line) => {
    const userId = lineUserId(line);
    const draft = drafts[userId];
    const saved = lineDraft(line);
    return Boolean(draft) && (
      draft.primaryManagerId !== saved.primaryManagerId
      || draft.secondaryManagerId !== saved.secondaryManagerId
    );
  }), [drafts, lines]);
  const changedIds = useMemo(() => new Set(changedLines.map(lineUserId)), [changedLines]);
  const hasChanges = changedLines.length > 0;
  const hasInvalidChanges = changedLines.some((line) => {
    if (line.isGeneralManager) return false;
    const userId = lineUserId(line);
    const draft = drafts[userId];
    return !draft
      || draft.primaryManagerId === userId
      || draft.secondaryManagerId === userId
      || (draft.primaryManagerId !== NONE && draft.primaryManagerId === draft.secondaryManagerId);
  });

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('growthReportingLinesList', {}, { force: true });
    if (response.data?.error) {
      setError(errorText(response));
    } else {
      const next = response.data || {};
      setData(next);
      setDrafts(draftsForLines(normalizedPayload(next)));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateDraft = (userId, key, value) => {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...(current[userId] || {}), [key]: value },
    }));
  };

  const discardChanges = () => {
    setDrafts(draftsForLines(lines));
  };

  const saveChanges = async () => {
    if (!hasChanges || hasInvalidChanges) return;
    setSaving(true);
    const changes = changedLines.map((line) => {
      const userId = lineUserId(line);
      const draft = drafts[userId];
      return {
        userId,
        primaryManagerId: draft.primaryManagerId === NONE ? null : draft.primaryManagerId,
        secondaryManagerId: draft.secondaryManagerId === NONE ? null : draft.secondaryManagerId,
        expectedRevision: draft.expectedRevision,
      };
    });
    const response = await appClient.functions.invoke('growthReportingLinesSaveBatch', {
      changes,
    }, { force: true });
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Reporting lines were not saved', description: errorText(response) });
    } else {
      toast({ title: 'Reporting lines saved', description: `${changes.length} ${changes.length === 1 ? 'assignment is' : 'assignments are'} now current.` });
      await load({ background: true });
    }
    setSaving(false);
  };

  if (loading) return <StateBlock icon={Loader2} title="Loading reporting lines" description="Checking the current management hierarchy." />;
  if (error) return <StateBlock icon={AlertCircle} title="Reporting lines unavailable" description={error} action={<Button variant="outline" onClick={() => load()}>Try again</Button>} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Reporting Lines</h2>
          <p className="mt-1 text-sm text-muted-foreground">Primary managers approve development goals. Advisory Managers have read-only visibility. The active General Manager is the reporting root and needs neither assignment.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {hasChanges && (
            <>
              <Button type="button" variant="outline" onClick={discardChanges} disabled={saving} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Discard
              </Button>
              <Button type="button" onClick={saveChanges} disabled={saving || hasInvalidChanges} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes ({changedLines.length})
              </Button>
            </>
          )}
          <Button type="button" variant="outline" onClick={() => load({ background: true })} disabled={refreshing || saving || hasChanges} title={hasChanges ? 'Save or discard changes before refreshing.' : 'Refresh reporting lines'} className="gap-2">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Hierarchy validation needs attention</AlertTitle>
          <AlertDescription>{issues.map((issue) => typeof issue === 'string' ? issue : issue.message || issue.label).filter(Boolean).join(' ')}</AlertDescription>
        </Alert>
      )}

      {gaps.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <Users className="h-4 w-4" />
          <AlertTitle>Initial setup queue: {gaps.length}</AlertTitle>
          <AlertDescription>These active users have no primary manager. They may draft development goals but cannot submit them for approval.</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="min-w-[190px]">Primary manager</TableHead>
              <TableHead className="min-w-[190px]">Advisory Manager</TableHead>
              <TableHead>Hierarchy</TableHead>
              <TableHead className="w-[130px]">Revision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const userId = lineUserId(line);
              const employee = line.user || line.employee || usersById.get(userId) || { id: userId, fullName: line.userName || line.employeeName };
              const draft = drafts[userId] || lineDraft(line);
              const isGeneralManager = line.isGeneralManager === true;
              const optionUsers = users.filter((user) => user.id !== userId && user.active !== false);
              const invalid = draft.primaryManagerId !== NONE && draft.primaryManagerId === draft.secondaryManagerId;
              return (
                <TableRow key={userId} className={changedIds.has(userId) ? 'bg-blue-50/60' : undefined}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{userName(employee)}</div>
                      {isGeneralManager && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">General Manager · Reporting root</Badge>}
                    </div>
                    {employee.email && <div className="text-xs text-muted-foreground">{employee.email}</div>}
                  </TableCell>
                  <TableCell>
                    {isGeneralManager ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Not required</div>
                    ) : (
                      <Select value={draft.primaryManagerId || NONE} onValueChange={(value) => updateDraft(userId, 'primaryManagerId', value)} disabled={saving}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="No primary manager" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>No primary manager</SelectItem>{optionUsers.map((user) => <SelectItem key={user.id} value={user.id}>{userName(user)}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {isGeneralManager ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Not required</div>
                    ) : (
                      <>
                        <Select value={draft.secondaryManagerId || NONE} onValueChange={(value) => updateDraft(userId, 'secondaryManagerId', value)} disabled={saving}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="No Advisory Manager" /></SelectTrigger>
                          <SelectContent><SelectItem value={NONE}>No Advisory Manager</SelectItem>{optionUsers.map((user) => <SelectItem key={user.id} value={user.id}>{userName(user)}</SelectItem>)}</SelectContent>
                        </Select>
                        {invalid && <p className="mt-1 text-xs text-destructive">Choose two different managers.</p>}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {isGeneralManager ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Reporting root</Badge> : line.valid === false || line.hierarchyValid === false ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Invalid</Badge> : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Valid</Badge>}
                    {(line.path || line.hierarchyPath) && <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><GitBranch className="h-3 w-3" />{line.path || line.hierarchyPath}</div>}
                  </TableCell>
                  <TableCell><div className="flex items-center gap-2"><span className="font-mono text-xs">{draft.expectedRevision}</span>{changedIds.has(userId) && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Unsaved</Badge>}</div></TableCell>
                </TableRow>
              );
            })}
            {!lines.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No active users are available for reporting-line setup.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground"><Label className="text-xs font-medium text-foreground">Revision protection</Label><p className="mt-1">Save changes validates every edited row and the resulting hierarchy together. The UUID-backed General Manager remains the manager-free reporting root and can still be selected as a manager for other employees. A concurrent change or reporting cycle rejects the entire batch.</p></div>
    </div>
  );
}
