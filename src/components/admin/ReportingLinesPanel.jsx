import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, GitBranch, Loader2, RefreshCw, Save, Users } from 'lucide-react';
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

/**
 * Service-backed Admin Control panel. The API deliberately owns hierarchy and
 * revision validation; this component only presents the latest server state.
 */
export default function ReportingLinesPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [data, setData] = useState({});
  const [drafts, setDrafts] = useState({});

  const users = useMemo(() => data?.users || data?.activeUsers || [], [data]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const lines = useMemo(() => normalizedPayload(data), [data]);
  const issues = useMemo(() => data?.issues || data?.validationIssues || [], [data]);
  const gaps = useMemo(() => data?.setupGaps || data?.gaps || lines.filter((line) => !line.primaryManagerId && !line.primary_manager_id), [data, lines]);

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
      const nextDrafts = {};
      normalizedPayload(next).forEach((line) => {
        const id = line.userId || line.employeeId || line.user_id;
        if (!id) return;
        nextDrafts[id] = {
          primaryManagerId: line.primaryManagerId || line.primary_manager_id || NONE,
          secondaryManagerId: line.secondaryManagerId || line.secondary_manager_id || NONE,
          expectedRevision: Number(line.revision || 0),
        };
      });
      setDrafts(nextDrafts);
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

  const saveLine = async (line) => {
    const userId = line.userId || line.employeeId || line.user_id;
    const draft = drafts[userId];
    if (!userId || !draft) return;
    if (draft.primaryManagerId === userId || draft.secondaryManagerId === userId) {
      toast({ variant: 'destructive', title: 'A user cannot manage themselves.' });
      return;
    }
    if (draft.primaryManagerId !== NONE && draft.primaryManagerId === draft.secondaryManagerId) {
      toast({ variant: 'destructive', title: 'Primary and secondary managers must be different.' });
      return;
    }
    setSavingId(userId);
    const response = await appClient.functions.invoke('growthReportingLineSave', {
      userId,
      primaryManagerId: draft.primaryManagerId === NONE ? null : draft.primaryManagerId,
      secondaryManagerId: draft.secondaryManagerId === NONE ? null : draft.secondaryManagerId,
      expectedRevision: draft.expectedRevision,
    }, { force: true });
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Reporting line was not saved', description: errorText(response) });
      if (response.data?.current) await load({ background: true });
    } else {
      toast({ title: 'Reporting line saved', description: `${userName(usersById.get(userId))} has the current manager assignment.` });
      await load({ background: true });
    }
    setSavingId(null);
  };

  if (loading) return <StateBlock icon={Loader2} title="Loading reporting lines" description="Checking the current management hierarchy." />;
  if (error) return <StateBlock icon={AlertCircle} title="Reporting lines unavailable" description={error} action={<Button variant="outline" onClick={() => load()}>Try again</Button>} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Reporting Lines</h2>
          <p className="mt-1 text-sm text-muted-foreground">Primary managers approve development goals. Secondary managers can read goals but cannot approve them.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => load({ background: true })} disabled={refreshing} className="gap-2 self-start sm:self-auto">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
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
              <TableHead className="min-w-[190px]">Secondary manager</TableHead>
              <TableHead>Hierarchy</TableHead>
              <TableHead className="w-[100px]">Revision</TableHead>
              <TableHead className="w-[92px] text-right">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const userId = line.userId || line.employeeId || line.user_id;
              const employee = line.user || line.employee || usersById.get(userId) || { id: userId, fullName: line.userName || line.employeeName };
              const draft = drafts[userId] || { primaryManagerId: NONE, secondaryManagerId: NONE, expectedRevision: Number(line.revision || 0) };
              const optionUsers = users.filter((user) => user.id !== userId && user.active !== false);
              const invalid = draft.primaryManagerId !== NONE && draft.primaryManagerId === draft.secondaryManagerId;
              return (
                <TableRow key={userId}>
                  <TableCell>
                    <div className="font-medium">{userName(employee)}</div>
                    {employee.email && <div className="text-xs text-muted-foreground">{employee.email}</div>}
                  </TableCell>
                  <TableCell>
                    <Select value={draft.primaryManagerId || NONE} onValueChange={(value) => updateDraft(userId, 'primaryManagerId', value)} disabled={savingId === userId}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="No primary manager" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>No primary manager</SelectItem>{optionUsers.map((user) => <SelectItem key={user.id} value={user.id}>{userName(user)}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={draft.secondaryManagerId || NONE} onValueChange={(value) => updateDraft(userId, 'secondaryManagerId', value)} disabled={savingId === userId}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="No secondary manager" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>No secondary manager</SelectItem>{optionUsers.map((user) => <SelectItem key={user.id} value={user.id}>{userName(user)}</SelectItem>)}</SelectContent>
                    </Select>
                    {invalid && <p className="mt-1 text-xs text-destructive">Choose two different managers.</p>}
                  </TableCell>
                  <TableCell>
                    {line.valid === false || line.hierarchyValid === false ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Invalid</Badge> : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Valid</Badge>}
                    {(line.path || line.hierarchyPath) && <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><GitBranch className="h-3 w-3" />{line.path || line.hierarchyPath}</div>}
                  </TableCell>
                  <TableCell><span className="font-mono text-xs">{draft.expectedRevision}</span></TableCell>
                  <TableCell className="text-right"><Button type="button" size="icon" variant="outline" title="Save reporting line" onClick={() => saveLine(line)} disabled={savingId === userId || invalid}>{savingId === userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</Button></TableCell>
                </TableRow>
              );
            })}
            {!lines.length && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No active users are available for reporting-line setup.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground"><Label className="text-xs font-medium text-foreground">Revision protection</Label><p className="mt-1">Each save sends the row&apos;s expected revision. A concurrent hierarchy change is rejected by the server and the latest hierarchy is reloaded.</p></div>
    </div>
  );
}
