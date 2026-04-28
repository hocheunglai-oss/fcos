import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calculator } from 'lucide-react';

const AGGREGATE_FNS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'COUNT_DISTINCT'];

// ── Formula autocomplete input ────────────────────────────────────────────────
// Detects the token being typed (fn name or field name inside parens) and shows suggestions
function FormulaInput({ value, onChange, fields }) {
  const [suggestions, setSuggestions] = useState([]);
  const [tokenStart, setTokenStart] = useState(0);
  const [dropStyle, setDropStyle] = useState({});
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  const fieldNames = fields.map(f => f.name);
  const fieldByName = Object.fromEntries(fields.map(f => [f.name, f]));

  // Parse what the user is currently typing at cursor
  const getActiveToken = (text, cursor) => {
    // Walk back from cursor to find start of current word
    let start = cursor;
    while (start > 0 && /[\w]/.test(text[start - 1])) start--;
    const token = text.slice(start, cursor);

    // Are we inside a function call? Look for unclosed '('
    const before = text.slice(0, start);
    const parenMatch = before.match(/([A-Z_]+)\($/i);
    const insideFn = !!parenMatch;

    return { token, start, insideFn };
  };

  const computeSuggestions = (text, cursor) => {
    const { token, start, insideFn } = getActiveToken(text, cursor);
    setTokenStart(start);

    if (!token) { setSuggestions([]); return; }

    const q = token.toUpperCase();
    if (insideFn) {
      // Suggest field names
      const matches = fieldNames
        .filter(n => n.toUpperCase().includes(q))
        .slice(0, 12)
        .map(n => ({ value: n, label: `${n}  ${fieldByName[n]?.label ? '— ' + fieldByName[n].label : ''}`, isField: true }));
      setSuggestions(matches);
    } else {
      // Suggest function names
      const fnMatches = AGGREGATE_FNS.filter(fn => fn.startsWith(q)).map(fn => ({ value: fn + '(', label: fn + '(…)', isFn: true }));
      // Also suggest bare field names
      const fieldMatches = fieldNames.filter(n => n.toUpperCase().startsWith(q)).slice(0, 8).map(n => ({ value: n, label: n, isField: true }));
      setSuggestions([...fnMatches, ...fieldMatches].slice(0, 12));
    }
  };

  const positionDropdown = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width, zIndex: 9999 });
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    computeSuggestions(e.target.value, e.target.selectionStart);
    positionDropdown();
  };

  const handleKeyDown = (e) => {
    if (suggestions.length === 0) return;
    if (e.key === 'Escape') { setSuggestions([]); }
  };

  const applySuggestion = (suggestion) => {
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(cursor);
    const inserted = suggestion.value;
    const newVal = before + inserted + after;
    onChange(newVal);
    setSuggestions([]);
    // Move cursor after inserted text
    setTimeout(() => {
      if (inputRef.current) {
        const pos = tokenStart + inserted.length;
        inputRef.current.setSelectionRange(pos, pos);
        inputRef.current.focus();
      }
    }, 0);
  };

  // Close on outside click
  useEffect(() => {
    if (suggestions.length === 0) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [suggestions.length]);

  return (
    <div className="flex-1 relative">
      <input
        ref={inputRef}
        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="e.g. SUM(Total_Invoice_Amount__c) - SUM(Costs_Total__c)"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={e => { computeSuggestions(value, e.target.selectionStart); positionDropdown(); }}
        autoComplete="off"
        spellCheck={false}
      />
      {suggestions.length > 0 && createPortal(
        <div ref={dropRef} style={dropStyle} className="bg-popover border border-border rounded-md shadow-xl overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => { e.preventDefault(); applySuggestion(s); }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors flex items-center gap-2"
            >
              {s.isFn && <span className="text-[9px] px-1 rounded bg-primary/10 text-primary font-bold uppercase">fn</span>}
              {s.isField && <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground font-bold uppercase">field</span>}
              {s.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// A calculated field is either:
// - An aggregate: SUM(Amount__c) → aliased
// - A formula expression shown as a computed column client-side
export default function CalculatedFields({ calcFields, onChange, fields }) {
  const numericFields = fields.filter(f =>
    ['double', 'currency', 'integer', 'percent'].includes(f.type)
  );

  const add = (type = 'aggregate') => {
    onChange([
      ...calcFields,
      type === 'aggregate'
        ? { id: Date.now(), label: '', type: 'aggregate', fn: 'SUM', field: numericFields[0]?.name || '' }
        : { id: Date.now(), label: '', type: 'formula', expr: '' }
    ]);
  };

  const update = (id, patch) => onChange(calcFields.map(c => c.id === id ? { ...c, ...patch } : c));
  const remove = (id) => onChange(calcFields.filter(c => c.id !== id));

  return (
    <div className="space-y-2">
      {calcFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calculated fields. Add aggregates like SUM, AVG, COUNT.</p>
      ) : (
        calcFields.map(cf => (
          <div key={cf.id} className="flex items-center gap-2 flex-wrap">
            {cf.type === 'aggregate' ? (
              <>
                {/* Function */}
                <Select value={cf.fn} onValueChange={v => update(cf.id, { fn: v })}>
                  <SelectTrigger className="w-32 h-8 text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGGREGATE_FNS.map(fn => (
                      <SelectItem key={fn} value={fn} className="text-xs font-mono">{fn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-muted-foreground text-sm">(</span>

                {/* Field */}
                <Select value={cf.field} onValueChange={v => update(cf.id, { field: v })}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue placeholder="Field…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {(cf.fn === 'COUNT' || cf.fn === 'COUNT_DISTINCT'
                      ? fields
                      : numericFields
                    ).map(f => (
                      <SelectItem key={f.name} value={f.name} className="text-xs">{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-muted-foreground text-sm">)</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground text-xs font-semibold shrink-0">Formula:</span>
                <FormulaInput
                  value={cf.expr}
                  onChange={v => update(cf.id, { expr: v })}
                  fields={fields}
                />
              </>
            )}

            <span className="text-muted-foreground text-xs">as</span>

            {/* Alias label */}
            <Input
              className="w-32 h-8 text-xs"
              placeholder="label"
              value={cf.label}
              onChange={e => update(cf.id, { label: e.target.value })}
            />

            <button onClick={() => remove(cf.id)} className="text-muted-foreground hover:text-destructive p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}

      <div className="flex gap-1 mt-2">
        <Button size="sm" variant="ghost" onClick={() => add('aggregate')} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Aggregate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => add('formula')} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Formula
        </Button>
      </div>

      {calcFields.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
          <Calculator className="w-3 h-3" />
          Aggregates require GROUP BY. Formulas: use SUM(FieldName), AVG(FieldName), etc. in expressions.
        </p>
      )}
    </div>
  );
}