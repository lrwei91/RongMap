import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, SOURCE_LABELS, hasCoordinates, relativeTime } from '../lib/location';

export const EMPTY_FILTERS = {
  keyword: '',
  category: 'all',
  geocoded: 'all',
  member: 'all',
  source: 'all',
  tag: 'all',
  sort: 'created'
};

export function LocationSearch({ value, onChange, locations, onSelect }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) return [];
    return locations.filter((item) => `${item.name} ${item.address}`.toLowerCase().includes(keyword)).slice(0, 6);
  }, [locations, value]);

  function onKeyDown(event) {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      onSelect?.(suggestions[activeIndex]);
      setOpen(false);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="search-field">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        value={value}
        placeholder="搜索名称、地址、备注或标签"
        aria-label="搜索地点"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls="location-search-suggestions"
        aria-activedescendant={open && suggestions[activeIndex] ? `suggestion-${suggestions[activeIndex].id}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={onKeyDown}
      />
      {value ? <button type="button" onClick={() => onChange('')} aria-label="清空搜索">×</button> : null}
      {open && suggestions.length ? (
        <div id="location-search-suggestions" className="search-popover" role="listbox">
          {suggestions.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              id={`suggestion-${item.id}`}
              className={index === activeIndex ? 'is-active' : ''}
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onSelect?.(item); setOpen(false); }}
            >
              <strong>{item.name}</strong>
              <span>{item.address}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FilterBar({ filters, onChange, members, tags }) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = ['category', 'geocoded', 'member', 'source', 'tag'].filter((key) => filters[key] !== 'all').length;
  const set = (key, value) => onChange({ ...filters, [key]: value });
  return (
    <div className="filter-block">
      <div className="filter-primary">
        <select value={filters.category} onChange={(e) => set('category', e.target.value)} aria-label="主分类">
          <option value="all">全部分类</option>
          {Object.entries(CATEGORIES).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}
        </select>
        <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="排序方式">
          <option value="created">最近添加</option>
          <option value="updated">最近修改</option>
          <option value="name">按名称</option>
        </select>
        <button type="button" className={`filter-toggle ${activeCount ? 'is-active' : ''}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          筛选{activeCount ? ` ${activeCount}` : ''}
        </button>
      </div>
      {expanded ? (
        <div className="filter-more">
          <label>定位状态<select value={filters.geocoded} onChange={(e) => set('geocoded', e.target.value)}><option value="all">全部</option><option value="yes">已定位</option><option value="no">未定位</option></select></label>
          <label>添加者<select value={filters.member} onChange={(e) => set('member', e.target.value)}><option value="all">全部</option>{members.map((item) => <option value={item.id} key={item.id}>{item.name || item.email}</option>)}</select></label>
          <label>来源<select value={filters.source} onChange={(e) => set('source', e.target.value)}><option value="all">全部</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>标签<select value={filters.tag} onChange={(e) => set('tag', e.target.value)}><option value="all">全部</option>{tags.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          {activeCount ? <button type="button" className="text-button" onClick={() => onChange({ ...EMPTY_FILTERS, keyword: filters.keyword, sort: filters.sort })}>清空筛选</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CompactLocationCard({ location, active, selected, member, onToggle, onOpen, onFocus, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const category = CATEGORIES[location.category] || CATEGORIES.food;
  return (
    <article className={`location-card ${active ? 'is-active' : ''} ${menuOpen ? 'is-menu-open' : ''}`}>
      <label className="selection-check" title="选择地点">
        <input type="checkbox" checked={selected} onChange={() => onToggle(location.id)} />
        <span className="sr-only">选择 {location.name}</span>
      </label>
      <button type="button" className="location-card__main" onClick={() => onOpen(location)}>
        <span className={`category-square category-square--${location.category}`}>{category.short}</span>
        <span className="location-card__copy">
          <strong>{location.name}</strong>
          <span className="location-address">{location.address}</span>
          <span className="location-meta">
            <span>{category.label}</span>
            {(location.tags || []).slice(0, 2).map((tag) => <span className="tag" key={tag.id || tag}>{tag.name || tag}</span>)}
            <span>{member?.name || location.createdByName || '空间成员'} · {relativeTime(location.createdAt)}</span>
          </span>
        </span>
      </button>
      <div className="context-menu">
        <button type="button" className="icon-button" aria-label={`打开 ${location.name} 操作菜单`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>•••</button>
        {menuOpen ? (
          <div className="context-menu__popover">
            <button type="button" disabled={!hasCoordinates(location)} onClick={() => { onFocus(location); setMenuOpen(false); }}>聚焦地图</button>
            <button type="button" onClick={() => { onEdit(location); setMenuOpen(false); }}>编辑</button>
            <button type="button" className="danger-text" onClick={() => { onDelete(location); setMenuOpen(false); }}>移入回收站</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function BulkActionBar({ count, tags, onApply, onClear }) {
  const [tagId, setTagId] = useState('');
  if (!count) return null;
  return (
    <div className="bulk-bar" role="region" aria-label="批量操作">
      <strong>已选 {count} 项</strong>
      <select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="批量添加标签">
        <option value="">选择标签</option>
        {tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}
      </select>
      <button type="button" className="button button--quiet" disabled={!tagId} onClick={() => onApply('tag', tagId)}>添加标签</button>
      <button type="button" className="button button--danger-quiet" onClick={() => onApply('trash')}>移入回收站</button>
      <button type="button" className="text-button" onClick={onClear}>取消选择</button>
    </div>
  );
}

export function LocationPanel({ locations, allLocations, filters, onFilters, activeId, selectedIds, members, tags, onToggle, onSelectAll, onOpen, onFocus, onEdit, onDelete, onBulk, onClearSelection, onAdd, onImport, onExport, fullPage = false }) {
  const [visibleCount, setVisibleCount] = useState(80);
  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  useEffect(() => setVisibleCount(80), [filters]);
  return (
    <section className={`location-panel ${fullPage ? 'location-panel--full' : ''}`} aria-label="地点列表">
      <div className="location-panel__sticky">
        <LocationSearch value={filters.keyword} onChange={(keyword) => onFilters({ ...filters, keyword })} locations={allLocations} onSelect={onOpen} />
        <FilterBar filters={filters} onChange={onFilters} members={members} tags={tags} />
        <div className="list-summary">
          <label><input type="checkbox" checked={locations.length > 0 && locations.every((item) => selectedIds.has(item.id))} onChange={() => onSelectAll(locations)} /> 全选当前</label>
          <span><strong>{locations.length}</strong> / {allLocations.length}</span>
        </div>
      </div>
      <BulkActionBar count={selectedIds.size} tags={tags} onApply={onBulk} onClear={onClearSelection} />
      <div className="compact-list">
        {locations.length ? locations.slice(0, visibleCount).map((location) => (
          <CompactLocationCard
            key={location.id}
            location={location}
            member={memberMap.get(location.createdBy)}
            active={location.id === activeId}
            selected={selectedIds.has(location.id)}
            onToggle={onToggle}
            onOpen={onOpen}
            onFocus={onFocus}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )) : (
          <div className="empty-state">
            <span aria-hidden="true">⌖</span>
            <h3>没有匹配的地点</h3>
            <p>{allLocations.length ? '调整筛选条件后再试。' : '添加第一个地点，开始共享地图。'}</p>
            <button type="button" className="button button--primary" onClick={onAdd}>添加地点</button>
          </div>
        )}
        {visibleCount < locations.length ? <button type="button" className="load-more" onClick={() => setVisibleCount((count) => count + 80)}>继续加载 {locations.length - visibleCount} 个地点</button> : null}
      </div>
      <div className="panel-footer-actions">
        <button type="button" className="button button--quiet" onClick={onImport}>批量导入</button>
        <button type="button" className="button button--quiet" onClick={() => onExport('json')}>导出 JSON</button>
        <button type="button" className="button button--quiet" onClick={() => onExport('csv')}>导出 CSV</button>
        <button type="button" className="button button--primary" onClick={onAdd}>添加地点</button>
      </div>
    </section>
  );
}

export function LocationDetailDrawer({ location, member, onClose, onFocus, onNavigate, onShare, onEdit, onDelete }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!location) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [location, onClose]);
  if (!location) return null;
  const category = CATEGORIES[location.category] || CATEGORIES.food;
  const hasPoint = hasCoordinates(location);
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header className="drawer-header">
          <span className={`category-square category-square--${location.category}`}>{category.short}</span>
          <div><p className="eyebrow">地点详情</p><h2 id="detail-title">{location.name}</h2></div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">×</button>
        </header>
        <div className="drawer-body">
          <section><h3>地址</h3><p>{location.address}</p></section>
          <section><h3>备注</h3><p>{location.reason || '暂无备注'}</p></section>
          <section><h3>分类与标签</h3><div className="tag-row"><span className="tag tag--strong">{category.label}</span>{(location.tags || []).map((tag) => <span className="tag" key={tag.id || tag}>{tag.name || tag}</span>)}</div></section>
          <section className="detail-grid"><div><h3>添加者</h3><p>{member?.name || location.createdByName || '空间成员'}</p></div><div><h3>添加时间</h3><p>{new Date(location.createdAt).toLocaleString('zh-CN')}</p></div></section>
          {!hasPoint ? <div className="inline-notice inline-notice--warning"><span>!</span>该地点尚未定位，聚焦、导航和海报暂不可用。</div> : null}
        </div>
        <footer className="drawer-actions">
          <button type="button" className="button button--primary" disabled={!hasPoint} onClick={() => onFocus(location)}>聚焦地图</button>
          <button type="button" className="button button--quiet" disabled={!hasPoint} onClick={() => onNavigate(location)}>导航</button>
          <button type="button" className="button button--quiet" disabled={!hasPoint} onClick={() => onShare(location)}>分享</button>
          <button type="button" className="button button--quiet" onClick={() => onEdit(location)}>编辑</button>
          <button type="button" className="button button--danger-quiet" onClick={() => onDelete(location)}>移入回收站</button>
        </footer>
      </aside>
    </div>
  );
}
