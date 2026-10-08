import React, { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './MapCanvas';
import { api } from '../data/api';
import { filterRestaurants, restaurantToLocation } from '../lib/discovery';

export default function Discovery({ savedLocations, onCollect }) {
  const [bounds, setBounds] = useState(null);
  const [result, setResult] = useState(null);
  const [filters, setFilters] = useState({ category: 'all', maximum: '', includeUnknown: true, hideChains: false, keyword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const generation = useRef(0);
  const cards = useRef(new Map());
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (selected) cards.current.get(selected.id)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const visible = useMemo(() => filterRestaurants(result?.restaurants || [], filters), [result, filters]);
  const savedIds = new Set(savedLocations.map((item) => item.sourceId).filter(Boolean));
  const tooWide = bounds && (bounds.east - bounds.west > 0.12 || bounds.north - bounds.south > 0.12);
  const moved = result && bounds && ['west', 'south', 'east', 'north'].some((key) => Math.abs(bounds[key] - result.bounds[key]) > 0.0005);
  function change(key, value) { setFilters((previous) => ({ ...previous, [key]: value })); }
  async function search() {
    const id = ++generation.current;
    setLoading(true); setError('');
    try {
      const next = await api.discoverRestaurants(bounds);
      if (generation.current !== id) return;
      setResult(next); setSelected(null);
    } catch (err) {
      if (generation.current === id) setError(err.message);
    } finally { if (generation.current === id) setLoading(false); }
  }
  async function collect(item) {
    setSaving(item.sourceId); setError('');
    try { await onCollect(restaurantToLocation(item)); }
    catch (err) { setError(err.message); }
    finally { setSaving(''); }
  }
  function select(item) { setSelected(item); setFocus({ ...item, focusToken: Date.now() }); }
  return <>
    <aside className="discovery-panel" aria-label="发现小馆">
      <div className="discovery-controls">
        <div className="discovery-heading"><h2>发现小馆</h2><span className="tag">福州</span></div>
        <p>拖动地图，搜索附近餐馆；喜欢的再收藏。</p>
        <button className="button button--primary discovery-search" disabled={!bounds || tooWide || loading} onClick={search}>{loading ? '正在搜索…' : '搜索当前区域'}</button>
        {tooWide ? <small>请放大地图后搜索。</small> : !bounds ? <small>等待地图加载…</small> : null}
        <label className="field">筛选搜索结果<input type="search" placeholder="店名、地址或菜系" value={filters.keyword} onChange={(event) => change('keyword', event.target.value)} /></label>
        <div className="discovery-filter-row">
          <label className="field">类型<select aria-label="类型" value={filters.category} onChange={(event) => change('category', event.target.value)}><option value="all">全部餐饮</option><option value="food">餐馆小吃</option><option value="cafe_bar">咖啡茶饮</option></select></label>
          <label className="field">人均预算<select value={filters.maximum} onChange={(event) => change('maximum', event.target.value)}><option value="">不限</option><option value="30">30 元以内</option><option value="50">50 元以内</option><option value="100">100 元以内</option><option value="200">200 元以内</option></select></label>
        </div>
        <div className="discovery-options"><label><input type="checkbox" checked={filters.includeUnknown} onChange={(event) => change('includeUnknown', event.target.checked)} />保留价格未知</label><label><input type="checkbox" checked={filters.hideChains} onChange={(event) => change('hideChains', event.target.checked)} />隐藏常见连锁</label></div>
      </div>
      <div className="discovery-results" tabIndex={0} aria-label="发现小馆结果" aria-busy={loading}>
        {error ? <p className="inline-notice inline-notice--error" role="alert">{error}{result ? '。下方保留上次结果。' : ''}</p> : null}
        {result?.partial ? <p className="inline-notice inline-notice--warning" role="status">部分区域搜索失败，结果不完整，请重试。</p> : null}
        {moved ? <p className="discovery-hint" role="status">地图范围已改变，点击搜索刷新结果。</p> : null}
        {result ? <p className="discovery-summary">{visible.length} / {result.restaurants.length} 家候选 · {new Date(result.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 查询</p> : null}
        {!result ? <div className="empty-state"><span aria-hidden="true">⌖</span><h3>找一家想去的小馆</h3><p>放大到想逛的街区，再搜索当前区域。</p></div> : !visible.length ? <div className="empty-state"><h3>{result.restaurants.length ? '没有符合筛选的餐馆' : '本次搜索没有返回餐馆'}</h3><p>{result.restaurants.length ? '调整预算、类型或搜索词试试。' : '移动地图或放大到附近街区再试。'}</p></div> : null}
        {visible.map((item) => <article ref={(element) => { if (element) cards.current.set(item.id, element); else cards.current.delete(item.id); }} className={`discovery-card ${selected?.id === item.id ? 'is-active' : ''}`} key={item.id}>
          <button className="discovery-card__main" onClick={() => select(item)} aria-label={`在地图查看${item.name}`}><strong>{item.name}</strong><span>{item.address || '地址暂无'}</span><small>{item.poiType.split(';').at(-1)} · {item.rating === null ? '评分暂无' : `高德 ${item.rating.toFixed(1)}`} · {item.averageCost === null ? '人均未知' : `人均 ¥${item.averageCost}`}</small></button>
          <button className="button" disabled={Boolean(saving) || savedIds.has(item.sourceId)} onClick={() => collect(item)} aria-label={`收藏${item.name}`}>{savedIds.has(item.sourceId) ? '已收藏' : saving === item.sourceId ? '收藏中…' : '收藏'}</button>
        </article>)}
      </div>
      <p className="discovery-footnote">高德搜索候选，未覆盖全部餐馆。评分和人均仅供参考。</p>
    </aside>
    <MapCanvas locations={visible} activeId={selected?.id} focusRequest={focus} onSelect={setSelected} onViewportChange={setBounds} discovery />
  </>;
}
