import React from 'react';

const NAV_ITEMS = [
  ['map', '地图', '⌖'],
  ['locations', '地点', '▦'],
  ['trips', '行程', '→'],
  ['activity', '活动', '↻'],
  ['trash', '回收站', '♲'],
  ['share-links', '共享链接', '↗'],
  ['settings', '设置', '⚙']
];

function Avatar({ member, small = false }) {
  const label = (member?.name || member?.email || '成员').slice(0, 1).toUpperCase();
  return <span className={`avatar ${small ? 'avatar--small' : ''}`} title={member?.name || member?.email}>{label}</span>;
}

export function SpaceSwitcher({ space, members }) {
  return (
    <button type="button" className="space-switcher" aria-label="切换共享空间">
      <span className="space-mark">R</span>
      <span className="space-switcher__copy">
        <strong>{space?.name || '亲友共享地图'}</strong>
        <small>{members.length} 位成员</small>
      </span>
      <span aria-hidden="true">⌄</span>
    </button>
  );
}

export function PrimaryNav({ route, onNavigate, user, space, members, trashCount }) {
  const activeRoute = route === 'trip' ? 'trips' : route;
  return (
    <aside className="primary-nav" aria-label="主导航">
      <div className="brand-lockup">
        <span className="brand-dot" aria-hidden="true" />
        <span>RONGMAP</span>
      </div>
      <SpaceSwitcher space={space} members={members} />
      <nav className="nav-list">
        {NAV_ITEMS.map(([id, label, icon]) => (
          <button
            type="button"
            key={id}
            className={`nav-item ${activeRoute === id ? 'is-active' : ''}`}
            aria-current={activeRoute === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <span className="nav-icon" aria-hidden="true">{icon}</span>
            <span>{label}</span>
            {id === 'trash' && trashCount > 0 ? <span className="nav-count">{trashCount}</span> : null}
          </button>
        ))}
      </nav>
      <div className="nav-account">
        <Avatar member={user} />
        <span>
          <strong>{user?.name || '空间成员'}</strong>
          <small>{user?.role === 'admin' ? '管理员' : '成员'}</small>
        </span>
      </div>
    </aside>
  );
}

export function TopBar({ route, filteredCount, totalCount, members, onAdd, onImport }) {
  const titles = {
    map: '地图工作台',
    locations: '地点管理',
    trips: '共享行程',
    trip: '行程编排',
    activity: '活动记录',
    trash: '回收站',
    'share-links': '共享链接',
    settings: '空间设置'
  };
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">共享空间</p>
        <h1>{titles[route] || titles.map}</h1>
      </div>
      <div className="top-bar__actions">
        {route === 'map' || route === 'locations' ? (
          <span className="result-count"><strong>{filteredCount}</strong> / {totalCount} 个地点</span>
        ) : null}
        <div className="member-stack" aria-label={`${members.length} 位空间成员`}>
          {members.slice(0, 4).map((member) => <Avatar member={member} small key={member.id} />)}
        </div>
        <button type="button" className="button button--quiet desktop-action" onClick={onImport}>导入</button>
        <button type="button" className="button button--primary desktop-action" onClick={onAdd}>添加地点</button>
      </div>
    </header>
  );
}

export function MobileTopBar({ space, members, filteredCount, totalCount }) {
  return (
    <header className="mobile-top-bar">
      <div>
        <p className="eyebrow">RONGMAP</p>
        <strong>{space?.name || '亲友共享地图'}</strong>
      </div>
      <div className="mobile-top-bar__meta">
        <span>{filteredCount}/{totalCount}</span>
        {members[0] ? <Avatar member={members[0]} small /> : null}
      </div>
    </header>
  );
}

export function MobileTabBar({ route, onNavigate, onAdd }) {
  const activeRoute = route === 'trips' || route === 'trip' ? 'locations' : route;
  const items = [
    ['map', '地图', '⌖'],
    ['locations', '地点', '▦'],
    ['add', '添加', '+'],
    ['activity', '活动', '↻'],
    ['settings', '我的', '☰']
  ];
  return (
    <nav className="mobile-tabs" aria-label="移动端主导航">
      {items.map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          className={`mobile-tab ${id === 'add' ? 'mobile-tab--add' : ''} ${activeRoute === id ? 'is-active' : ''}`}
          aria-current={activeRoute === id ? 'page' : undefined}
          onClick={() => id === 'add' ? onAdd() : onNavigate(id)}
        >
          <span aria-hidden="true">{icon}</span>
          <small>{label}</small>
        </button>
      ))}
    </nav>
  );
}

export function AppShell({ children, route, onNavigate, onAdd, onImport, data, filteredCount }) {
  return (
    <div className={`app-shell app-shell--${route}`}>
      <PrimaryNav
        route={route}
        onNavigate={onNavigate}
        user={data.currentUser}
        space={data.space}
        members={data.members}
        trashCount={data.trash.length}
      />
      <div className="app-content">
        <TopBar
          route={route}
          filteredCount={filteredCount}
          totalCount={data.locations.length}
          members={data.members}
          onAdd={onAdd}
          onImport={onImport}
        />
        <MobileTopBar
          space={data.space}
          members={data.members}
          filteredCount={filteredCount}
          totalCount={data.locations.length}
        />
        {children}
      </div>
      <MobileTabBar route={route} onNavigate={onNavigate} onAdd={onAdd} />
    </div>
  );
}
