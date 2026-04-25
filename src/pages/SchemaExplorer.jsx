import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2, RefreshCw, Search, X, ZoomIn, ZoomOut, Maximize2, ChevronRight } from 'lucide-react';

const CARD_WIDTH = 220;
const CARD_HEADER = 36;
const FIELD_H = 22;
const MAX_FIELDS_SHOWN = 8;
const H_GAP = 80;
const V_GAP = 40;

// Color scheme
const OBJ_COLORS = {
  custom: { bg: '#1e3a5f', border: '#3b82f6', header: '#2563eb', text: '#e2e8f0' },
  standard: { bg: '#1a2e1a', border: '#22c55e', header: '#16a34a', text: '#d1fae5' },
};

function getCardHeight(fieldCount) {
  const shown = Math.min(fieldCount, MAX_FIELDS_SHOWN);
  return CARD_HEADER + shown * FIELD_H + (fieldCount > MAX_FIELDS_SHOWN ? 24 : 8);
}

function layoutObjects(objects) {
  const positions = {};
  const cols = Math.ceil(Math.sqrt(objects.length * 1.5));
  objects.forEach((obj, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions[obj.name] = {
      x: col * (CARD_WIDTH + H_GAP) + 40,
      y: row * (300 + V_GAP) + 40,
    };
  });
  return positions;
}

export default function SchemaExplorer() {
  const [schemaData, setSchemaData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedObj, setSelectedObj] = useState(null);
  const [positions, setPositions] = useState({});
  const [dragging, setDragging] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState(null);
  const [zoom, setZoom] = useState(0.75);
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await base44.functions.invoke('salesforceFullSchema', {});
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setSchemaData(res.data);
      setPositions(layoutObjects(res.data.objects));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredObjects = schemaData?.objects?.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const visibleNames = new Set(filteredObjects.map(o => o.name));
  const visibleEdges = (schemaData?.edges || []).filter(
    e => visibleNames.has(e.from) && visibleNames.has(e.to) && e.from !== e.to
  );

  // Dedup edges to show only one line per object pair
  const dedupedEdges = [];
  const seenPairs = new Set();
  visibleEdges.forEach(e => {
    const key = [e.from, e.to].sort().join('||');
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      dedupedEdges.push(e);
    }
  });

  const highlight = selectedObj
    ? new Set([selectedObj, ...(schemaData?.edges || [])
        .filter(e => e.from === selectedObj || e.to === selectedObj)
        .flatMap(e => [e.from, e.to])])
    : null;

  // Drag card
  const onCardMouseDown = useCallback((e, name) => {
    e.stopPropagation();
    const startX = e.clientX / zoom - positions[name].x;
    const startY = e.clientY / zoom - positions[name].y;
    setDragging({ name, startX, startY });
  }, [positions, zoom]);

  const onMouseMove = useCallback((e) => {
    if (dragging) {
      setPositions(prev => ({
        ...prev,
        [dragging.name]: {
          x: e.clientX / zoom - dragging.startX,
          y: e.clientY / zoom - dragging.startY,
        }
      }));
    } else if (panStart) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [dragging, panStart, zoom]);

  const onMouseUp = useCallback(() => {
    setDragging(null);
    setPanStart(null);
  }, []);

  const onBgMouseDown = useCallback((e) => {
    if (e.target === svgRef.current || e.target.tagName === 'svg') {
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      setSelectedObj(null);
    }
  }, [pan]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.25, z - e.deltaY * 0.001)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', onWheel, { passive: false });
    return () => { if (el) el.removeEventListener('wheel', onWheel); };
  }, [onWheel]);

  const fitToScreen = () => {
    setPan({ x: 0, y: 0 });
    setZoom(0.75);
  };

  const selectedObjData = selectedObj ? schemaData?.objects?.find(o => o.name === selectedObj) : null;

  // Edge path between two cards
  const edgePath = (e) => {
    const from = positions[e.from];
    const to = positions[e.to];
    if (!from || !to) return null;
    const fromObj = schemaData?.objects?.find(o => o.name === e.from);
    const fh = getCardHeight(fromObj?.fields?.length || 0);
    const fx = from.x + CARD_WIDTH / 2;
    const fy = from.y + fh / 2;
    const tx = to.x + CARD_WIDTH / 2;
    const ty = to.y + getCardHeight(schemaData?.objects?.find(o => o.name === e.to)?.fields?.length || 0) / 2;
    const cx = (fx + tx) / 2;
    return `M ${fx} ${fy} C ${cx} ${fy}, ${cx} ${ty}, ${tx} ${ty}`;
  };

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
        <h1 className="text-sm font-semibold text-foreground font-dm">Schema Explorer</h1>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search objects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.min(2, z + 0.1))}><ZoomIn className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.max(0.25, z - 0.1))}><ZoomOut className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToScreen}><Maximize2 className="w-3.5 h-3.5" /></Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-8">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reload
          </Button>
        </div>
      </div>

      {error && (
        <div className="m-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading Salesforce schema…</p>
          <p className="text-xs opacity-60">This may take 15–30 seconds</p>
        </div>
      )}

      {!loading && schemaData && (
        <div className="flex flex-1 overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden bg-slate-950 cursor-grab active:cursor-grabbing">
            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />Custom</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block" />Standard</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">{filteredObjects.length} objects · {dedupedEdges.length} relationships</span>
            </div>

            <svg
              ref={svgRef}
              className="w-full h-full select-none"
              onMouseDown={onBgMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            >
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#475569" />
                </marker>
              </defs>
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Edges */}
                {dedupedEdges.map((e, i) => {
                  const path = edgePath(e);
                  if (!path) return null;
                  const isHighlighted = highlight && (highlight.has(e.from) && highlight.has(e.to));
                  const isDimmed = highlight && !isHighlighted;
                  return (
                    <path
                      key={i}
                      d={path}
                      fill="none"
                      stroke={isHighlighted ? '#3b82f6' : '#334155'}
                      strokeWidth={isHighlighted ? 2 : 1}
                      strokeDasharray={isHighlighted ? '' : '4 3'}
                      opacity={isDimmed ? 0.15 : 0.8}
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })}

                {/* Object cards */}
                {filteredObjects.map(obj => {
                  const pos = positions[obj.name];
                  if (!pos) return null;
                  const colors = obj.custom ? OBJ_COLORS.custom : OBJ_COLORS.standard;
                  const cardH = getCardHeight(obj.fields.length);
                  const isSelected = selectedObj === obj.name;
                  const isDimmed = highlight && !highlight.has(obj.name);
                  const shownFields = obj.fields.slice(0, MAX_FIELDS_SHOWN);

                  return (
                    <g
                      key={obj.name}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onMouseDown={(e) => onCardMouseDown(e, obj.name)}
                      onClick={(e) => { e.stopPropagation(); setSelectedObj(obj.name === selectedObj ? null : obj.name); }}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.2 : 1 }}
                    >
                      {/* Card shadow */}
                      <rect x={3} y={3} width={CARD_WIDTH} height={cardH} rx={8} fill="black" opacity={0.4} />
                      {/* Card body */}
                      <rect width={CARD_WIDTH} height={cardH} rx={8} fill={colors.bg} stroke={isSelected ? '#f59e0b' : colors.border} strokeWidth={isSelected ? 2 : 1} />
                      {/* Header */}
                      <rect width={CARD_WIDTH} height={CARD_HEADER} rx={8} fill={colors.header} />
                      <rect y={CARD_HEADER - 8} width={CARD_WIDTH} height={8} fill={colors.header} />
                      {/* Title */}
                      <text x={10} y={23} fill="white" fontSize={12} fontWeight="600" fontFamily="DM Sans, sans-serif">
                        {obj.label.length > 22 ? obj.label.slice(0, 21) + '…' : obj.label}
                      </text>
                      {obj.custom && (
                        <rect x={CARD_WIDTH - 38} y={10} width={28} height={14} rx={3} fill="rgba(255,255,255,0.15)" />
                      )}
                      {obj.custom && (
                        <text x={CARD_WIDTH - 24} y={21} fill="rgba(255,255,255,0.8)" fontSize={9} textAnchor="middle">custom</text>
                      )}
                      {/* Fields */}
                      {shownFields.map((f, fi) => {
                        const isRef = f.type === 'reference';
                        return (
                          <g key={f.name} transform={`translate(0, ${CARD_HEADER + fi * FIELD_H})`}>
                            <rect width={CARD_WIDTH} height={FIELD_H} fill={fi % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'} />
                            <circle cx={14} cy={FIELD_H / 2} r={3} fill={isRef ? '#f59e0b' : '#64748b'} />
                            <text x={24} y={FIELD_H / 2 + 4} fill={colors.text} fontSize={10} fontFamily="monospace">
                              {f.label.length > 20 ? f.label.slice(0, 19) + '…' : f.label}
                            </text>
                            <text x={CARD_WIDTH - 6} y={FIELD_H / 2 + 4} fill="#64748b" fontSize={9} textAnchor="end">
                              {isRef ? f.referenceTo[0] || f.type : f.type}
                            </text>
                          </g>
                        );
                      })}
                      {obj.fields.length > MAX_FIELDS_SHOWN && (
                        <text x={CARD_WIDTH / 2} y={cardH - 8} fill="#64748b" fontSize={9} textAnchor="middle">
                          +{obj.fields.length - MAX_FIELDS_SHOWN} more fields
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Detail panel */}
          {selectedObjData && (
            <div className="w-72 border-l border-border bg-card overflow-y-auto shrink-0">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{selectedObjData.custom ? 'Custom Object' : 'Standard Object'}</p>
                  <h3 className="text-sm font-semibold text-foreground">{selectedObjData.label}</h3>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{selectedObjData.name}</p>
                </div>
                <button onClick={() => setSelectedObj(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Fields ({selectedObjData.fields.length})
                </p>
                <div className="space-y-0.5">
                  {selectedObjData.fields.map(f => (
                    <div key={f.name} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{f.label}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>
                      </div>
                      <div className="text-right ml-2 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${f.type === 'reference' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>
                          {f.type}
                        </span>
                        {f.type === 'reference' && f.referenceTo[0] && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">→ {f.referenceTo[0]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Related objects */}
                {(() => {
                  const related = (schemaData?.edges || [])
                    .filter(e => e.from === selectedObjData.name || e.to === selectedObjData.name)
                    .map(e => e.from === selectedObjData.name ? e.to : e.from);
                  const unique = [...new Set(related)];
                  if (!unique.length) return null;
                  return (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Related Objects ({unique.length})
                      </p>
                      <div className="space-y-1">
                        {unique.map(name => {
                          const o = schemaData.objects.find(x => x.name === name);
                          return (
                            <button key={name} onClick={() => setSelectedObj(name)}
                              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-xs">
                              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="font-medium text-foreground">{o?.label || name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}