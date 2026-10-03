import React, { useEffect, useState } from 'react';
import { api } from '../data/api';
import { EMPTY_ROADBOOK, MODES, dayDate, downloadRoadbook } from '../lib/roadbook';

import RoadbookAI from '../components/RoadbookAI';
import { RoadbookContent } from '../components/RoadbookContent';

// 规划 → 需求 → 花费提醒 → 完整路书（核实、导出与分享只在最后一步）
const STEPS = ['规划草案', '出行需求', '预算与提醒', '完整路书'];

function DayInspection({ trip }) {
  const [dayIndex, setDayIndex] = useState(trip.days[0]?.dayIndex || 1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function inspect() {
    setLoading(true); setError(''); setResult(null);
    try { setResult(await api.inspectRoadbook(trip.id, dayIndex)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  const day = trip.days.find((item) => item.dayIndex === dayIndex);
  const date = day ? dayDate(trip, day) : '';
  return <section className="roadbook-day"><h3>里程与沿途天气核实</h3><div className="page-toolbar"><select aria-label="核实行程日期" value={dayIndex} disabled={loading} onChange={(event) => { setDayIndex(Number(event.target.value)); setResult(null); setError(''); }}>{trip.days.map((item) => <option key={item.dayIndex} value={item.dayIndex}>第 {item.dayIndex} 天</option>)}</select><button className="button button--quiet" disabled={loading} onClick={inspect}>{loading ? '正在核实…' : '核实当天路线与天气'}</button></div><p>使用已保存的地点顺序查询；导航为逐段路线。微信内请在浏览器打开。天气仅显示预报覆盖日期，出发前应刷新。</p>{error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}{result ? <><small>{result.source} · 查询于 {new Date(result.queriedAt).toLocaleString('zh-CN')}</small><p>{result.complete ? '当天路段合计' : '已核实部分路段'}：{result.segments.reduce((sum, item) => sum + item.km, 0).toFixed(1)} km · 约 {result.segments.reduce((sum, item) => sum + item.hours, 0).toFixed(1)} 小时（不含游玩、休息和实际拥堵）</p>{result.segments.map((segment) => <p key={segment.index}>{segment.from} → {segment.to} · {segment.km.toFixed(1)} km · {segment.hours.toFixed(1)} 小时</p>)}{result.weather.map((forecast) => {
      const cast = forecast.casts.find((item) => item.date === date);
      return <article className="roadbook-cost" key={forecast.city}><strong>{forecast.city}</strong>{cast ? <p>{cast.date} · {cast.dayweather} / {cast.nightweather} · {cast.nighttemp}–{cast.daytemp}℃</p> : <p>{date ? `${date}不在当前预报窗口，暂无该日天气` : '请先填写行程日期以匹配天气'}</p>}<small>预报发布时间：{forecast.reportTime}</small></article>;
    })}{result.warnings.map((warning, index) => <p className="inline-notice inline-notice--warning" key={index}>{warning}</p>)}</> : null}</section>;
}

export default function RoadbookPage({ trips, tripId, locations = [], onOpen, onBack, onCreate, onEditTrip, onChanged, onDirtyChange, isAdmin }) {
  const [trip, setTrip] = useState(null);
  const [draft, setDraft] = useState(EMPTY_ROADBOOK);
  const [planDays, setPlanDays] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [step, setStep] = useState(0);
  async function load() {
    setTrip(null); setPlanDays(null); setStep(0); setStatus('正在加载路书…'); setConflict(false);
    try { const next = await api.loadTrip(tripId); setTrip(next); setDraft({ ...EMPTY_ROADBOOK, ...next.roadbook }); setStatus(''); }
    catch (error) { setStatus(error.message); }
  }
  useEffect(() => { if (tripId) load(); else { setTrip(null); setStatus(''); } }, [tripId]);
  const dirty = Boolean(trip && (JSON.stringify(draft) !== JSON.stringify({ ...EMPTY_ROADBOOK, ...trip.roadbook }) || (planDays && JSON.stringify(planDays) !== JSON.stringify(trip.days))));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => { if (!dirty) return; const guard = (event) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  async function save() {
    setBusy(true); setConflict(false);
    try { const next = await api.updateTrip(trip.id, { ...trip, days: planDays || trip.days, roadbook: draft }); setPlanDays(null); setTrip(next); setDraft({ ...EMPTY_ROADBOOK, ...next.roadbook }); setInspectionRevision((value) => value + 1); setStatus('路书已保存'); await onChanged(); }
    catch (error) { setConflict(error.status === 409); setStatus(error.status === 409 ? '其他成员已更新行程，请载入最新版本后重新应用修改。' : error.message); }
    finally { setBusy(false); }
  }
  async function share() {
    setBusy(true);
    try { const link = await api.createShareLink({ scope: 'trip', tripId: trip.id, label: trip.name }); const url = `${window.location.origin}/share/${link.token}`; await navigator.clipboard.writeText(url); setStatus('路书只读链接已复制'); await onChanged(); }
    catch (error) { setStatus(`分享失败：${error.message}`); }
    finally { setBusy(false); }
  }
  if (!tripId) return <main className="management-page roadbook-page"><header className="page-header"><div><p className="eyebrow">从收藏到出发</p><h2>旅行路书</h2><p>将共享行程整理成逐日路书，核实路线与天气，带上预算和出行提醒。</p></div><button className="button button--primary" onClick={() => onCreate([])}>创建路书</button></header><div className="page-toolbar"><input type="search" aria-label="搜索路书" placeholder="搜索行程名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div><div className="trip-grid">{trips.filter((item) => item.name.toLowerCase().includes(keyword.trim().toLowerCase())).map((item) => <article className="trip-card" key={item.id}><button className="trip-card__main" onClick={() => onOpen(item.id)}><span className="trip-card__mark">{item.dayCount || 1}</span><span><strong>{item.name}</strong><small>{item.startDate || '日期待定'} · {item.dayCount || 1} 天 · {item.itemCount || 0} 个地点</small><p>{item.description || '打开路书，补充预算与出行提醒。'}</p></span></button></article>)}</div>{!trips.length ? <div className="empty-state"><span>→</span><h3>准备一份旅行路书</h3><p>先创建行程、加入收藏地点，再填写出行需求和逐日安排。</p></div> : !trips.some((item) => item.name.toLowerCase().includes(keyword.trim().toLowerCase())) ? <p>没有匹配的路书。</p> : null}</main>;
  if (!trip) return <main className="management-page"><button className="text-button" onClick={onBack}>← 返回路书</button><p role="status">{status}</p><button className="button button--quiet" onClick={load}>重新加载</button></main>;
  return <main className="management-page roadbook-page"><header className="page-header"><div><button className="text-button" onClick={onBack}>← 返回路书</button><h2>{trip.name}</h2><p>{trip.startDate || '日期待定'} · {(planDays || trip.days).length} 天 · {MODES[draft.mode]}</p></div></header>{status ? <div role="status" className="inline-notice">{status}{conflict ? <button className="text-button" onClick={load}>载入最新版本</button> : null}</div> : null}<ol className="wizard-steps roadbook-steps">{STEPS.map((label, index) => <li className={index === step ? 'is-active' : ''} key={label}><button type="button" onClick={() => setStep(index)} aria-current={index === step ? 'step' : undefined}><span aria-hidden="true">{index < step ? '✓' : index + 1}</span>{label}</button></li>)}</ol><div hidden={step !== 0}><div className="row-actions roadbook-steps__lead"><button className="button button--quiet" disabled={dirty || busy || aiBusy} onClick={() => onEditTrip(trip.id)}>编排地点与日期</button></div><RoadbookAI key={trip.id} trip={{ ...trip, days: planDays || trip.days }} roadbook={draft} locations={locations} onBusyChange={setAiBusy} onApply={(next) => { setDraft({ ...EMPTY_ROADBOOK, ...next.roadbook }); setPlanDays(next.days); setStatus('AI 草案已应用，请检查并保存路书'); }} /></div>{step === 1 ? <div className="roadbook-form"><section className="settings-card"><h3>出行需求</h3><div className="roadbook-fields"><label>出发地<input value={draft.origin} maxLength={120} onChange={(event) => update({ origin: event.target.value })} placeholder="行程首站应加入出发地点" /></label><label>出行方式<select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>{Object.entries(MODES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>同行人数<input type="number" min="1" max="100" required value={draft.travelers} onChange={(event) => update({ travelers: event.target.value })} /></label><label>人均预算（元）<input type="number" min="0" max="1000000" step="0.01" value={draft.budget ?? ''} onChange={(event) => update({ budget: event.target.value })} /></label></div><label>同行构成、偏好与避忌<textarea value={draft.preferences} maxLength={1000} placeholder="例如：带长辈、慢节奏；避开哪些地点，是否可以过境" onChange={(event) => update({ preferences: event.target.value })} /></label></section></div> : null}{step === 2 ? <div className="roadbook-form"><section className="settings-card"><h3>门票与花费（人均）</h3>{draft.tickets.map((ticket, index) => <div className="roadbook-ticket" key={index}>{[['name', '项目名称'], ['price', '金额（元/人）'], ['reservation', '预约与说明'], ['source', '来源与核实日期']].map(([key, label]) => <label key={key}>{label}<input type={key === 'price' ? 'number' : 'text'} min={key === 'price' ? 0 : undefined} max={key === 'price' ? 1000000 : undefined} step={key === 'price' ? '0.01' : undefined} maxLength={key === 'source' ? 500 : key === 'reservation' ? 240 : 120} value={ticket[key] ?? ''} onChange={(event) => update({ tickets: draft.tickets.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) })} /></label>)}<button type="button" className="text-button danger-text" onClick={() => update({ tickets: draft.tickets.filter((_, i) => i !== index) })}>移除花费</button></div>)}<button type="button" className="button button--quiet" disabled={draft.tickets.length >= 100} onClick={() => update({ tickets: [...draft.tickets, { name: '', price: '', reservation: '', source: '' }] })}>添加花费项目</button></section><section className="settings-card"><label>穿着建议<textarea value={draft.clothing} maxLength={2000} onChange={(event) => update({ clothing: event.target.value })} /></label><label>注意事项<textarea value={draft.tips} maxLength={3000} onChange={(event) => update({ tips: event.target.value })} /></label></section></div> : null}{step === 3 ? <div className="roadbook-reading"><RoadbookContent trip={{ ...trip, days: planDays || trip.days, roadbook: draft }} />{!dirty ? <DayInspection key={`${trip.id}-${inspectionRevision}`} trip={trip} /> : null}</div> : null}<div className="row-actions roadbook-nav">{step > 0 ? <button className="button button--quiet" onClick={() => setStep(step - 1)}>上一步</button> : null}{step < STEPS.length - 1 ? <button className="button button--quiet" onClick={() => setStep(step + 1)}>下一步</button> : null}{dirty ? <button className="button button--primary" disabled={busy || aiBusy} onClick={save}>{busy ? '正在保存…' : '保存路书'}</button> : <button className="button button--quiet" disabled>已保存</button>}{step === STEPS.length - 1 ? <><button className="button button--quiet" disabled={dirty || busy || aiBusy} onClick={() => downloadRoadbook(trip)}>导出路书网页</button>{isAdmin ? <button className="button button--quiet" disabled={dirty || busy || aiBusy} onClick={share}>分享路书</button> : null}</> : null}</div>{dirty ? <p>保存后可核实路线、导出和分享。</p> : null}</main>;
}
