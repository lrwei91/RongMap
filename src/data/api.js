import { getAccessToken } from '../lib/supabase';
import { normalizeLocation } from '../lib/location';

async function request(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '请求失败');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function legacyBootstrap(locations) {
  const now = new Date().toISOString();
  return {
    mode: 'legacy',
    currentUser: { id: 'legacy-admin', name: '空间管理员', email: '', role: 'admin' },
    space: { id: 'default', name: '亲友共享地图', memberCount: 1 },
    members: [{ id: 'legacy-admin', name: '空间管理员', email: '', role: 'admin' }],
    tags: [],
    locations: locations.map(normalizeLocation),
    trash: [],
    activity: [{ id: 'legacy-welcome', action: 'space_ready', createdAt: now, actorName: 'RongMap', summary: '共享地图已准备就绪' }],
    shareLinks: []
  };
}

export async function loadBootstrap() {
  try {
    const data = await request('/api/v2/bootstrap');
    return { ...data, locations: (data.locations || []).map(normalizeLocation) };
  } catch (error) {
    if (error.status && error.status !== 404) throw error;
    const legacy = await request('/api/locations');
    return legacyBootstrap(Array.isArray(legacy) ? legacy : []);
  }
}

export const api = {
  createLocation: (body) => request('/api/v2/locations', { method: 'POST', body: JSON.stringify(body) }),
  updateLocation: (id, body) => request(`/api/v2/locations?id=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLocation: (id) => request(`/api/v2/locations?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreLocation: (id) => request('/api/v2/trash', { method: 'POST', body: JSON.stringify({ id }) }),
  purgeLocation: (id) => request(`/api/v2/trash?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bulk: (body) => request('/api/v2/bulk', { method: 'POST', body: JSON.stringify(body) }),
  importPreview: (records) => request('/api/v2/import-preview', { method: 'POST', body: JSON.stringify({ records }) }),
  importCommit: (body) => request('/api/v2/import-commit', { method: 'POST', body: JSON.stringify(body) }),
  createTag: (name) => request('/api/v2/tags', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteTag: (id) => request(`/api/v2/tags?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  inviteMember: (email) => request('/api/v2/members', { method: 'POST', body: JSON.stringify({ email }) }),
  createShareLink: (body) => request('/api/v2/share-links', { method: 'POST', body: JSON.stringify(body) }),
  revokeShareLink: (id) => request(`/api/v2/share-links?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  loadPublicShare: (token) => request(`/api/v2/public-share?token=${encodeURIComponent(token)}`)
};
