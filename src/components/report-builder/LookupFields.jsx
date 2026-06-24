import { useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Link2, Loader2 } from 'lucide-react';

// Cross-object lookup: adds relationship fields like Account.Name to the SELECT
export default function LookupFields({ lookups, onChange, fields, selectedObject }) {
  const [relatedFieldsCache, setRelatedFieldsCache] = useState({});
  const [loadingRel, setLoadingRel] = useState({});

  // Reference fields from the primary object (relationship traversal)
  const referenceFields = fields.filter(f => f.type === 'reference' && f.name !== 'RecordTypeId');

  const loadRelatedFields = async (relationshipName, relObjectName) => {
    if (relatedFieldsCache[relObjectName]) return;
    setLoadingRel(prev => ({ ...prev, [relObjectName]: true }));
    const res = await appClient.functions.invoke('salesforceObjectFields', { objectName: relObjectName });
    setRelatedFieldsCache(prev => ({
      ...prev,
      [relObjectName]: (res.data?.fields || []).filter(f =>
        f.type !== 'base64' && f.name !== 'IsDeleted' && f.name !== 'SystemModstamp'
      )
    }));
    setLoadingRel(prev => ({ ...prev, [relObjectName]: false }));
  };

  const add = () => {
    if (!referenceFields.length) return;
    const firstRef = referenceFields[0];
    // Strip __c → __r for custom, or use relationshipName
    const relName = firstRef.name.endsWith('__c')
      ? firstRef.name.replace(/__c$/, '__r')
      : firstRef.name.replace(/Id$/, '');

    onChange([...lookups, { id: Date.now(), refField: firstRef.name, relName, relObject: '', relFieldName: '' }]);
  };

  const update = (id, patch) => onChange(lookups.map(l => l.id === id ? { ...l, ...patch } : l));
  const remove = (id) => onChange(lookups.filter(l => l.id !== id));

  const getRefFieldMeta = (fieldName) => fields.find(f => f.name === fieldName);

  return (
    <div className="space-y-2">
      {lookups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No lookups. Add cross-object fields like <span className="font-mono">Account.Name</span> or <span className="font-mono">Owner.Email</span>.
        </p>
      ) : (
        lookups.map(lookup => {
          // Determine the related object name from the reference field's referenceTo
          const refMeta = getRefFieldMeta(lookup.refField);
          const relObjectOptions = refMeta?.referenceTo || [];

          return (
            <div key={lookup.id} className="flex items-center gap-2 flex-wrap bg-muted/30 rounded-lg px-3 py-2">
              {/* Parent reference field */}
              <Select value={lookup.refField} onValueChange={v => {
                const meta = fields.find(f => f.name === v);
                const relName = v.endsWith('__c') ? v.replace(/__c$/, '__r') : v.replace(/Id$/, '');
                update(lookup.id, { refField: v, relName, relObject: meta?.referenceTo?.[0] || '', relFieldName: '' });
              }}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue placeholder="Lookup field…" />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {referenceFields.map(f => (
                    <SelectItem key={f.name} value={f.name} className="text-xs">{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

              {/* Related object (if polymorphic) */}
              {relObjectOptions.length > 1 && (
                <Select value={lookup.relObject} onValueChange={v => {
                  update(lookup.id, { relObject: v, relFieldName: '' });
                  loadRelatedFields(lookup.relName, v);
                }}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="Object…" />
                  </SelectTrigger>
                  <SelectContent>
                    {relObjectOptions.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              {/* Auto-load single reference target */}
              {relObjectOptions.length === 1 && !relatedFieldsCache[relObjectOptions[0]] && !loadingRel[relObjectOptions[0]] && (
                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1"
                  onClick={() => {
                    update(lookup.id, { relObject: relObjectOptions[0] });
                    loadRelatedFields(lookup.relName, relObjectOptions[0]);
                  }}>
                  Load fields
                </Button>
              )}

              {/* Related field */}
              {(() => {
                const targetObj = lookup.relObject || relObjectOptions[0];
                if (!targetObj) return null;
                if (loadingRel[targetObj]) return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
                const relFields = relatedFieldsCache[targetObj];
                if (!relFields) return null;
                return (
                  <Select value={lookup.relFieldName} onValueChange={v => update(lookup.id, { relFieldName: v, relObject: targetObj })}>
                    <SelectTrigger className="w-40 h-8 text-xs">
                      <SelectValue placeholder="Field on related…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48">
                      {relFields.map(f => (
                        <SelectItem key={f.name} value={f.name} className="text-xs">{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}

              {/* Preview */}
              {lookup.relFieldName && (
                <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  {lookup.relName}.{lookup.relFieldName}
                </span>
              )}

              <button onClick={() => remove(lookup.id)} className="text-muted-foreground hover:text-destructive p-1 ml-auto">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })
      )}

      <Button size="sm" variant="ghost" onClick={add} disabled={!referenceFields.length} className="h-7 text-xs gap-1 text-primary mt-1">
        <Plus className="w-3 h-3" /> Add Lookup Field
      </Button>
    </div>
  );
}
