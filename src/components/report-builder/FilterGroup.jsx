import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, GitBranch } from 'lucide-react';

// Operators grouped by field type
const OPERATORS_BY_TYPE = {
  string: ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'],
  picklist: ['=', '!=', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'],
  boolean: ['='],
  date: ['=', '!=', '<', '>', '<=', '>='],
  datetime: ['=', '!=', '<', '>', '<=', '>='],
  double: ['=', '!=', '<', '>', '<=', '>='],
  currency: ['=', '!=', '<', '>', '<=', '>='],
  integer: ['=', '!=', '<', '>', '<=', '>='],
  id: ['=', '!=', 'IN', 'NOT IN'],
  reference: ['=', '!=', 'IN', 'NOT IN'],
};

const DATE_LITERALS = [
  'TODAY', 'YESTERDAY', 'TOMORROW',
  'THIS_WEEK', 'LAST_WEEK', 'NEXT_WEEK',
  'THIS_MONTH', 'LAST_MONTH', 'NEXT_MONTH',
  'THIS_QUARTER', 'LAST_QUARTER', 'NEXT_QUARTER',
  'THIS_YEAR', 'LAST_YEAR', 'NEXT_YEAR',
  'LAST_N_DAYS:7', 'LAST_N_DAYS:30', 'LAST_N_DAYS:90',
];

function getOperators(fieldType) {
  return OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.string;
}

function FilterRow({ condition, fields, onChange, onRemove }) {
  const field = fields.find(f => f.name === condition.field);
  const fieldType = field?.type || 'string';
  const operators = getOperators(fieldType);
  const isDate = fieldType === 'date' || fieldType === 'datetime';
  const isBool = fieldType === 'boolean';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Field */}
      <Select value={condition.field} onValueChange={v => onChange({ ...condition, field: v, operator: '=', value: '' })}>
        <SelectTrigger className="w-44 h-8 text-xs">
          <SelectValue placeholder="Field…" />
        </SelectTrigger>
        <SelectContent className="max-h-52">
          {fields.map(f => (
            <SelectItem key={f.name} value={f.name} className="text-xs">{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select value={condition.operator} onValueChange={v => onChange({ ...condition, operator: v })}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(op => (
            <SelectItem key={op} value={op} className="text-xs font-mono">{op}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value */}
      {isBool ? (
        <Select value={condition.value} onValueChange={v => onChange({ ...condition, value: v })}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue placeholder="Value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">true</SelectItem>
            <SelectItem value="false" className="text-xs">false</SelectItem>
          </SelectContent>
        </Select>
      ) : isDate ? (
        <div className="flex gap-1">
          <Select value={DATE_LITERALS.includes(condition.value) ? condition.value : '__custom'} onValueChange={v => {
            if (v !== '__custom') onChange({ ...condition, value: v });
          }}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Date literal…" />
            </SelectTrigger>
            <SelectContent className="max-h-52">
              {DATE_LITERALS.map(l => <SelectItem key={l} value={l} className="text-xs font-mono">{l}</SelectItem>)}
              <SelectItem value="__custom" className="text-xs">Custom date…</SelectItem>
            </SelectContent>
          </Select>
          {!DATE_LITERALS.includes(condition.value) && (
            <Input
              className="w-32 h-8 text-xs font-mono"
              placeholder="YYYY-MM-DD"
              value={condition.value}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          )}
        </div>
      ) : (
        <Input
          className="w-36 h-8 text-xs font-mono"
          placeholder={condition.operator === 'IN' || condition.operator === 'NOT IN' ? "'A','B'" : 'value'}
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive p-1 shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Recursive group component
export default function FilterGroup({ group, fields, onChange, depth = 0 }) {
  const addCondition = () => {
    const defaultField = fields[0]?.name || '';
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { type: 'condition', field: defaultField, operator: '=', value: '', id: Date.now() }
      ]
    });
  };

  const addGroup = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { type: 'group', logic: 'AND', conditions: [], id: Date.now() }
      ]
    });
  };

  const updateCondition = (idx, updated) => {
    const conditions = [...group.conditions];
    conditions[idx] = updated;
    onChange({ ...group, conditions });
  };

  const removeCondition = (idx) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  };

  const borderColors = ['border-primary/30', 'border-amber-400/40', 'border-emerald-400/40', 'border-violet-400/40'];
  const bgColors = ['bg-accent/20', 'bg-amber-50/50', 'bg-emerald-50/50', 'bg-violet-50/50'];

  return (
    <div className={`rounded-lg border ${borderColors[depth % 4]} ${bgColors[depth % 4]} p-3 space-y-2`}>
      {/* Logic toggle */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {depth === 0 ? 'Where' : 'Group'}
        </span>
        <div className="flex rounded-md border border-border overflow-hidden">
          {['AND', 'OR'].map(l => (
            <button
              key={l}
              onClick={() => onChange({ ...group, logic: l })}
              className={`px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                group.logic === l ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        {group.conditions.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {group.conditions.length} condition{group.conditions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Conditions */}
      {group.conditions.map((cond, idx) => (
        <div key={cond.id || idx}>
          {idx > 0 && (
            <div className="text-[10px] font-bold text-muted-foreground/60 uppercase pl-1 my-1">{group.logic}</div>
          )}
          {cond.type === 'group' ? (
            <div className="relative">
              <FilterGroup
                group={cond}
                fields={fields}
                onChange={updated => updateCondition(idx, updated)}
                depth={depth + 1}
              />
              <button
                onClick={() => removeCondition(idx)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <FilterRow
              condition={cond}
              fields={fields}
              onChange={updated => updateCondition(idx, updated)}
              onRemove={() => removeCondition(idx)}
            />
          )}
        </div>
      ))}

      {/* Add buttons */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={addCondition} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Add Condition
        </Button>
        <Button size="sm" variant="ghost" onClick={addGroup} className="h-7 text-xs gap-1 text-muted-foreground">
          <GitBranch className="w-3 h-3" /> Add Group
        </Button>
      </div>
    </div>
  );
}