export const MARKET_PULSE_POSITION_STORAGE_KEY = 'fcos.marketPulse.position.v1';
export const MARKET_PULSE_POSITION_VERSION = 1;
export const DEFAULT_MARKET_PULSE_POSITION = Object.freeze({ x: 1, y: 0 });

export function clampUnit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
}

export function normalizedUtilityPosition(value) {
  return {
    x: clampUnit(value?.x ?? DEFAULT_MARKET_PULSE_POSITION.x),
    y: clampUnit(value?.y ?? DEFAULT_MARKET_PULSE_POSITION.y),
  };
}

export function utilityPixelsFromNormalized(position, bounds) {
  const normalized = normalizedUtilityPosition(position);
  return {
    left: bounds.left + normalized.x * Math.max(0, bounds.maxLeft - bounds.left),
    top: bounds.top + normalized.y * Math.max(0, bounds.maxTop - bounds.top),
  };
}

export function utilityNormalizedFromPixels(position, bounds) {
  const availableX = Math.max(0, bounds.maxLeft - bounds.left);
  const availableY = Math.max(0, bounds.maxTop - bounds.top);
  return {
    x: availableX === 0 ? 0 : clampUnit((position.left - bounds.left) / availableX),
    y: availableY === 0 ? 0 : clampUnit((position.top - bounds.top) / availableY),
  };
}
