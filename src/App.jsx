import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/Shell';
import MapCanvas from './components/MapCanvas';
import { EMPTY_FILTERS, LocationDetailDrawer, LocationPanel } from './components/Locations';
import { ConfirmDialog, ImportWizard, LocationFormDialog, UndoToast } from './components/Dialogs';
import { ActivityPage, SettingsPage, ShareLinksPage, TrashPage } from './pages/ManagementPages';
import { AuthPage, PublicSharePage } from './pages/StandalonePages';
import { api, loadBootstrap } from './data/api';
import { downloadLocations, matchesLocation, normalizeLocation, sortLocations } from './lib/location';
import { supabase } from './lib/supabase';

const EMPTY_DATA = {
  currentUser: { id: '', name: '', role: 'member' },
  space: { id: '', name: '' },
  members: [], tags: [], locations: [], trash: [], activity: [], shareLinks: []
};

function getRoute() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.startsWith('/share/')) return { type: 'share', token: decodeURIComponent(path.split('/')[2] || '') };
  if (path.startsWith('/auth')) return { type: 'auth' };
  const page = path.startsWith('/app/') ? path.split('/')[2] : 'map';
  return { type: 'app', page: ['map', 'locations', 'activity', 'trash', 'share-links', 'settings'].includes(page) ? page : 'map' };
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeLocation, setActiveLocation] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [formLocation, setFormLocation] = useState(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await loadBootstrap();
      setData({ ...EMPTY_DATA, ...next, locations: (next.locations || []).map(normalizeLocation) });
      setLoadError('');
    } catch (error) {
      if (error.status === 401 && route.type === 'app') {
        window.location.replace('/auth/login');
        return;
      }
      setLoadError(error.message || '共享空间加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    window.addEventListener('popstate', onPopState);
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/app/map');
      setRoute(getRoute());
    }
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (route.type === 'app') load();
  }, [route.type, load]);

  useEffect(() => {
    if (!supabase || !data.space.id || route.type !== 'app') return undefined;
    let timer;
    const channel = supabase.channel(`space:${data.space.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter: `space_id=eq.${data.space.id}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => load(true), 180);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `space_id=eq.${data.space.id}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => load(true), 180);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [data.space.id, load, route.type]);

  const filteredLocations = useMemo(() => sortLocations(data.locations.filter((item) => matchesLocation(item, filters)), filters.sort), [data.locations, filters]);

  function navigate(page) {
    window.history.pushState({}, '', `/app/${page}`);
    setRoute({ type: 'app', page });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openAdd() { setFormLocation(undefined); setFormOpen(true); }
  function openEdit(location) { setActiveLocation(null); setFormLocation(location); setFormOpen(true); }
  function openDetail(location) { setActiveLocation(location); }
  function focusLocation(location) { setActiveLocation(null); setFocusRequest({ ...location, focusToken: Date.now() }); if (route.page !== 'map') navigate('map'); }
  function navigateLocation(location) {
    const url = `https://uri.amap.com/navigation?to=${Number(location.longitude)},${Number(location.latitude)},${encodeURIComponent(location.name)}&mode=car&src=rongmap&coordinate=gaode&callnative=1`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  async function shareLocation(location) {
    const url = `https://uri.amap.com/marker?position=${Number(location.longitude)},${Number(location.latitude)}&name=${encodeURIComponent(location.name)}&src=rongmap&coordinate=gaode`;
    try {
      if (navigator.share) await navigator.share({ title: location.name, text: location.address, url });
      else { await navigator.clipboard.writeText(url); setNotice({ message: `已复制「${location.name}」的地图链接` }); }
    } catch (error) {
      if (error.name !== 'AbortError') setNotice({ message: `分享失败：${error.message}`, error: true });
    }
  }

  async function saveLocation(form) {
    setBusy(true);
    try {
      const payload = {
        ...form,
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
        version: formLocation?.version,
        sourceType: formLocation?.sourceType || 'manual'
      };
      if (formLocation) await api.updateLocation(formLocation.id, payload);
      else await api.createLocation(payload);
      await load(true);
      setFormOpen(false);
      setNotice({ message: formLocation ? `已更新「${form.name}」` : `已添加「${form.name}」` });
    } catch (error) {
      if (error.status === 409) {
        setConfirm({ type: 'conflict', title: '地点已被其他成员修改', message: '服务器中已有更新版本。关闭后请查看最新内容，再重新应用你的修改。' });
        await load(true);
      } else setNotice({ message: `保存失败：${error.message}`, error: true });
    } finally { setBusy(false); }
  }

  function askDelete(location) {
    setActiveLocation(null);
    setConfirm({ type: 'delete', location, title: '移入回收站', message: `「${location.name}」会保留30天，期间可随时恢复。` });
  }

  async function deleteLocation(location) {
    setBusy(true);
    try {
      await api.deleteLocation(location.id);
      await load(true);
      setConfirm(null);
      setNotice({ message: `已将「${location.name}」移入回收站`, undoId: location.id });
    } catch (error) { setNotice({ message: `删除失败：${error.message}`, error: true }); }
    finally { setBusy(false); }
  }

  async function restore(locationOrId) {
    const id = typeof locationOrId === 'string' ? locationOrId : locationOrId.id;
    try { await api.restoreLocation(id); await load(true); setNotice({ message: '地点已恢复' }); }
    catch (error) { setNotice({ message: `恢复失败：${error.message}`, error: true }); }
  }

  function askPurge(location) {
    setConfirm({ type: 'purge', location, title: '永久删除地点', message: `永久删除「${location.name}」后将不能恢复。` });
  }

  async function purge(location) {
    setBusy(true);
    try { await api.purgeLocation(location.id); await load(true); setConfirm(null); setNotice({ message: `已永久删除「${location.name}」` }); }
    catch (error) { setNotice({ message: `清理失败：${error.message}`, error: true }); }
    finally { setBusy(false); }
  }

  function toggleSelection(id) {
    setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function selectAll(locations) {
    setSelectedIds((current) => {
      const allSelected = locations.length && locations.every((item) => current.has(item.id));
      return allSelected ? new Set() : new Set(locations.map((item) => item.id));
    });
  }

  async function bulk(action, value) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      await api.bulk({ action, ids, value });
      setSelectedIds(new Set());
      await load(true);
      setNotice({ message: action === 'trash' ? `已将 ${ids.length} 个地点移入回收站` : `已更新 ${ids.length} 个地点` });
    } catch (error) { setNotice({ message: `批量操作失败：${error.message}`, error: true }); }
  }

  async function invite(email) {
    try {
      const member = await api.inviteMember(email);
      setNotice({ message: member.status === 'active' ? `${email} 已加入共享空间` : `邀请已发送至 ${email}` });
      await load(true);
      return member;
    } catch (error) {
      setNotice({ message: `邀请失败：${error.message}`, error: true });
      throw error;
    }
  }
  async function createTag(name) { await api.createTag(name); await load(true); setNotice({ message: `已创建标签「${name}」` }); }
  async function deleteTag(tag) { await api.deleteTag(tag.id); await load(true); setNotice({ message: `已删除标签「${tag.name}」` }); }
  async function createShare(body) {
    const link = await api.createShareLink(body);
    const url = `${window.location.origin}/share/${link.token}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    await load(true);
    setNotice({ message: '只读链接已创建，地址已复制' });
  }
  async function revokeShare(link) { await api.revokeShareLink(link.id); await load(true); setNotice({ message: '共享链接已撤销' }); }
  async function importCommit(body) { const result = await api.importCommit(body); await load(true); return result; }

  if (route.type === 'auth') return <AuthPage />;
  if (route.type === 'share') return <PublicSharePage token={route.token} />;
  if (loading) return <main className="boot-state"><span className="brand-dot" /><p className="eyebrow">RONGMAP</p><h1>正在打开共享地图</h1><div className="skeleton-line" /></main>;

  const sharedPanelProps = {
    locations: filteredLocations,
    allLocations: data.locations,
    filters,
    onFilters: setFilters,
    activeId: activeLocation?.id,
    selectedIds,
    members: data.members,
    tags: data.tags,
    onToggle: toggleSelection,
    onSelectAll: selectAll,
    onOpen: openDetail,
    onFocus: focusLocation,
    onEdit: openEdit,
    onDelete: askDelete,
    onBulk: bulk,
    onClearSelection: () => setSelectedIds(new Set()),
    onAdd: openAdd,
    onImport: () => setImportOpen(true),
    onExport: (format) => downloadLocations(data.locations, format)
  };

  return (
    <AppShell route={route.page} onNavigate={navigate} onAdd={openAdd} onImport={() => setImportOpen(true)} data={data} filteredCount={filteredLocations.length}>
      {loadError ? <div className="global-error" role="alert"><span>!</span><p>{loadError}</p><button type="button" onClick={() => load()}>重试</button></div> : null}
      {route.page === 'map' ? <main className="map-workspace"><LocationPanel {...sharedPanelProps} /><MapCanvas locations={filteredLocations} activeId={activeLocation?.id} focusRequest={focusRequest} onSelect={openDetail} /></main> : null}
      {route.page === 'locations' ? <main className="locations-page"><LocationPanel {...sharedPanelProps} fullPage /></main> : null}
      {route.page === 'activity' ? <ActivityPage activity={data.activity} members={data.members} /> : null}
      {route.page === 'trash' ? <TrashPage trash={data.trash} onRestore={restore} onPurge={askPurge} isAdmin={data.currentUser.role === 'admin'} /> : null}
      {route.page === 'share-links' ? <ShareLinksPage links={data.shareLinks} onCreate={createShare} onRevoke={revokeShare} isAdmin={data.currentUser.role === 'admin'} /> : null}
      {route.page === 'settings' ? <SettingsPage data={data} onInvite={invite} onCreateTag={createTag} onDeleteTag={deleteTag} /> : null}
      <LocationDetailDrawer location={activeLocation} member={data.members.find((member) => member.id === activeLocation?.createdBy)} onClose={() => setActiveLocation(null)} onFocus={focusLocation} onNavigate={navigateLocation} onShare={shareLocation} onEdit={openEdit} onDelete={askDelete} />
      {formOpen ? <LocationFormDialog location={formLocation} tags={data.tags} onClose={() => setFormOpen(false)} onSave={saveLocation} busy={busy} /> : null}
      {importOpen ? <ImportWizard onClose={() => setImportOpen(false)} onPreview={api.importPreview} onCommit={importCommit} /> : null}
      {confirm ? <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.type === 'delete' || confirm.type === 'purge'} confirmLabel={confirm.type === 'purge' ? '永久删除' : confirm.type === 'delete' ? '移入回收站' : '知道了'} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => confirm.type === 'delete' ? deleteLocation(confirm.location) : confirm.type === 'purge' ? purge(confirm.location) : setConfirm(null)} /> : null}
      <UndoToast notice={notice} onUndo={notice?.undoId ? () => { restore(notice.undoId); setNotice(null); } : null} onClose={() => setNotice(null)} />
    </AppShell>
  );
}
