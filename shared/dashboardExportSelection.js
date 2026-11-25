// Use the same representation on the server and in the workbook downloader.
// A page can arrive in any requested sort order.
export async function dashboardExportSelectionDigest(rows) {
  const entries = rows.map(({ id, exportRevision }) => {
    if (typeof id !== 'string' || !id || typeof exportRevision !== 'string' || !exportRevision) {
      throw new Error('Dashboard export cannot verify the STEM revision. Please export again.');
    }
    return JSON.stringify([id, exportRevision]);
  }).sort();
  const bytes = new TextEncoder().encode(entries.join('\n'));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
