import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../data/api';
import { CATEGORIES, normalizeSearchPoi } from '../lib/location';

function Modal({ title, eyebrow, children, footer, onClose, wide = false }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = bodyOverflow;
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2 id="modal-title">{title}</h2></div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function LocationFormDialog({ location, tags, onClose, onSave, busy }) {
  const [form, setForm] = useState(() => ({
    name: location?.name || '',
    address: location?.address || '',
    category: location?.category || 'food',
    reason: location?.reason || '',
    latitude: location?.latitude ?? '',
    longitude: location?.longitude ?? '',
    tagIds: (location?.tags || []).map((tag) => tag.id || tag)
  }));
  const [suggestions, setSuggestions] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const requestIdRef = useRef(0);
  const selectedPoiRef = useRef(null);
  const skipSearchRef = useRef(true);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.name.trim() && form.address.trim();
  useEffect(() => {
    const keyword = form.address.trim();
    if (skipSearchRef.current) { skipSearchRef.current = false; return undefined; }
    if (!keyword) { requestIdRef.current += 1; setSuggestions([]); setSearchState('idle'); return undefined; }
    const requestId = ++requestIdRef.current;
    setSearchState('loading');
    const timer = setTimeout(async () => {
      try {
        const result = await api.searchPlaces(keyword);
        if (requestId !== requestIdRef.current) return;
        const next = (result.pois || []).map(normalizeSearchPoi).filter(Boolean).slice(0, 8);
        setSuggestions(next);
        setActiveSuggestion(next.length ? 0 : -1);
        setSearchState(next.length ? 'ready' : 'empty');
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setActiveSuggestion(-1);
        setSearchState('error');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.address]);

  function changeAddress(value) {
    if (selectedPoiRef.current && value !== selectedPoiRef.current.address) {
      selectedPoiRef.current = null;
      setForm((current) => ({ ...current, address: value, latitude: '', longitude: '', sourceId: '', matchType: '', poiType: '', city: '', district: '' }));
    } else set('address', value);
  }

  function chooseSuggestion(item) {
    selectedPoiRef.current = item;
    skipSearchRef.current = true;
    requestIdRef.current += 1;
    setForm((current) => ({ ...current, name: item.name, address: item.address, latitude: item.latitude, longitude: item.longitude, sourceId: item.sourceId, sourceType: 'manual', sourcePlatform: 'web', matchType: 'manual_search', poiType: item.poiType, city: item.city, district: item.district }));
    setSuggestions([]);
    setActiveSuggestion(-1);
    setSearchState('selected');
  }

  function onAddressKeyDown(event) {
    if (event.key === 'Escape' && suggestions.length) { event.preventDefault(); event.stopPropagation(); setSuggestions([]); setActiveSuggestion(-1); return; }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveSuggestion((current) => (current + 1) % suggestions.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1)); }
    if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(suggestions[activeSuggestion]); }
  }
  function toggleTag(id) {
    set('tagIds', form.tagIds.includes(id) ? form.tagIds.filter((item) => item !== id) : [...form.tagIds, id]);
  }
  return (
    <Modal
      title={location ? '编辑地点' : '添加地点'}
      eyebrow={location ? '更新共享信息' : '加入共享地图'}
      onClose={onClose}
      footer={<><button type="button" className="button button--quiet" onClick={onClose}>取消</button><button type="button" className="button button--primary" disabled={!valid || busy} onClick={() => onSave(form)}>{busy ? '保存中…' : '保存地点'}</button></>}
    >
      <div className="form-grid">
        <label className="field field--full"><span>地点名称</span><input autoFocus value={form.name} maxLength={120} placeholder="搜索或输入地点名称" onChange={(e) => set('name', e.target.value)} /></label>
        <div className="field field--full address-search"><label htmlFor="location-address">地址</label><input id="location-address" role="combobox" aria-autocomplete="list" aria-expanded={Boolean(suggestions.length)} aria-controls="address-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `address-suggestion-${activeSuggestion}` : undefined} autoComplete="off" value={form.address} maxLength={240} placeholder="输入地点名称或详细地址" onChange={(e) => changeAddress(e.target.value)} onKeyDown={onAddressKeyDown} />{searchState === 'loading' ? <small className="address-search__status" role="status">正在搜索高德地点…</small> : null}{searchState === 'empty' ? <small className="address-search__status">没有匹配结果，也可以继续手动填写。</small> : null}{searchState === 'error' ? <small className="address-search__status address-search__status--error" role="alert">地址联想暂时不可用，可继续手动填写。</small> : null}{searchState === 'selected' ? <small className="address-search__status address-search__status--selected">✓ 已回填地址和经纬度</small> : null}{suggestions.length ? <div id="address-suggestions" className="address-suggestions" role="listbox" aria-label="地址联想结果">{suggestions.map((item, index) => <button id={`address-suggestion-${index}`} key={item.id} type="button" role="option" aria-selected={index === activeSuggestion} className={index === activeSuggestion ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); chooseSuggestion(item); }}><strong>{item.name}</strong><small>{item.address}</small></button>)}</div> : null}</div>
        <label className="field"><span>主分类</span><select value={form.category} onChange={(e) => set('category', e.target.value)}>{Object.entries(CATEGORIES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
        <label className="field"><span>备注</span><input value={form.reason} maxLength={240} placeholder="补充推荐理由或其他说明（选填）" onChange={(e) => set('reason', e.target.value)} /></label>
        <label className="field"><span>纬度</span><input inputMode="decimal" value={form.latitude} placeholder="例如 26.061473" onChange={(e) => set('latitude', e.target.value)} /></label>
        <label className="field"><span>经度</span><input inputMode="decimal" value={form.longitude} placeholder="例如 119.296531" onChange={(e) => set('longitude', e.target.value)} /></label>
        <fieldset className="field field--full tag-picker"><legend>标签</legend>{tags.length ? tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={form.tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} />{tag.name}</label>) : <p>还没有自定义标签，可在空间设置中创建。</p>}</fieldset>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({ title = '请确认', message, confirmLabel = '确认', danger = false, onClose, onConfirm, busy }) {
  return (
    <Modal
      title={title}
      eyebrow="操作确认"
      onClose={onClose}
      footer={<><button type="button" className="button button--quiet" onClick={onClose}>取消</button><button type="button" className={`button ${danger ? 'button--danger' : 'button--primary'}`} disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmLabel}</button></>}
    >
      <p className="confirm-copy">{message}</p>
    </Modal>
  );
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const aliases = { 名称: 'name', name: 'name', 地点: 'name', 地址: 'address', address: 'address', 分类: 'category', category: 'category', 备注: 'reason', reason: 'reason', 纬度: 'latitude', latitude: 'latitude', 经度: 'longitude', longitude: 'longitude', 标签: 'tags', tags: 'tags' };
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [aliases[header] || header, values[index] || ''])));
}

export function ImportWizard({ onClose, onPreview, onCommit }) {
  const [step, setStep] = useState(1);
  const [records, setRecords] = useState([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [policy, setPolicy] = useState('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stepLabels = ['上传文件', '字段映射', '重复预览', '确认导入', '完成'];

  async function readFile(file) {
    setError('');
    try {
      const text = await file.text();
      const parsed = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text.replace(/^\uFEFF/, ''));
      const list = Array.isArray(parsed) ? parsed : parsed.locations;
      if (!Array.isArray(list) || !list.length) throw new Error('文件中没有可导入的地点');
      setRecords(list);
      setFileName(file.name);
      setStep(2);
    } catch (err) {
      setError(err.message || '文件解析失败');
    }
  }

  async function previewRecords() {
    setBusy(true);
    try { setPreview(await onPreview(records)); setStep(3); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true);
    try { setPreview(await onCommit({ records, policy })); setStep(5); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const footer = step === 5
    ? <button type="button" className="button button--primary" onClick={onClose}>完成</button>
    : <><button type="button" className="button button--quiet" onClick={step === 1 ? onClose : () => setStep(step - 1)}>返回</button>{step === 2 ? <button type="button" className="button button--primary" disabled={busy} onClick={previewRecords}>{busy ? '分析中…' : '分析重复项'}</button> : null}{step === 3 ? <button type="button" className="button button--primary" onClick={() => setStep(4)}>继续</button> : null}{step === 4 ? <button type="button" className="button button--primary" disabled={busy} onClick={commit}>{busy ? '导入中…' : '开始导入'}</button> : null}</>;

  return (
    <Modal title="批量导入地点" eyebrow="CSV / JSON" onClose={onClose} wide footer={footer}>
      <ol className="wizard-steps">{stepLabels.map((label, index) => <li className={index + 1 <= step ? 'is-active' : ''} key={label}><span>{index + 1}</span>{label}</li>)}</ol>
      {error ? <div className="inline-notice inline-notice--error"><span>!</span>{error}</div> : null}
      {step === 1 ? <label className="file-drop"><input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} /><span>⇧</span><strong>选择 CSV 或 JSON 文件</strong><small>上传后会先预览，不会立即写入共享空间。</small></label> : null}
      {step === 2 ? <div className="mapping-preview"><h3>{fileName}</h3><p>识别到 {records.length} 条记录。系统会映射名称、地址、分类、备注、坐标和标签。</p><div className="preview-table"><table><thead><tr><th>名称</th><th>地址</th><th>分类</th></tr></thead><tbody>{records.slice(0, 5).map((item, index) => <tr key={index}><td>{item.name || item.名称 || '—'}</td><td>{item.address || item.地址 || '—'}</td><td>{item.category || item.分类 || 'food'}</td></tr>)}</tbody></table></div></div> : null}
      {step === 3 && preview ? <div className="import-summary"><div><strong>{preview.newCount}</strong><span>可新增</span></div><div><strong>{preview.duplicateCount}</strong><span>重复</span></div><div><strong>{preview.conflictCount}</strong><span>需合并</span></div><div><strong>{preview.invalidCount}</strong><span>格式错误</span></div></div> : null}
      {step === 4 ? <div className="policy-options"><h3>遇到重复或冲突时</h3>{[['merge', '合并有价值字段', '保留已有地点，补充备注、坐标和标签。'], ['skip', '跳过重复项', '只导入确认是新地点的记录。'], ['overwrite', '使用导入数据覆盖', '以文件内容更新匹配地点。']].map(([value, title, copy]) => <label key={value} className={policy === value ? 'is-selected' : ''}><input type="radio" name="policy" value={value} checked={policy === value} onChange={() => setPolicy(value)} /><span><strong>{title}</strong><small>{copy}</small></span></label>)}</div> : null}
      {step === 5 ? <div className="import-complete"><span>✓</span><h3>导入完成</h3><p>新增 {preview?.created || 0} 个，更新 {preview?.updated || 0} 个，跳过 {preview?.skipped || 0} 个。</p></div> : null}
    </Modal>
  );
}

export function UndoToast({ notice, onUndo, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  return <div className={`undo-toast${notice.error ? ' undo-toast--error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? '!' : '✓'}</span><p>{notice.message}</p>{onUndo ? <button type="button" onClick={onUndo}>撤销</button> : null}<button type="button" aria-label="关闭提示" onClick={onClose}>×</button></div>;
}
