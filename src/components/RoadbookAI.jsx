import React, { useState } from 'react';
import { api } from '../data/api';
import { RoadbookContent } from './RoadbookContent';

export default function RoadbookAI({ trip, roadbook, locations, onApply, onBusyChange }) {
  const [requirements, setRequirements] = useState('');
  const [dayCount, setDayCount] = useState(trip.days.length);
  const [source, setSource] = useState(trip.days.some((day) => day.items.length) ? 'trip' : 'library');
  const [selected, setSelected] = useState(() => new Set(locations.slice(0, 12).map((item) => item.id)));
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  async function generate(event) {
    event.preventDefault(); setBusy(true); onBusyChange(true); setError(''); setPreview(null);
    try {
      const result = await api.generateRoadbook({ tripId: trip.id, dayCount: Number(dayCount), requirements, roadbook, ...(source === 'library' ? { locationIds: [...selected] } : {}) });
      setPreview(result);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="roadbook-ai settings-card"><h3>AI 规划路书</h3><p>填写需求，Monk 会用行程地点或你选中的收藏地点生成逐日草案。出行需求与所选地点的名称、地址和坐标将发送给 AI 服务。</p><form onSubmit={generate}><fieldset disabled={busy}><label>旅行需求<textarea required maxLength={2000} value={requirements} placeholder="例如：福州两日游，带长辈，轻松步行，上午9点出发；优先美食，避开人多的地方" onChange={(event) => setRequirements(event.target.value)} /></label><div className="roadbook-fields"><label>规划天数<input type="number" min="1" max="30" required value={dayCount} onChange={(event) => setDayCount(event.target.value)} /></label><label>地点来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="trip">当前行程地点</option><option value="library">从收藏地点选择</option></select></label></div>{source === 'library' ? <><input type="search" aria-label="搜索规划地点" placeholder="搜索收藏地点" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><p>已选 {selected.size}/60 个地点</p><div className="roadbook-ai__locations">{locations.filter((item) => `${item.name} ${item.address || ''}`.includes(keyword.trim())).map((item) => <label key={item.id}><input type="checkbox" checked={selected.has(item.id)} disabled={!selected.has(item.id) && selected.size >= 60} onChange={() => setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><span>{item.name}<small>{item.address}</small></span></label>)}</div></> : null}<button className="button button--primary" disabled={!requirements.trim() || (source === 'library' ? !selected.size : !trip.days.some((day) => day.items.length))}>{busy ? 'AI 正在规划…' : '生成路书草案'}</button></fieldset></form>{busy ? <p role="status">正在生成逐日安排，请稍候…</p> : null}{error ? <div className="inline-notice inline-notice--error" role="alert">{error}</div> : null}{preview ? <div className="roadbook-ai__preview"><h3>AI 草案预览</h3><p>草案尚未保存。应用后可继续修改；保存时会检查行程版本。AI 建议的时间、路线与票价需要核实。</p><RoadbookContent trip={preview.trip} /><div className="row-actions"><button className="button button--primary" onClick={() => { onApply(preview.trip); setPreview(null); }}>应用到路书草稿</button><button className="button button--quiet" onClick={() => setPreview(null)}>放弃草案</button></div></div> : null}</section>;
}
