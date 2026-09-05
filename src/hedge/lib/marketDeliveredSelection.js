// Revalidating a response must not itself change the history request inputs.
// React compares effect dependencies by reference, not by array contents.
export function reconcileDeliveredPortSelection(current, ports) {
  if (!ports.length) return current;
  const available = new Set(ports.map(([key]) => key));
  const retained = current.filter((key) => available.has(key));
  if (retained.length === current.length && retained.length) return current;
  if (retained.length) return retained;
  return available.has('singapore') ? ['singapore'] : [ports[0][0]];
}
