import React, { useEffect, useRef, useState } from 'react';
import { api } from '../data/api';
import TravelGuideContent, { SourceList } from '../components/TravelGuideContent';
import { EMPTY_TRAVEL_REQUEST, downloadGuide } from '../lib/travel-guide';
import { MODES } from '../lib/roadbook';

export default function TravelGuidePage({ trips, tripId, onOpen, onBack, onEditTrip, onChanged, onDirtyChange, isAdmin }) {
  const [request, setRequest] = useState(EMPTY_TRAVEL_REQUEST);
  const [references, setReferences] = useState([]);
  const [research, setResearch] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(!tripId);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [inspections, setInspections] = useState({});
  const [inspecting, setInspecting] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [sourceProgress, setSourceProgress] = useState('');
  const contentRef = useRef(null);
  const generationRef = useRef(0);
  const dirty = touched || Boolean(draft) || Boolean(busy);
  const current = draft || saved;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { generationRef.current += 1; onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const guard = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  async function load() {
    const revision = ++generationRef.current;
    setError(''); setConflict(false); setMessage(''); setSaved(null); setDraft(null); setTouched(false); setResearch(null); setInspections({}); setEditing(!tripId);
    if (!tripId) { setRequest(EMPTY_TRAVEL_REQUEST); setReferences([]); return; }
    setBusy('load');
    try {
      const trip = await api.loadTrip(tripId);
      if (revision !== generationRef.current) return;
      setSaved(trip);
      setRequest({ ...EMPTY_TRAVEL_REQUEST, ...(trip.roadbook?.guide?.request || { destination: '', startDate: trip.startDate || '', dayCount: trip.days.length, travelers: trip.roadbook?.travelers || 2, mode: trip.roadbook?.mode || 'car', budget: trip.roadbook?.budget ?? '', preferences: trip.roadbook?.preferences || '' }) });
      setReferences((trip.roadbook?.guide?.sources || []).filter((source) => source.platform === 'reference').map((source) => ({ title: source.name, url: source.url, excerpt: source.excerpt })));
    } catch (err) { if (revision === generationRef.current) setError(err.message); }
    finally { if (revision === generationRef.current) setBusy(''); }
  }
  useEffect(() => { load(); }, [tripId]);
  function update(patch) { setRequest((value) => ({ ...value, ...patch })); setTouched(true); setResearch(null); setSelected(new Set()); }
  function updateReference(index, patch) { setReferences((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); setTouched(true); setResearch(null); }
  async function collect(event) {
    event.preventDefault(); setBusy('collect'); setError(''); setMessage('');
    const revision = ++generationRef.current;
    try {
      let result = await api.collectTravelGuide({ ...request, sources: references });
      if (revision !== generationRef.current) return;
      setResearch(result); setDraft(null); setInspections({});
      setSelected(new Set([...result.places.filter((poi) => poi.category === 'spot').slice(0, 8), ...result.places.filter((poi) => poi.category !== 'spot').slice(0, 4)].map((poi) => poi.sourceId)));
      for (const platform of ['xiaohongshu', 'dianping']) {
        if (!result.sources.some((source) => source.id === platform && source.status === 'pending')) continue;
        const name = platform === 'xiaohongshu' ? '小红书' : '大众点评';
        setSourceProgress(`正在检索${name}，请保留此页面…`);
        try {
          result = await api.queryTravelSource({ researchToken: result.researchToken, platform, step: 'search' });
          if (revision !== generationRef.current) return;
          setResearch(result);
          const notes = result.next || [];
          for (let index = 0; index < notes.length; index++) {
            setSourceProgress(`正在读取${name}详情 ${index + 1}/${notes.length}…`);
            result = await api.queryTravelSource({ researchToken: result.researchToken, platform, step: 'detail', noteId: notes[index].id });
            if (revision !== generationRef.current) return;
            setResearch(result);
          }
        } catch (err) {
          if (revision !== generationRef.current) return;
          setError(`${name}采集未完成：${err.message}。可继续使用其他来源规划。`);
        }
      }
      setSourceProgress('');
      if (revision !== generationRef.current) return;
      setResearch(result);
    } catch (err) { if (revision === generationRef.current) setError(err.message); }
    finally { if (revision === generationRef.current) { setBusy(''); setSourceProgress(''); } }
  }
  async function generate() {
    setBusy('generate'); setError(''); setMessage('');
    const revision = ++generationRef.current;
    try {
      const result = await api.generateTravelGuide({ researchToken: research.researchToken, sourceIds: [...selected] });
      if (revision !== generationRef.current) return;
      setDraft({ ...result.trip, ...(saved ? { id: saved.id, version: saved.version } : {}) });
      setMessage(result.warnings.join(' ')); setInspections({}); setEditing(false);
    } catch (err) { if (revision === generationRef.current) setError(err.message); }
    finally { if (revision === generationRef.current) setBusy(''); }
  }
  async function save() {
    setBusy('save'); setError(''); setConflict(false);
    try {
      const trip = saved ? await api.updateTrip(saved.id, draft) : await api.createTrip(draft);
      setSaved(trip); setDraft(null); setTouched(false); onDirtyChange(false); setMessage('旅行攻略已保存');
      await onChanged();
      if (!tripId) onOpen(trip.id, { saved: true });
    } catch (err) { setError(err.status === 409 ? '其他成员已更新此行程。草稿已保留，可载入最新版本后重新规划。' : err.message); setConflict(err.status === 409); }
    finally { setBusy(''); }
  }
  async function inspect(dayIndex) {
    setInspecting(dayIndex); setError('');
    try { const result = await api.inspectRoadbook(saved.id, dayIndex); setInspections((rows) => ({ ...rows, [dayIndex]: result })); }
    catch (err) { setError(err.message); }
    finally { setInspecting(null); }
  }
  async function share() {
    setBusy('share'); setError('');
    try {
      const link = await api.createShareLink({ scope: 'trip', tripId: saved.id, label: saved.name });
      const url = `${window.location.origin}/share/${link.token}`;
      try { await navigator.clipboard.writeText(url); setMessage('攻略只读链接已复制'); }
      catch { setMessage(`攻略只读链接：${url}`); }
      await onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  function replan() { setEditing(true); setDraft(null); setResearch(null); setError(''); setMessage(''); }
  const step = draft || (saved && !editing) ? 2 : research ? 1 : 0;
  const matches = trips.filter((trip) => trip.name.toLowerCase().includes(keyword.trim().toLowerCase()));
  return <main className="management-page travel-guide-page">
    <header className="page-header"><div>{tripId ? <button className="text-button" onClick={onBack}>← 返回旅行攻略</button> : <p className="eyebrow">从旅行想法到逐日安排</p>}<h2>{current?.name || '规划一份旅行攻略'}</h2><p>先选目的地与偏好，再核对候选地点，生成带来源的旅行安排。</p></div>{saved && !editing ? <button className="button button--quiet" disabled={Boolean(busy)} onClick={replan}>重新规划</button> : null}</header>
    {error ? <div className="inline-notice inline-notice--error" role="alert">{error}{conflict ? <button className="text-button" onClick={load}>载入最新版本</button> : tripId && !saved && !busy ? <button className="text-button" onClick={load}>重新加载</button> : null}</div> : null}
    {message ? <p className="inline-notice" role="status">{message}</p> : null}
    <ol className="guide-steps" aria-label="攻略规划进度">{['旅行需求', '候选与来源', '逐日攻略'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step >= index ? 'is-active' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
    {sourceProgress ? <p className="inline-notice" role="status">{sourceProgress}</p> : null}
    {busy === 'load' ? <p role="status">正在载入旅行攻略…</p> : null}
    {editing ? <form className="guide-request" onSubmit={collect}><fieldset disabled={Boolean(busy)}><div className="guide-form-grid">
      <label>目的地城市<input required maxLength={60} value={request.destination} placeholder="例如：福州、昆明、大理" onChange={(event) => update({ destination: event.target.value })} /></label>
      <label>出发日期（选填）<input type="date" value={request.startDate || ''} onChange={(event) => update({ startDate: event.target.value })} /></label>
      <label>旅行天数<input required type="number" min="1" max="14" value={request.dayCount} onChange={(event) => update({ dayCount: Number(event.target.value) })} /></label>
      <label>同行人数<input required type="number" min="1" max="30" value={request.travelers} onChange={(event) => update({ travelers: Number(event.target.value) })} /></label>
      <label>人均总预算（元，选填）<input type="number" min="0" max="1000000" value={request.budget ?? ''} placeholder="例如：3000" onChange={(event) => update({ budget: event.target.value })} /></label>
      <label>出行方式<select value={request.mode} onChange={(event) => update({ mode: event.target.value })}>{Object.entries(MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>出发地（选填）<input maxLength={120} value={request.origin} placeholder="例如：福州市区 / 福州站" onChange={(event) => update({ origin: event.target.value })} /></label>
      <label>已订住宿（选填）<input maxLength={120} value={request.hotel} placeholder="例如：平潭海边民宿" onChange={(event) => update({ hotel: event.target.value })} /></label>
      <label className="guide-field-wide">同行构成与偏好（选填）<textarea maxLength={800} rows="3" value={request.preferences} placeholder="例如：带父母、慢节奏，喜欢人文与本地美食，留出午休" onChange={(event) => update({ preferences: event.target.value })} /></label>
      <label className="guide-field-wide">必须满足的安排与避忌（选填）<textarea maxLength={800} rows="2" value={request.constraints} placeholder="例如：第二天下午返程、不吃辣、避开爬山" onChange={(event) => update({ constraints: event.target.value })} /></label>
    </div><details className="guide-references"><summary>补充攻略链接与摘录（选填）</summary><p>链接用于追溯来源；请粘贴有用片段，全文不会自动读取。</p>{references.map((row, index) => <div className="guide-reference" key={index}><label>来源标题 {index + 1}<input value={row.title} maxLength={100} onChange={(event) => updateReference(index, { title: event.target.value })} /></label><label>来源链接 {index + 1}<input required type="url" value={row.url} placeholder="https://…" onChange={(event) => updateReference(index, { url: event.target.value })} /></label><label>攻略摘录 {index + 1}<textarea value={row.excerpt} maxLength={1000} onChange={(event) => updateReference(index, { excerpt: event.target.value })} /></label><button type="button" className="text-button" onClick={() => { setReferences((rows) => rows.filter((_, i) => i !== index)); setTouched(true); setResearch(null); }}>移除此来源</button></div>)}<button type="button" className="button button--quiet" disabled={references.length >= 8} onClick={() => { setReferences((rows) => [...rows, { title: '', url: '', excerpt: '' }]); setTouched(true); }}>添加攻略来源</button></details><div className="guide-actions"><button className="button button--primary" disabled={!request.destination.trim()}>{busy === 'collect' ? '正在搜集地点…' : research ? '重新搜集候选地点' : '搜集候选地点'}</button><small>{request.destination.trim() ? '下一步核对地点，再交给 AI 规划。' : '先填写目的地城市，再开始搜集候选地点。'}</small></div></fieldset></form> : null}
    {research && editing ? <section className="guide-section"><header className="guide-section-header"><div><h3>核对候选地点</h3><p>已选 {selected.size}/24 个。按分店和地址确认，也可减少地点，留出休息时间。</p></div><button className="text-button" disabled={Boolean(busy)} onClick={() => setSelected(new Set())}>清空选择</button></header><SourceList sources={research.sources} />{research.warnings.map((warning) => <p className="guide-caution" key={warning}>{warning}</p>)}<div className="guide-candidates">{research.places.map((poi) => <label className={selected.has(poi.sourceId) ? 'is-selected' : ''} key={poi.sourceId}><input type="checkbox" checked={selected.has(poi.sourceId)} disabled={Boolean(busy) || (!selected.has(poi.sourceId) && selected.size >= 24)} onChange={() => setSelected((currentIds) => { const next = new Set(currentIds); next.has(poi.sourceId) ? next.delete(poi.sourceId) : next.add(poi.sourceId); return next; })} /><span><strong>{poi.name}</strong><small>{poi.address}</small><small>{poi.category === 'spot' ? '景点／人文' : '餐饮'} · {poi.rating == null ? '评分暂无' : `高德 ${poi.rating} 分`} · {poi.averageCost == null ? '人均未知' : `人均 ¥${poi.averageCost}`}</small></span></label>)}</div><p className="guide-unverified">生成时会将旅行需求、所选地点和补充摘录发送给 AI 服务。</p><div className="guide-actions"><button className="button button--primary" disabled={!selected.size || Boolean(busy)} onClick={generate}>{busy === 'generate' ? 'AI 正在规划…' : '生成旅行攻略'}</button>{busy === 'generate' ? <p role="status">正在按地理动线和同行节奏安排，可能需要几分钟，请保留此页面。</p> : null}</div></section> : null}
    {current && !editing ? <><div className="guide-actions">{draft ? <><button className="button button--primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '正在保存…' : '保存旅行攻略'}</button><button className="button button--quiet" disabled={Boolean(busy)} onClick={() => setEditing(true)}>调整需求与地点</button><small>预览尚未保存；确认后再保存到共享行程。</small></> : <><button className="button button--quiet" disabled={Boolean(busy)} onClick={() => downloadGuide(saved, contentRef.current)}>导出攻略网页</button>{isAdmin ? <button className="button button--quiet" disabled={Boolean(busy)} onClick={share}>分享攻略</button> : null}<button className="text-button" disabled={Boolean(busy)} onClick={() => onEditTrip(saved.id)}>编辑行程地点与日期</button></>}</div><div ref={contentRef}><TravelGuideContent trip={current} inspections={inspections} onInspect={!draft && saved ? inspect : undefined} inspecting={inspecting} /></div></> : null}
    {!tripId ? <section className="guide-section guide-saved"><header className="guide-section-header"><h3>已保存的攻略与行程</h3><input type="search" aria-label="搜索旅行攻略" placeholder="搜索名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></header>{matches.length ? <div className="trip-grid">{matches.map((trip) => <article className="trip-card" key={trip.id}><button className="trip-card__main" onClick={() => onOpen(trip.id)}><span className="trip-card__mark">{trip.dayCount || 1}</span><span><strong>{trip.name}</strong><small>{trip.roadbook?.guide ? '旅行攻略' : '已有行程'} · {trip.startDate || '日期待定'} · {trip.itemCount || 0} 个地点</small></span></button></article>)}</div> : <p className="guide-unverified">{trips.length ? '没有匹配的攻略或行程。' : '保存后，亲友可以在这里一起查看旅行安排。'}</p>}</section> : null}
  </main>;
}
