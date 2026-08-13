import React, { useEffect, useState } from 'react';
import MapCanvas from '../components/MapCanvas';
import { CATEGORIES } from '../lib/location';
import { api } from '../data/api';
import { supabase } from '../lib/supabase';

export function AuthPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  async function submit(event) {
    event.preventDefault();
    if (!supabase) { setStatus('unconfigured'); return; }
    setStatus('loading');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setStatus(error ? 'error' : 'sent');
  }
  useEffect(() => {
    if (!supabase || !window.location.pathname.includes('callback')) return;
    supabase.auth.getSession().then(({ data }) => { if (data.session) window.location.replace('/app/map'); });
  }, []);
  return <main className="auth-page"><section className="auth-card"><div className="brand-lockup"><span className="brand-dot" />RONGMAP</div><p className="eyebrow">受邀成员登录</p><h1>回到亲友共享地图</h1><p>输入受邀邮箱，我们会发送一次性登录链接。</p><form onSubmit={submit}><label className="field"><span>邮箱</span><input type="email" required value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} /></label><button className="button button--primary" disabled={status === 'loading'}>{status === 'loading' ? '发送中…' : '发送登录链接'}</button></form>{status === 'sent' ? <div className="inline-notice"><span>✓</span>登录链接已发送，请检查邮箱。</div> : null}{status === 'error' ? <div className="inline-notice inline-notice--error"><span>!</span>发送失败，请确认邮箱已受邀。</div> : null}{status === 'unconfigured' ? <div className="inline-notice inline-notice--warning"><span>!</span>当前环境尚未配置 Supabase 登录。</div> : null}</section></main>;
}

export function PublicSharePage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  useEffect(() => { api.loadPublicShare(token).then(setData).catch((err) => setError(err.message)); }, [token]);
  if (error) return <main className="share-unavailable"><span>↗</span><h1>这个共享链接已失效</h1><p>{error}</p></main>;
  if (!data) return <main className="share-unavailable"><span>⌖</span><h1>正在打开共享地图</h1><p>请稍候。</p></main>;
  return <main className="public-share"><header><div><p className="eyebrow">RONGMAP · 只读共享</p><h1>{data.space.name}</h1><p>{data.locations.length} 个地点 · 内容随共享空间实时更新</p></div><span className="readonly-badge">只读</span></header><div className="public-share__workspace"><aside><div className="compact-list">{data.locations.map((item) => <button className={`public-location ${active?.id === item.id ? 'is-active' : ''}`} key={item.id} onClick={() => setActive(item)}><span className={`category-square category-square--${item.category}`}>{CATEGORIES[item.category]?.short || '地'}</span><span><strong>{item.name}</strong><small>{item.address}</small></span></button>)}</div></aside><MapCanvas locations={data.locations} activeId={active?.id} focusRequest={active} onSelect={setActive} publicMode /></div></main>;
}
