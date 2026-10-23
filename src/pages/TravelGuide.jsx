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
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState('library');
  const [step, setStep] = useState(0);
  const [candidateKeyword, setCandidateKeyword] = useState('');
  const [candidateCategory, setCandidateCategory] = useState('all');
  const stageRef = useRef(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [conflict, setConflict] = useState(false);
  const [inspections, setInspections] = useState({});
  const [inspecting, setInspecting] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [sourceProgress, setSourceProgress] = useState('');
  const contentRef = useRef(null);
  const generationRef = useRef(0);
  const dirty = touched || Boolean(draft) || ['collect', 'generate', 'save'].includes(busy);
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
    setError(''); setConflict(false); setMessage(''); setWarnings([]); setSaved(null); setDraft(null); setTouched(false); setResearch(null); setInspections({}); setEditing(false); setView(tripId ? 'planner' : 'library'); setStep(tripId ? 2 : 0); setSelected(new Set()); setBusy(''); setSourceProgress(''); setInspecting(null); setCandidateKeyword(''); setCandidateCategory('all');
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
  function update(patch) { setRequest((value) => ({ ...value, ...patch })); setTouched(true); setResearch(null); setDraft(null); setSelected(new Set()); }
  function updateReference(index, patch) { setReferences((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); setTouched(true); setResearch(null); setDraft(null); }
  async function collect(event) {
    event.preventDefault(); setBusy('collect'); setError(''); setMessage(''); setWarnings([]);
    const revision = ++generationRef.current;
    try {
      let result = await api.collectTravelGuide({ ...request, sources: references });
      if (revision !== generationRef.current) return;
      setResearch(result); setDraft(null); setInspections({}); setStep(1); setCandidateKeyword(''); setCandidateCategory('all');
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
    setBusy('generate'); setError(''); setMessage(''); setWarnings([]);
    const revision = ++generationRef.current;
    try {
      const result = await api.generateTravelGuide({ researchToken: research.researchToken, sourceIds: [...selected] });
      if (revision !== generationRef.current) return;
      setDraft({ ...result.trip, ...(saved ? { id: saved.id, version: saved.version } : {}) });
      setWarnings(result.warnings || []); setInspections({}); setEditing(false); setStep(2);
    } catch (err) { if (revision === generationRef.current) setError(err.message); }
    finally { if (revision === generationRef.current) setBusy(''); }
  }
  async function save() {
    if (!draft || busy) return;
    const revision = ++generationRef.current;
    setBusy('save'); setError(''); setConflict(false);
    try {
      const trip = saved ? await api.updateTrip(saved.id, draft) : await api.createTrip(draft);
      if (revision !== generationRef.current) return;
      setSaved(trip); setDraft(null); setTouched(false); onDirtyChange(false); setMessage('旅行攻略已保存');
      await onChanged();
      if (revision !== generationRef.current) return;
      if (!tripId) onOpen(trip.id, { saved: true });
    } catch (err) { if (revision !== generationRef.current) return; setError(err.status === 409 ? '其他成员已更新此行程。草稿已保留，可载入最新版本后重新规划。' : err.message); setConflict(err.status === 409); }
    finally { if (revision === generationRef.current) setBusy(''); }
  }
  async function inspect(dayIndex) {
    const revision = generationRef.current;
    setInspecting(dayIndex); setError('');
    try { const result = await api.inspectRoadbook(saved.id, dayIndex); if (revision === generationRef.current) setInspections((rows) => ({ ...rows, [dayIndex]: result })); }
    catch (err) { if (revision === generationRef.current) setError(err.message); }
    finally { if (revision === generationRef.current) setInspecting(null); }
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
  function replan() { setView('planner'); setStep(0); setEditing(true); setDraft(null); setResearch(null); setError(''); setMessage(''); setWarnings([]); }
  function start() { setView('planner'); setStep(0); setEditing(true); }
  function backToLibrary() {
    if (dirty && !window.confirm('攻略还有未保存修改，确认放弃并返回吗？')) return;
    load();
  }
  function changeStep(next) { setStep(next); setEditing(next !== 2); }
  function changeSelection(ids) { setSelected(ids); setDraft(null); setTouched(true); }
  function reloadLatest() {
    if (draft && !window.confirm('载入最新版本会放弃当前草稿，确认继续吗？')) return;
    load();
  }
  useEffect(() => {
    if (view === 'planner' && busy !== 'load') {
      window.scrollTo({ top: 0, behavior: 'instant' });
      stageRef.current?.focus({ preventScroll: true });
    }
  }, [step, view]);
  const candidates = (research?.places || []).filter((poi) =>
    (candidateCategory === 'all' || (candidateCategory === 'spot' ? poi.category === 'spot' : poi.category !== 'spot')) &&
    `${poi.name} ${poi.address}`.toLowerCase().includes(candidateKeyword.trim().toLowerCase())
  );
  const matches = trips.filter((trip) => trip.name.toLowerCase().includes(keyword.trim().toLowerCase()));
  return <main className={`management-page travel-guide-page ${view === 'planner' ? 'guide-planner' : ''}`}>

    <header className="page-header guide-page-header"><div>
      {tripId ? <button className="text-button" disabled={busy === 'save'} onClick={onBack}>← 返回旅行攻略</button> : view === 'planner' ? <button className="text-button" disabled={Boolean(busy)} onClick={backToLibrary}>← 返回我的攻略</button> : <p className="eyebrow">一起计划，慢慢出发</p>}
      <h2 ref={stageRef} tabIndex={-1} className="guide-title">{view === 'library' ? '我的旅行攻略' : !editing && current ? current.name : saved ? '重新规划旅行' : '规划一趟旅行'}</h2>
      <p>{view === 'library' ? '把想去的地方，整理成每天都从容的安排。' : editing ? '先确认需求，再挑选地点，最后预览并保存。' : draft ? '这是一份未保存的预览，确认安排后保存。' : '与亲友共享的逐日安排，出发前可再次核验路线。'}</p>
    </div>{view === 'library' ? <button className="button button--primary" onClick={start}>新建旅行攻略</button> : saved && !editing ? <button className="button button--quiet" disabled={Boolean(busy)} onClick={replan}>重新规划</button> : saved && editing ? <button className="button button--quiet" disabled={Boolean(busy)} onClick={backToLibrary}>取消重新规划</button> : null}</header>
    {error ? <div className="inline-notice inline-notice--error" role="alert">{error}{conflict ? <button className="text-button" onClick={reloadLatest}>载入最新版本</button> : tripId && !saved && !busy ? <button className="text-button" onClick={load}>重新加载</button> : null}</div> : null}
    {message ? <p className="inline-notice" role="status">{message}</p> : null}
    {warnings.length ? <p className="guide-caution" role="status">{warnings.join(' ')}</p> : null}
    {view === 'planner' && (editing || draft) ? <ol className="guide-steps" aria-label="攻略规划进度">{['旅行需求', '候选地点', '预览与保存'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step >= index ? 'is-active' : ''}><button type="button" disabled={Boolean(busy) || (index === 1 && !research) || (index === 2 && !draft)} onClick={() => changeStep(index)}><span>{index + 1}</span>{label}</button></li>)}</ol> : null}
    {sourceProgress ? <p className="inline-notice" role="status">{sourceProgress}</p> : null}
    {busy === 'load' ? <p role="status">正在载入旅行攻略…</p> : null}
    {editing && step === 0 ? <form className="guide-request" onSubmit={collect}><fieldset disabled={Boolean(busy)}><header className="guide-form-heading"><h3>这次想去哪里？</h3><p>填写目的地即可开始，其他安排可以逐步补充。</p></header><div className="guide-form-grid">
      <label>目的地城市<input required maxLength={60} value={request.destination} placeholder="例如：福州、昆明、大理" onChange={(event) => update({ destination: event.target.value })} /></label>
      <label>出发日期（选填）<input type="date" value={request.startDate || ''} onChange={(event) => update({ startDate: event.target.value })} /></label>
      <label>旅行天数<input required type="number" min="1" max="14" value={request.dayCount} onChange={(event) => update({ dayCount: Number(event.target.value) })} /></label>
      <label>同行人数<input required type="number" min="1" max="30" value={request.travelers} onChange={(event) => update({ travelers: Number(event.target.value) })} /></label>
      <label>人均总预算（元，选填）<input type="number" min="0" max="1000000" value={request.budget ?? ''} placeholder="例如：3000" onChange={(event) => update({ budget: event.target.value })} /></label>
      <label>出行方式<select value={request.mode} onChange={(event) => update({ mode: event.target.value })}>{Object.entries(MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div><details className="guide-preferences"><summary>偏好与补充安排（选填）</summary><div className="guide-form-grid"><label>出发地（选填）<input maxLength={120} value={request.origin} placeholder="例如：福州市区 / 福州站" onChange={(event) => update({ origin: event.target.value })} /></label>
      <label>已订住宿（选填）<input maxLength={120} value={request.hotel} placeholder="例如：平潭海边民宿" onChange={(event) => update({ hotel: event.target.value })} /></label>
      <label className="guide-field-wide">同行构成与偏好（选填）<textarea maxLength={800} rows="3" value={request.preferences} placeholder="例如：带父母、慢节奏，喜欢人文与本地美食，留出午休" onChange={(event) => update({ preferences: event.target.value })} /></label>
      <label className="guide-field-wide">必须满足的安排与避忌（选填）<textarea maxLength={800} rows="2" value={request.constraints} placeholder="例如：第二天下午返程、不吃辣、避开爬山" onChange={(event) => update({ constraints: event.target.value })} /></label>
    </div></details><details className="guide-references"><summary>补充攻略链接与摘录（选填）</summary><p>链接用于追溯来源；请粘贴有用片段，全文不会自动读取。</p>{references.map((row, index) => <div className="guide-reference" key={index}><label>来源标题 {index + 1}<input value={row.title} maxLength={100} onChange={(event) => updateReference(index, { title: event.target.value })} /></label><label>来源链接 {index + 1}<input required type="url" value={row.url} placeholder="https://…" onChange={(event) => updateReference(index, { url: event.target.value })} /></label><label>攻略摘录 {index + 1}<textarea value={row.excerpt} maxLength={1000} onChange={(event) => updateReference(index, { excerpt: event.target.value })} /></label><button type="button" className="text-button" onClick={() => { setReferences((rows) => rows.filter((_, i) => i !== index)); setTouched(true); setResearch(null); setDraft(null); }}>移除此来源</button></div>)}<button type="button" className="button button--quiet" disabled={references.length >= 8} onClick={() => { setReferences((rows) => [...rows, { title: '', url: '', excerpt: '' }]); setTouched(true); setResearch(null); setDraft(null); }}>添加攻略来源</button></details><div className="guide-actions"><button className="button button--primary" disabled={!request.destination.trim()}>{busy === 'collect' ? '正在搜集地点…' : research ? '重新搜集候选地点' : '搜集候选地点'}</button>{research ? <button type="button" className="button button--quiet" onClick={() => changeStep(1)}>继续选择地点</button> : null}<small>{request.destination.trim() ? '下一步核对地点，再交给 AI 规划。' : '先填写目的地城市，再开始搜集候选地点。'}</small></div></fieldset></form> : null}
    {research && editing && step === 1 ? <section className="guide-section guide-candidate-stage">
      <header className="guide-section-header"><div><p className="eyebrow">{request.destination} · {request.dayCount} 天 · {request.travelers} 人</p><h3>核对候选地点</h3><p>挑选真正想去的地方，给休息和随心逛逛留些时间。</p></div><button className="text-button" disabled={Boolean(busy)} onClick={() => changeStep(0)}>修改旅行需求</button></header>
      {research.warnings.map((warning) => <p className="guide-caution" key={warning}>{warning}</p>)}
      <details className="guide-source-details"><summary>来源与查询情况 · {research.sources.length} 个来源</summary><SourceList sources={research.sources} /></details>
      <div className="guide-candidate-tools"><input type="search" aria-label="搜索候选地点" placeholder="搜索名称或地址" value={candidateKeyword} onChange={(event) => setCandidateKeyword(event.target.value)} /><select aria-label="候选地点类型" value={candidateCategory} onChange={(event) => setCandidateCategory(event.target.value)}><option value="all">全部类型</option><option value="spot">景点／人文</option><option value="food">餐饮</option></select></div>
      <div className="guide-selection-summary"><strong>已选 {selected.size} / 24 个</strong><span>共 {research.places.length} 个候选</span><button className="text-button" disabled={Boolean(busy) || !selected.size} onClick={() => changeSelection(new Set())}>清空选择</button></div>
      <div className="guide-candidates">{candidates.map((poi) => <label className={selected.has(poi.sourceId) ? 'is-selected' : ''} key={poi.sourceId}><input type="checkbox" checked={selected.has(poi.sourceId)} disabled={Boolean(busy) || (!selected.has(poi.sourceId) && selected.size >= 24)} onChange={() => { const next = new Set(selected); next.has(poi.sourceId) ? next.delete(poi.sourceId) : next.add(poi.sourceId); changeSelection(next); }} /><span><strong>{poi.name}</strong><small>{poi.address}</small><small>{poi.category === 'spot' ? '景点／人文' : '餐饮'} · {poi.rating == null ? '评分暂无' : `高德 ${poi.rating} 分`} · {poi.averageCost == null ? '人均未知' : `人均 ¥${poi.averageCost}`}</small></span></label>)}</div>
      {!candidates.length ? <div className="empty-state"><h3>{research.places.length ? '没有匹配的候选地点' : '暂未找到候选地点'}</h3><p>{research.places.length ? '试试其他名称，或清空筛选。' : '返回上一步调整目的地，再重新搜集。'}</p>{research.places.length ? <button className="button button--quiet" onClick={() => { setCandidateKeyword(''); setCandidateCategory('all'); }}>清空候选筛选</button> : null}</div> : null}
      <p className="guide-unverified">生成时会将旅行需求、所选地点和补充摘录发送给 AI 服务。</p>
      <div className="guide-actions guide-primary-actions"><button className="button button--quiet" disabled={Boolean(busy)} onClick={() => changeStep(0)}>上一步</button><button className="button button--primary" disabled={!selected.size || Boolean(busy)} onClick={generate}>{busy === 'generate' ? 'AI 正在规划…' : '生成旅行攻略'}</button>{!selected.size ? <small>至少选择一个地点后即可生成。</small> : <small>已选 {selected.size} 个地点 · 生成后可预览再保存</small>}{busy === 'generate' ? <p role="status">正在安排路线与休息时间，可能需要几分钟，请保留此页面。</p> : null}</div>
    </section> : null}
    {view === 'planner' && current && !editing ? <><div className="guide-actions guide-primary-actions">{draft ? <><button className="button button--primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '正在保存…' : '保存旅行攻略'}</button><button className="button button--quiet" disabled={Boolean(busy)} onClick={() => changeStep(research ? 1 : 0)}>调整需求与地点</button><small>预览尚未保存；确认后再保存到共享行程。</small></> : <><button className="button button--quiet" disabled={Boolean(busy)} onClick={() => downloadGuide(saved, contentRef.current)}>导出攻略网页</button>{isAdmin ? <button className="button button--quiet" disabled={Boolean(busy)} onClick={share}>分享攻略</button> : null}<button className="text-button" disabled={Boolean(busy)} onClick={() => onEditTrip(saved.id)}>编辑行程地点与日期</button></>}</div><div ref={contentRef}><TravelGuideContent trip={current} inspections={inspections} onInspect={!draft && saved ? inspect : undefined} inspecting={inspecting} /></div></> : null}
    {view === 'library' ? <section className="guide-section guide-saved"><header className="guide-section-header"><div><h3>已保存的攻略与行程</h3><p>{trips.length} 份旅行安排</p></div><input type="search" aria-label="搜索旅行攻略" placeholder="搜索名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></header>{matches.length ? <div className="trip-grid">{matches.map((trip) => <article className="trip-card" key={trip.id}><button className="trip-card__main" onClick={() => onOpen(trip.id)}><span className="trip-card__mark">{trip.dayCount || 1}</span><span><strong>{trip.name}</strong><small>{trip.roadbook?.guide ? '旅行攻略' : '已有行程'} · {trip.startDate || '日期待定'} · {trip.itemCount || 0} 个地点</small></span></button></article>)}</div> : <div className="empty-state guide-library-empty"><span aria-hidden="true">⚑</span><h3>{trips.length ? '没有匹配的攻略或行程' : '下一趟旅行，从这里开始'}</h3><p>{trips.length ? '换个名称搜索，或清空关键词。' : '选一个目的地，挑几处喜欢的地方，一起安排每天的路线。'}</p>{trips.length ? <button className="button button--quiet" onClick={() => setKeyword('')}>清空搜索</button> : <button className="button button--quiet" onClick={start}>开始规划</button>}</div>}</section> : null}
  </main>;
}
