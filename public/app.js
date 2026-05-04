const AMAP_CONFIG = {
  securityCode: 'db67e6113b81508f33ae7b14dbc42358'
};

window._AMapSecurityConfig = {
  securityJsCode: AMAP_CONFIG.securityCode
};

const FUZHOU_CENTER = [119.296531, 26.061473];
const SEARCH_CITY = '福州';
const SEARCH_CITY_CODE = '0591';
const SEARCH_LIMIT = 8;
const FUZHOU_ADCODE_PREFIX = '3501';
const MOBILE_BREAKPOINT = 720;
const FOCUS_ZOOM = 17;
const MOBILE_ZOOM_ANIMATION_MS = 360;
const SHARE_POSTER_WIDTH = 900;
const SHARE_POSTER_HEIGHT = 1400;
const SHARE_MAP_HEIGHT = 520;
const SHARE_QR_VERSION = 10;
const SHARE_QR_SIZE = 4 * SHARE_QR_VERSION + 17;

// 分类配置
const CATEGORIES = {
  food: { label: '餐饮美食', color: '#ef4444' },
  spot: { label: '景点休闲', color: '#10b981' },
  shopping: { label: '购物消费', color: '#8b5cf6' },
  traffic: { label: '交通枢纽', color: '#3b82f6' },
  medical: { label: '医疗服务', color: '#f59e0b' },
  education: { label: '教育培训', color: '#06b6d4' },
  other: { label: '其他', color: '#6b7280' }
};

const CATEGORY_ALIASES = {
  food: ['餐饮美食', '餐饮', '美食', '咖啡', '小吃', '甜品', '饮品', '餐厅', '饭店'],
  spot: ['景点休闲', '景点', '休闲', '景区', '公园', '乐园', '娱乐', '旅游'],
  shopping: ['购物消费', '购物', '商场', '超市', '百货', '便利店', '消费'],
  traffic: ['交通枢纽', '交通', '地铁', '高铁', '火车站', '汽车站', '机场', '码头'],
  medical: ['医疗服务', '医疗', '医院', '诊所', '药店', '门诊'],
  education: ['教育培训', '教育', '学校', '培训', '大学', '学院', '图书馆'],
  other: ['其他', '其它']
};

const SOURCE_TYPES = {
  manual: '手动添加',
  text: 'AI 文本',
  map_location: '地图定位',
  douyin_url: '抖音 URL',
  video: '视频内容'
};

let map = null;
let markers = [];
let markerMap = new Map();
let locations = [];
let activeLocationId = null;
let activeDetailLocationId = null;
let detailDrawerTrigger = null;
let visibleLocationIds = new Set();
let toastTimer = null;
let myLocationMarker = null;
let myLocationInfoWindow = null;
let isAddSheetOpen = false;
let isListSheetOpen = false;
let activeCategoryFilter = 'all';
let activeSearchKeyword = '';
let currentSharePoster = null;

let ui = {};

let searchDebounceTimer = null;
let selectedSuggestion = null;
let autoCompleteService = null;
let placeSearchService = null;
let searchServicesPromise = null;
let latestSuggestionRequestId = 0;
let geolocationService = null;
let geolocationServicePromise = null;
let lastViewportWidth = window.innerWidth;
let lastIsMobileLayout = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
let lastOrientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';

function initMap(callback) {
  // 延迟创建地图，确保 PC 模式下 CSS grid 布局已完全稳定
  setTimeout(() => {
    map = new AMap.Map('map', {
      zoom: 12,
      center: FUZHOU_CENTER,
      viewMode: '2D',
      resizeEnable: true,
      zoomControl: true,
      scale: true
    });

    initSearchServices();
    initGeolocationService();
    bindMapEvents();
    triggerMapResize();

    setTimeout(() => {
      triggerMapResize();
      if (callback) callback();
    }, 100);
  }, 500);
}

function initSearchServices() {
  if (searchServicesPromise) {
    return searchServicesPromise;
  }

  if (!window.AMap || typeof AMap.plugin !== 'function') {
    searchServicesPromise = Promise.resolve(false);
    return searchServicesPromise;
  }

  searchServicesPromise = new Promise((resolve) => {
    AMap.plugin(['AMap.AutoComplete', 'AMap.PlaceSearch'], () => {
      try {
        const AutoCompleteConstructor = AMap.AutoComplete || AMap.Autocomplete;

        if (!AutoCompleteConstructor || !AMap.PlaceSearch) {
          resolve(false);
          return;
        }

        autoCompleteService = new AutoCompleteConstructor({
          city: SEARCH_CITY,
          citylimit: false,
          datatype: 'poi'
        });

        placeSearchService = new AMap.PlaceSearch({
          city: SEARCH_CITY,
          citylimit: false,
          pageSize: SEARCH_LIMIT,
          pageIndex: 1,
          extensions: 'all'
        });

        if (typeof autoCompleteService.setCityLimit === 'function') {
          autoCompleteService.setCityLimit(false);
        }

        if (typeof placeSearchService.setCityLimit === 'function') {
          placeSearchService.setCityLimit(false);
        }

        resolve(true);
      } catch (err) {
        console.warn('初始化高德搜索服务失败:', err);
        resolve(false);
      }
    });
  });

  return searchServicesPromise;
}

function initGeolocationService() {
  if (geolocationServicePromise) {
    return geolocationServicePromise;
  }

  if (!window.AMap || typeof AMap.plugin !== 'function') {
    geolocationServicePromise = Promise.resolve(false);
    return geolocationServicePromise;
  }

  geolocationServicePromise = new Promise((resolve) => {
    AMap.plugin('AMap.Geolocation', () => {
      try {
        if (!AMap.Geolocation) {
          resolve(false);
          return;
        }

        geolocationService = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
          convert: true,
          showButton: false,
          showMarker: false,
          showCircle: false,
          panToLocation: false,
          zoomToAccuracy: false,
          needAddress: true,
          getCityWhenFail: true,
          GeoLocationFirst: true
        });

        resolve(true);
      } catch (err) {
        console.warn('初始化高德定位服务失败:', err);
        resolve(false);
      }
    });
  });

  return geolocationServicePromise;
}

function bindMapEvents() {
  if (!map || typeof map.on !== 'function') return;

  map.on('moveend', () => refreshViewportState());
  map.on('zoomend', () => {
    refreshViewportState();
    updateMobileZoomControls();
  });
}

function initUI() {
  ui = {
    singleInput: document.getElementById('singleInput'),
    reasonInput: document.getElementById('reasonInput'),
    addSingleBtn: document.getElementById('addSingleBtn'),
    locationsList: document.getElementById('locationsList'),
    locationSearchInput: document.getElementById('locationSearchInput'),
    locationCount: document.getElementById('locationCount'),
    geocodedCount: document.getElementById('geocodedCount'),
    listSummary: document.getElementById('listSummary'),
    viewportCount: document.getElementById('viewportCount'),
    viewportHint: document.getElementById('viewportHint'),
    mobileLocationSummary: document.getElementById('mobileLocationSummary'),
    mobileViewportCount: document.getElementById('mobileViewportCount'),
    mobileViewportHint: document.getElementById('mobileViewportHint'),
    mobileActionDock: document.getElementById('mobileActionDock'),
    mobileLocateBtn: document.getElementById('mobileLocateBtn'),
    mobileAddToggleBtn: document.getElementById('mobileAddToggleBtn'),
    mobileListToggleBtn: document.getElementById('mobileListToggleBtn'),
    mobileAddSheet: document.getElementById('mobileAddSheet'),
    mobileListSheet: document.getElementById('mobileListSheet'),
    mobileAddCloseBtn: document.getElementById('mobileAddCloseBtn'),
    mobileListCloseBtn: document.getElementById('mobileListCloseBtn'),
    mobileExportBtn: document.getElementById('mobileExportBtn'),
    mobileZoomInBtn: document.getElementById('mobileZoomInBtn'),
    mobileZoomOutBtn: document.getElementById('mobileZoomOutBtn'),
    toast: document.getElementById('toast'),
    searchSuggestions: document.getElementById('searchSuggestions'),
    locateMeBtn: document.getElementById('locateMeBtn'),
    exportBtn: document.getElementById('exportBtn'),
    categorySelect: document.getElementById('categorySelect'),
    categoryFilterSelect: document.getElementById('categoryFilterSelect'),
    mobileCategoryFilterSelect: document.getElementById('mobileCategoryFilterSelect'),
    detailDrawer: document.getElementById('detailDrawer'),
    detailTitle: document.getElementById('detailTitle'),
    detailCategory: document.getElementById('detailCategory'),
    detailAddress: document.getElementById('detailAddress'),
    detailReason: document.getElementById('detailReason'),
    detailCoords: document.getElementById('detailCoords'),
    detailCreatedAt: document.getElementById('detailCreatedAt'),
    detailFocusBtn: document.getElementById('detailFocusBtn'),
    detailNavigateBtn: document.getElementById('detailNavigateBtn'),
    detailShareBtn: document.getElementById('detailShareBtn'),
    detailEditBtn: document.getElementById('detailEditBtn'),
    detailDeleteBtn: document.getElementById('detailDeleteBtn'),
    detailCloseBtn: document.getElementById('detailCloseBtn'),
    sharePosterDialog: document.getElementById('sharePosterDialog'),
    sharePosterPreview: document.getElementById('sharePosterPreview'),
    sharePosterCloseBtn: document.getElementById('sharePosterCloseBtn'),
    sharePosterCopyBtn: document.getElementById('sharePosterCopyBtn'),
    sharePosterDoneBtn: document.getElementById('sharePosterDoneBtn'),
    // 编辑对话框
    editDialog: document.getElementById('editDialog'),
    editLocationId: document.getElementById('editLocationId'),
    editName: document.getElementById('editName'),
    editAddress: document.getElementById('editAddress'),
    editCategory: document.getElementById('editCategory'),
    editReason: document.getElementById('editReason'),
    saveEditBtn: document.getElementById('saveEditBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    dialogClose: document.getElementById('editDialogCloseBtn')
  };
}

function hasCoordinates(loc) {
  const lat = loc && loc.latitude;
  const lng = loc && loc.longitude;
  return lat !== null &&
    lat !== undefined &&
    lat !== '' &&
    lng !== null &&
    lng !== undefined &&
    lng !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));
}

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function formatDateTime(value) {
  if (!value) return '未知';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getLocationById(id) {
  return locations.find((item) => item.id === id) || null;
}

function getCoordinateText(loc) {
  if (!hasCoordinates(loc)) {
    return '未定位';
  }

  return `${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)}`;
}

function buildNavigationUrl(loc) {
  if (!hasCoordinates(loc)) return '';

  const longitude = Number(loc.longitude);
  const latitude = Number(loc.latitude);
  const name = encodeURIComponent(loc.name || '目的地');
  return `https://uri.amap.com/navigation?to=${longitude},${latitude},${name}&mode=car&src=map-tool&coordinate=gaode&callnative=1`;
}

function navigateToLocation(loc) {
  const url = loc ? buildNavigationUrl(loc) : '';

  if (!url) {
    showToast('该地点还未完成定位', 'error');
    return false;
  }

  window.open(url, '_blank', 'noopener');
  return true;
}

function buildLocationSharePayload(loc) {
  const title = loc && loc.name ? loc.name : '地点';
  const address = loc && loc.address ? loc.address : '未填写地址';
  const url = loc ? buildNavigationUrl(loc) : '';
  const nativeText = [title, address].filter(Boolean).join('\n');
  const fallbackText = url
    ? `${nativeText}\n${url}`
    : nativeText;

  return {
    title,
    nativeText,
    fallbackText,
    url
  };
}

function isWechatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('复制失败');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('地图图片加载失败'));
    };
    image.src = url;
  });
}

async function loadShareMapImage(loc) {
  const query = new URLSearchParams({
    latitude: String(Number(loc.latitude)),
    longitude: String(Number(loc.longitude)),
    name: loc.name || '地点'
  });
  const response = await fetch(`/api/share-map?${query.toString()}`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || '地图图片生成失败');
  }

  return loadImageFromBlob(await response.blob());
}

async function loadSharePoiInfo(loc) {
  const query = new URLSearchParams({
    latitude: String(Number(loc.latitude)),
    longitude: String(Number(loc.longitude)),
    name: loc.name || ''
  });

  if (loc.sourceId) {
    query.set('sourceId', loc.sourceId);
  }

  const response = await fetch(`/api/share-poi?${query.toString()}`);
  if (!response.ok) {
    throw new Error('地点详情补充失败');
  }

  const result = await response.json();
  return result && result.poi ? result.poi : null;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text || '').split('');
  const lines = [];
  let line = '';

  chars.forEach((char) => {
    const nextLine = line + char;
    if (line && ctx.measureText(nextLine).width > maxWidth) {
      lines.push(line);
      line = char;
      return;
    }

    line = nextLine;
  });

  if (line) {
    lines.push(line);
  }

  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines && visibleLines.length > 0) {
    let lastLine = visibleLines[visibleLines.length - 1];
    while (lastLine.length > 0 && ctx.measureText(`${lastLine}...`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1);
    }
    visibleLines[visibleLines.length - 1] = `${lastLine}...`;
  }

  visibleLines.forEach((item, index) => {
    ctx.fillText(item, x, y + index * lineHeight);
  });

  return y + visibleLines.length * lineHeight;
}

function drawMapFallback(ctx, loc) {
  const gradient = ctx.createLinearGradient(0, 0, SHARE_POSTER_WIDTH, SHARE_MAP_HEIGHT);
  gradient.addColorStop(0, '#dbeafe');
  gradient.addColorStop(1, '#dcfce7');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_POSTER_WIDTH, SHARE_MAP_HEIGHT);

  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 12;
  for (let i = -1; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-80, 120 + i * 86);
    ctx.bezierCurveTo(190, 48 + i * 70, 340, 210 + i * 80, 600, 130 + i * 74);
    ctx.bezierCurveTo(720, 92 + i * 70, 820, 150 + i * 74, 980, 86 + i * 70);
    ctx.stroke();
  }

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(SHARE_POSTER_WIDTH / 2, SHARE_MAP_HEIGHT / 2 - 18, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(SHARE_POSTER_WIDTH / 2, SHARE_MAP_HEIGHT / 2 + 50);
  ctx.lineTo(SHARE_POSTER_WIDTH / 2 - 18, SHARE_MAP_HEIGHT / 2 + 10);
  ctx.lineTo(SHARE_POSTER_WIDTH / 2 + 18, SHARE_MAP_HEIGHT / 2 + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((loc.name || '地点').slice(0, 1), SHARE_POSTER_WIDTH / 2, SHARE_MAP_HEIGHT / 2 - 10);
  ctx.textAlign = 'left';
}

function createQrCodeMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const maxDataBytes = 271;
  if (bytes.length > maxDataBytes) {
    throw new Error('分享链接过长，无法生成二维码');
  }

  const dataCodewords = 274;
  const blockSizes = [68, 68, 69, 69];
  const ecCodewordsPerBlock = 18;
  const bits = [];
  const appendBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  };

  appendBits(0x4, 4);
  appendBits(bytes.length, 16);
  bytes.forEach((byte) => appendBits(byte, 8));
  appendBits(0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }

  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xfd) {
    data.push(pad);
  }

  const gfMul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  };

  const rsDivisor = (degree) => {
    const result = Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < degree; j += 1) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  };

  const rsRemainder = (block, divisor) => {
    const result = Array(divisor.length).fill(0);
    block.forEach((byte) => {
      const factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach((coef, index) => {
        result[index] ^= gfMul(coef, factor);
      });
    });
    return result;
  };

  const blocks = [];
  let offset = 0;
  const divisor = rsDivisor(ecCodewordsPerBlock);
  blockSizes.forEach((size) => {
    const block = data.slice(offset, offset + size);
    blocks.push({ data: block, ec: rsRemainder(block, divisor) });
    offset += size;
  });

  const codewords = [];
  const maxBlockSize = Math.max(...blockSizes);
  for (let i = 0; i < maxBlockSize; i += 1) {
    blocks.forEach((block) => {
      if (i < block.data.length) codewords.push(block.data[i]);
    });
  }
  for (let i = 0; i < ecCodewordsPerBlock; i += 1) {
    blocks.forEach((block) => codewords.push(block.ec[i]));
  }

  const size = SHARE_QR_SIZE;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const setModule = (x, y, dark, isReserved = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = Boolean(dark);
    if (isReserved) reserved[y][x] = true;
  };

  const drawFinder = (left, top) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inFinder && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setModule(xx, yy, dark);
      }
    }
  };

  const drawAlignment = (centerX, centerY) => {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        setModule(centerX + x, centerY + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  [6, 28, 50].forEach((y) => {
    [6, 28, 50].forEach((x) => {
      if ((x === 6 && y === 6) || (x === 6 && y === 50) || (x === 50 && y === 6)) return;
      drawAlignment(x, y);
    });
  });

  for (let i = 8; i < size - 8; i += 1) {
    setModule(i, 6, i % 2 === 0);
    setModule(6, i, i % 2 === 0);
  }
  setModule(8, 4 * SHARE_QR_VERSION + 9, true);

  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      reserved[i][size - 11 + j] = true;
      reserved[size - 11 + j][i] = true;
    }
  }

  const dataBits = codewords.flatMap((byte) => {
    const result = [];
    for (let i = 7; i >= 0; i -= 1) result.push((byte >>> i) & 1);
    return result;
  });
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let xOffset = 0; xOffset < 2; xOffset += 1) {
        const x = right - xOffset;
        if (!reserved[y][x]) {
          modules[y][x] = bitIndex < dataBits.length ? Boolean(dataBits[bitIndex]) : false;
          bitIndex += 1;
        }
      }
    }
    upward = !upward;
  }

  const mask = 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!reserved[y][x] && y % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  const drawFormatBits = () => {
    const errorCorrectionBits = 1;
    let dataValue = (errorCorrectionBits << 3) | mask;
    let remainder = dataValue << 10;
    for (let i = 14; i >= 10; i -= 1) {
      if (((remainder >>> i) & 1) !== 0) {
        remainder ^= 0x537 << (i - 10);
      }
    }
    const bitsValue = ((dataValue << 10) | remainder) ^ 0x5412;
    const getBit = (i) => ((bitsValue >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i += 1) setModule(8, i, getBit(i));
    setModule(8, 7, getBit(6));
    setModule(8, 8, getBit(7));
    setModule(7, 8, getBit(8));
    for (let i = 9; i < 15; i += 1) setModule(14 - i, 8, getBit(i));
    for (let i = 0; i < 8; i += 1) setModule(size - 1 - i, 8, getBit(i));
    for (let i = 8; i < 15; i += 1) setModule(8, size - 15 + i, getBit(i));
  };

  const drawVersionBits = () => {
    let remainder = SHARE_QR_VERSION << 12;
    for (let i = 17; i >= 12; i -= 1) {
      if (((remainder >>> i) & 1) !== 0) {
        remainder ^= 0x1f25 << (i - 12);
      }
    }
    const bitsValue = (SHARE_QR_VERSION << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bitsValue >>> i) & 1) !== 0;
      setModule(size - 11 + (i % 3), Math.floor(i / 3), bit);
      setModule(Math.floor(i / 3), size - 11 + (i % 3), bit);
    }
  };

  drawFormatBits();
  drawVersionBits();
  return modules;
}

function drawQrCode(ctx, text, x, y, size) {
  const modules = createQrCodeMatrix(text);
  const quietZone = 4;
  const count = modules.length + quietZone * 2;
  const moduleSize = Math.floor(size / count);
  const actualSize = moduleSize * count;
  const offset = Math.floor((size - actualSize) / 2);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#111827';
  modules.forEach((row, rowIndex) => {
    row.forEach((dark, colIndex) => {
      if (!dark) return;
      ctx.fillRect(
        x + offset + (colIndex + quietZone) * moduleSize,
        y + offset + (rowIndex + quietZone) * moduleSize,
        moduleSize,
        moduleSize
      );
    });
  });
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('海报图片生成失败'));
        return;
      }
      resolve(blob);
    }, 'image/png', 0.95);
  });
}

function formatSharePoiRows(loc, poiInfo) {
  const rows = [];
  const tel = normalizeOptionalText(poiInfo && poiInfo.tel);
  const businessArea = normalizeOptionalText(poiInfo && poiInfo.businessArea);
  const openingHours = normalizeOptionalText(poiInfo && poiInfo.openingHours);
  const rating = normalizeOptionalText(poiInfo && poiInfo.rating);
  const cost = normalizeOptionalText(poiInfo && poiInfo.cost);
  const ratingCost = [rating ? `${rating} 分` : '', cost ? `人均 ${cost.startsWith('¥') ? cost : `¥${cost}`}` : '']
    .filter(Boolean)
    .join(' · ');

  if (tel) rows.push({ label: '电话', value: tel });
  if (openingHours) rows.push({ label: '营业', value: openingHours });
  if (ratingCost) rows.push({ label: '评分', value: ratingCost });
  if (businessArea) rows.push({ label: '商圈', value: businessArea });

  return rows.slice(0, 4);
}

function drawInfoChip(ctx, label, value, x, y, width) {
  ctx.fillStyle = '#f8fafc';
  drawRoundedRect(ctx, x, y, width, 72, 16);
  ctx.fill();

  ctx.fillStyle = '#64748b';
  ctx.font = '700 17px Arial, sans-serif';
  ctx.fillText(label, x + 18, y + 25);

  ctx.fillStyle = '#334155';
  ctx.font = '600 21px Arial, sans-serif';
  fillWrappedText(ctx, value, x + 18, y + 57, width - 36, 25, 1);
}

function drawSharePosterInfo(ctx, loc, payload, poiInfo) {
  const left = 58;
  const maxWidth = SHARE_POSTER_WIDTH - left * 2;
  let y = SHARE_MAP_HEIGHT + 74;
  const poiRows = formatSharePoiRows(loc, poiInfo);

  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, 34, SHARE_MAP_HEIGHT - 56, SHARE_POSTER_WIDTH - 68, 590, 30);
  ctx.fill();

  ctx.fillStyle = '#182334';
  ctx.font = '700 54px Arial, sans-serif';
  y = fillWrappedText(ctx, loc.name || '地点', left, y, maxWidth, 60, 2) + 22;

  ctx.fillStyle = '#5d6b7f';
  ctx.font = '400 28px Arial, sans-serif';
  y = fillWrappedText(ctx, loc.address || '未填写地址', left, y, maxWidth, 38, 2) + 30;

  ctx.fillStyle = '#182334';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('备注', left, y);
  y += 40;

  ctx.fillStyle = '#5d6b7f';
  ctx.font = '400 25px Arial, sans-serif';
  y = fillWrappedText(ctx, loc.reason || '暂无备注', left, y, maxWidth, 36, 2) + 28;

  const chipGap = 18;
  const chipWidth = (maxWidth - chipGap) / 2;
  poiRows.forEach((row, index) => {
    const chipX = left + (index % 2) * (chipWidth + chipGap);
    const chipY = y + Math.floor(index / 2) * 84;
    drawInfoChip(ctx, row.label, row.value, chipX, chipY, chipWidth);
  });

  ctx.fillStyle = '#f8fafc';
  drawRoundedRect(ctx, 34, 1060, SHARE_POSTER_WIDTH - 68, 290, 30);
  ctx.fill();

  const qrSize = 220;
  const qrX = 72;
  const qrY = 1096;
  drawQrCode(ctx, payload.url, qrX, qrY, qrSize);

  ctx.fillStyle = '#182334';
  ctx.font = '700 36px Arial, sans-serif';
  ctx.fillText('扫码打开高德导航', 340, 1134);
  ctx.fillStyle = '#5d6b7f';
  ctx.font = '400 25px Arial, sans-serif';
  fillWrappedText(ctx, '识别二维码后可直接跳转到该地点的高德导航页面。', 340, 1186, 440, 38, 3);
}

async function createSharePoster(loc, payload) {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_POSTER_WIDTH;
  canvas.height = SHARE_POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#edf1f5';
  ctx.fillRect(0, 0, SHARE_POSTER_WIDTH, SHARE_POSTER_HEIGHT);

  const [mapImage, poiInfo] = await Promise.all([
    loadShareMapImage(loc).catch((err) => {
      console.warn('静态地图加载失败，使用海报占位地图:', err);
      return null;
    }),
    loadSharePoiInfo(loc).catch((err) => {
      console.warn('地点详情补充失败，使用本地地点信息:', err);
      return null;
    })
  ]);

  if (mapImage) {
    ctx.drawImage(mapImage, 0, 0, SHARE_POSTER_WIDTH, SHARE_MAP_HEIGHT);
  } else {
    drawMapFallback(ctx, loc);
  }

  drawSharePosterInfo(ctx, loc, payload, poiInfo);

  const blob = await canvasToBlob(canvas);
  const fileName = `${(loc.name || '地点').replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '地点'}-分享海报.png`;
  const file = typeof File === 'function'
    ? new File([blob], fileName, { type: 'image/png' })
    : null;

  return {
    blob,
    file,
    dataUrl: canvas.toDataURL('image/png'),
    payload
  };
}

function openSharePosterDialog(poster) {
  currentSharePoster = poster;
  if (!ui.sharePosterDialog || !ui.sharePosterPreview) return;

  ui.sharePosterPreview.src = poster.dataUrl;
  ui.sharePosterDialog.classList.add('is-open');
  ui.sharePosterDialog.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');

  window.requestAnimationFrame(() => {
    if (ui.sharePosterCopyBtn) {
      ui.sharePosterCopyBtn.focus();
    }
  });
}

function closeSharePosterDialog() {
  if (!ui.sharePosterDialog) return;

  ui.sharePosterDialog.classList.remove('is-open');
  ui.sharePosterDialog.setAttribute('aria-hidden', 'true');
  if (ui.sharePosterPreview) {
    ui.sharePosterPreview.removeAttribute('src');
  }
  currentSharePoster = null;
  document.body.classList.toggle('drawer-open', Boolean(ui.detailDrawer && ui.detailDrawer.classList.contains('is-open')));
}

async function shareLocation(loc) {
  if (!loc) {
    showToast('未找到可分享的地点', 'error');
    return;
  }

  if (!hasCoordinates(loc)) {
    showToast('该地点还未完成定位，无法生成分享海报', 'error');
    return;
  }

  const payload = buildLocationSharePayload(loc);
  setButtonBusy(ui.detailShareBtn, true, '生成中...');

  try {
    const poster = await createSharePoster(loc, payload);
    const canSharePosterFile = poster.file &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [poster.file] });

    if (!isWechatBrowser() && canSharePosterFile) {
      try {
        await navigator.share({
          title: payload.title,
          text: payload.nativeText,
          files: [poster.file]
        });
        showToast('已打开系统分享面板', 'success');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return;
        }
        console.warn('图片分享失败，打开海报预览:', err);
      }
    }

    openSharePosterDialog(poster);
    showToast(isWechatBrowser() ? '长按海报保存或转发' : '已生成分享海报', 'success');
  } catch (err) {
    console.warn('分享海报生成失败，回退到复制内容:', err);
    try {
      await copyTextToClipboard(payload.fallbackText);
      showToast(`海报生成失败，已复制分享内容：${err.message}`, 'error');
    } catch (copyErr) {
      showToast(`分享失败：${copyErr.message}`, 'error');
    }
  } finally {
    setButtonBusy(ui.detailShareBtn, false);
  }
}

async function copyCurrentSharePosterLink() {
  if (!currentSharePoster || !currentSharePoster.payload || !currentSharePoster.payload.url) {
    showToast('没有可复制的高德链接', 'error');
    return;
  }

  try {
    await copyTextToClipboard(currentSharePoster.payload.url);
    showToast('已复制高德链接', 'success');
  } catch (err) {
    showToast(`复制失败：${err.message}`, 'error');
  }
}

function triggerMapResize() {
  if (!map || typeof map.resize !== 'function') return;

  window.requestAnimationFrame(() => {
    map.resize();
    refreshViewportState(true);
  });
}

function getViewportOrientation() {
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

function shouldHandleMapResize() {
  const width = window.innerWidth;
  const nextIsMobileLayout = isMobileLayout();
  const nextOrientation = getViewportOrientation();
  const widthChanged = width !== lastViewportWidth;
  const layoutChanged = nextIsMobileLayout !== lastIsMobileLayout;
  const orientationChanged = nextOrientation !== lastOrientation;

  lastViewportWidth = width;
  lastIsMobileLayout = nextIsMobileLayout;
  lastOrientation = nextOrientation;

  return widthChanged || layoutChanged || orientationChanged;
}

function syncMobileSheetState() {
  const mobileActive = isMobileLayout();
  const anySheetOpen = isAddSheetOpen || isListSheetOpen;

  if (ui.mobileAddSheet) {
    ui.mobileAddSheet.classList.toggle('is-open', isAddSheetOpen);
    ui.mobileAddSheet.setAttribute('aria-hidden', String(mobileActive ? !isAddSheetOpen : false));
  }

  if (ui.mobileListSheet) {
    ui.mobileListSheet.classList.toggle('is-open', isListSheetOpen);
    ui.mobileListSheet.setAttribute('aria-hidden', String(mobileActive ? !isListSheetOpen : false));
  }

  if (ui.mobileAddToggleBtn) {
    ui.mobileAddToggleBtn.setAttribute('aria-expanded', String(isAddSheetOpen));
    ui.mobileAddToggleBtn.classList.toggle('is-active', isAddSheetOpen);
  }

  if (ui.mobileListToggleBtn) {
    ui.mobileListToggleBtn.setAttribute('aria-expanded', String(isListSheetOpen));
    ui.mobileListToggleBtn.classList.toggle('is-active', isListSheetOpen);
  }

  if (ui.mobileActionDock) {
    ui.mobileActionDock.classList.toggle('is-muted', anySheetOpen);
  }

  document.body.classList.toggle('mobile-sheet-open', mobileActive && anySheetOpen);
}

function closeMobileSheets(options = {}) {
  const { restoreFocus = false } = options;
  const hadAddSheet = isAddSheetOpen;
  const hadListSheet = isListSheetOpen;

  isAddSheetOpen = false;
  isListSheetOpen = false;
  syncMobileSheetState();
  hideSuggestions();

  if (restoreFocus && hadAddSheet && ui.mobileAddToggleBtn) {
    ui.mobileAddToggleBtn.focus();
    return;
  }

  if (restoreFocus && hadListSheet && ui.mobileListToggleBtn) {
    ui.mobileListToggleBtn.focus();
  }
}

function openMobileAddSheet() {
  if (!isMobileLayout()) return;

  if (ui.detailDrawer.classList.contains('is-open')) {
    closeDetailDrawer({ restoreFocus: false });
  }

  isListSheetOpen = false;
  isAddSheetOpen = true;
  syncMobileSheetState();
  hideSuggestions();

  window.requestAnimationFrame(() => {
    ui.singleInput.focus();
    triggerMapResize();
  });
}

function closeMobileAddSheet(options = {}) {
  if (!isAddSheetOpen) return;

  isAddSheetOpen = false;
  syncMobileSheetState();
  hideSuggestions();

  if (options.restoreFocus !== false && ui.mobileAddToggleBtn) {
    ui.mobileAddToggleBtn.focus();
  }
}

function openMobileListSheet() {
  if (!isMobileLayout()) return;

  if (ui.detailDrawer.classList.contains('is-open')) {
    closeDetailDrawer({ restoreFocus: false });
  }

  isAddSheetOpen = false;
  isListSheetOpen = true;
  syncMobileSheetState();

  window.requestAnimationFrame(() => {
    triggerMapResize();
  });
}

function closeMobileListSheet(options = {}) {
  if (!isListSheetOpen) return;

  isListSheetOpen = false;
  syncMobileSheetState();

  if (options.restoreFocus !== false && ui.mobileListToggleBtn) {
    ui.mobileListToggleBtn.focus();
  }
}

function centerMapOnLocation(loc, zoom = 16, options = {}) {
  if (!hasCoordinates(loc)) {
    showToast('该地点还未完成定位', 'error');
    return false;
  }

  map.setCenter([Number(loc.longitude), Number(loc.latitude)]);
  if (Number.isFinite(zoom)) {
    map.setZoom(zoom);
  }

  window.requestAnimationFrame(() => {
    refreshViewportState(true);
  });

  return true;
}

function setActiveLocation(id) {
  activeLocationId = id;
  renderLocationsList();
  renderMarkers();
  syncDetailDrawer();
}

function areSetsEqual(left, right) {
  if (left.size !== right.size) return false;

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
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

function normalizeText(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, '').toLowerCase()
    : '';
}

function normalizeOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCoordinatePair(location) {
  if (!location) {
    return { longitude: null, latitude: null };
  }

  if (typeof location === 'string') {
    const [lng, lat] = location.split(',').map(Number);
    return {
      longitude: Number.isFinite(lng) ? lng : null,
      latitude: Number.isFinite(lat) ? lat : null
    };
  }

  if (Array.isArray(location) && location.length >= 2) {
    const [lng, lat] = location.map(Number);
    return {
      longitude: Number.isFinite(lng) ? lng : null,
      latitude: Number.isFinite(lat) ? lat : null
    };
  }

  if (typeof location.getLng === 'function' && typeof location.getLat === 'function') {
    const lng = Number(location.getLng());
    const lat = Number(location.getLat());
    return {
      longitude: Number.isFinite(lng) ? lng : null,
      latitude: Number.isFinite(lat) ? lat : null
    };
  }

  if (typeof location.lng === 'number' || typeof location.lat === 'number') {
    const lng = Number(location.lng);
    const lat = Number(location.lat);
    return {
      longitude: Number.isFinite(lng) ? lng : null,
      latitude: Number.isFinite(lat) ? lat : null
    };
  }

  return { longitude: null, latitude: null };
}

function hasValidPoint(point) {
  const lat = point && point.latitude;
  const lng = point && point.longitude;
  return lat !== null &&
    lat !== undefined &&
    lat !== '' &&
    lng !== null &&
    lng !== undefined &&
    lng !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));
}

function joinAddressParts(parts) {
  const unique = [];

  parts.forEach((part) => {
    const value = normalizeOptionalText(part);
    if (!value) return;
    if (unique.some((item) => item === value || item.includes(value) || value.includes(item))) {
      return;
    }
    unique.push(value);
  });

  return unique.join(' ');
}

function buildSuggestionAddress(raw) {
  return joinAddressParts([
    raw && raw.cityname,
    raw && raw.district,
    raw && raw.adname,
    raw && raw.address
  ]);
}

function getSuggestionKey(item) {
  return item.id || `${normalizeText(item.name)}::${normalizeText(item.address)}`;
}

function isFuzhouSuggestion(item) {
  const citycode = normalizeOptionalText(item && item.citycode);
  const adcode = normalizeOptionalText(item && item.adcode);
  const cityname = normalizeOptionalText(item && item.cityname);
  const district = normalizeOptionalText(item && item.district);
  const address = normalizeOptionalText(item && item.address);

  return citycode === SEARCH_CITY_CODE ||
    adcode.startsWith(FUZHOU_ADCODE_PREFIX) ||
    cityname.includes(SEARCH_CITY) ||
    district.includes(SEARCH_CITY) ||
    address.includes(SEARCH_CITY);
}

function normalizeSuggestion(raw, source, keyword, index) {
  const coords = parseCoordinatePair(raw && raw.location);
  const name = normalizeOptionalText(raw && raw.name);

  if (!name) {
    return null;
  }

  return {
    id: normalizeOptionalText(raw && raw.id),
    name,
    address: buildSuggestionAddress(raw) || keyword,
    type: normalizeOptionalText(raw && raw.type),
    district: normalizeOptionalText(raw && (raw.district || raw.adname)),
    cityname: normalizeOptionalText(raw && raw.cityname),
    citycode: normalizeOptionalText(raw && raw.citycode),
    adcode: normalizeOptionalText(raw && raw.adcode),
    latitude: coords.latitude,
    longitude: coords.longitude,
    rawKeyword: keyword,
    source,
    rankIndex: index
  };
}

function mergeSuggestion(existing, incoming) {
  const incomingAddress = incoming.address || existing.address;
  const existingAddress = existing.address || incoming.address;
  const incomingHasPoint = hasValidPoint(incoming);

  return {
    ...existing,
    ...incoming,
    address: incomingAddress.length >= existingAddress.length ? incomingAddress : existingAddress,
    district: incoming.district || existing.district,
    cityname: incoming.cityname || existing.cityname,
    citycode: incoming.citycode || existing.citycode,
    adcode: incoming.adcode || existing.adcode,
    type: incoming.type || existing.type,
    latitude: incomingHasPoint ? incoming.latitude : existing.latitude,
    longitude: incomingHasPoint ? incoming.longitude : existing.longitude,
    source: incoming.source === 'place-search' ? incoming.source : existing.source,
    rankIndex: Math.min(existing.rankIndex, incoming.rankIndex)
  };
}

function scoreSuggestion(item, context = {}) {
  const keyword = normalizeText(context.keyword);
  const selectedName = normalizeText(context.selectedName);
  const selectedId = normalizeOptionalText(context.selectedId);
  const name = normalizeText(item.name);
  const address = normalizeText(item.address);
  let score = 0;

  if (selectedId && item.id && item.id === selectedId) {
    score += 1000;
  }

  if (selectedName) {
    if (name === selectedName) {
      score += 700;
    } else if (name.includes(selectedName) || selectedName.includes(name)) {
      score += 320;
    }
  }

  if (keyword) {
    if (name === keyword) {
      score += 400;
    } else if (name.includes(keyword) || keyword.includes(name)) {
      score += 180;
    }

    if (address.includes(keyword)) {
      score += 50;
    }
  }

  if (isFuzhouSuggestion(item)) {
    score += 120;
  }

  if (hasValidPoint(item)) {
    score += 30;
  }

  if (item.source === 'place-search') {
    score += 15;
  }

  return score - (item.rankIndex * 0.001);
}

function rankSuggestions(items, context) {
  return [...items].sort((a, b) => scoreSuggestion(b, context) - scoreSuggestion(a, context));
}

function mergeSuggestionLists(lists, context) {
  const merged = new Map();

  lists.flat().forEach((item) => {
    if (!item) return;

    const key = getSuggestionKey(item);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, item);
      return;
    }

    merged.set(key, mergeSuggestion(existing, item));
  });

  return rankSuggestions(Array.from(merged.values()), context).slice(0, SEARCH_LIMIT);
}

function searchWithAutoComplete(keyword) {
  return new Promise((resolve, reject) => {
    if (!autoCompleteService) {
      resolve([]);
      return;
    }

    autoCompleteService.search(keyword, (status, result) => {
      if (status === 'error') {
        reject(new Error('高德输入提示失败'));
        return;
      }

      const tips = Array.isArray(result && result.tips) ? result.tips : [];
      resolve(
        tips
          .map((item, index) => normalizeSuggestion(item, 'auto-complete', keyword, index))
          .filter(Boolean)
      );
    });
  });
}

function searchWithPlaceSearch(keyword) {
  return new Promise((resolve, reject) => {
    if (!placeSearchService) {
      resolve([]);
      return;
    }

    placeSearchService.search(keyword, (status, result) => {
      if (status === 'error') {
        reject(new Error('高德地点搜索失败'));
        return;
      }

      const pois = Array.isArray(result && result.poiList && result.poiList.pois)
        ? result.poiList.pois
        : [];

      resolve(
        pois
          .map((item, index) => normalizeSuggestion(item, 'place-search', keyword, index))
          .filter(Boolean)
      );
    });
  });
}

async function fetchFallbackSuggestions(keyword) {
  const result = await requestJson('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: keyword, city: SEARCH_CITY })
  });

  return Array.isArray(result.pois)
    ? result.pois
      .map((item, index) => normalizeSuggestion(item, 'api-fallback', keyword, index))
      .filter(Boolean)
      .slice(0, SEARCH_LIMIT)
    : [];
}

async function lookupSuggestions(keyword) {
  const servicesReady = await initSearchServices();

  if (!servicesReady) {
    return fetchFallbackSuggestions(keyword);
  }

  try {
    const [tips, pois] = await Promise.all([
      searchWithAutoComplete(keyword),
      searchWithPlaceSearch(keyword)
    ]);

    const merged = mergeSuggestionLists([tips, pois], { keyword });
    if (merged.length > 0) {
      return merged;
    }
  } catch (err) {
    console.warn('高德前端搜索失败，降级到后端搜索:', err);
  }

  return fetchFallbackSuggestions(keyword);
}

function pickBestPlaceSearchResult(pois, selected) {
  if (!Array.isArray(pois) || pois.length === 0) {
    return null;
  }

  const normalizedPois = pois
    .map((item, index) => normalizeSuggestion(item, 'place-search', selected.name, index))
    .filter(Boolean);

  return rankSuggestions(normalizedPois, {
    keyword: selected.name,
    selectedId: selected.id,
    selectedName: selected.name
  })[0] || null;
}

async function resolveSuggestionDetails(selected) {
  if (hasValidPoint(selected)) {
    return selected;
  }

  const servicesReady = await initSearchServices();

  if (servicesReady && placeSearchService) {
    const places = await new Promise((resolve, reject) => {
      placeSearchService.search(selected.name, (status, result) => {
        if (status === 'error') {
          reject(new Error('高德详情补全失败'));
          return;
        }

        const pois = Array.isArray(result && result.poiList && result.poiList.pois)
          ? result.poiList.pois
          : [];

        resolve(pois);
      });
    });

    const best = pickBestPlaceSearchResult(places, selected);
    if (best && hasValidPoint(best)) {
      return {
        ...selected,
        ...best,
        address: best.address || selected.address
      };
    }
  }

  const fallback = await fetchFallbackSuggestions(selected.name);
  const bestFallback = rankSuggestions(fallback, {
    keyword: selected.name,
    selectedId: selected.id,
    selectedName: selected.name
  })[0];

  if (bestFallback && hasValidPoint(bestFallback)) {
    return {
      ...selected,
      ...bestFallback,
      address: bestFallback.address || selected.address
    };
  }

  throw new Error('未找到该地点的坐标信息，请重新选择候选结果');
}

async function loadLocations() {
  try {
    locations = (await requestJson('/api/locations')).map(normalizeLocationRecord);
    syncFilteredSelectionState();
    renderLocationsList();
    renderMarkers();
  } catch (err) {
    console.error('加载地点失败:', err);
    showToast(`加载地点失败：${err.message}`, 'error');
  }
}

function updateStats() {
  const filteredLocations = getFilteredLocations();
  const geocodedCount = filteredLocations.filter(hasCoordinates).length;
  ui.locationCount.textContent = String(filteredLocations.length);
  ui.geocodedCount.textContent = String(geocodedCount);
  if (ui.mobileLocationSummary) {
    ui.mobileLocationSummary.textContent = `${filteredLocations.length} 个地点 · ${geocodedCount} 个已带坐标`;
  }
  if (ui.listSummary) {
    ui.listSummary.textContent = `${filteredLocations.length} 个地点，${geocodedCount} 个已带坐标`;
  }
}

function getCategoryLabel(category) {
  if (!category || !CATEGORIES[category]) return '';
  return CATEGORIES[category].label;
}

function createMarkerIcon(category, isActive) {
  const color = category.color || CATEGORIES.other.color;
  const label = escapeHtml((category.label || CATEGORIES.other.label).slice(0, 1));
  const stroke = isActive ? '#dbeafe' : '#ffffff';
  const shadow = isActive ? '#1d4ed833' : '#0f172a33';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
      <filter id="shadow" x="-40%" y="-25%" width="180%" height="160%">
        <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="${shadow}"/>
      </filter>
      <path filter="url(#shadow)" d="M17 2C8.7 2 2 8.7 2 17c0 10.8 15 25 15 25s15-14.2 15-25C32 8.7 25.3 2 17 2Z" fill="${color}" stroke="${stroke}" stroke-width="3"/>
      <circle cx="17" cy="17" r="9" fill="#fff"/>
      <text x="17" y="20.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="${color}">${label}</text>
    </svg>
  `.trim();

  return new AMap.Icon({
    size: new AMap.Size(34, 44),
    image: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    imageSize: new AMap.Size(34, 44)
  });
}

function getLocationSourceType(loc) {
  return loc && loc.sourceType ? loc.sourceType : 'manual';
}

function getSourceLabel(sourceType) {
  return SOURCE_TYPES[sourceType] || SOURCE_TYPES.manual;
}

function getCategoryFilterLabel(category) {
  if (category === 'all') return '全部';
  return getCategoryLabel(category);
}

function normalizeSearchKeyword(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function normalizeCategoryValue(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '')
    : '';

  if (!normalized) return null;
  if (CATEGORIES[normalized]) return normalized;

  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => {
      const normalizedAlias = alias.toLowerCase().replace(/\s+/g, '');
      return normalizedAlias === normalized || (normalizedAlias.length >= 2 && normalized.includes(normalizedAlias));
    })) {
      return category;
    }
  }

  return null;
}

function normalizeLocationRecord(location) {
  return {
    ...location,
    category: normalizeCategoryValue(location && location.category)
  };
}

function normalizeCategoryFilter(value) {
  return value && CATEGORIES[value] ? value : 'all';
}

function buildCategoryFilterOptionsMarkup() {
  const options = ['<option value="all">全部</option>'];

  Object.entries(CATEGORIES).forEach(([value, category]) => {
    options.push(`<option value="${value}">${escapeHtml(category.label)}</option>`);
  });

  return options.join('');
}

function syncCategoryFilterControls() {
  [ui.categoryFilterSelect, ui.mobileCategoryFilterSelect].forEach((select) => {
    if (select) {
      select.value = activeCategoryFilter;
    }
  });
}

function initializeCategoryFilterControls() {
  const markup = buildCategoryFilterOptionsMarkup();

  [ui.categoryFilterSelect, ui.mobileCategoryFilterSelect].forEach((select) => {
    if (select) {
      select.innerHTML = markup;
    }
  });

  syncCategoryFilterControls();
}

function matchesCategoryFilter(loc, category = activeCategoryFilter) {
  if (!loc) return false;
  if (category === 'all') return true;
  return loc.category === category;
}

function matchesKeywordFilter(loc, keyword = activeSearchKeyword) {
  const normalizedKeyword = normalizeSearchKeyword(keyword).toLowerCase();
  if (!normalizedKeyword) return true;

  const haystack = [
    loc.name,
    loc.address,
    loc.reason,
    getCategoryLabel(loc.category),
    getSourceLabel(getLocationSourceType(loc)),
    loc.sourceContent,
    loc.city,
    loc.district
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedKeyword);
}

function getFilteredLocations() {
  return locations.filter((loc) =>
    matchesCategoryFilter(loc) &&
    matchesKeywordFilter(loc)
  );
}

function getActiveFilterSummary() {
  const segments = [];

  if (activeCategoryFilter !== 'all') {
    segments.push(getCategoryFilterLabel(activeCategoryFilter));
  }

  if (activeSearchKeyword) {
    segments.push(`关键词“${activeSearchKeyword}”`);
  }

  return segments.join(' / ');
}

function syncFilteredSelectionState() {
  const filteredLocationIds = new Set(getFilteredLocations().map((loc) => loc.id));

  if (activeLocationId && !filteredLocationIds.has(activeLocationId)) {
    activeLocationId = null;
  }

  if (activeDetailLocationId && !filteredLocationIds.has(activeDetailLocationId)) {
    closeDetailDrawer({ restoreFocus: false });
  }
}

function applyCategoryFilter(value, options = {}) {
  const nextFilter = normalizeCategoryFilter(value);

  if (!options.force && nextFilter === activeCategoryFilter) {
    syncCategoryFilterControls();
    return;
  }

  activeCategoryFilter = nextFilter;
  syncCategoryFilterControls();
  syncFilteredSelectionState();
  renderLocationsList();
  renderMarkers();
}

function updateViewportSummary() {
  const filteredLocations = getFilteredLocations();
  const visibleLocations = filteredLocations.filter((loc) => visibleLocationIds.has(loc.id));
  const count = visibleLocations.length;
  const previewNames = visibleLocations.slice(0, 3).map((loc) => loc.name);

  ui.viewportCount.textContent = `视野内 ${count}`;
  if (ui.mobileViewportCount) {
    ui.mobileViewportCount.textContent = `视野内 ${count}`;
  }

  if (count === 0) {
    const filterSummary = getActiveFilterSummary();
    const emptyMessage = filterSummary
      ? `当前视野内暂无符合“${filterSummary}”的已定位地点，移动或缩放地图后会实时更新。`
      : '当前视野内暂无已定位地点，移动或缩放地图后会实时更新。';
    ui.viewportHint.textContent = emptyMessage;
    if (ui.mobileViewportHint) {
      ui.mobileViewportHint.textContent = emptyMessage;
    }
    return;
  }

  const suffix = count > previewNames.length ? ` 等 ${count} 个地点` : '';
  ui.viewportHint.textContent = `${previewNames.join('、')}${suffix}`;
  if (ui.mobileViewportHint) {
    ui.mobileViewportHint.textContent = `${previewNames.join('、')}${suffix}`;
  }
}

function refreshViewportState(force = false) {
  if (!map || typeof map.getBounds !== 'function') {
    visibleLocationIds = new Set();
    updateViewportSummary();
    return;
  }

  const bounds = map.getBounds();
  if (!bounds || typeof bounds.contains !== 'function') {
    visibleLocationIds = new Set();
    updateViewportSummary();
    return;
  }

  const nextVisibleIds = new Set(
    getFilteredLocations()
      .filter(hasCoordinates)
      .filter((loc) => bounds.contains([Number(loc.longitude), Number(loc.latitude)]))
      .map((loc) => loc.id)
  );

  const changed = force || !areSetsEqual(visibleLocationIds, nextVisibleIds);
  visibleLocationIds = nextVisibleIds;
  updateViewportSummary();

  if (changed) {
    renderLocationsList();
    syncDetailDrawer();
  }
}

function getMapZoomLimits() {
  if (!map || typeof map.getZooms !== 'function') {
    return { minZoom: 3, maxZoom: 20 };
  }

  const zooms = map.getZooms();
  const minZoom = Array.isArray(zooms) ? Number(zooms[0]) : Number(zooms?.min);
  const maxZoom = Array.isArray(zooms) ? Number(zooms[1]) : Number(zooms?.max);

  return {
    minZoom: Number.isFinite(minZoom) ? minZoom : 3,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : 20
  };
}

function updateMobileZoomControls() {
  if (!map || !ui.mobileZoomInBtn || !ui.mobileZoomOutBtn || typeof map.getZoom !== 'function') return;

  const currentZoom = Number(map.getZoom());
  const { minZoom, maxZoom } = getMapZoomLimits();
  ui.mobileZoomInBtn.disabled = Number.isFinite(currentZoom) && currentZoom >= maxZoom - 0.01;
  ui.mobileZoomOutBtn.disabled = Number.isFinite(currentZoom) && currentZoom <= minZoom + 0.01;
}

function zoomMobileMap(direction) {
  if (!map) return;

  const currentZoom = typeof map.getZoom === 'function' ? Number(map.getZoom()) : NaN;
  const { minZoom, maxZoom } = getMapZoomLimits();
  if (!Number.isFinite(currentZoom)) return;
  if (direction === 'in' && Number.isFinite(currentZoom) && currentZoom >= maxZoom - 0.01) return;
  if (direction === 'out' && Number.isFinite(currentZoom) && currentZoom <= minZoom + 0.01) return;

  const center = map.getCenter();
  const nextZoom = direction === 'in'
    ? Math.min(currentZoom + 1, maxZoom)
    : Math.max(currentZoom - 1, minZoom);

  if (typeof map.setZoomAndCenter === 'function') {
    map.setZoomAndCenter(nextZoom, center, false, MOBILE_ZOOM_ANIMATION_MS);
  } else {
    map.setZoom(nextZoom, false, MOBILE_ZOOM_ANIMATION_MS);
    map.setCenter(center, false, MOBILE_ZOOM_ANIMATION_MS);
  }

  updateMobileZoomControls();
}

function renderLocationsList() {
  updateStats();
  const filteredLocations = getFilteredLocations();

  if (locations.length === 0) {
    ui.locationsList.innerHTML = '<div class="empty-state">还没有保存的地点。先在上方搜索一个地点，再把它加入地图。</div>';
    return;
  }

  if (filteredLocations.length === 0) {
    const filterSummary = getActiveFilterSummary();
    ui.locationsList.innerHTML = `<div class="empty-state">${filterSummary ? `当前筛选“${escapeHtml(filterSummary)}”下暂无地点。` : '当前没有可显示的地点。'}</div>`;
    return;
  }

  ui.locationsList.innerHTML = filteredLocations.map((loc) => {
    const hasCoords = hasCoordinates(loc);
    const activeClass = activeLocationId === loc.id ? 'is-active' : '';
    const inViewClass = visibleLocationIds.has(loc.id) ? 'is-in-view' : '';
    const category = CATEGORIES[loc.category];
    const categoryBadge = category
      ? `<span class="category-badge" style="--badge-color:${category.color};background:${category.color}14;border-color:${category.color}26;color:${category.color};">${escapeHtml(getCategoryLabel(loc.category))}</span>`
      : '';
    const sourceBadge = `<span class="source-badge">${escapeHtml(getSourceLabel(getLocationSourceType(loc)))}</span>`;
    const revealLabel = hasCoords ? '地图聚焦' : '待定位';
    const revealDisabled = hasCoords ? '' : ' disabled aria-disabled="true"';
    const navigateDisabled = hasCoords ? '' : ' disabled aria-disabled="true"';

    return `
      <article class="location-item ${activeClass} ${inViewClass}" data-id="${escapeHtml(loc.id)}">
        <div
          class="location-main"
          role="button"
          tabindex="0"
          aria-label="查看地点详情 ${escapeHtml(loc.name)}"
          data-action="open-detail"
          data-id="${escapeHtml(loc.id)}"
        >
          <div class="location-top">
            <div class="location-heading">
              <p class="location-name">${escapeHtml(loc.name)}</p>
              <div class="location-meta-badges">
                ${categoryBadge}
                ${sourceBadge}
              </div>
            </div>
          </div>
          <p class="location-address">${escapeHtml(loc.address)}</p>
          ${loc.reason ? `<p class="location-reason">${escapeHtml(loc.reason)}</p>` : ''}
        </div>
        <div class="location-actions">
          <button type="button" class="card-action card-action-quiet card-action-main" data-action="reveal-map" data-id="${escapeHtml(loc.id)}"${revealDisabled}>${revealLabel}</button>
          <button type="button" class="card-action card-action-nav" data-action="navigate" data-id="${escapeHtml(loc.id)}"${navigateDisabled}>导航前往</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderMarkers() {
  markers.forEach((marker) => marker.instance.setMap(null));
  markers = [];
  markerMap = new Map();

  if (!map || !window.AMap || !AMap.Marker || !AMap.Icon || !AMap.Size || !AMap.Pixel) return;

  getFilteredLocations().forEach((loc) => {
    if (!hasCoordinates(loc)) return;
    const isActive = activeLocationId === loc.id;
    const category = CATEGORIES[loc.category] || CATEGORIES.other;

    const markerInstance = new AMap.Marker({
      position: [Number(loc.longitude), Number(loc.latitude)],
      icon: createMarkerIcon(category, isActive),
      anchor: 'bottom-center',
      zIndex: isActive ? 120 : 100,
      title: loc.name,
      map
    });

    markerInstance.on('click', () => {
      openDetailDrawer(loc.id);
    });

    const marker = { id: loc.id, loc, instance: markerInstance };
    markers.push(marker);
    markerMap.set(loc.id, marker);
  });

  refreshViewportState(true);
}

function syncDetailDrawer() {
  const loc = getLocationById(activeDetailLocationId);
  const category = loc ? CATEGORIES[loc.category] : null;
  const hasPoint = loc ? hasCoordinates(loc) : false;

  if (!loc) {
    ui.detailTitle.textContent = '地点';
    ui.detailAddress.textContent = '未填写地址';
    ui.detailReason.textContent = '还没有添加备注';
    ui.detailReason.classList.add('detail-note-empty');
    ui.detailCoords.textContent = '未定位';
    ui.detailCreatedAt.textContent = '未知';
    ui.detailCategory.hidden = true;
    ui.detailFocusBtn.disabled = true;
    ui.detailNavigateBtn.disabled = true;
    ui.detailShareBtn.disabled = true;
    return;
  }

  ui.detailTitle.textContent = loc.name;
  ui.detailAddress.textContent = loc.address || '未填写地址';
  ui.detailCoords.textContent = getCoordinateText(loc);
  ui.detailCreatedAt.textContent = formatDateTime(loc.createdAt);

  if (loc.reason) {
    ui.detailReason.textContent = loc.reason;
    ui.detailReason.classList.remove('detail-note-empty');
  } else {
    ui.detailReason.textContent = '还没有添加备注';
    ui.detailReason.classList.add('detail-note-empty');
  }

  if (category) {
    ui.detailCategory.hidden = false;
    ui.detailCategory.textContent = category.label;
    ui.detailCategory.style.setProperty('--badge-color', category.color);
    ui.detailCategory.style.background = `${category.color}14`;
    ui.detailCategory.style.borderColor = `${category.color}26`;
    ui.detailCategory.style.color = category.color;
  } else {
    ui.detailCategory.hidden = true;
    ui.detailCategory.textContent = '';
  }

  ui.detailFocusBtn.disabled = !hasPoint;
  ui.detailNavigateBtn.disabled = !hasPoint;
  ui.detailShareBtn.disabled = false;
}

function openDetailDrawer(id, options = {}) {
  const loc = getLocationById(id);
  if (!loc || !matchesCategoryFilter(loc)) return false;

  closeMobileSheets({ restoreFocus: false });
  activeDetailLocationId = id;
  detailDrawerTrigger = options.triggerButton || null;
  setActiveLocation(id);
  ui.detailDrawer.classList.add('is-open');
  ui.detailDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');

  if (options.focusMap) {
    centerMapOnLocation(loc, options.zoom ?? FOCUS_ZOOM, { revealMap: options.revealMap });
  }

  window.requestAnimationFrame(() => {
    if (!ui.detailFocusBtn.disabled) {
      ui.detailFocusBtn.focus();
    } else if (!ui.detailShareBtn.disabled) {
      ui.detailShareBtn.focus();
    } else if (!ui.detailEditBtn.disabled) {
      ui.detailEditBtn.focus();
    } else {
      ui.detailCloseBtn.focus();
    }
  });

  return true;
}

function closeDetailDrawer(options = {}) {
  const restoreFocus = options.restoreFocus !== false;

  ui.detailDrawer.classList.remove('is-open');
  ui.detailDrawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
  activeDetailLocationId = null;

  if (restoreFocus && detailDrawerTrigger) {
    detailDrawerTrigger.focus();
  }

  detailDrawerTrigger = null;
  syncDetailDrawer();
}

function focusLocation(id, zoom = FOCUS_ZOOM, options = {}) {
  const location = getLocationById(id);
  if (!location || !hasCoordinates(location)) {
    showToast('该地点还未完成定位', 'error');
    return;
  }

  setActiveLocation(id);
  centerMapOnLocation(location, zoom, options);

  if (options.openDrawer) {
    openDetailDrawer(id, { triggerButton: options.triggerButton || null });
  }
}

function createLocateError(kind, message) {
  const error = new Error(message);
  error.locateKind = kind;
  return error;
}

function mapAmapLocateError(result) {
  const info = normalizeOptionalText(result && result.info).toUpperCase();
  const message = normalizeOptionalText(result && result.message);
  const lowerMessage = message.toLowerCase();

  if (info.includes('PERMISSION_DENIED') || lowerMessage.includes('permission')) {
    return createLocateError('permission', '定位失败：定位权限被拒绝，请检查浏览器或系统设置');
  }

  if (info.includes('TIME_OUT') || info.includes('TIMEOUT') || lowerMessage.includes('timeout')) {
    return createLocateError('timeout', '定位失败：定位请求超时，请稍后重试');
  }

  if (info.includes('POSITION_UNAVAILABLE') || info.includes('NO_POSITION')) {
    return createLocateError('precision', '定位失败：当前定位精度不足，请移步到空旷区域后重试');
  }

  return createLocateError('failed', `定位失败：${message || result?.info || '暂时无法获取当前位置'}`);
}

function mapBrowserLocateError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return createLocateError('permission', '定位失败：定位权限被拒绝，请检查浏览器或系统设置');
    case error.TIMEOUT:
      return createLocateError('timeout', '定位失败：定位请求超时，请稍后重试');
    case error.POSITION_UNAVAILABLE:
      return createLocateError('precision', '定位失败：当前定位精度不足，请移步到空旷区域后重试');
    default:
      return createLocateError('failed', `定位失败：${error.message || '暂时无法获取当前位置'}`);
  }
}

function renderMyLocationMarker(locationData) {
  const { latitude, longitude, accuracy, address } = locationData;

  if (myLocationMarker) {
    myLocationMarker.setMap(null);
  }

  if (myLocationInfoWindow) {
    myLocationInfoWindow.close();
  }

  myLocationMarker = new AMap.Marker({
    position: [longitude, latitude],
    icon: new AMap.Icon({
      size: new AMap.Size(36, 36),
      imageSize: new AMap.Size(36, 36),
      imageUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxOCIgY3k9IjE4IiByPSIxNSIgZmlsbD0iI0UxRUZGRiIvPjxjaXJjbGUgY3g9IjE4IiBjeT0iMTgiIHI9IjEwIiBmaWxsPSIjMUQ0RUQ4Ii8+PGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iNCIgZmlsbD0id2hpdGUiLz48L3N2Zz4='
    }),
    offset: new AMap.Pixel(-18, -18),
    zIndex: 220,
    map
  });

  const detailLines = [
    '<strong style="font-size:14px;color:#182334;">我的位置</strong>',
    Number.isFinite(accuracy) ? `<p style="margin:8px 0 0;font-size:12px;color:#5d6b7f;">精度：约${Math.round(accuracy)}米</p>` : '',
    address ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:#5d6b7f;">${escapeHtml(address)}</p>` : ''
  ].filter(Boolean).join('');

  myLocationInfoWindow = new AMap.InfoWindow({
    content: `<div style="padding:10px 12px;min-width:200px;">${detailLines}</div>`,
    offset: new AMap.Pixel(0, -28)
  });

  myLocationMarker.on('click', () => {
    myLocationInfoWindow.open(map, myLocationMarker.getPosition());
  });

  map.setCenter([longitude, latitude]);
  map.setZoom(Number.isFinite(accuracy) && accuracy <= 200 ? 16 : 14);
}

async function locateWithAmap() {
  const ready = await initGeolocationService();

  if (!ready || !geolocationService) {
    throw createLocateError('unavailable', '高德定位服务暂不可用');
  }

  return new Promise((resolve, reject) => {
    geolocationService.getCurrentPosition((status, result) => {
      if (status === 'complete' && result && result.position) {
        const coords = parseCoordinatePair(result.position);
        const accuracy = Number(result.accuracy);
        const locationType = normalizeOptionalText(result.location_type).toLowerCase();

        if (!Number.isFinite(coords.longitude) || !Number.isFinite(coords.latitude)) {
          reject(createLocateError('failed', '定位失败：未能解析当前位置'));
          return;
        }

        if (locationType.startsWith('ip') || (Number.isFinite(accuracy) && accuracy > 5000)) {
          reject(createLocateError('precision', '定位失败：当前定位精度不足，请移步到空旷区域后重试'));
          return;
        }

        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          address: normalizeOptionalText(result.formattedAddress),
          source: 'amap'
        });
        return;
      }

      reject(mapAmapLocateError(result));
    });
  });
}

async function locateWithBrowser() {
  if (!navigator.geolocation) {
    throw createLocateError('unavailable', '定位失败：当前浏览器不支持定位');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy);

        if (Number.isFinite(accuracy) && accuracy > 5000) {
          reject(createLocateError('precision', '定位失败：当前定位精度不足，请移步到空旷区域后重试'));
          return;
        }

        resolve({
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          address: '',
          source: 'browser'
        });
      },
      (error) => {
        reject(mapBrowserLocateError(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

async function locateMe() {
  setButtonBusy(ui.locateMeBtn, true, '定位中...');
  setButtonBusy(ui.mobileLocateBtn, true, '定位中...');

  try {
    let locationData;

    try {
      locationData = await locateWithAmap();
    } catch (err) {
      if (err.locateKind === 'permission') {
        throw err;
      }

      console.warn('高德定位失败，尝试浏览器定位兜底:', err);
      locationData = await locateWithBrowser();
    }

    renderMyLocationMarker(locationData);
    showToast('已定位到您的当前位置', 'success');
  } catch (err) {
    showToast(err.message || '定位失败：暂时无法获取当前位置', 'error');
  } finally {
    setButtonBusy(ui.locateMeBtn, false);
    setButtonBusy(ui.mobileLocateBtn, false);
  }
}

// 导出功能
function exportData(format = 'json') {
  if (locations.length === 0) {
    showToast('暂无可导出的数据', 'error');
    return;
  }

  if (format === 'json') {
    const dataStr = JSON.stringify(locations, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuzhou-locations-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === 'csv') {
    const headers = ['ID', '名称', '地址', '分类', '来源', '理由', '纬度', '经度', '添加时间'];
    const rows = locations.map(loc => [
      loc.id,
      `"${loc.name}"`,
      `"${loc.address}"`,
      loc.category || '',
      getSourceLabel(getLocationSourceType(loc)),
      loc.reason ? `"${loc.reason}"` : '',
      loc.latitude || '',
      loc.longitude || '',
      loc.createdAt
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuzhou-locations-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  showToast('导出成功', 'success');
}

// 编辑功能
function openEditDialog(id) {
  const loc = locations.find(l => l.id === id);
  if (!loc) return;

  closeDetailDrawer({ restoreFocus: false });
  ui.editLocationId.value = id;
  ui.editName.value = loc.name;
  ui.editAddress.value = loc.address;
  ui.editCategory.value = loc.category || '';
  ui.editReason.value = loc.reason || '';
  ui.editDialog.style.display = 'flex';
  window.requestAnimationFrame(() => {
    ui.editName.focus();
  });
}

function closeEditDialog() {
  ui.editDialog.style.display = 'none';
}

async function saveEdit() {
  const id = ui.editLocationId.value;
  const updates = {
    name: ui.editName.value.trim(),
    address: ui.editAddress.value.trim(),
    category: ui.editCategory.value || null,
    reason: ui.editReason.value.trim() || null
  };

  if (!updates.name || !updates.address) {
    showToast('名称和地址不能为空', 'error');
    return;
  }

  try {
    const result = normalizeLocationRecord(await requestJson(`/api/locations?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }));

    const index = locations.findIndex(l => l.id === id);
    if (index !== -1) {
      locations[index] = { ...locations[index], ...result };
    }

    syncFilteredSelectionState();
    renderLocationsList();
    renderMarkers();
    closeEditDialog();
    showToast('地点已更新', 'success');
  } catch (err) {
    showToast(`更新失败：${err.message}`, 'error');
  }
}

async function addSingleLocation() {
  const address = ui.singleInput.value.trim();
  const reason = ui.reasonInput.value.trim();
  const category = ui.categorySelect.value || null;

  if (!address) {
    showToast('请输入地址后再提交', 'error');
    ui.singleInput.focus();
    return;
  }

  if (!selectedSuggestion || normalizeText(selectedSuggestion.name) !== normalizeText(address)) {
    setButtonBusy(ui.addSingleBtn, true, '搜索中...');

    try {
      const suggestions = await fetchSuggestions(address);
      if (suggestions.length === 0) {
        throw new Error('未找到相关地点，请尝试更完整的名称');
      }

      ui.singleInput.focus();
      showToast('请先从候选结果中选择一个地点', 'error');
    } catch (err) {
      showToast(`添加失败：${err.message}`, 'error');
    } finally {
      setButtonBusy(ui.addSingleBtn, false);
    }
    return;
  }

  setButtonBusy(ui.addSingleBtn, true, '添加中...');

  try {
    const resolvedSuggestion = await resolveSuggestionDetails(selectedSuggestion);
    const location = {
      name: resolvedSuggestion.name,
      address: resolvedSuggestion.address || address,
      reason: reason,
      category: category,
      latitude: resolvedSuggestion.latitude,
      longitude: resolvedSuggestion.longitude,
      sourceId: resolvedSuggestion.id || null,
      sourceType: 'manual',
      sourcePlatform: 'web',
      createdBy: 'user',
      confidence: 'high',
      matchType: 'manual_search',
      poiType: resolvedSuggestion.type || null,
      city: resolvedSuggestion.cityname || SEARCH_CITY,
      district: resolvedSuggestion.district || null
    };

    const savedLocation = normalizeLocationRecord(await requestJson('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location)
    }));

    locations.push(savedLocation);
    renderLocationsList();
    renderMarkers();
    const shouldRevealSavedLocation = matchesCategoryFilter(savedLocation);
    if (shouldRevealSavedLocation) {
      openDetailDrawer(savedLocation.id, { focusMap: true, zoom: FOCUS_ZOOM });
    }

    ui.singleInput.value = '';
    ui.reasonInput.value = '';
    ui.categorySelect.value = '';
    selectedSuggestion = null;
    hideSuggestions();
    showToast(shouldRevealSavedLocation ? '地点已添加' : '地点已添加，当前筛选未显示该地点', 'success');
  } catch (err) {
    showToast(`添加失败：${err.message}`, 'error');
  } finally {
    setButtonBusy(ui.addSingleBtn, false);
  }
}

async function deleteLocation(id) {
  if (!window.confirm('确定删除该地点吗？')) return;

  try {
    await requestJson(`/api/locations?id=${id}`, { method: 'DELETE' });
    locations = locations.filter((item) => item.id !== id);
    if (activeDetailLocationId === id) {
      closeDetailDrawer({ restoreFocus: false });
    }

    if (activeLocationId === id) {
      activeLocationId = null;
    }

    renderLocationsList();
    renderMarkers();
    refreshViewportState(true);
    showToast('地点已删除', 'success');
  } catch (err) {
    showToast(`删除失败：${err.message}`, 'error');
  }
}

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
    return `
      <div class="suggestion-item" data-index="${index}">
        <div class="suggestion-name">${escapeHtml(poi.name)}</div>
        <div class="suggestion-address">${escapeHtml(poi.address || '')}</div>
      </div>
    `;
  }).join('');

  ui.searchSuggestions.innerHTML = html;
  ui.searchSuggestions.classList.add('show');

  ui.searchSuggestions.querySelectorAll('.suggestion-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      const poi = pois[index];

      selectedSuggestion = {
        id: poi.id,
        name: poi.name,
        address: poi.address || ui.singleInput.value,
        district: poi.district || '',
        cityname: poi.cityname || '',
        citycode: poi.citycode || '',
        adcode: poi.adcode || '',
        type: poi.type || '',
        latitude: poi.latitude,
        longitude: poi.longitude,
        source: poi.source,
        rawKeyword: poi.rawKeyword
      };

      ui.singleInput.value = poi.name;
      hideSuggestions();
    });
  });
}

async function fetchSuggestions(keywords) {
  if (!keywords || keywords.length < 1) {
    latestSuggestionRequestId += 1;
    hideSuggestions();
    return [];
  }

  const requestId = ++latestSuggestionRequestId;

  try {
    const suggestions = await lookupSuggestions(keywords);

    if (requestId !== latestSuggestionRequestId) {
      return [];
    }

    if (suggestions.length > 0) {
      showSuggestions(suggestions);
    } else {
      hideSuggestions();
    }

    return suggestions;
  } catch (err) {
    console.warn('获取建议失败:', err);
    if (requestId === latestSuggestionRequestId) {
      hideSuggestions();
    }
    return [];
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function trapDrawerFocus(event) {
  const focusable = [ui.detailCloseBtn, ui.detailFocusBtn, ui.detailNavigateBtn, ui.detailShareBtn, ui.detailEditBtn, ui.detailDeleteBtn]
    .filter((element) => element && !element.disabled);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    if (ui.sharePosterDialog && ui.sharePosterDialog.classList.contains('is-open')) {
      event.preventDefault();
      closeSharePosterDialog();
      return;
    }

    if (ui.detailDrawer.classList.contains('is-open')) {
      event.preventDefault();
      closeDetailDrawer();
      return;
    }

    if (isAddSheetOpen || isListSheetOpen) {
      event.preventDefault();
      closeMobileSheets({ restoreFocus: true });
    }
    return;
  }

  if (!ui.detailDrawer.classList.contains('is-open')) return;

  if (event.key === 'Tab') {
    trapDrawerFocus(event);
  }
}

function handleListAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!id) return;

  if (action === 'reveal-map') {
    if (isMobileLayout()) {
      closeMobileListSheet({ restoreFocus: false });
    }
    focusLocation(id, FOCUS_ZOOM, { revealMap: true });
    return;
  }

  if (action === 'navigate') {
    const location = getLocationById(id);
    navigateToLocation(location);
    return;
  }

  if (action === 'open-detail') {
    if (isMobileLayout()) {
      closeMobileListSheet({ restoreFocus: false });
    }
    openDetailDrawer(id, { triggerButton: target });
  }
}

function handleListKeyboard(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const target = event.target.closest('[data-action="open-detail"]');
  if (!target) return;

  event.preventDefault();
  const id = target.dataset.id;
  if (id) {
    if (isMobileLayout()) {
      closeMobileListSheet({ restoreFocus: false });
    }
    openDetailDrawer(id, { triggerButton: target });
  }
}

function handleExportDialog() {
  const format = window.confirm('选择导出格式：\n点击"确定"导出 JSON 格式\n点击"取消"导出 CSV 格式') ? 'json' : 'csv';
  exportData(format);
}

function handleCategoryFilterChange(event) {
  applyCategoryFilter(event.target.value);
}

function applySearchFilters() {
  syncFilteredSelectionState();
  renderLocationsList();
  renderMarkers();
}

function handleKeywordSearchInput(event) {
  activeSearchKeyword = normalizeSearchKeyword(event.target.value);
  applySearchFilters();
}

function bindEvents() {
  ui.addSingleBtn.addEventListener('click', addSingleLocation);
  ui.locateMeBtn.addEventListener('click', locateMe);
  ui.exportBtn.addEventListener('click', handleExportDialog);
  ui.categoryFilterSelect.addEventListener('change', handleCategoryFilterChange);
  ui.mobileCategoryFilterSelect.addEventListener('change', handleCategoryFilterChange);
  ui.locationSearchInput.addEventListener('input', handleKeywordSearchInput);
  ui.mobileLocateBtn.addEventListener('click', locateMe);
  ui.mobileAddToggleBtn.addEventListener('click', () => {
    if (isAddSheetOpen) {
      closeMobileAddSheet();
      return;
    }

    openMobileAddSheet();
  });
  ui.mobileListToggleBtn.addEventListener('click', () => {
    if (isListSheetOpen) {
      closeMobileListSheet();
      return;
    }

    openMobileListSheet();
  });
  ui.mobileAddCloseBtn.addEventListener('click', () => closeMobileAddSheet());
  ui.mobileListCloseBtn.addEventListener('click', () => closeMobileListSheet());
  ui.mobileExportBtn.addEventListener('click', handleExportDialog);

  if (ui.mobileZoomInBtn) {
    ui.mobileZoomInBtn.addEventListener('click', () => zoomMobileMap('in'));
  }

  if (ui.mobileZoomOutBtn) {
    ui.mobileZoomOutBtn.addEventListener('click', () => zoomMobileMap('out'));
  }

  updateMobileZoomControls();

  [ui.mobileAddSheet, ui.mobileListSheet].forEach((sheet) => {
    sheet.addEventListener('click', (event) => {
      const closeTarget = event.target.closest('[data-mobile-sheet-close]');
      if (!closeTarget) return;

      const sheetType = closeTarget.dataset.mobileSheetClose;
      if (sheetType === 'add') {
        closeMobileAddSheet();
        return;
      }

      if (sheetType === 'list') {
        closeMobileListSheet();
      }
    });
  });

  ui.saveEditBtn.addEventListener('click', saveEdit);
  ui.cancelEditBtn.addEventListener('click', closeEditDialog);
  ui.dialogClose.addEventListener('click', closeEditDialog);
  ui.editDialog.addEventListener('click', (e) => {
    if (e.target === ui.editDialog) closeEditDialog();
  });

  ui.singleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSingleLocation();
    }
  });

  ui.singleInput.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    selectedSuggestion = null;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-box')) {
      hideSuggestions();
    }
  });

  ui.detailDrawer.addEventListener('click', (event) => {
    if (event.target.dataset.drawerClose === 'true' || event.target === ui.detailDrawer) {
      closeDetailDrawer();
    }
  });
  ui.sharePosterDialog.addEventListener('click', (event) => {
    if (event.target.dataset.sharePosterClose === 'true' || event.target === ui.sharePosterDialog) {
      closeSharePosterDialog();
    }
  });
  ui.sharePosterCloseBtn.addEventListener('click', closeSharePosterDialog);
  ui.sharePosterDoneBtn.addEventListener('click', closeSharePosterDialog);
  ui.sharePosterCopyBtn.addEventListener('click', copyCurrentSharePosterLink);
  ui.detailCloseBtn.addEventListener('click', () => closeDetailDrawer());
  ui.detailFocusBtn.addEventListener('click', () => {
    if (activeDetailLocationId) {
      focusLocation(activeDetailLocationId, FOCUS_ZOOM, { revealMap: true });
    }
  });
  ui.detailNavigateBtn.addEventListener('click', () => {
    if (!activeDetailLocationId) return;

    navigateToLocation(getLocationById(activeDetailLocationId));
  });
  ui.detailShareBtn.addEventListener('click', () => {
    if (!activeDetailLocationId) return;

    shareLocation(getLocationById(activeDetailLocationId));
  });
  ui.detailEditBtn.addEventListener('click', () => {
    if (activeDetailLocationId) {
      openEditDialog(activeDetailLocationId);
    }
  });
  ui.detailDeleteBtn.addEventListener('click', () => {
    if (activeDetailLocationId) {
      deleteLocation(activeDetailLocationId);
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      closeMobileSheets({ restoreFocus: false });
    }

    if (!shouldHandleMapResize()) {
      return;
    }

    triggerMapResize();
    refreshViewportState(true);
  });
  document.addEventListener('keydown', handleGlobalKeydown);
  ui.locationsList.addEventListener('click', handleListAction);
  ui.locationsList.addEventListener('keydown', handleListKeyboard);
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initializeCategoryFilterControls();
  syncMobileSheetState();
  initMap(() => {
    bindEvents();
    loadLocations();
  });
});
