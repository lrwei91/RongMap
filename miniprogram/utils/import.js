const { CATEGORIES, normalizeCategory } = require('./constants');

// 原 Web 端导入依赖服务端解析（api/search.js 等）。
// 小程序改为端上解析：CSV 走自带解析器，JSON 直接结构化读取，
// 再把结果交给 utils/api.js 的 createLocation 逐条落库（含判重）。

const HEADER_ALIASES = {
  name: ['名称', '地点', '店名', 'name', 'title'],
  address: ['地址', '详细地址', '位置', 'address', 'addr'],
  category: ['分类', '类别', 'category', 'type'],
  reason: ['备注', '推荐理由', '理由', 'reason', 'note', 'remark'],
  tags: ['标签', 'tags', 'tag'],
  latitude: ['纬度', 'lat', 'latitude'],
  longitude: ['经度', 'lng', 'lon', 'longitude']
};

/** 反向分类映射：既接受中文标签，也接受原始 key。 */
const CATEGORY_BY_LABEL = Object.keys(CATEGORIES).reduce(function (map, key) {
  map[key] = key;
  map[CATEGORIES[key].label] = key;
  map[CATEGORIES[key].short] = key;
  return map;
}, {});

/** RFC4180 风格解析：支持引号包裹、字段内逗号/换行、双引号转义。 */
function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(function (item) {
    return item.some(function (cell) { return String(cell).trim() !== ''; });
  });
}

function matchHeader(cell) {
  const value = String(cell || '').trim().toLowerCase();
  const keys = Object.keys(HEADER_ALIASES);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (HEADER_ALIASES[key].indexOf(value) >= 0) return key;
  }
  return null;
}

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCategoryValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'food';
  return normalizeCategory(CATEGORY_BY_LABEL[raw] || raw, 'food');
}

function draftsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  // 第一行含可识别表头就按列名映射，否则按「名称, 地址, 分类, 备注…」的默认列序。
  const header = rows[0].map(matchHeader);
  const hasHeader = header.filter(Boolean).length >= 2;
  const mapping = {
    name: hasHeader ? header.indexOf('name') : 0,
    address: hasHeader ? header.indexOf('address') : 1,
    category: hasHeader ? header.indexOf('category') : 2,
    reason: hasHeader ? header.indexOf('reason') : 3,
    tags: hasHeader ? header.indexOf('tags') : -1,
    latitude: hasHeader ? header.indexOf('latitude') : -1,
    longitude: hasHeader ? header.indexOf('longitude') : -1
  };

  const body = hasHeader ? rows.slice(1) : rows;
  return body.map(function (cells) {
    function pick(key) {
      const position = mapping[key];
      return position >= 0 ? cells[position] : '';
    }
    return {
      name: String(pick('name') || '').trim(),
      address: String(pick('address') || '').trim(),
      category: normalizeCategoryValue(pick('category')),
      reason: String(pick('reason') || '').trim(),
      tagNames: String(pick('tags') || '').split(/[|,、;]/).map(function (item) {
        return item.trim();
      }).filter(Boolean),
      latitude: toNumber(pick('latitude')),
      longitude: toNumber(pick('longitude')),
      sourceType: 'import'
    };
  }).filter(function (draft) { return draft.name && draft.address; });
}

function draftsFromJson(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error('JSON 解析失败，请检查文件内容');
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.locations) ? parsed.locations : []);
  return list.map(function (item) {
    const source = item || {};
    return {
      name: String(source.name || '').trim(),
      address: String(source.address || '').trim(),
      category: normalizeCategoryValue(source.category),
      reason: String(source.reason || '').trim(),
      tagNames: Array.isArray(source.tags)
        ? source.tags.map(function (tag) { return String((tag && tag.name) || tag).trim(); }).filter(Boolean)
        : [],
      latitude: toNumber(source.latitude),
      longitude: toNumber(source.longitude),
      city: source.city ? String(source.city).trim() : '',
      district: source.district ? String(source.district).trim() : '',
      poiType: source.poiType ? String(source.poiType).trim() : '',
      sourceType: 'import'
    };
  }).filter(function (draft) { return draft.name && draft.address; });
}

/** 依据文件名后缀选择解析器，返回可直接落库的草稿数组。 */
function parseImportFile(fileName, content) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.json')) return draftsFromJson(content);
  return draftsFromCsv(content);
}

function readFileText(filePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'utf8',
      success: function (res) { resolve(res.data); },
      fail: function () {
        console.error('[RongMap] 文件读取失败', JSON.stringify({ stage: 'readFile' }));
        reject(new Error('文件读取失败'));
      }
    });
  });
}

/** 从聊天记录里选一个 CSV/JSON 文件（小程序唯一可用的文件获取通道）。 */
function chooseFile() {
  return new Promise(function (resolve, reject) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'json', 'txt'],
      success: function (res) {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          reject(new Error('未选择文件'));
          return;
        }
        resolve(file);
      },
      fail: function () { reject(new Error('cancelled')); }
    });
  });
}

module.exports = { parseCsv, parseImportFile, draftsFromCsv, draftsFromJson, readFileText, chooseFile };
