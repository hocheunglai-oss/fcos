import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";

const ActionsContext = createContext(null);

function cleanRecord(record = {}) {
  const { id, created_date, updated_date, created_by, created_by_id, is_sample, ...payload } = record;
  return payload;
}

export function ActionsProvider({ children, reload }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const showToast = useCallback((nextToast) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(nextToast);
    timerRef.current = setTimeout(() => setToast(null), 9000);
  }, []);

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

  const undo = useCallback(async () => {
    const operation = toast?.operation;
    if (!operation) return;
    setToast(null);
    if (operation.action === "create") {
      await operation.entity.delete(operation.record.id, operation.record.revision);
    } else if (operation.action === "delete") {
      await operation.entity.create(cleanRecord(operation.record));
    } else if (operation.action === "update") {
      await operation.entity.update(operation.record.id, cleanRecord(operation.before), operation.record.revision);
    }
    await reload({ silent: true });
  }, [reload, toast]);

  const value = useMemo(() => ({ create, update, remove, notify: showToast }), [create, remove, showToast, update]);

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {toast && (
        <div className="app-toast" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{toast.message}</span>
          {toast.operation && (
            <button type="button" className="app-toast__undo" onClick={undo}>
              <RotateCcw size={15} aria-hidden="true" />
              Undo
            </button>
          )}
          <button type="button" className="app-icon-button app-icon-button--quiet" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
    </ActionsContext.Provider>
  );
}

export function useActions() {
  const context = useContext(ActionsContext);
  if (!context) throw new Error("useActions must be used within ActionsProvider");
  return context;
}
