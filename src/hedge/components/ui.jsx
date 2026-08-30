import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Inbox,
  Search,
  X,
} from "lucide-react";
import { PRODUCT_COLORS, formatMoney } from "../lib/domain";
import { PAGE_METHODOLOGIES } from "../lib/methodology";
import PageMethodology from "@/components/common/PageMethodology";
import SalesforceSyncBadge from "@/components/common/SalesforceSyncBadge";

export function Button({ children, icon: Icon, variant = "secondary", size = "md", className = "", ...props }) {
  return (
    <button className={`app-button app-button--${variant} app-button--${size} ${className}`} type="button" {...props}>
      {Icon && <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ label, icon: Icon, variant = "default", className = "", ...props }) {
  return (
    <button className={`app-icon-button app-icon-button--${variant} ${className}`} type="button" aria-label={label} title={label} {...props}>
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

export function Field({ label, hint, required, className = "", children }) {
  return (
    <label className={`app-field ${className}`}>
      <span className="app-field__label">
        {label}
        {required && <span className="app-field__required">Required</span>}
      </span>
      {children}
      {hint && <span className="app-field__hint">{hint}</span>}
    </label>
  );
}

export function Select({ children, className = "", ...props }) {
  return (
    <span className={`app-select-wrap ${className}`}>
      <select className="app-input app-select" {...props}>{children}</select>
      <ChevronDown size={15} aria-hidden="true" />
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", className = "" }) {
  return (
    <label className={`app-search ${className}`}>
      <Search size={16} aria-hidden="true" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}

export function PageHeader({ eyebrow, title, description, actions, status }) {
  const methodology = PAGE_METHODOLOGIES[title];
  const methodologySections = methodology ? [
    { title: "Purpose", body: methodology.summary },
    { title: "Calculation and control rules", points: methodology.steps },
  ] : [];
  return (
    <header className="app-page-header">
      <div className="app-page-header__copy">
        {eyebrow && <div className="app-eyebrow">{eyebrow}</div>}
        <div className="app-page-header__title-row">
          <h1>{title}</h1>
          <SalesforceSyncBadge className="app-salesforce-freshness" />
          {status}
        </div>
        {description && <p>{description}</p>}
      </div>
      {(methodology || actions) && (
        <div className="app-page-header__actions">
          {methodology && (
            <PageMethodology
              title={title}
              description="Calculation basis, workflow assumptions, and control sources used by this page."
              sections={methodologySections}
              sources={methodology.sources || []}
            />
          )}
          {actions}
        </div>
      )}
    </header>
  );
}

export function SectionHeading({ title, description, actions, id }) {
  return (
    <div className="app-section-heading" id={id}>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="app-section-heading__actions">{actions}</div>}
    </div>
  );
}

export function SegmentedControl({ value, onChange, options, label }) {
  return (
    <div className="app-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          role="tab"
          aria-selected={value === option.value}
        >
          {option.icon && <option.icon size={15} aria-hidden="true" />}
          <span>{option.label}</span>
          {option.count != null && <span className="app-segmented__count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ tone = "neutral", children, dot = true }) {
  return (
    <span className={`app-status app-status--${tone}`}>
      {dot && <span className="app-status__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function ProductBadge({ product }) {
  return (
    <span className="app-product" style={{ "--product-color": PRODUCT_COLORS[product] || "#596579" }}>
      {product || "-"}
    </span>
  );
}

export function Money({ value, digits = 0, signed = true, strong = false }) {
  const number = Number(value);
  const tone = !Number.isFinite(number) || number === 0 ? "neutral" : number > 0 ? "positive" : "negative";
  return <span className={`app-money app-money--${tone} ${strong ? "is-strong" : ""}`}>{formatMoney(value, { signed, digits })}</span>;
}

export function Metric({ label, value, detail, tone = "default", progress, icon: Icon }) {
  return (
    <div className={`app-metric app-metric--${tone}`}>
      <div className="app-metric__top">
        <span>{label}</span>
        {Icon && <Icon size={17} aria-hidden="true" />}
      </div>
      <div className="app-metric__value">{value}</div>
      {detail && <div className="app-metric__detail">{detail}</div>}
      {progress != null && (
        <div className="app-progress" aria-label={`${label} ${Math.round(progress)} percent`}>
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

export function Panel({ children, className = "", ...props }) {
  return <section className={`app-panel ${className}`} {...props}>{children}</section>;
}

export function TableFrame({ children, className = "" }) {
  return <div className={`app-table-frame ${className}`}>{children}</div>;
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="app-empty">
      <Icon size={24} aria-hidden="true" />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

function useDialogKeyboard(open, onClose) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const preferred = panelRef.current?.querySelector("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]");
      preferred?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [open]);

  return panelRef;
}

export function Drawer({ open, onClose, title, description, children, footer, width = "wide" }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useDialogKeyboard(open, onClose);
  if (!open) return null;
  return (
    <div className="app-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={panelRef} className={`app-drawer app-drawer--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="app-drawer__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close" icon={X} variant="quiet" onClick={onClose} />
        </header>
        <div className="app-drawer__body">{children}</div>
        {footer && <footer className="app-drawer__footer">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useDialogKeyboard(open, onClose);
  if (!open) return null;
  return (
    <div className="app-overlay app-overlay--center" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panelRef} className={`app-modal app-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="app-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close" icon={X} variant="quiet" onClick={onClose} />
        </header>
        <div className="app-modal__body">{children}</div>
        {footer && <footer className="app-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Delete", tone = "danger", busy, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy} icon={AlertTriangle}>{busy ? "Working..." : confirmLabel}</Button>
        </>
      )}
    >
      <div className="app-confirm-copy">
        This action changes live production data. An Undo option will remain available briefly after completion.
      </div>
    </Modal>
  );
}

export function LoadingScreen({ label = "Loading workspace" }) {
  return (
    <div className="app-loading" role="status">
      <div className="app-loading__mark">FC</div>
      <div>
        <strong>{label}</strong>
        <span>Syncing live desk data</span>
      </div>
      <div className="app-loading__bar"><span /></div>
    </div>
  );
}

export function InlineError({ title = "Something went wrong", error, action }) {
  return (
    <div className="app-inline-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{error?.message || String(error || "Please try again.")}</span>
      </div>
      {action}
    </div>
  );
}
