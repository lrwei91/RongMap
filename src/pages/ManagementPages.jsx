import React, { useMemo, useState } from 'react';
import { CATEGORIES, relativeTime } from '../lib/location';

const ACTION_COPY = {
  location_created: '添加了地点',
  location_updated: '更新了地点',
  location_deleted: '将地点移入回收站',
  location_restored: '恢复了地点',
  bulk_updated: '批量整理了地点',
  import_committed: '完成了批量导入',
  member_invited: '邀请了新成员',
  share_created: '创建了只读链接',
  share_revoked: '撤销了只读链接',
  trip_created: '创建了行程',
  trip_updated: '更新了行程',
  trip_optimized: '优化了行程路线',
  trip_deleted: '删除了行程',
  trip_share_created: '创建了行程只读链接',
  trip_share_revoked: '撤销了行程只读链接',
  space_ready: '更新了共享空间'
};

function PageHeader({ eyebrow, title, description, action }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{action}</header>;
}

export function ActivityPage({ activity, members }) {
  const [member, setMember] = useState('all');
  const [action, setAction] = useState('all');
  const filtered = activity.filter((item) => (member === 'all' || item.actorId === member) && (action === 'all' || item.action === action));
  return (
    <main className="management-page">
      <PageHeader eyebrow="协作记录" title="活动记录" description="查看谁在什么时候对共享空间做了什么。" />
      <div className="page-toolbar">
        <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="按成员筛选"><option value="all">全部成员</option>{members.map((item) => <option value={item.id} key={item.id}>{item.name || item.email}</option>)}</select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="按动作筛选"><option value="all">全部动作</option><option value="location_created">新增地点</option><option value="location_updated">修改地点</option><option value="location_deleted">删除地点</option><option value="location_restored">恢复地点</option><option value="trip_created">创建行程</option><option value="trip_updated">修改行程</option><option value="trip_optimized">优化行程</option><option value="trip_share_created">分享行程</option><option value="import_committed">批量导入</option></select>
      </div>
      <div className="timeline">
        {filtered.length ? filtered.map((item) => (
          <article className="timeline-item" key={item.id}>
            <span className="timeline-mark" aria-hidden="true" />
            <div><p><strong>{item.actorName || '空间成员'}</strong> {ACTION_COPY[item.action] || item.summary || '更新了内容'}</p>{item.targetName ? <h3>{item.targetName}</h3> : null}<small>{relativeTime(item.createdAt)}</small></div>
          </article>
        )) : <div className="empty-state"><span>↻</span><h3>暂无匹配活动</h3><p>成员的新增、修改、删除和恢复会显示在这里。</p></div>}
      </div>
    </main>
  );
}

export function TrashPage({ trash, onRestore, onPurge, isAdmin }) {
  return (
    <main className="management-page">
      <PageHeader eyebrow="30 天保留" title="回收站" description="成员删除的地点会在这里保留30天，管理员可永久清理。" />
      <div className="data-list">
        {trash.length ? trash.map((item) => {
          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deletedAt).getTime()) / 86400000));
          return <article className="data-row" key={item.id}><span className={`category-square category-square--${item.category}`}>{CATEGORIES[item.category]?.short || '地'}</span><div><strong>{item.name}</strong><p>{item.address}</p><small>{item.deletedByName || '空间成员'} 删除 · {daysLeft} 天后清理</small></div><div className="row-actions"><button type="button" className="button button--quiet" onClick={() => onRestore(item)}>恢复</button>{isAdmin ? <button type="button" className="button button--danger-quiet" onClick={() => onPurge(item)}>永久删除</button> : null}</div></article>;
        }) : <div className="empty-state"><span>♲</span><h3>回收站是空的</h3><p>误删的地点可在30天内恢复。</p></div>}
      </div>
    </main>
  );
}

export function ShareLinksPage({ links, onCreate, onRevoke, isAdmin }) {
  const [label, setLabel] = useState('亲友共享地图');
  async function create() { await onCreate({ label }); setLabel('亲友共享地图'); }
  return (
    <main className="management-page">
      <PageHeader eyebrow="无需登录 · 只读" title="共享链接" description="创建可随时撤销的实时只读地图，不开放成员和编辑能力。" />
      {isAdmin ? <section className="create-strip"><label><span>链接名称</span><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></label><button type="button" className="button button--primary" onClick={create}>创建只读链接</button></section> : <div className="inline-notice inline-notice--warning"><span>!</span>只有管理员可以创建或撤销共享链接。</div>}
      <div className="data-list">
        {links.length ? links.map((link) => {
          const url = link.token ? `${window.location.origin}/share/${link.token}` : '';
          return <article className="data-row" key={link.id}><span className="share-icon">↗</span><div><strong>{link.label}</strong><p className="monospace">{link.revokedAt ? '链接已失效' : url || '链接仍有效；为保护访问令牌，地址只在创建时自动复制。'}</p><small>{link.scope === 'trip' ? '单个行程' : '完整空间'} · {link.revokedAt ? '已撤销' : `创建于 ${new Date(link.createdAt).toLocaleDateString('zh-CN')}`}</small></div><div className="row-actions">{url ? <button type="button" className="button button--quiet" disabled={Boolean(link.revokedAt)} onClick={() => navigator.clipboard.writeText(url)}>复制</button> : null}{isAdmin ? <button type="button" className="button button--danger-quiet" disabled={Boolean(link.revokedAt)} onClick={() => onRevoke(link)}>撤销</button> : null}</div></article>;
        }) : <div className="empty-state"><span>↗</span><h3>还没有共享链接</h3><p>创建后，收到链接的人可以查看实时地图和地点详情。</p></div>}
      </div>
    </main>
  );
}

export function SettingsPage({ data, onInvite, onCreateTag, onDeleteTag }) {
  const [email, setEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState({ type: 'idle', message: '' });
  const [tagName, setTagName] = useState('');
  const isAdmin = data.currentUser.role === 'admin';
  const normalizedEmail = email.trim().toLowerCase();
  const existingMember = data.members.find((member) => member.email?.trim().toLowerCase() === normalizedEmail);
  const activeCount = data.members.filter((member) => member.status !== 'invited').length;
  const invitedCount = data.members.filter((member) => member.status === 'invited').length;

  async function submitInvite() {
    if (!normalizedEmail || existingMember || inviteStatus.type === 'loading') return;
    setInviteStatus({ type: 'loading', message: `正在向 ${normalizedEmail} 发送邀请…` });
    try {
      await onInvite(normalizedEmail);
      setInviteStatus({ type: 'success', message: `已向 ${normalizedEmail} 发送邀请，等待对方接受。` });
      setEmail('');
    } catch (error) {
      setInviteStatus({ type: 'error', message: error.message });
    }
  }
  return (
    <main className="management-page">
      <PageHeader eyebrow="空间管理" title={data.space.name} description="管理亲友共享空间、成员与地点标签。" />
      <div className="settings-grid">
        <section className="settings-card"><header><div><p className="eyebrow">共享空间</p><h3>{data.space.name}</h3></div><span className="status-badge">{activeCount} 位成员{invitedCount ? ` · ${invitedCount} 个待加入` : ''}</span></header><dl><div><dt>当前身份</dt><dd>{isAdmin ? '管理员' : '成员'}</dd></div><div><dt>空间编号</dt><dd className="monospace">{data.space.id}</dd></div><div><dt>默认权限</dt><dd>成员可添加、编辑及移入回收站</dd></div></dl></section>
        <section className="settings-card settings-card--wide"><header><div><p className="eyebrow">成员</p><h3>成员与邀请</h3></div></header>{isAdmin ? <><div className="inline-form"><input aria-label="受邀成员邮箱" type="email" value={email} placeholder="输入受邀成员邮箱" onChange={(e) => { setEmail(e.target.value); setInviteStatus({ type: 'idle', message: '' }); }} /><button type="button" className="button button--primary" disabled={!email.includes('@') || Boolean(existingMember) || inviteStatus.type === 'loading'} onClick={submitInvite}>{inviteStatus.type === 'loading' ? '发送中…' : existingMember ? '已邀请' : '发送邀请'}</button></div>{existingMember ? <div className="inline-notice inline-notice--warning"><span>!</span>{existingMember.status === 'invited' ? '该邮箱已发送过邀请，正在等待对方加入。' : '该邮箱已经是空间成员。'}</div> : null}{inviteStatus.message ? <div className={`inline-notice${inviteStatus.type === 'error' ? ' inline-notice--error' : inviteStatus.type === 'loading' ? ' inline-notice--warning' : ''}`} role={inviteStatus.type === 'error' ? 'alert' : 'status'}><span>{inviteStatus.type === 'error' ? '!' : inviteStatus.type === 'loading' ? '…' : '✓'}</span>{inviteStatus.message}</div> : null}</> : null}<div className="member-list">{data.members.map((member) => { const label = member.role === 'admin' ? '管理员' : member.status === 'invited' ? '邀请待接受' : '已加入'; const detail = member.status === 'invited' ? `${member.email} · 邀请已发送${member.createdAt ? ` · ${new Date(member.createdAt).toLocaleDateString('zh-CN')}` : ''}` : member.email || '已加入共享空间'; return <article key={member.id}><span className="avatar">{(member.name || member.email || '?').slice(0, 1)}</span><div><strong>{member.name || member.email || '空间成员'}</strong><small>{detail}</small></div><span className="role-label">{label}</span></article>; })}</div></section>
        <section className="settings-card settings-card--wide"><header><div><p className="eyebrow">地点组织</p><h3>自定义标签</h3></div></header><div className="inline-form"><input value={tagName} maxLength={24} placeholder="例如：周末、长辈友好、约会" onChange={(e) => setTagName(e.target.value)} /><button type="button" className="button button--primary" disabled={!tagName.trim()} onClick={async () => { await onCreateTag(tagName); setTagName(''); }}>创建标签</button></div><div className="tag-management">{data.tags.length ? data.tags.map((tag) => <span className="tag tag--manage" key={tag.id}>{tag.name}<button type="button" onClick={() => onDeleteTag(tag)} aria-label={`删除标签 ${tag.name}`}>×</button></span>) : <p>还没有自定义标签。</p>}</div></section>
      </div>
    </main>
  );
}
