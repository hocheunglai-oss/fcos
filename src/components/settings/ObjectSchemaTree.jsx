import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ChevronRight, ChevronDown, Loader2, Check, Minus } from 'lucide-react';

/**
 * allowedMap shape:
 * {
 *   "ObjectName": true | false | {
 *     fields: { "FieldName": true | false },
 *     children: {
 *       "ChildRelName": true | false | {
 *         fields: { "FieldName": true|false },
 *         children: { ... }   // grandchildren, etc.
 *       }
 *     }
 *   }
 * }
 *
 * true  = fully allowed
 * false = fully blocked
 * object = partially configured (granular)
 */

function getNodeState(node) {
  if (node === true) return 'all';
  if (node === false) return 'none';
  return 'partial';
}

// ── Checkbox UI ──────────────────────────────────────────────────────────────
function Checkbox({ state, onClick }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
        state === 'all' ? 'bg-primary border-primary' :
        state === 'partial' ? 'bg-primary/30 border-primary' :
        'border-border bg-background'
      }`}
    >
      {state === 'all' && <Check className="w-2.5 h-2.5 text-white" />}
      {state === 'partial' && <Minus className="w-2.5 h-2.5 text-primary" />}
    </button>
  );
}

// ── Field row ────────────────────────────────────────────────────────────────
function FieldRow({ fieldMeta, allowed, onToggle, depth = 0 }) {
  const state = allowed === true ? 'all' : allowed === false ? 'none' : 'none';
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors"
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
    >
      <Checkbox state={state} onClick={onToggle} />
      <span className="text-xs text-foreground flex-1">{fieldMeta.label}</span>
      <span className="text-[10px] text-muted-foreground/50">{fieldMeta.type}</span>
    </div>
  );
}

// ── Generic tree node (object or child relationship) ─────────────────────────
function SchemaNode({ objectName, label, nodeValue, onChange, depth = 0, isChild = false }) {
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState(null); // { fields, childRelationships }
  const [loading, setLoading] = useState(false);

  const state = getNodeState(nodeValue);

  const loadMeta = () => {
    if (meta || loading) return;
    setLoading(true);
    base44.functions.invoke('salesforceObjectFields', { objectName }).then(res => {
      setMeta({
        fields: (res.data?.fields || []).filter(f => !['IsDeleted', 'SystemModstamp', 'attributes'].includes(f.name)),
        childRelationships: res.data?.childRelationships || [],
      });
      setLoading(false);
    });
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadMeta();
  };

  // Toggle node between true/false/partial→true
  const toggleNode = () => {
    if (state === 'none') onChange(true);
    else onChange(false);
  };

  // Update a field's allowed status
  const setField = (fieldName, allowed) => {
    const current = typeof nodeValue === 'object' && nodeValue !== null ? nodeValue : {};
    const fields = { ...(current.fields || {}) };
    fields[fieldName] = allowed;
    // If all fields allowed → simplify back to true? We keep granular for clarity.
    onChange({ ...current, fields });
  };

  // Update a child relationship's node
  const setChild = (childRel, childValue) => {
    const current = typeof nodeValue === 'object' && nodeValue !== null ? nodeValue : {};
    const children = { ...(current.children || {}) };
    children[childRel] = childValue;
    onChange({ ...current, children });
  };

  const fieldAllowed = (fieldName) => {
    if (nodeValue === true) return true;
    if (nodeValue === false) return false;
    return nodeValue?.fields?.[fieldName] ?? true; // default allow if parent node is on
  };

  const childAllowed = (childRel) => {
    if (nodeValue === true) return true;
    if (nodeValue === false) return false;
    return nodeValue?.children?.[childRel] ?? true;
  };

  const indent = depth * 16;

  return (
    <div>
      {/* Node header */}
      <div
        className={`flex items-center gap-2 py-2 pr-3 hover:bg-muted/20 transition-colors cursor-pointer ${state === 'none' ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={toggle}
      >
        <Checkbox state={state} onClick={toggleNode} />
        <span className={`transition-transform duration-150 text-muted-foreground ${expanded ? 'rotate-90' : ''}`}>
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
        <span className={`text-sm font-medium flex-1 ${isChild ? 'text-purple-700' : 'text-foreground'}`}>{label}</span>
        {isChild && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">child</span>}
        <span className="text-[10px] text-muted-foreground/40">{objectName}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Expanded content */}
      {expanded && meta && (
        <div className="border-l border-border/50 ml-4">
          {/* Fields section */}
          {meta.fields.length > 0 && (
            <div>
              <div
                className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-3 py-1.5 bg-muted/20"
                style={{ paddingLeft: `${indent + 24}px` }}
              >
                Fields ({meta.fields.length})
              </div>
              {meta.fields.map(f => (
                <FieldRow
                  key={f.name}
                  fieldMeta={f}
                  allowed={fieldAllowed(f.name)}
                  onToggle={() => setField(f.name, !fieldAllowed(f.name))}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}

          {/* Child relationships */}
          {meta.childRelationships.length > 0 && (
            <div>
              <div
                className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-3 py-1.5 bg-muted/20"
                style={{ paddingLeft: `${indent + 24}px` }}
              >
                Child Objects ({meta.childRelationships.length})
              </div>
              {meta.childRelationships.map(cr => (
                <SchemaNode
                  key={cr.relationshipName}
                  objectName={cr.childSObject}
                  label={cr.childSObject}
                  nodeValue={childAllowed(cr.relationshipName)}
                  onChange={v => setChild(cr.relationshipName, v)}
                  depth={depth + 1}
                  isChild
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root export ──────────────────────────────────────────────────────────────
export default function ObjectSchemaTree({ allObjects, allowedMap, onChange }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden divide-y divide-border/50 max-h-[520px] overflow-y-auto">
      {allObjects.map(obj => (
        <SchemaNode
          key={obj.name}
          objectName={obj.name}
          label={obj.label}
          nodeValue={allowedMap?.[obj.name] ?? true}
          onChange={v => onChange({ ...allowedMap, [obj.name]: v })}
          depth={0}
        />
      ))}
    </div>
  );
}