// Deferred synthetic responses exercise real components without provider traffic.
window.desktopDebug = { requests: [], resolve(index, data) { this.requests[index].resolve({ data }); }, background(index, data) { this.requests[index].options.onBackgroundUpdate?.({ data }); } };
export const appClient = { functions: { invoke(name, body, options) {
  return new Promise((resolve) => window.desktopDebug.requests.push({ name, body, options, resolve }));
} } };
