import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Loader2, Send, Settings2, Trash2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const SUGGESTIONS = [
  'What was the average Singapore delivered price last month for HSFO, VLSFO and LSMGO?',
  'Compare Singapore and Hong Kong VLSFO prices over the past month.',
  'What are the main drivers in our latest market reports?',
  'What does the latest forward curve show for all three products?',
];

const number = (value) => value == null ? 'N/A' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
const product = (key) => ({ hsfo380: 'HSFO 380', vlsfo: 'VLSFO 0.5%', lsmgo: 'LSMGO 0.1%' })[key] || key;
const report = (key) => ({ bunkerwire: 'Bunkerwire', european_marketscan: 'European Marketscan' })[key] || key || 'Market report';
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

// Render a small, safe Markdown subset. Model text never becomes HTML or a URL.
function Answer({ text }) {
  const lines = text.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim().startsWith('|') && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] || '')) {
      const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
      const headers = cells(lines[index]);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(cells(lines[index++]));
      index--;
      blocks.push(<div className="my-3 overflow-x-auto" key={index}><table className="w-full text-left text-xs"><thead><tr>{headers.map((cell, i) => <th className="border-b p-2" key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td className="border-b p-2" key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
    } else if (lines[index].trim()) blocks.push(<p key={index} className="my-1 whitespace-pre-wrap">{inline(lines[index].replace(/^#{1,4}\s/, ''))}</p>);
  }
  return <div className="break-words text-sm leading-6">{blocks}</div>;
}

function Evidence({ source }) {
  const history = source.kind === 'market_history';
  const data = source.data || {};
  const drivers = Array.isArray(data.drivers) ? data.drivers : Object.entries(data.drivers || {}).flatMap(([status, rows]) => rows.map((row) => ({ ...row, status })));
  return <details className="mt-2 rounded-md border border-border bg-background text-xs">
    <summary className="cursor-pointer px-3 py-2 font-medium">[{source.id}] {history ? 'Price evidence' : source.kind === 'market_curves' ? 'Forward curve evidence' : 'Market report evidence'} · {source.startDate ? `${source.startDate} – ${source.endDate}` : source.data?.asOfDate || source.asOfDate}</summary>
    <div className="space-y-3 border-t px-3 py-3">
      {history ? <>
        <p className="text-muted-foreground">{source.data.basis}</p>
        {source.data.series.map((series) => <div key={series.id} className="space-y-1">
          <strong>{series.label} · {series.sourceSymbol || 'No exact series'}</strong>
          <p>{series.source} · {series.basis} · {series.unit}</p>
          <p>Average {number(series.stats.average)} · Low {number(series.stats.low)} · High {number(series.stats.high)} · {series.stats.numericDateCount} publication days</p>
          <p className="text-muted-foreground">Available dates: {series.stats.firstDate || 'None'} – {series.stats.latestDate || 'None'} · Conflicts: {series.stats.conflictDateCount || 0}</p>
          <details><summary className="cursor-pointer text-muted-foreground">Daily prices ({series.suppliedPointCount} of {series.totalPointCount})</summary>
            <div className="mt-1 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th>Date</th><th>Price</th><th>Report page</th></tr></thead><tbody>{series.points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.state === 'numeric' ? number(point.price) : point.state}</td><td>{point.pages?.join(', ') || '—'}</td></tr>)}</tbody></table></div>
          </details>
        </div>)}
      </> : <>
        <p className="text-muted-foreground">{data.fallbackMessage || 'Retrieved from the Market page’s dated evidence.'}</p>
        {source.kind === 'market_curves' ? <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Product / month', 'Mark / unit', 'Report date / source'].map((label) => <th className="border-b p-2" key={label}>{label}</th>)}</tr></thead><tbody>
          {(data.snapshot || []).map((row, index) => <tr key={index}>
            <td className="border-b p-2">{product(row.productKey)}<br />{String(row.contractMonth || '').slice(0, 7)} · {row.tenor}</td>
            <td className="border-b p-2">{number(row.value)} {row.unit}<br />{row.qualityStatus === 'authorized_fallback' ? 'Approved fallback estimate' : 'Published assessment'}</td>
            <td className="border-b p-2">{row.reportDate}<br />{row.sourceSymbol || 'Fallback'}{row.sourcePage ? ` · p. ${row.sourcePage}` : ''}</td>
          </tr>)}
        </tbody></table>{!data.snapshot?.length && <p>No forward marks were available for this date.</p>}
        <p className="mt-2 text-muted-foreground">Forward marks and settlement projections are not guaranteed future prices.</p></div> : <>
          {data.reportCompleteness && <p>{data.reportCompleteness.completeReports} of {data.reportCompleteness.requiredReports} required reports available</p>}
          {[...drivers, ...(data.risks || [])].map((row, index) => <div key={index}><strong>{row.title}</strong>{row.status && <span className="capitalize text-muted-foreground"> · {row.status}</span>}<p>{row.summary}</p></div>)}
          {(data.sourceRefs || []).map((row, index) => <p key={index} className="text-muted-foreground">{report(row.documentType)} · {row.reportDate}{row.page || row.sourcePage ? ` · p. ${row.page || row.sourcePage}` : ''}</p>)}
        </>}
        {[...(data.warnings || []), ...(data.availabilityNotes || [])].map((warning, index) => <p key={index} className="text-amber-700 dark:text-amber-300">{warning}</p>)}
      </>}
    </div>
  </details>;
}

export default function MarketAssistant() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const endRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => () => pendingRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSettingsError('');
    appClient.functions.invoke('marketAssistantSettingsGet', {}, { cache: false, force: true }).then(({ data }) => {
      if (data?.error) throw new Error(data.error);
      if (active) setSettings(data);
    }).catch((e) => { if (active) setSettingsError(e.message || 'Could not check the Market Assistant connection.'); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy, open]);

  const ask = async (question = draft) => {
    const content = question.trim();
    if (!content || content.length > 2000 || pendingRef.current || !settings?.apiConfigured) return;
    const previous = messages;
    const next = [...previous, { role: 'user', content }];
    const controller = new AbortController();
    pendingRef.current = controller;
    setMessages(next);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const { data } = await appClient.functions.invoke('marketAssistant', { messages: next.slice(-12).map(({ role, content: text }) => ({ role, content: text.slice(0, 6000) })) }, { cache: false, signal: controller.signal });
      if (data?.error) throw new Error(data.error);
      if (!data?.reply) throw new Error('The Market Assistant returned no answer.');
      setMessages([...next, { role: 'assistant', content: data.reply, sources: data.sources || [], model: data.model }]);
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessages(previous);
        setDraft(content);
        setError(e.message || 'The Market Assistant could not answer. Please try again.');
      }
    } finally { pendingRef.current = null; setBusy(false); }
  };
  const ready = settings?.apiConfigured === true && settings.modelSupported !== false && !settingsError;
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="outline" className="gap-2"><Bot className="h-4 w-4" />Ask market data</Button></SheetTrigger>
    <SheetContent className="flex h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-2xl">
      <SheetHeader className="border-b p-5 pr-12 text-left">
        <SheetTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Market Assistant</SheetTitle>
        <SheetDescription>Ask about delivered-market prices, MOPS, forward curves and our licensed reports.</SheetDescription>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{settings?.models?.find((model) => model.id === settings.modelId)?.label || 'OpenAI'} · Source-backed answers</span>
          {settings?.canManage && <Link to="/settings?section=ai" className="inline-flex items-center gap-1 underline"><Settings2 className="h-3 w-3" />Model settings</Link>}
          {messages.length > 0 && <button type="button" disabled={busy} className="inline-flex items-center gap-1 disabled:opacity-50" onClick={() => { setMessages([]); setError(''); }}><Trash2 className="h-3 w-3" />New chat</button>}
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" role="log" aria-label="Market conversation" aria-live="polite">
        {!messages.length && <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose a question or ask your own. Include a port, product and period when comparing prices.</p>
          <div className="grid gap-2">{SUGGESTIONS.map((question) => <button className="rounded-lg border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-50" key={question} disabled={!ready || busy} onClick={() => ask(question)}>{question}</button>)}</div>
          <p className="text-xs leading-5 text-muted-foreground">Delivered-market assessments differ from FCOS executed selling prices. The assistant shows which source and averaging basis it used.</p>
        </div>}
        {messages.map((message, index) => <article key={index} className={`mb-5 rounded-lg p-4 ${message.role === 'user' ? 'ml-6 bg-muted' : 'border border-border bg-card'}`}>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">{message.role === 'user' ? 'You' : 'Market Assistant'}</div>
          {message.role === 'user' ? <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p> : <Answer text={message.content} />}
          {message.sources?.map((source) => <Evidence key={source.id} source={source} />)}
          {message.model && <p className="mt-3 text-[10px] text-muted-foreground">{message.model}</p>}
        </article>)}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Looking up market evidence…</p>}
        <div ref={endRef} />
      </div>
      <form className="space-y-2 border-t bg-background p-4" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        {(error || settingsError) && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error || settingsError}</p>}
        {settings && !settings.apiConfigured && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">The OpenAI connection is pending. Ask an administrator to complete setup in Settings → AI Models.</p>}
        {settings?.modelSupported === false && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Ask an administrator to select a supported model in Settings → AI Models.</p>}
        {!settings && !settingsError && <p role="status" className="text-xs text-muted-foreground">Checking the OpenAI connection…</p>}
        <label className="sr-only" htmlFor="market-assistant-question">Ask a market question</label>
        <Textarea id="market-assistant-question" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} disabled={busy || !ready}
          placeholder="Ask about a product, port or market trend…" className="min-h-20 max-h-40 resize-none"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} />
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span><Button type="submit" disabled={busy || !ready || !draft.trim()} className="gap-2"><Send className="h-4 w-4" />Ask</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
