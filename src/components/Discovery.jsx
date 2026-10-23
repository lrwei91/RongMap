import React, { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './MapCanvas';
import { LocationDetailDrawer } from './Locations';
import { CATEGORIES } from '../lib/location';
import { api } from '../data/api';
import { filterRestaurants, restaurantToLocation } from '../lib/discovery';

const EMPTY_FILTERS = { category: 'all', maximum: '', includeUnknown: true, hideChains: false, keyword: '' };

export default function Discovery({ savedLocations, onCollect, onNavigate, onShare }) {
  const [bounds, setBounds] = useState(null);
  const [result, setResult] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState(false);
  const [mobileView, setMobileView] = useState('map');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [collectError, setCollectError] = useState('');
  const [saving, setSaving] = useState('');
  const savingRef = useRef(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [focus, setFocus] = useState(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const visible = useMemo(() => filterRestaurants(result?.restaurants || [], filters), [result, filters]);
  const savedIds = useMemo(() => new Set(savedLocations.map((item) => item.sourceId).filter(Boolean)), [savedLocations]);
  const tooWide = bounds && (bounds.east - bounds.west > 0.12 || bounds.north - bounds.south > 0.12);
  const moved = result && bounds && ['west', 'south', 'east', 'north'].some((key) => Math.abs(bounds[key] - result.bounds[key]) > 0.0005);
  const activeCount = Number(filters.category !== 'all') + Number(filters.maximum !== '') + Number(filters.hideChains) + Number(!filters.includeUnknown);
  useEffect(() => { if (selected && !visible.some((item) => item.id === selected.id)) setSelected(null); }, [visible, selected]);
  function change(key, value) { setFilters((previous) => ({ ...previous, [key]: value })); }
  async function search() {
    if (!bounds || tooWide || loading) return;
    const id = ++generation.current;
    setLoading(true); setError(''); setCollectError('');
    try {
      const next = await api.discoverRestaurants(bounds);
      if (generation.current !== id) return;
      setResult(next); setSelected(null); setMobileView('list');
    } catch (err) {
      if (generation.current === id) setError(err.message);
    } finally { if (generation.current === id) setLoading(false); }
  }
  async function collect(item) {
    if (savingRef.current || savedIds.has(item.sourceId)) return;
    savingRef.current = true;
    setSaving(item.sourceId); setCollectError('');
    try { await onCollect(restaurantToLocation(item)); }
    catch (err) { setCollectError(err.message); }
    finally { setSaving(''); savingRef.current = false; }
  }
  function open(item) { setSelected(item); setDetail(item); setCollectError(''); }
  function focusOnMap(item) { setSelected(item); setDetail(null); setFocus({ ...item, focusToken: Date.now() }); setMobileView('map'); }
  const searchDisabled = !bounds || tooWide || loading;
  const searchHint = tooWide ? '请放大地图后搜索。' : !bounds ? '等待地图加载…' : moved ? '地图范围已改变，点击搜索刷新结果。' : '移动地图，搜索你想逛的街区。';
  return <>
    <div className="discovery-mobile-toolbar">
      <div className="discovery-view-switch" role="group" aria-label="发现视图">
        <button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>地图</button>
        <button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>列表{result ? ` · ${visible.length}` : ''}</button>
      </div>
      <button className="button button--primary" disabled={searchDisabled} onClick={search}>{loading ? '正在搜索…' : '搜索当前区域'}</button>
      {mobileView === 'map' ? <p role="status">{error || searchHint}</p> : null}
    </div>
    <aside className={`discovery-panel discovery-panel--${mobileView}`} aria-label="发现小馆">
      <div className="discovery-controls">
        <div className="discovery-heading"><h2>发现小馆</h2><span className="tag">福州</span></div>
        <div className="discovery-desktop-search"><button className="button button--primary discovery-search" disabled={searchDisabled} onClick={search}>{loading ? '正在搜索…' : '搜索当前区域'}</button><p>{tooWide ? '请放大地图后搜索。' : !bounds ? '等待地图加载…' : '移动地图，搜索你想逛的街区。'}</p></div>
        <div className="search-field"><span aria-hidden="true">⌕</span><input type="search" aria-label="筛选搜索结果" placeholder="搜索店名、地址或菜系" value={filters.keyword} onChange={(event) => change('keyword', event.target.value)} />{filters.keyword ? <button aria-label="清空搜索" onClick={() => change('keyword', '')}>×</button> : null}</div>
        <div className="filter-block"><div className="filter-primary">
          <select aria-label="类型" value={filters.category} onChange={(event) => change('category', event.target.value)}><option value="all">全部餐饮</option><option value="food">餐馆小吃</option><option value="cafe_bar">咖啡茶饮</option></select>
          <select aria-label="人均预算" value={filters.maximum} onChange={(event) => change('maximum', event.target.value)}><option value="">预算不限</option><option value="30">30 元以内</option><option value="50">50 元以内</option><option value="100">100 元以内</option><option value="200">200 元以内</option></select>
          <button className={`filter-toggle ${activeCount ? 'is-active' : ''}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>筛选{activeCount ? ` ${activeCount}` : ''}</button>
        </div>{expanded ? <div className="discovery-options"><label><input type="checkbox" checked={filters.includeUnknown} onChange={(event) => change('includeUnknown', event.target.checked)} />保留价格未知</label><label><input type="checkbox" checked={filters.hideChains} onChange={(event) => change('hideChains', event.target.checked)} />隐藏常见连锁</label><button className="text-button" onClick={() => setFilters(EMPTY_FILTERS)}>清空筛选</button></div> : null}</div>
        <div className="list-summary"><span>{result ? <><strong>{visible.length}</strong> / {result.restaurants.length} 家候选</> : '尚未搜索'}</span>{result ? <span>查询于 {new Date(result.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span> : null}</div>
      </div>
      <div className="discovery-results compact-list" tabIndex={0} aria-label="发现小馆结果" aria-busy={loading}>
        {error ? <p className="inline-notice inline-notice--error" role="alert">{error}{result ? '。下方保留上次结果。' : ''}</p> : null}
        {collectError && !detail ? <p className="inline-notice inline-notice--error" role="alert">{collectError}</p> : null}
        {result?.partial ? <p className="inline-notice inline-notice--warning" role="status">部分区域搜索失败，结果不完整，请重试。</p> : null}
        {moved ? <p className="discovery-hint" role="status">地图范围已改变，点击搜索刷新结果。</p> : null}
        {!result ? <div className="empty-state"><span aria-hidden="true">⌖</span><h3>找一家想去的小馆</h3><p>在地图上找到想逛的街区，再点「搜索当前区域」。</p></div> : !visible.length ? <div className="empty-state"><h3>{result.restaurants.length ? '没有符合筛选的餐馆' : '本次搜索没有返回餐馆'}</h3><p>{result.restaurants.length ? '调整预算、类型或搜索词试试。' : '移动地图或放大到附近街区再试。'}</p>{result.restaurants.length ? <button className="button button--quiet" onClick={() => setFilters(EMPTY_FILTERS)}>清空筛选</button> : null}</div> : null}
        {visible.map((item) => <article className={`discovery-card location-card ${selected?.id === item.id ? 'is-active' : ''}`} key={item.id}>
          <button className="location-card__main" onClick={() => open(item)} aria-label={`查看${item.name}详情`}><span className={`category-square category-square--${item.category}`}>{(CATEGORIES[item.category] || CATEGORIES.food).short}</span><span className="location-card__copy"><strong>{item.name}</strong><span className="location-address">{item.address || '地址暂无'}</span><span className="location-meta"><span>{item.rating == null ? '评分暂无' : `高德 ${item.rating.toFixed(1)}`}</span><span>{item.averageCost == null ? '人均未知' : `人均 ¥${item.averageCost}`}</span></span></span></button>
          <button className="button button--quiet" disabled={Boolean(saving) || savedIds.has(item.sourceId)} onClick={() => collect(item)} aria-label={`收藏${item.name}`}>{savedIds.has(item.sourceId) ? '已收藏' : saving === item.sourceId ? '收藏中…' : '收藏'}</button>
        </article>)}
      </div>
      <p className="discovery-footnote">高德搜索候选，未覆盖全部餐馆。评分和人均仅供参考。</p>
    </aside>
    <div className={`discovery-map discovery-map--${mobileView}`}><MapCanvas locations={visible} activeId={selected?.id} focusRequest={focus} onSelect={open} onViewportChange={setBounds} discovery /></div>
    <LocationDetailDrawer location={detail} discovery onClose={() => setDetail(null)} onFocus={focusOnMap} onNavigate={onNavigate} onShare={onShare} onCollect={collect} collecting={Boolean(saving)} collected={savedIds.has(detail?.sourceId)} collectError={collectError} />
  </>;
}
