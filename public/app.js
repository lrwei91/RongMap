const AMAP_CONFIG = {
  securityCode: 'db67e6113b81508f33ae7b14dbc42358'
};

window._AMapSecurityConfig = {
  securityJsCode: AMAP_CONFIG.securityCode
};

const FUZHOU_CENTER = [119.296531, 26.061473];

let map = null;
let markers = [];
let markerMap = new Map();
let locations = [];
let activeLocationId = null;
let toastTimer = null;
let myLocationMarker = null;

let ui = {};  // 延迟初始化

let searchDebounceTimer = null;
let selectedSuggestion = null;

function initMap(callback) {
  map = new AMap.Map('map', {
    zoom: 12,
    center: FUZHOU_CENTER,
    viewMode: '2D',
    // 使用内置控件配置
    zoomControl: true,    // 显示缩放控件
    scale: true           // 显示比例尺
  });

  // 插件加载完成后执行回调
  setTimeout(() => {
    if (callback) callback();
  }, 100);
}

function initUI() {
  ui = {
    singleInput: document.getElementById('singleInput'),
    reasonInput: document.getElementById('reasonInput'),
    batchInput: document.getElementById('batchInput'),
    addSingleBtn: document.getElementById('addSingleBtn'),
    addBatchBtn: document.getElementById('addBatchBtn'),
    fitMarkersBtn: document.getElementById('fitMarkersBtn'),
    locationsList: document.getElementById('locationsList'),
    locationCount: document.getElementById('locationCount'),
    geocodedCount: document.getElementById('geocodedCount'),
    toast: document.getElementById('toast'),
    searchSuggestions: document.getElementById('searchSuggestions'),
    locateMeBtn: document.getElementById('locateMeBtn')
  };
}

function hasCoordinates(loc) {
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function showToast(message, type = 'info') {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');

  if (type === 'error') {
    ui.toast.style.background = '#7f1d1d';
  } else if (type === 'success') {
    ui.toast.style.background = '#14532d';
  } else {
    ui.toast.style.background = '#0f172a';
  }

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('show');
  }, 2600);
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;

  if (busy) {
    button.dataset.originLabel = button.textContent;
    button.textContent = busyLabel;
  } else {
    button.textContent = button.dataset.originLabel || button.textContent;
  }

  button.disabled = busy;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data;
}

async function loadLocations() {
  try {
    locations = await requestJson('/api/locations');
    renderLocationsList();
    renderMarkers();
  } catch (err) {
    console.error('加载地点失败:', err);
    showToast(`加载地点失败：${err.message}`, 'error');
  }
}

function updateStats() {
  const geocodedCount = locations.filter(hasCoordinates).length;
  ui.locationCount.textContent = String(locations.length);
  ui.geocodedCount.textContent = String(geocodedCount);
}

function renderLocationsList() {
  updateStats();

  if (locations.length === 0) {
    ui.locationsList.innerHTML = '<div class="empty-state">暂无地点，先添加一条地址开始。</div>';
    return;
  }

  ui.locationsList.innerHTML = locations.map((loc) => {
    const hasCoords = hasCoordinates(loc);
    const activeClass = activeLocationId === loc.id ? 'is-active' : '';

    return `
      <article class="location-item ${activeClass}" data-id="${escapeHtml(loc.id)}">
        <div
          class="location-main"
          role="button"
          tabindex="0"
          aria-label="聚焦地点 ${escapeHtml(loc.name)}"
          data-action="focus"
          data-id="${escapeHtml(loc.id)}"
        >
          <p class="location-name">${escapeHtml(loc.name)}</p>
          <p class="location-address">${escapeHtml(loc.address)}</p>
          ${loc.reason ? `<p class="location-reason"><span>理由：</span>${escapeHtml(loc.reason)}</p>` : ''}
          <div class="location-meta">
            <span class="status ${hasCoords ? 'status-geocoded' : 'status-pending'}">${hasCoords ? '已定位' : '待定位'}</span>
            ${hasCoords ? `<button type="button" class="locate-btn" data-action="focus" data-id="${escapeHtml(loc.id)}">地图聚焦</button>` : ''}
          </div>
        </div>
        <div class="location-actions">
          <button type="button" class="btn-delete" data-action="delete" data-id="${escapeHtml(loc.id)}" aria-label="删除 ${escapeHtml(loc.name)}">×</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderMarkers() {
  markers.forEach((marker) => map.remove(marker));
  markers = [];
  markerMap = new Map();

  locations.forEach((loc) => {
    if (!hasCoordinates(loc)) return;

    const marker = new AMap.Marker({
      position: [Number(loc.longitude), Number(loc.latitude)],
      title: loc.name,
      map
    });

    const infoWindow = new AMap.InfoWindow({
      content: `
        <div style="padding: 10px 12px; min-width: 220px;">
          <strong style="font-size:14px;color:#1f2937;">${escapeHtml(loc.name)}</strong><br/>
          <span style="color:#4b5563;font-size:12px;line-height:1.5;display:block;margin:6px 0;">${escapeHtml(loc.address)}</span>
          ${loc.reason ? `<div style="background:#f3f4f6;padding:8px;border-radius:6px;margin-top:8px;"><span style="color:#6b7280;font-size:11px;">添加理由</span><p style="color:#374151;font-size:12px;margin:4px 0 0;">${escapeHtml(loc.reason)}</p></div>` : ''}
        </div>
      `,
      offset: new AMap.Pixel(0, -30)
    });

    marker.on('click', () => {
      activeLocationId = loc.id;
      renderLocationsList();
      infoWindow.open(map, marker.getPosition());
    });

    markers.push(marker);
    markerMap.set(loc.id, marker);
  });
}

function focusLocation(id, zoom = 16) {
  const marker = markerMap.get(id);
  if (!marker) {
    showToast('该地点还未完成定位', 'error');
    return;
  }

  activeLocationId = id;
  renderLocationsList();
  map.setCenter(marker.getPosition());
  map.setZoom(zoom);
}

function fitAllMarkers() {
  if (markers.length === 0) {
    map.setCenter(FUZHOU_CENTER);
    map.setZoom(12);
    showToast('暂无可定位地点，已回到福州中心');
    return;
  }

  map.setFitView(markers, false, [56, 56, 56, 56]);
}

function locateMe() {
  if (!navigator.geolocation) {
    showToast('您的浏览器不支持地理位置功能', 'error');
    return;
  }

  setButtonBusy(ui.locateMeBtn, true, '定位中...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      // 在地图上标记当前位置
      if (myLocationMarker) {
        myLocationMarker.setMap(null);
      }

      myLocationMarker = new AMap.Marker({
        position: [longitude, latitude],
        icon: new AMap.Icon({
          size: new AMap.Size(32, 32),
          imageSize: new AMap.Size(32, 32),
          imageUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzNCODJGNCIvPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjYiIGZpbGw9IndoaXRlIi8+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMyIgZmlsbD0iIzNCODJGNCIvPjwvc3ZnPg=='
        }),
        offset: new AMap.Pixel(-16, -16),
        map
      });

      // 添加点击事件，显示信息窗口
      const infoWindow = new AMap.InfoWindow({
        content: `<div style="padding:8px 10px;min-width:180px;"><strong style="font-size:14px;">我的位置</strong><p style="color:#6b7280;font-size:12px;margin:8px 0 0;">精度：约${Math.round(accuracy)}米</p></div>`,
        offset: new AMap.Pixel(0, -30)
      });

      myLocationMarker.on('click', () => {
        infoWindow.open(map, myLocationMarker.getPosition());
      });

      // 地图中心移动到当前位置
      map.setCenter([longitude, latitude]);
      map.setZoom(16);

      showToast(`已定位到您的当前位置`, 'success');
      setButtonBusy(ui.locateMeBtn, false);
    },
    (error) => {
      let message = '定位失败：';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message += '您拒绝了地理位置请求';
          break;
        case error.POSITION_UNAVAILABLE:
          message += '无法获取位置信息';
          break;
        case error.TIMEOUT:
          message += '定位请求超时';
          break;
        default:
          message += error.message;
      }
      showToast(message, 'error');
      setButtonBusy(ui.locateMeBtn, false);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

async function addSingleLocation() {
  const address = ui.singleInput.value.trim();
  const reason = ui.reasonInput.value.trim();
  if (!address) {
    showToast('请输入地址后再提交', 'error');
    ui.singleInput.focus();
    return;
  }

  // 如果用户选择了搜索建议，直接使用选中的数据
  if (selectedSuggestion) {
    setButtonBusy(ui.addSingleBtn, true, '添加中...');
    try {
      const location = {
        name: selectedSuggestion.name,
        address: selectedSuggestion.address || address,
        reason: reason,
        latitude: selectedSuggestion.latitude,
        longitude: selectedSuggestion.longitude
      };

      const savedLocation = await requestJson('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location)
      });

      locations.push(savedLocation);
      renderLocationsList();
      renderMarkers();
      focusLocation(savedLocation.id);

      ui.singleInput.value = '';
      ui.reasonInput.value = '';
      selectedSuggestion = null;
      hideSuggestions();
      showToast('地点已添加', 'success');
    } catch (err) {
      showToast(`添加失败：${err.message}`, 'error');
    } finally {
      setButtonBusy(ui.addSingleBtn, false);
    }
    return;
  }

  const name = extractName(address);
  setButtonBusy(ui.addSingleBtn, true, '搜索中...');

  try {
    // 先调用搜索 API 进行模糊搜索
    const searchResult = await requestJson('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: address, city: '0591' })
    });

    if (!searchResult.pois || searchResult.pois.length === 0) {
      throw new Error('未找到相关地点，请输入更详细的地址');
    }

    const poi = searchResult.pois[0];

    // 高德搜索 API 返回的 location 可能是字符串 "lng,lat" 或对象 {lng,lat}
    let lng, lat;
    if (typeof poi.location === 'string') {
      [lng, lat] = poi.location.split(',').map(Number);
    } else {
      lng = Number(poi.location.lng);
      lat = Number(poi.location.lat);
    }

    // 验证坐标是否有效（排除 0,0 或超出范围的值）
    if (!lng || !lat || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error('无效的地理坐标');
    }

    const location = {
      name: name,
      address: address,
      reason: reason,
      latitude: lat,
      longitude: lng
    };

    // 保存到后端
    const savedLocation = await requestJson('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location)
    });

    locations.push(savedLocation);
    renderLocationsList();
    renderMarkers();

    // 聚焦到新标记
    focusLocation(savedLocation.id);

    ui.singleInput.value = '';
    ui.reasonInput.value = '';
    showToast('地点已添加', 'success');
  } catch (err) {
    showToast(`添加失败：${err.message}`, 'error');
  } finally {
    setButtonBusy(ui.addSingleBtn, false);
  }
}

async function addBatchLocations() {
  const lines = ui.batchInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    showToast('请至少输入一条地址', 'error');
    ui.batchInput.focus();
    return;
  }

  setButtonBusy(ui.addBatchBtn, true, '导入中...');

  const newLocations = lines.map((address) => ({
    name: extractName(address),
    address
  }));

  try {
    const result = await requestJson('/api/locations/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: newLocations })
    });

    locations.push(...result.locations);
    renderLocationsList();

    for (const loc of result.locations) {
      await geocodeLocation(loc, { silentSuccess: true });
    }

    ui.batchInput.value = '';
    showToast(`已添加 ${result.added} 个地点`, 'success');
  } catch (err) {
    showToast(`批量添加失败：${err.message}`, 'error');
  } finally {
    setButtonBusy(ui.addBatchBtn, false);
  }
}

async function geocodeLocation(location, options = {}) {
  if (!location.address) return;

  try {
    const data = await requestJson('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: location.address })
    });

    if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) {
      throw new Error(data.info || '未找到该地址');
    }

    const geocode = data.geocodes[0];
    const [lng, lat] = geocode.location.split(',');

    await requestJson(`/api/locations/${location.id}/geocode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: Number(lat),
        longitude: Number(lng)
      })
    });

    const index = locations.findIndex((item) => item.id === location.id);
    if (index !== -1) {
      locations[index].latitude = Number(lat);
      locations[index].longitude = Number(lng);
    }

    renderLocationsList();
    renderMarkers();

    if (!options.silentSuccess) {
      focusLocation(location.id);
    }
  } catch (err) {
    console.warn('地理编码失败:', err);
    showToast(`“${location.address}”定位失败：${err.message}`, 'error');
  }
}

async function deleteLocation(id) {
  if (!window.confirm('确定删除该地点吗？')) return;

  try {
    await requestJson(`/api/locations/${id}`, { method: 'DELETE' });
    locations = locations.filter((item) => item.id !== id);

    if (activeLocationId === id) {
      activeLocationId = null;
    }

    renderLocationsList();
    renderMarkers();
    showToast('地点已删除', 'success');
  } catch (err) {
    showToast(`删除失败：${err.message}`, 'error');
  }
}

// 搜索建议相关函数
function hideSuggestions() {
  ui.searchSuggestions.classList.remove('show');
  ui.searchSuggestions.innerHTML = '';
}

function showSuggestions(pois) {
  if (!pois || pois.length === 0) {
    hideSuggestions();
    return;
  }

  const html = pois.map((poi, index) => {
    let lng, lat;
    if (typeof poi.location === 'string') {
      [lng, lat] = poi.location.split(',').map(Number);
    } else {
      lng = Number(poi.location.lng);
      lat = Number(poi.location.lat);
    }

    return `
      <div class="suggestion-item" data-index="${index}">
        <div class="suggestion-name">${escapeHtml(poi.name)}</div>
        <div class="suggestion-address">${escapeHtml(poi.address || poi.type || '')}</div>
      </div>
    `;
  }).join('');

  ui.searchSuggestions.innerHTML = html;
  ui.searchSuggestions.classList.add('show');

  // 绑定点击事件
  ui.searchSuggestions.querySelectorAll('.suggestion-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      const poi = pois[index];
      let lng, lat;
      if (typeof poi.location === 'string') {
        [lng, lat] = poi.location.split(',').map(Number);
      } else {
        lng = Number(poi.location.lng);
        lat = Number(poi.location.lat);
      }

      selectedSuggestion = {
        name: poi.name,
        address: poi.address || ui.singleInput.value,
        latitude: lat,
        longitude: lng
      };

      ui.singleInput.value = poi.name;
      hideSuggestions();
    });
  });
}

async function fetchSuggestions(keywords) {
  if (!keywords || keywords.length < 2) {
    hideSuggestions();
    return;
  }

  try {
    const result = await requestJson('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, city: '0591' })
    });

    if (result.pois && result.pois.length > 0) {
      showSuggestions(result.pois.slice(0, 8)); // 最多显示 8 条
    } else {
      hideSuggestions();
    }
  } catch (err) {
    console.warn('获取建议失败:', err);
    hideSuggestions();
  }
}

function extractName(address) {
  const patterns = [
    /^(.+?)(?:店|广场|中心|大厦|小区|路|号)/,
    /^(.+?)(?:福州|仓山|鼓楼|台江|马尾|晋安|长乐)/
  ];

  for (const pattern of patterns) {
    const match = address.match(pattern);
    if (match && match[1].length > 1) {
      return match[1].trim();
    }
  }

  return address;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleListAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!id) return;

  if (action === 'delete') {
    deleteLocation(id);
    return;
  }

  if (action === 'focus') {
    focusLocation(id);
  }
}

function handleListKeyboard(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const target = event.target.closest('[data-action="focus"]');
  if (!target) return;

  event.preventDefault();
  const id = target.dataset.id;
  if (id) {
    focusLocation(id);
  }
}

function bindEvents() {
  ui.addSingleBtn.addEventListener('click', addSingleLocation);
  ui.addBatchBtn.addEventListener('click', addBatchLocations);
  ui.fitMarkersBtn.addEventListener('click', fitAllMarkers);
  ui.locateMeBtn.addEventListener('click', locateMe);

  ui.singleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSingleLocation();
    }
  });

  // 搜索建议 - 防抖输入
  ui.singleInput.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  });

  // 点击输入框外隐藏建议
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-box')) {
      hideSuggestions();
    }
  });

  ui.locationsList.addEventListener('click', handleListAction);
  ui.locationsList.addEventListener('keydown', handleListKeyboard);
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initMap(() => {
    bindEvents();
    loadLocations();
  });
});
