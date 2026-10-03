import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { clientSessionState, isCurrentClientSession } from "@/lib/clientSessionState";

const ActionsContext = createContext(null);

function cleanRecord(record = {}) {
  const { id, created_date, updated_date, created_by, created_by_id, is_sample, ...payload } = record;
  return payload;
}

export function ActionsProvider({ children, reload }) {
  const notificationRef = useRef(null);

  useEffect(() => () => notificationRef.current?.dismiss(), []);

  const showToast = useCallback((nextToast) => {
    notificationRef.current?.dismiss();
    const session = clientSessionState();
    const operation = nextToast.operation;
    let notification;
    const undo = async () => {
      if (!isCurrentClientSession(session)) return;
      notification.dismiss();
      try {
        if (operation.action === "create") {
          await operation.entity.delete(operation.record.id, operation.record.revision);
        } else if (operation.action === "delete") {
          await operation.entity.create(cleanRecord(operation.record));
        } else if (operation.action === "update") {
          await operation.entity.update(operation.record.id, cleanRecord(operation.before), operation.record.revision);
        }
        if (!isCurrentClientSession(session)) return;
        await reload({ silent: true });
        notification.update({ description: 'Undone' });
      } catch (error) {
        if (isCurrentClientSession(session)) toast({ title: 'Undo failed', description: error.message, variant: 'destructive' });
      }
    };
    notification = toast({
      title: nextToast.message,
      action: operation ? <button type="button" className="flex shrink-0 items-center gap-1 text-sm underline" onClick={undo}><RotateCcw size={15} aria-hidden="true" />Undo</button> : undefined,
    });
    notificationRef.current = notification;
  }, [reload]);

  const create = useCallback(async ({ entity, entityName, payload, label }) => {
    const record = await entity.create(payload);
    await reload({ silent: true });
    showToast({ message: `${label} created`, operation: { action: "create", entity, entityName, record, label } });
    return record;
  }, [reload, showToast]);

  const update = useCallback(async ({ entity, entityName, id, payload, before, label }) => {
    const record = await entity.update(id, payload, before?.revision);
    await reload({ silent: true });
    showToast({ message: `${label} updated`, operation: { action: "update", entity, entityName, record, before, label } });
    return record;
  }, [reload, showToast]);

  const remove = useCallback(async ({ entity, entityName, record, label, undoable = true }) => {
    await entity.delete(record.id, record.revision);
    await reload({ silent: true });
    showToast({ message: `${label} deleted`, operation: undoable ? { action: "delete", entity, entityName, record, label } : null });
  }, [reload, showToast]);

  const value = useMemo(() => ({ create, update, remove, notify: showToast }), [create, remove, showToast, update]);

  return (
    <ActionsContext.Provider value={value}>
      {children}
    </ActionsContext.Provider>
  );
}

export function useActions() {
  const context = useContext(ActionsContext);
  if (!context) throw new Error("useActions must be used within ActionsProvider");
  return context;
}
