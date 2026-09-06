import { appClient } from '@/api/appClient';
import { clientSessionKey, clientSessionState, isCurrentClientSession, onClientSessionReset } from './clientSessionState.js';

const CACHE_TTL_MS = 30_000;
const detailCache = new Map();
onClientSessionReset(() => detailCache.clear());

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
  const session = clientSessionState();
  const key = clientSessionKey('special-term:', termId, session);
  if (!key) return Promise.reject(new Error('Sign in to view Special Terms.'));
  const existing = currentEntry(key);
  if (existing) return existing.promise;
  const promise = appClient.functions.invoke('specialTermDetail', { termId }, { cache: false })
    .then((response) => {
      if (!isCurrentClientSession(session)) throw new Error('Your account changed. Open the term again.');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    })
    .catch((error) => {
      if (detailCache.get(key)?.promise === promise) detailCache.delete(key);
      throw error;
    });
  detailCache.set(key, { createdAt: Date.now(), promise });
  return promise;
}

export function invalidateSpecialTermDetail(termId) {
  const key = clientSessionKey('special-term:', termId);
  if (key) detailCache.delete(key);
}
