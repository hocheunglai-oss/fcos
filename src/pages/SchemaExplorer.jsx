import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

// Memoized card component to prevent re-renders
const ObjectCard = ({ obj, pos, isSelected, isDimmed, onMouseDown, onClick }) => {
  // eslint-disable-next-line
  const isCustom = obj.custom;
  const shownFields = obj.fields.slice(0, MAX_FIELDS_SHOWN);
  const cardH = getCardHeight(obj.fields.length);

  return (
    <div
      data-card={obj.name}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: CARD_WIDTH,
        height: cardH,
        opacity: isDimmed ? 0.15 : 1,
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: 8,
        border: `${isSelected ? 2 : 1}px solid ${isSelected ? '#f59e0b' : isCustom ? '#3b82f6' : '#22c55e'}`,
        backgroundColor: isCustom ? '#1e3a5f' : '#1a2e1a',
        boxShadow: isSelected ? '0 0 0 2px rgba(245,158,11,0.3)' : '3px 3px 8px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        willChange: 'transform',
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {/* Header */}
      <div style={{
        height: CARD_HEADER,
        backgroundColor: isCustom ? '#2563eb' : '#16a34a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
      }}>
        <span style={{ color: 'white', fontSize: 12, fontWeight: 600, fontFamily: 'DM Sans, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
          {obj.label}
        </span>
        {isCustom && (
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.15)', borderRadius: 3, padding: '1px 5px' }}>
            custom
          </span>
        )}
      </div>
      {/* Fields */}
      {shownFields.map((f, fi) => {
        const isRef = f.type === 'reference';
        return (
          <div key={f.name} style={{
            display: 'flex',
            alignItems: 'center',
            height: FIELD_H,
            padding: '0 8px',
            backgroundColor: fi % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
            gap: 6,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: isRef ? '#f59e0b' : '#64748b', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: isCustom ? '#e2e8f0' : '#d1fae5', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.label}
            </span>
            <span style={{ fontSize: 9, color: '#64748b', flexShrink: 0 }}>
              {isRef ? (f.referenceTo[0] || f.type) : f.type}
            </span>
          </div>
        );
      })}
      {obj.fields.length > MAX_FIELDS_SHOWN && (
        <div style={{ textAlign: 'center', fontSize: 9, color: '#64748b', padding: '4px 0' }}>
          +{obj.fields.length - MAX_FIELDS_SHOWN} more fields
        </div>
      )}
    </div>
  );
};

// Build SVG edges separately (static-ish, only re-renders when positions/edges change)
const EdgesLayer = ({ edges, positions, objects, highlight }) => {
  const objMap = useMemo(() => Object.fromEntries(objects.map(o => [o.name, o])), [objects]);

  const paths = useMemo(() => edges.map((e, i) => {
    const from = positions[e.from];
    const to = positions[e.to];
    if (!from || !to) return null;
    const fh = getCardHeight(objMap[e.from]?.fields?.length || 0);
    const th = getCardHeight(objMap[e.to]?.fields?.length || 0);
    const fx = from.x + CARD_WIDTH / 2;
    const fy = from.y + fh / 2;
    const tx = to.x + CARD_WIDTH / 2;
    const ty = to.y + th / 2;
    const cx = (fx + tx) / 2;
    const isHighlighted = highlight && highlight.has(e.from) && highlight.has(e.to);
    const isDimmed = highlight && !isHighlighted;
    return { i, d: `M ${fx} ${fy} C ${cx} ${fy}, ${cx} ${ty}, ${tx} ${ty}`, isHighlighted, isDimmed };
  }).filter(Boolean), [edges, positions, objMap, highlight]);

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#475569" />
        </marker>
        <marker id="arrow-hi" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
        </marker>
      </defs>
      {paths.map(({ i, d, isHighlighted, isDimmed }) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={isHighlighted ? '#3b82f6' : '#334155'}
          strokeWidth={isHighlighted ? 2 : 1}
          strokeDasharray={isHighlighted ? '' : '4 3'}
          opacity={isDimmed ? 0.1 : 0.7}
          markerEnd={isHighlighted ? 'url(#arrow-hi)' : 'url(#arrow)'}
        />
      ))}
    </svg>
  );
};

export default function SchemaExplorer() {
  const [schemaData, setSchemaData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedObj, setSelectedObj] = useState(null);
  const [positions, setPositions] = useState({});
  const [zoom, setZoom] = useState(0.75);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  // Refs for drag/pan (avoid state updates during mouse move)
  const dragging = useRef(null);
  const panning = useRef(null);
  const posRef = useRef(positions);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  useEffect(() => { posRef.current = positions; }, [positions]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

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

  const filteredObjects = useMemo(() =>
    schemaData?.objects?.filter(o =>
      !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
    ) || [],
    [schemaData, search]
  );

  const visibleNames = useMemo(() => new Set(filteredObjects.map(o => o.name)), [filteredObjects]);

  const dedupedEdges = useMemo(() => {
    const visibleEdges = (schemaData?.edges || []).filter(
      e => visibleNames.has(e.from) && visibleNames.has(e.to) && e.from !== e.to
    );
    const seenPairs = new Set();
    return visibleEdges.filter(e => {
      const key = [e.from, e.to].sort().join('||');
      if (seenPairs.has(key)) return false;
      seenPairs.add(key);
      return true;
    });
  }, [schemaData, visibleNames]);

  const highlight = useMemo(() => selectedObj
    ? new Set([selectedObj, ...(schemaData?.edges || [])
        .filter(e => e.from === selectedObj || e.to === selectedObj)
        .flatMap(e => [e.from, e.to])])
    : null,
    [selectedObj, schemaData]
  );

  const selectedObjData = useMemo(() =>
    selectedObj ? schemaData?.objects?.find(o => o.name === selectedObj) : null,
    [selectedObj, schemaData]
  );

  // Mouse move: directly mutate DOM transform, flush to state only on mouseup
  const onMouseMove = useCallback((e) => {
    if (dragging.current) {
      const { name, startX, startY } = dragging.current;
      const z = zoomRef.current;
      const p = panRef.current;
      const newX = (e.clientX - p.x) / z - startX;
      const newY = (e.clientY - p.y) / z - startY;
      // Directly move the DOM element for zero-lag drag
      const el = canvasRef.current?.querySelector(`[data-card="${name}"]`);
      if (el) { el.style.left = newX + 'px'; el.style.top = newY + 'px'; }
      dragging.current.lastX = newX;
      dragging.current.lastY = newY;
    } else if (panning.current) {
      const newPan = {
        x: e.clientX - panning.current.startX,
        y: e.clientY - panning.current.startY,
      };
      panRef.current = newPan;
      if (canvasRef.current) {
        canvasRef.current.style.transform = `translate(${newPan.x}px, ${newPan.y}px) scale(${zoomRef.current})`;
      }
    }
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragging.current && dragging.current.lastX !== undefined) {
      const { name, lastX, lastY } = dragging.current;
      setPositions(prev => ({ ...prev, [name]: { x: lastX, y: lastY } }));
    }
    if (panning.current) {
      setPan({ ...panRef.current });
    }
    dragging.current = null;
    panning.current = null;
  }, []);

  const onBgMouseDown = useCallback((e) => {
    if (e.target === e.currentTarget) {
      panning.current = { startX: e.clientX - panRef.current.x, startY: e.clientY - panRef.current.y };
      setSelectedObj(null);
    }
  }, []);

  const onCardMouseDown = useCallback((e, name) => {
    e.stopPropagation();
    const z = zoomRef.current;
    const p = panRef.current;
    const pos = posRef.current[name];
    dragging.current = {
      name,
      startX: (e.clientX - p.x) / z - pos.x,
      startY: (e.clientY - p.y) / z - pos.y,
    };
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const newZoom = Math.min(2, Math.max(0.2, zoomRef.current - e.deltaY * 0.001));
    zoomRef.current = newZoom;
    setZoom(newZoom);
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${newZoom})`;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', onWheel, { passive: false });
    return () => { if (el) el.removeEventListener('wheel', onWheel); };
  }, [onWheel]);

  const fitToScreen = () => {
    const newPan = { x: 0, y: 0 };
    const newZoom = 0.75;
    setPan(newPan);
    setZoom(newZoom);
    panRef.current = newPan;
    zoomRef.current = newZoom;
    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(0px, 0px) scale(${newZoom})`;
    }
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { const z = Math.min(2, zoom + 0.1); setZoom(z); zoomRef.current = z; if (canvasRef.current) canvasRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${z})`; }}><ZoomIn className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { const z = Math.max(0.2, zoom - 0.1); setZoom(z); zoomRef.current = z; if (canvasRef.current) canvasRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${z})`; }}><ZoomOut className="w-3.5 h-3.5" /></Button>
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
          <div
            className="flex-1 relative overflow-hidden bg-slate-950"
            style={{ cursor: panning.current ? 'grabbing' : 'grab' }}
            onMouseDown={onBgMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-3 py-2 text-xs pointer-events-none">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />Custom</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block" />Standard</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">{filteredObjects.length} objects · {dedupedEdges.length} relationships</span>
            </div>

            {/* Transformed canvas */}
            <div
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transformOrigin: '0 0',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* SVG edges layer */}
              <EdgesLayer
                edges={dedupedEdges}
                positions={positions}
                objects={schemaData.objects}
                highlight={highlight}
              />

              {/* HTML card layer */}
              {filteredObjects.map(obj => {
                const pos = positions[obj.name];
                if (!pos) return null;
                const isSelected = selectedObj === obj.name;
                const isDimmed = !!(highlight && !highlight.has(obj.name));
                return (
                  <ObjectCard
                    key={obj.name}
                    obj={obj}
                    pos={pos}
                    isSelected={isSelected}
                    isDimmed={isDimmed}
                    onMouseDown={(e) => onCardMouseDown(e, obj.name)}
                    onClick={(e) => { e.stopPropagation(); setSelectedObj(obj.name === selectedObj ? null : obj.name); }}
                  />
                );
              })}


            </div>
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
                        {f.type === 'reference' && f.referenceTo?.[0] && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">→ {f.referenceTo[0]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

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