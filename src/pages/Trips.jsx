import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from '../components/MapCanvas';
import { api } from '../data/api';
import { CATEGORIES, hasCoordinates } from '../lib/location';

const clone = (value) => JSON.parse(JSON.stringify(value));
const localId = () => globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function MobileLocationSwitch({ active, onNavigate }) {
  return <nav className="mobile-section-switch" aria-label="地点与行程"><button type="button" className={active === 'locations' ? 'is-active' : ''} onClick={() => onNavigate('locations')}>地点</button><button type="button" className={active === 'trips' ? 'is-active' : ''} onClick={() => onNavigate('trips')}>行程</button></nav>;
}

export function TripsPage({ trips, onOpen, onCreate, onDelete, onNavigate }) {
  const [keyword, setKeyword] = useState('');
  const filtered = useMemo(() => trips.filter((trip) => `${trip.name} ${trip.description || ''}`.toLowerCase().includes(keyword.trim().toLowerCase())), [trips, keyword]);
  return (
    <main className="management-page trips-page">
      <MobileLocationSwitch active="trips" onNavigate={onNavigate} />
      <header className="page-header"><div><p className="eyebrow">共享编排</p><h2>行程</h2><p>把空间里的收藏地点组合成可排序、可优化和可分享的逐日路线。</p></div><button type="button" className="button button--primary" onClick={() => onCreate([])}>创建行程</button></header>
      <div className="page-toolbar"><input type="search" value={keyword} aria-label="搜索行程" placeholder="搜索行程名称或说明" onChange={(event) => setKeyword(event.target.value)} /></div>
      <div className="trip-grid">
        {filtered.length ? filtered.map((trip) => (
          <article className="trip-card" key={trip.id}>
            <button type="button" className="trip-card__main" onClick={() => onOpen(trip.id)}>
              <span className="trip-card__mark">{trip.dayCount || 1}</span>
              <span><strong>{trip.name}</strong><small>{trip.startDate || '日期待定'} · {trip.dayCount || 1} 天 · {trip.itemCount || 0} 个地点</small><p>{trip.description || '还没有行程说明。'}</p></span>
            </button>
            <div className="row-actions"><button type="button" className="button button--quiet" onClick={() => onOpen(trip.id)}>编排行程</button><button type="button" className="button button--danger-quiet" onClick={() => onDelete(trip)}>删除</button></div>
          </article>
        )) : <div className="empty-state"><span>→</span><h3>{trips.length ? '没有匹配的行程' : '还没有行程'}</h3><p>从收藏地点创建第一份共享行程。</p><button type="button" className="button button--primary" onClick={() => onCreate([])}>创建行程</button></div>}
      </div>
    </main>
  );
}

function TripItem({ item, index, dayIndex, dayCount, selected, onSelect, onChange, onMove, onRemove, onDragStart, onDrop }) {
  const category = CATEGORIES[item.category] || CATEGORIES.food;
  return (
    <article className={`trip-item ${selected ? 'is-active' : ''}`} draggable onDragStart={() => onDragStart(dayIndex, index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDrop(dayIndex, index); }}>
      <button type="button" className="trip-item__select" onClick={onSelect} aria-label={`在地图上查看 ${item.name}`}><span className="trip-order">{index + 1}</span><span className={`category-square category-square--${item.category}`}>{category.short}</span><span><strong>{item.name}</strong><small>{item.address || '地址待补充'}</small></span></button>
      <div className="trip-item__fields">
        <label>开始<input type="time" value={item.startTime || ''} onChange={(event) => onChange({ startTime: event.target.value })} /></label>
        <label>结束<input type="time" value={item.endTime || ''} onChange={(event) => onChange({ endTime: event.target.value })} /></label>
        <label className="trip-item__note">备注<input value={item.note || ''} maxLength={240} placeholder="本段安排（选填）" onChange={(event) => onChange({ note: event.target.value })} /></label>
      </div>
      {!hasCoordinates(item) ? <div className="inline-notice inline-notice--warning"><span>!</span>未定位地点不会参与路线优化。</div> : null}
      <div className="trip-item__actions">
        <button type="button" className="text-button" disabled={index === 0} onClick={() => onMove(dayIndex, index, dayIndex, index - 1)}>上移</button>
        <button type="button" className="text-button" onClick={() => onMove(dayIndex, index, dayIndex, index + 1)}>下移</button>
        <button type="button" className="text-button" disabled={dayIndex === 1} onClick={() => onMove(dayIndex, index, dayIndex - 1)}>前一天</button>
        <button type="button" className="text-button" disabled={dayIndex === dayCount} onClick={() => onMove(dayIndex, index, dayIndex + 1)}>后一天</button>
        <button type="button" className="text-button danger-text" onClick={onRemove}>移出</button>
      </div>
    </article>
  );
}

export function TripEditorPage({ tripId, locations, isAdmin, onBack, onChanged, onDirtyChange }) {
  const [draft, setDraft] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [activeDayIndex, setActiveDayIndex] = useState(1);
  const [activeItem, setActiveItem] = useState(null);
  const [locationToAdd, setLocationToAdd] = useState('');
  const [status, setStatus] = useState({ type: 'loading', message: '正在加载行程…' });
  const dragRef = useRef(null);

  const load = useCallback(async () => {
    setStatus({ type: 'loading', message: '正在加载行程…' });
    try {
      const trip = await api.loadTrip(tripId);
      setDraft(trip); setSavedSnapshot(JSON.stringify(trip)); setPast([]); setFuture([]); setActiveDayIndex(trip.days[0]?.dayIndex || 1); setStatus({ type: 'idle', message: '' });
    } catch (error) { setStatus({ type: 'error', message: error.message }); }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== savedSnapshot);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const guard = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function apply(updater) {
    const next = typeof updater === 'function' ? updater(draft) : updater;
    if (!draft || !next || JSON.stringify(next) === JSON.stringify(draft)) return;
    setPast((items) => [...items, clone(draft)].slice(-50)); setFuture([]); setDraft(next);
  }
  function undo() { if (!past.length) return; const previous = past[past.length - 1]; setFuture((items) => [clone(draft), ...items]); setPast((items) => items.slice(0, -1)); setDraft(previous); }
  function redo() { if (!future.length) return; const next = future[0]; setPast((items) => [...items, clone(draft)].slice(-50)); setFuture((items) => items.slice(1)); setDraft(next); }

  function updateDay(dayIndex, updater) {
    apply((current) => ({ ...current, days: current.days.map((day) => day.dayIndex === dayIndex ? updater(day) : day) }));
  }
  function updateItem(dayIndex, itemIndex, patch) {
    updateDay(dayIndex, (day) => ({ ...day, items: day.items.map((item, index) => index === itemIndex ? { ...item, ...patch } : item) }));
  }
  function moveItem(fromDay, fromIndex, toDay, toIndex = null) {
    apply((current) => {
      const days = clone(current.days);
      const source = days.find((day) => day.dayIndex === fromDay);
      const target = days.find((day) => day.dayIndex === toDay);
      if (!source || !target || !source.items[fromIndex]) return current;
      const [item] = source.items.splice(fromIndex, 1);
      const insertion = toIndex == null ? target.items.length : Math.max(0, Math.min(toIndex, target.items.length));
      target.items.splice(insertion, 0, item);
      return { ...current, days };
    });
  }
  function addLocation() {
    const location = locations.find((item) => item.id === locationToAdd);
    if (!location) return;
    updateDay(activeDayIndex, (day) => ({ ...day, items: [...day.items, { id: localId(), locationId: location.id, name: location.name, address: location.address, category: location.category, latitude: location.latitude, longitude: location.longitude, startTime: '', endTime: '', note: '' }] }));
    setLocationToAdd('');
  }
  function addDay() {
    if (draft.days.length >= 30) return;
    const dayIndex = draft.days.length + 1;
    apply((current) => ({ ...current, days: [...current.days, { id: localId(), dayIndex, date: '', title: '', items: [] }] }));
    setActiveDayIndex(dayIndex);
  }
  function removeDay(dayIndex) {
    const target = draft.days.find((day) => day.dayIndex === dayIndex);
    if (!target || target.items.length || draft.days.length === 1) return;
    apply((current) => ({ ...current, days: current.days.filter((day) => day.dayIndex !== dayIndex).map((day, index) => ({ ...day, dayIndex: index + 1 })) }));
    setActiveDayIndex(1);
  }

  async function save() {
    setStatus({ type: 'loading', message: '正在保存行程…' });
    try {
      const saved = await api.updateTrip(tripId, draft);
      setDraft(saved); setSavedSnapshot(JSON.stringify(saved)); setPast([]); setFuture([]); setStatus({ type: 'success', message: '行程已保存' }); await onChanged();
      return saved;
    } catch (error) {
      if (error.status === 409) {
        const fields = error.payload?.localSummary?.changedFields || [];
        setStatus({ type: 'conflict', message: `其他成员已经修改此行程${fields.length ? `；你的本地修改涉及：${fields.join('、')}` : ''}。请载入最新版本后重新应用。` });
      }
      else setStatus({ type: 'error', message: `保存失败：${error.message}` });
    }
  }
  async function optimize() {
    setStatus({ type: 'loading', message: '正在优化当天路线…' });
    try {
      let current = draft;
      if (dirty) current = await api.updateTrip(tripId, draft);
      const optimized = await api.optimizeTrip(tripId, { version: current.version, dayIndex: activeDayIndex });
      const report = optimized.optimization?.[0];
      setDraft(optimized); setSavedSnapshot(JSON.stringify(optimized)); setPast([]); setFuture([]);
      setStatus({ type: 'success', message: report?.improved ? `路线已从 ${report.beforeKm.toFixed(1)} km 优化到 ${report.afterKm.toFixed(1)} km${report.skipped ? `，${report.skipped} 个未定位地点已保留在末尾` : ''}` : '当前顺序已经是稳定的较短路线' });
      await onChanged();
    } catch (error) { setStatus({ type: error.status === 409 ? 'conflict' : 'error', message: error.status === 409 ? '行程版本已更新，请重新载入后再优化。' : `优化失败：${error.message}` }); }
  }
  async function share() {
    try {
      const link = await api.createShareLink({ scope: 'trip', tripId, label: draft.name });
      const url = `${window.location.origin}/share/${link.token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      setStatus({ type: 'success', message: '行程只读链接已创建并复制' }); await onChanged();
    } catch (error) { setStatus({ type: 'error', message: `创建分享链接失败：${error.message}` }); }
  }

  if (!draft) return <main className="management-page"><div className={`inline-notice${status.type === 'error' ? ' inline-notice--error' : ''}`} role="status"><span>{status.type === 'error' ? '!' : '…'}</span>{status.message}</div></main>;
  const activeDay = draft.days.find((day) => day.dayIndex === activeDayIndex) || draft.days[0];
  const usedIds = new Set(draft.days.flatMap((day) => day.items.map((item) => item.locationId).filter(Boolean)));
  const availableLocations = locations.filter((item) => !usedIds.has(item.id));
  const mapItems = draft.days.flatMap((day) => day.items.map((item, index) => ({ ...item, id: item.id || `${day.dayIndex}-${index}`, routeDayIndex: day.dayIndex, routeOrder: index + 1 })));
  const routeDays = draft.days.map((day) => ({ ...day, items: day.items.map((item, index) => ({ ...item, id: item.id || `${day.dayIndex}-${index}`, routeOrder: index + 1 })) }));
  return (
    <main className="trip-editor">
      <section className="trip-editor__panel">
        <header className="trip-editor__header"><button type="button" className="text-button" onClick={onBack}>← 返回行程</button><div className="trip-editor__title"><input aria-label="行程名称" value={draft.name} maxLength={80} onChange={(event) => apply({ ...draft, name: event.target.value })} /><textarea aria-label="行程说明" value={draft.description || ''} maxLength={240} placeholder="补充同行人、节奏或注意事项" onChange={(event) => apply({ ...draft, description: event.target.value })} /><label className="trip-start-date">开始日期<input aria-label="行程开始日期" type="date" value={draft.startDate || ''} onChange={(event) => apply({ ...draft, startDate: event.target.value })} /></label></div><div className="trip-editor__toolbar"><button type="button" className="button button--quiet" disabled={!past.length} onClick={undo}>撤销</button><button type="button" className="button button--quiet" disabled={!future.length} onClick={redo}>重做</button><button type="button" className="button button--primary" disabled={!dirty || status.type === 'loading'} onClick={save}>{dirty ? '保存行程' : '已保存'}</button></div></header>
        {status.message ? <div className={`inline-notice${status.type === 'error' || status.type === 'conflict' ? ' inline-notice--error' : status.type === 'loading' ? ' inline-notice--warning' : ''}`} role={status.type === 'error' || status.type === 'conflict' ? 'alert' : 'status'}><span>{status.type === 'error' || status.type === 'conflict' ? '!' : status.type === 'loading' ? '…' : '✓'}</span><span>{status.message}</span>{status.type === 'conflict' ? <button type="button" className="text-button" onClick={load}>载入最新版本</button> : null}</div> : null}
        <div className="trip-day-tabs">{draft.days.map((day) => <button type="button" className={day.dayIndex === activeDayIndex ? 'is-active' : ''} key={day.id || day.dayIndex} onClick={() => setActiveDayIndex(day.dayIndex)}>第 {day.dayIndex} 天 <small>{day.items.length} 地点</small></button>)}<button type="button" className="trip-day-tabs__add" disabled={draft.days.length >= 30} onClick={addDay}>＋ 增加一天</button></div>
        <div className="trip-day-tools"><label>日期<input type="date" value={activeDay.date || ''} onChange={(event) => updateDay(activeDayIndex, (day) => ({ ...day, date: event.target.value }))} /></label><label>当天标题<input value={activeDay.title || ''} maxLength={80} placeholder="例如：老城慢游" onChange={(event) => updateDay(activeDayIndex, (day) => ({ ...day, title: event.target.value }))} /></label><button type="button" className="button button--quiet" onClick={optimize}>优化当天路线</button>{isAdmin ? <button type="button" className="button button--quiet" onClick={share}>创建只读链接</button> : null}<button type="button" className="text-button danger-text" disabled={draft.days.length === 1 || activeDay.items.length > 0} title={activeDay.items.length ? '请先移走当天地点' : ''} onClick={() => removeDay(activeDayIndex)}>删除空白日</button></div>
        <div className="trip-add-location"><select aria-label="选择要加入行程的地点" value={locationToAdd} onChange={(event) => setLocationToAdd(event.target.value)}><option value="">从共享地点库添加…</option>{availableLocations.map((location) => <option value={location.id} key={location.id}>{location.name} · {location.address}</option>)}</select><button type="button" className="button button--primary" disabled={!locationToAdd} onClick={addLocation}>加入第 {activeDayIndex} 天</button></div>
        <div className="trip-items" onDragOver={(event) => event.preventDefault()} onDrop={() => dragRef.current && moveItem(dragRef.current.dayIndex, dragRef.current.itemIndex, activeDayIndex)}>
          {activeDay.items.length ? activeDay.items.map((item, index) => <TripItem key={item.id || `${activeDayIndex}-${index}`} item={item} index={index} dayIndex={activeDayIndex} dayCount={draft.days.length} selected={activeItem?.id === item.id} onSelect={() => { setActiveItem(item); }} onChange={(patch) => updateItem(activeDayIndex, index, patch)} onMove={moveItem} onRemove={() => updateDay(activeDayIndex, (day) => ({ ...day, items: day.items.filter((_, itemIndex) => itemIndex !== index) }))} onDragStart={(dayIndex, itemIndex) => { dragRef.current = { dayIndex, itemIndex }; }} onDrop={(dayIndex, itemIndex) => { if (dragRef.current) moveItem(dragRef.current.dayIndex, dragRef.current.itemIndex, dayIndex, itemIndex); dragRef.current = null; }} />) : <div className="empty-state"><span>1</span><h3>这一天还没有地点</h3><p>从共享地点库选择一个地点加入。</p></div>}
        </div>
      </section>
      <MapCanvas locations={mapItems} routeDays={routeDays} activeDayIndex={activeDayIndex} activeId={activeItem?.id} focusRequest={activeItem} onSelect={(item) => { setActiveItem(item); setActiveDayIndex(item.routeDayIndex || activeDayIndex); }} />
    </main>
  );
}
