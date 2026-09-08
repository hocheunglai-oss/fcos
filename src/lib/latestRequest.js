// Keeps UI state tied to the newest request. Abort is an efficiency measure;
// the token check remains the correctness boundary when a transport cannot abort.
export function createLatestRequestGate() {
  let current = null;
  let generation = 0;

  const invalidate = () => {
    generation += 1;
    current?.controller?.abort?.();
    current = null;
  };

  return {
    begin(key = '') {
      current?.controller?.abort?.();
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const token = ++generation;
      current = { token, key, controller };
      return {
        key,
        signal: controller?.signal,
        isCurrent: () => current?.token === token,
      };
    },
    invalidate,
  };
}
