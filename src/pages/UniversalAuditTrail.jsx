import { Fragment, useEffect, useMemo, useState } from 'react';
import { History, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function shortJson(value) {
  if (!value || !Object.keys(value || {}).length) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sourceTone(source) {
  if (source === 'Admin Control') return 'border-slate-200 bg-slate-50 text-slate-700';
  if (source === 'Reports Archive') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (source === 'Late Payment Interest') return 'border-red-200 bg-red-50 text-red-700';
  if (source === 'Dispute Beta') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (source === 'Internal Daily Report') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-violet-200 bg-violet-50 text-violet-700';
}

export default function UniversalAuditTrail() {
  const [rows, setRows] = useState([]);
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRows = async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('universalAuditTrail', {
      source,
      keyword,
      limit: 500,
    }, {
      cache: true,
      force,
      cacheKey: `universalAuditTrail:${source}:${keyword}`,
    });
    if (response.data?.error) {
      setError(response.data.error);
      setRows([]);
      setSources([]);
    } else {
      setRows(response.data?.rows || []);
      setSources(response.data?.sources || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRows({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownSources = useMemo(() => {
    const base = new Set(sources);
    rows.forEach((row) => base.add(row.source));
    return [...base].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [rows, sources]);

  return (
    <div className="min-h-screen bg-background px-4 py-5 md:px-6">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administrator audit"
        title="Universal Audit Trail"
        description="Review app-level audit events from admin changes, collections, report archive, dispute workflow, internal report runs, and late-payment interest requests."
        meta={`${rows.length.toLocaleString()} events shown · Hong Kong time`}
        actions={(
          <Button onClick={() => loadRows({ force: true })} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        )}
      />

      <TableShell title="Audit Filters" bodyClassName="p-4" className="mb-4">
        <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Source</Label>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All sources</option>
              {shownSources.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Keyword</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Search actor, action, STEM, buyer, file name, or metadata" />
            </div>
          </div>
          <Button variant="outline" onClick={() => loadRows({ force: true })} disabled={loading}>
            Apply
          </Button>
        </div>
      </TableShell>

      {error && (
        <StateBlock
          icon={History}
          title="Unable to load audit trail"
          description={error}
          action={<Button variant="outline" onClick={() => loadRows({ force: true })}>Try Again</Button>}
        />
      )}

      {!error && (
        <TableShell title="Audit Events" meta="Click a row to inspect raw metadata." bodyClassName="p-0">
          {loading ? (
            <StateBlock icon={Loader2} title="Loading audit trail..." description="Reading administrator-only audit sources." />
          ) : rows.length ? (
            <div className="max-h-[72vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Time</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpandedId((current) => current === row.id ? '' : row.id)}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className={sourceTone(row.source)}>{row.source}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{row.action || '—'}</TableCell>
                        <TableCell className="min-w-[180px] text-sm">{row.target || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.actor || '—'}</TableCell>
                        <TableCell className="min-w-[280px] text-sm text-muted-foreground">{row.summary || '—'}</TableCell>
                      </TableRow>
                      {expandedId === row.id && (
                        <TableRow key={`${row.id}:details`}>
                          <TableCell colSpan={6} className="bg-muted/20 p-0">
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 text-xs text-muted-foreground">
                              {shortJson(row.metadata)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <StateBlock title="No audit events found" description="No events match the selected filters." />
          )}
        </TableShell>
      )}
    </div>
  );
}
