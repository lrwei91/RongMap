import React, { useEffect, useMemo, useState } from 'react';
import TravelGuideContent from '../components/TravelGuideContent';
import { RoadbookContent } from '../components/RoadbookContent';
import MapCanvas from '../components/MapCanvas';
import { CATEGORIES } from '../lib/location';
import { api } from '../data/api';
import { signInWithUsername, supabase } from '../lib/supabase';

export function AuthPage() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  async function submit(event) {
    event.preventDefault();
    setStatus('loading');
    try {
      await signInWithUsername(username.trim().toLowerCase());
      // 服务端已换到会话，但缺少客户端配置时浏览器无法保存它。
      if (!supabase) { setStatus('unconfigured'); return; }
      window.location.replace('/app/map');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '该用户名未注册');
    }
  }
  return <main className="auth-page"><section className="auth-card"><div className="brand-lockup"><span className="brand-dot" />RONGMAP</div><p className="eyebrow">成员登录</p><h1>回到亲友共享地图</h1><p>输入管理员为你注册的用户名即可登录。</p><form onSubmit={submit}><label className="field"><span>用户名</span><input required autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} placeholder="例如：xiaorong" onChange={(e) => { setUsername(e.target.value); setStatus('idle'); setMessage(''); }} /></label><button className="button button--primary" disabled={status === 'loading' || !username.trim()}>{status === 'loading' ? '登录中…' : '登录'}</button></form>{status === 'error' ? <div className="inline-notice inline-notice--error" role="alert"><span>!</span>{message}</div> : null}{status === 'unconfigured' ? <div className="inline-notice inline-notice--warning"><span>!</span>当前环境尚未配置 Supabase 登录。</div> : null}</section></main>;
}

export function PublicSharePage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  useEffect(() => { api.loadPublicShare(token).then(setData).catch((err) => setError(err.message)); }, [token]);
  const routeDays = useMemo(() => (data?.trip?.days || []).map((day) => ({ ...day, items: day.items.map((item, index) => ({ ...item, id: item.id || `${day.dayIndex}-${index}`, routeDayIndex: day.dayIndex, routeOrder: index + 1 })) })), [data?.trip]);
  const tripLocations = useMemo(() => routeDays.flatMap((day) => day.items), [routeDays]);
  if (error) return <main className="share-unavailable"><span>↗</span><h1>这个共享链接已失效</h1><p>{error}</p></main>;
  if (!data) return <main className="share-unavailable"><span>⌖</span><h1>正在打开共享地图</h1><p>请稍候。</p></main>;
  if (data.type === 'trip' && data.trip) {
    const locations = tripLocations;
    return <main className="public-share public-trip"><header><div><p className="eyebrow">RONGMAP · 只读行程</p><h1>{data.trip.name}</h1><p>{data.trip.startDate || '日期待定'} · {data.trip.days.length} 天 · {locations.length} 个地点</p></div><span className="readonly-badge">只读</span></header><div className="public-share__workspace"><aside className="public-trip__days">{data.trip.days.map((day) => <section key={day.id || day.dayIndex}><header><strong>第 {day.dayIndex} 天</strong><small>{day.date || '日期待定'}{day.title ? ` · ${day.title}` : ''}</small></header>{day.items.map((item, index) => <button className={`public-location ${active?.id === item.id ? 'is-active' : ''}`} key={item.id || index} onClick={() => setActive({ ...item, routeDayIndex: day.dayIndex, routeOrder: index + 1 })}><span className="trip-order">{index + 1}</span><span><strong>{item.name}</strong><small>{item.startTime ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ''} · ` : ''}{item.address}</small>{item.note ? <small>{item.note}</small> : null}</span></button>)}</section>)}{data.trip.roadbook && !data.trip.roadbook.guide ? <RoadbookContent trip={data.trip} includeDays={false} /> : null}</aside><MapCanvas locations={locations} routeDays={routeDays} activeDayIndex={active?.routeDayIndex || 1} activeId={active?.id} focusRequest={active} onSelect={setActive} publicMode /></div>{data.trip.roadbook?.guide ? <TravelGuideContent trip={data.trip} /> : null}</main>;
  }
  return <main className="public-share"><header><div><p className="eyebrow">RONGMAP · 只读共享</p><h1>{data.space.name}</h1><p>{data.locations.length} 个地点 · 内容随共享空间实时更新</p></div><span className="readonly-badge">只读</span></header><div className="public-share__workspace"><aside><div className="compact-list">{data.locations.map((item) => <button className={`public-location ${active?.id === item.id ? 'is-active' : ''}`} key={item.id} onClick={() => setActive(item)}><span className={`category-square category-square--${item.category}`}>{CATEGORIES[item.category]?.short || '地'}</span><span><strong>{item.name}</strong><small>{item.address}</small></span></button>)}</div></aside><MapCanvas locations={data.locations} activeId={active?.id} focusRequest={active} onSelect={setActive} publicMode /></div></main>;
}
