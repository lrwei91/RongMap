const api = require('../../utils/api');
const store = require('../../utils/store');
const { CATEGORIES } = require('../../utils/constants');

const CATEGORY_KEYS = Object.keys(CATEGORIES);
const NAME_MAX = 120;
// 关闭动画时长：animationend 不跨组件可靠，用固定定时器兜底（比动画多留 40ms 余量）。
const CLOSE_MS = 280;

// 键盘让位要按像素算，而视口高度只有运行期知道；读一次缓存起来，之后靠减法得出可用高度。
function readViewportHeight() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const height = Number(info && info.windowHeight);
    return Number.isFinite(height) && height > 0 ? height : 0;
  } catch (error) {
    return 0;
  }
}

// wx.chooseLocation 选到正式 POI 时会返回 name；点选空白区域时 name 可能为空。
// 这时退回「地址最后一段」当名称，保证名称栏不留空
// （locations.name 在库里是 NOT NULL，api.validateLocation 也要求非空）。
function deriveName(rawName, rawAddress) {
  const name = String(rawName || '').trim();
  if (name) return name.slice(0, NAME_MAX);
  const address = String(rawAddress || '').trim();
  if (!address) return '';
  const segments = address.split(/[,，]/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean);
  const tail = segments.length ? segments[segments.length - 1] : address;
  return tail.slice(0, NAME_MAX);
}

function emptyForm() {
  return {
    name: '',
    address: '',
    category: 'food',
    reason: '',
    latitude: null,
    longitude: null,
    city: '',
    district: '',
    poiType: '',
    version: 1
  };
}

function formFromLocation(location) {
  if (!location) return emptyForm();
  return {
    name: location.name || '',
    address: location.address || '',
    category: CATEGORIES[location.category] ? location.category : 'food',
    reason: location.reason || '',
    latitude: location.latitude == null ? null : Number(location.latitude),
    longitude: location.longitude == null ? null : Number(location.longitude),
    city: location.city || '',
    district: location.district || '',
    poiType: location.poiType || '',
    version: Number(location.version || 1)
  };
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    location: { type: Object, value: null },
    draft: { type: Object, value: null },
    tags: { type: Array, value: [] }
  },

  data: {
    form: emptyForm(),
    categoryLabels: [],
    categoryIndex: 0,
    tagIds: [],
    saving: false,
    error: '',
    conflictName: '',
    // 编辑时的「未改动字段」基准行：表单不管理 city/district/poiType/source_* 等列，
    // 必须原样回传，否则 locationToRow 的空值兜底会把它们清成 NULL。
    baseline: null,
    // 关闭动画：visible 变 false 后弹层先留在树上滑下去，动画结束再由 mounted 摘除
    mounted: false,
    closing: false,
    // 键盘弹起时覆盖弹层的几何：bottom 抬到键盘顶边，height 取「视口 − 键盘」。
    // 键盘不可见时为空串，交还给类里的 86vh 默认值。
    sheetStyle: ''
  },

  lifetimes: {
    attached() {
      const self = this;
      this.viewportHeight = readViewportHeight();
      if (typeof wx.onKeyboardHeightChange !== 'function') return;
      this.keyboardHeight = 0;
      this.onKeyboardHeightChange = function (res) {
        const height = Math.max(0, Math.round(Number(res && res.height) || 0));
        // 同高度的重复回调必须直接丢弃：少这一层判断，一次 setData 引起的重排
        // 会再触发一次回调，形成「高度反反复调 → 弹层一直闪」的回环。
        if (height === self.keyboardHeight) return;
        self.keyboardHeight = height;
        self.applyKeyboard(height);
      };
      wx.onKeyboardHeightChange(this.onKeyboardHeightChange);
    },

    detached() {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      if (this.onKeyboardHeightChange && typeof wx.offKeyboardHeightChange === 'function') {
        wx.offKeyboardHeightChange(this.onKeyboardHeightChange);
      }
      this.onKeyboardHeightChange = null;
      this.keyboardHeight = 0;
    }
  },

  observers: {
    /**
     * 挂载/关闭动画的唯一入口：visible=true 立即上树；
     * visible=false 先挂 closing 播滑出动画，CLOSE_MS 后再摘除。
     * 关闭途中重新打开会取消计时、原地重播入场。
     */
    visible: function (visible) {
      if (visible) {
        if (this.closeTimer) {
          clearTimeout(this.closeTimer);
          this.closeTimer = null;
        }
        if (!this.data.mounted || this.data.closing) {
          this.setData({ mounted: true, closing: false });
        }
        return;
      }
      if (!this.data.mounted || this.data.closing) return;
      const self = this;
      this.setData({ closing: true });
      this.closeTimer = setTimeout(function () {
        self.closeTimer = null;
        self.setData({ mounted: false, closing: false });
      }, CLOSE_MS);
    },

    'visible, location, draft': function (visible, location, draft) {
      if (!visible) return;
      const form = formFromLocation(location);
      if (!location && draft) {
        form.name = draft.name || form.name;
        form.address = draft.address || form.address;
        form.latitude = draft.latitude == null ? form.latitude : Number(draft.latitude);
        form.longitude = draft.longitude == null ? form.longitude : Number(draft.longitude);
      }
      const picked = location && Array.isArray(location.tags)
        ? location.tags.map(function (tag) { return String(tag.id); })
        : [];
      this.setData({
        form: form,
        categoryLabels: CATEGORY_KEYS.map(function (key) { return CATEGORIES[key].label; }),
        categoryIndex: Math.max(0, CATEGORY_KEYS.indexOf(form.category)),
        tagIds: picked,
        saving: false,
        error: '',
        conflictName: '',
        baseline: location || null
      });
    }
  },

  methods: {
    patch(patch) {
      const form = Object.assign({}, this.data.form, patch);
      this.setData({ form: form });
    },

    onInput(event) {
      const field = event.currentTarget.dataset.field;
      const patch = {};
      patch[field] = event.detail.value;
      this.patch(patch);
    },

    onCategoryChange(event) {
      const index = Number(event.detail.value);
      this.patch({ category: CATEGORY_KEYS[index] });
      this.setData({ categoryIndex: index });
    },

    /**
     * 键盘弹起/收起时调整弹层几何。
     *
     * 两种写法都会算错：
     * 1. 只改 bottom 不改 height：86vh 叠上键盘高度会超过视口，顶部标题被顶出屏幕；
     * 2. 用 calc(86vh - 键盘高度)：与类里的 height/max-height 互相覆盖，高度来回变。
     * 这里改成「视口高度 − 键盘高度」，弹层顶边因此恒等于 0：
     * 键盘高度变化时上方内容一动不动，不会再触发下一轮高度回调。
     */
    applyKeyboard(height) {
      if (!height) {
        if (this.data.sheetStyle) this.setData({ sheetStyle: '' });
        return;
      }
      const viewport = this.viewportHeight || readViewportHeight();
      if (!viewport) {
        // 拿不到视口高度时只抬底边：顶部可能被顶出屏幕，但不会算出 0 高度把内容压没。
        this.setData({ sheetStyle: `bottom:${height}px;` });
        return;
      }
      const available = Math.max(160, viewport - height);
      this.setData({
        sheetStyle: `bottom:${height}px;height:${available}px;max-height:${available}px;`
      });
    },

    // 原 Web 端依赖高德 JS API 做地址搜索；小程序改用系统选点，
    // 返回的 name/address 与坐标（GCJ-02）可直接落库，无需再做坐标转换。
    // 与 Web 端 chooseSuggestion 保持一致：选中地点就整体回填名称 / 地址 / 坐标，
    // 不保留「名称已有内容就跳过」的分支，否则选完点还得再手填一次名称。
    // 表单已没有地址输入框，地址只在这里被带入，用于列表与详情的展示。
    onPickLocation() {
      const self = this;
      wx.chooseLocation({
        success: function (res) {
          const address = String(res.address || '').trim() || self.data.form.address;
          const name = deriveName(res.name, address);
          const previous = String(self.data.form.name || '').trim();
          self.patch({
            name: name || previous,
            address: address,
            latitude: Number(res.latitude),
            longitude: Number(res.longitude)
          });
          if (name && name !== previous) {
            wx.showToast({ title: '已填入名称', icon: 'none' });
          }
        },
        fail: function (error) {
          if (String(error.errMsg || '').indexOf('cancel') >= 0) return;
          wx.showToast({ title: '无法打开地图选点', icon: 'none' });
        }
      });
    },

    // 「清除」清掉的是整条位置信息：坐标与选点带回的地址一起清，
    // 否则会留下「有地址、无坐标」的中间状态，列表与详情上都显示得别扭。
    onClearLocation() {
      this.patch({ latitude: null, longitude: null, address: '' });
    },

    onTagChange(event) {
      this.setData({ tagIds: event.detail.ids });
    },

    onTagCreate(event) {
      this.triggerEvent('createtag', { name: event.detail.name });
    },

    buildPayload() {
      const form = this.data.form;
      const origin = this.data.baseline;
      const address = String(form.address || '').trim();
      const payload = {
        // 名称留空时用地址兜底（等价于 Web 端 saveForm 的 name || address.slice(0,120)），
        // 选完点又手动删掉名称时仍能保存成功。
        name: String(form.name || '').trim() || deriveName('', address),
        address: address,
        category: form.category,
        reason: String(form.reason || '').trim(),
        latitude: form.latitude === '' ? null : form.latitude,
        longitude: form.longitude === '' ? null : form.longitude,
        version: form.version,
        tagIds: this.data.tagIds,
        sourcePlatform: 'miniprogram'
      };

      if (origin) {
        // 显式回传，等价于原 Web 端 toDb(input, existing) 的「未提供则沿用旧值」。
        payload.city = origin.city;
        payload.district = origin.district;
        payload.poiType = origin.poiType;
        payload.sourceId = origin.sourceId;
        payload.sourceType = origin.sourceType || 'manual';
        payload.matchType = origin.matchType;
        payload.confidence = origin.confidence;
      } else {
        payload.sourceType = 'manual';
      }
      return payload;
    },

    async onSave() {
      if (this.data.saving) return;
      const identity = store.getState().identity;
      if (!identity) {
        wx.showToast({ title: '登录已失效，请重新登录', icon: 'none' });
        return;
      }

      const payload = this.buildPayload();
      // 名称是唯一硬性必填：地址已改为「地图选点」自动带入，可以为空。
      if (!payload.name) {
        this.setData({ error: '名称不能为空' });
        return;
      }

      this.setData({ saving: true, error: '', conflictName: '' });
      try {
        if (this.data.location) {
          await api.updateLocation(identity, this.data.location.id, payload);
        } else {
          await api.createLocation(identity, payload);
        }
        // 触感反馈：保存成功轻震一下（不支持的环境静默降级）
        try { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }); } catch (error) { /* 忽略 */ }
        wx.showToast({ title: this.data.location ? '已保存修改' : '已添加地点', icon: 'success' });
        this.triggerEvent('saved');
      } catch (error) {
        if (error.status === 409 && error.latest) {
          // 版本冲突：把服务端最新内容回填，让用户在原值基础上重改。
          const latest = error.latest;
          const refreshed = formFromLocation(latest);
          this.setData({
            form: refreshed,
            tagIds: (latest.tags || []).map(function (tag) { return String(tag.id); }),
            baseline: latest,
            error: '该地点已被其他成员修改，已载入最新内容，请确认后再保存'
          });
        } else if (error.status === 409) {
          this.setData({
            error: '该地点已在共享空间中收藏',
            conflictName: (error.existing && error.existing.name) || ''
          });
        } else {
          console.error('[RongMap] 保存地点失败', JSON.stringify({ stage: 'saveLocation', status: error.status }));
          this.setData({ error: error.message || '保存失败，请重试' });
        }
      } finally {
        this.setData({ saving: false });
      }
    },

    onClose() {
      this.triggerEvent('close');
    },

    noop() {}
  }
});
