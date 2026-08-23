import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MARKET_PULSE_POSITION,
  MARKET_PULSE_POSITION_STORAGE_KEY,
  MARKET_PULSE_POSITION_VERSION,
  normalizedUtilityPosition,
  utilityNormalizedFromPixels,
  utilityPixelsFromNormalized,
} from '@/lib/marketPulsePosition';

const MOBILE_BREAKPOINT = 768;
const DRAG_THRESHOLD = 6;

function readStoredPositions() {
  if (typeof window === 'undefined') return { desktop: DEFAULT_MARKET_PULSE_POSITION, mobile: DEFAULT_MARKET_PULSE_POSITION };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MARKET_PULSE_POSITION_STORAGE_KEY) || 'null');
    if (parsed?.version !== MARKET_PULSE_POSITION_VERSION) throw new Error('Unsupported stored position');
    return {
      desktop: normalizedUtilityPosition(parsed.desktop),
      mobile: normalizedUtilityPosition(parsed.mobile),
    };
  } catch {
    return { desktop: DEFAULT_MARKET_PULSE_POSITION, mobile: DEFAULT_MARKET_PULSE_POSITION };
  }
}

function writeStoredPositions(positions) {
  try {
    window.localStorage.setItem(MARKET_PULSE_POSITION_STORAGE_KEY, JSON.stringify({
      version: MARKET_PULSE_POSITION_VERSION,
      desktop: normalizedUtilityPosition(positions.desktop),
      mobile: normalizedUtilityPosition(positions.mobile),
    }));
  } catch {
    // Position persistence is optional; dragging remains available without storage.
  }
}

function readSafeInset(element, propertyName) {
  const value = Number.parseFloat(window.getComputedStyle(element).getPropertyValue(propertyName));
  return Number.isFinite(value) ? value : 0;
}

export default function DraggableWorkspaceUtility({ children, className, onDragStart }) {
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const positionsRef = useRef(null);
  if (positionsRef.current === null) positionsRef.current = readStoredPositions();
  const positionRef = useRef(positionsRef.current.desktop);
  const suppressClickRef = useRef(false);
  const [viewportMode, setViewportMode] = useState(() => (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop'));
  const [dragging, setDragging] = useState(false);

  const measureBounds = useCallback(() => {
    const host = hostRef.current;
    const parent = host?.offsetParent;
    if (!host || !parent) return null;
    const topInset = readSafeInset(parent, '--workspace-safe-area-top');
    const rightInset = readSafeInset(parent, '--workspace-safe-area-right');
    const bottomInset = readSafeInset(parent, '--workspace-safe-area-bottom');
    const leftInset = readSafeInset(parent, '--workspace-safe-area-left');
    const gutter = window.innerWidth < MOBILE_BREAKPOINT ? 8 : 12;
    const left = leftInset + gutter;
    const top = topInset + gutter;
    return {
      left,
      top,
      maxLeft: Math.max(left, parent.clientWidth - host.offsetWidth - rightInset - gutter),
      maxTop: Math.max(top, parent.clientHeight - host.offsetHeight - bottomInset - gutter),
    };
  }, []);

  const applyPosition = useCallback((nextPosition) => {
    const host = hostRef.current;
    const bounds = measureBounds();
    if (!host || !bounds) return;
    const normalized = normalizedUtilityPosition(nextPosition);
    const pixels = utilityPixelsFromNormalized(normalized, bounds);
    host.style.left = `${pixels.left}px`;
    host.style.top = `${pixels.top}px`;
    positionRef.current = normalized;
    document.documentElement.dataset.marketPulseCorner = normalized.x >= 0.9 && normalized.y <= 0.1 ? 'top-right' : 'free';
  }, [measureBounds]);

  useLayoutEffect(() => {
    applyPosition(positionsRef.current[viewportMode]);
  }, [applyPosition, viewportMode]);

  useEffect(() => {
    const host = hostRef.current;
    const parent = host?.offsetParent;
    if (!host || !parent) return undefined;
    const resizeObserver = new ResizeObserver(() => applyPosition(positionsRef.current[viewportMode]));
    resizeObserver.observe(parent);
    resizeObserver.observe(host);
    const handleResize = () => {
      const nextMode = window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
      setViewportMode(nextMode);
      applyPosition(positionsRef.current[nextMode]);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [applyPosition, viewportMode]);

  useEffect(() => () => {
    delete document.documentElement.dataset.marketPulseCorner;
  }, []);

  const persist = useCallback((nextPosition) => {
    const normalized = normalizedUtilityPosition(nextPosition);
    positionsRef.current = { ...positionsRef.current, [viewportMode]: normalized };
    writeStoredPositions(positionsRef.current);
    applyPosition(normalized);
  }, [applyPosition, viewportMode]);

  const resetPosition = useCallback(() => {
    suppressClickRef.current = false;
    persist(DEFAULT_MARKET_PULSE_POSITION);
  }, [persist]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const host = hostRef.current;
    if (!host) return;
    const bounds = measureBounds();
    if (!bounds) return;
    const rect = host.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left - host.offsetParent.getBoundingClientRect().left,
      startTop: rect.top - host.offsetParent.getBoundingClientRect().top,
      bounds,
      moved: false,
    };
  }, [measureBounds]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      hostRef.current?.setPointerCapture?.(event.pointerId);
      setDragging(true);
      onDragStart?.();
    }
    event.preventDefault();
    const nextPixels = {
      left: Math.min(drag.bounds.maxLeft, Math.max(drag.bounds.left, drag.startLeft + deltaX)),
      top: Math.min(drag.bounds.maxTop, Math.max(drag.bounds.top, drag.startTop + deltaY)),
    };
    const nextNormalized = utilityNormalizedFromPixels(nextPixels, drag.bounds);
    const host = hostRef.current;
    if (host) {
      host.style.left = `${nextPixels.left}px`;
      host.style.top = `${nextPixels.top}px`;
    }
    positionRef.current = nextNormalized;
  }, [onDragStart]);

  const handlePointerEnd = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const host = hostRef.current;
    if (host?.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
    if (drag.moved) {
      suppressClickRef.current = true;
      persist(positionRef.current);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, [persist]);

  const handleClickCapture = useCallback((event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  useEffect(() => {
    const handleWindowPointerMove = (event) => handlePointerMove(event);
    const handleWindowPointerEnd = (event) => handlePointerEnd(event);
    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  }, [handlePointerEnd, handlePointerMove]);

  return (
    <div
      ref={hostRef}
      className={cn('app-market-pulse-dock absolute z-40', dragging && 'is-dragging', className)}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      data-testid="draggable-market-pulse"
    >
      {children({ resetPosition, dragging })}
    </div>
  );
}
