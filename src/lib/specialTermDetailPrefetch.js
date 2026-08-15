import { appClient } from '@/api/appClient';

const CACHE_TTL_MS = 30_000;
const detailCache = new Map();

function currentEntry(termId) {
  const entry = detailCache.get(termId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    detailCache.delete(termId);
    return null;
  }
  return entry;
}

export function prefetchSpecialTermDetail(termId) {
  if (!termId) return Promise.resolve(null);
  const existing = currentEntry(termId);
  if (existing) return existing.promise;
  const promise = appClient.functions.invoke('specialTermDetail', { termId }, { cache: false })
    .then((response) => {
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    })
    .catch((error) => {
      detailCache.delete(termId);
      throw error;
    });
  detailCache.set(termId, { createdAt: Date.now(), promise });
  return promise;
}

export function invalidateSpecialTermDetail(termId) {
  if (termId) detailCache.delete(termId);
}
