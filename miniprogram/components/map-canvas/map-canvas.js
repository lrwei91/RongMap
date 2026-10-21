const { hasCoordinates } = require('../../utils/location');
const { normalizeCategory } = require('../../utils/constants');

// 原项目由高德 JS API 渲染地图；小程序不能加载外部 JS，改用原生 <map> 组件，
// 标记与视野都由数据驱动。定位走 MapContext.moveToLocation：坐标留在地图组件
// 内部、不进 JS 层，因此不需要 wx.getLocation，也就不用申请那道平台审批
//（getLocation 属于隐私接口，工具类目申请常被拒；moveToLocation 不在清单里）。
//
// 这个组件只负责地图本身：定位按钮、错误提示都交给页面，避免普通 view 叠在
// 原生 map 之上（同层渲染在不同基础库版本上表现不一致，会整块被地图盖住）。
const FUZHOU = { latitude: 26.061473, longitude: 119.296531 };

// 标记按分类着色（餐饮=黄 / 景点=绿 / 日咖夜酒=蓝），外圈统一白色以便压在
// 任何底图上都立得住；选中态换成墨色实心，与底栏、卡片「实心=选中」的约定一致。
const MARKER_ICONS = {
  food: '/images/markers/food.png',
  spot: '/images/markers/spot.png',
  cafe_bar: '/images/markers/cafe_bar.png'
};
const MARKER_ACTIVE_ICONS = {
  food: '/images/markers/food-active.png',
  spot: '/images/markers/spot-active.png',
  cafe_bar: '/images/markers/cafe_bar-active.png'
};
const MARKER_SIZE = 28;
const MARKER_ACTIVE_SIZE = 36;

Component({
  properties: {
    locations: { type: Array, value: [] },
    activeId: { type: String, value: '' },
    focusRequest: { type: Object, value: null }
  },

  data: {
    latitude: FUZHOU.latitude,
    longitude: FUZHOU.longitude,
    scale: 12,
    markers: [],
    includePoints: [],
    showLocation: false
  },

  lifetimes: {
    detached() {
      // 组件销毁后去抖里的 getRegion 回调仍会执行，定时器必须清掉。
      if (this.regionTimer) {
        clearTimeout(this.regionTimer);
        this.regionTimer = null;
      }
      this.mapContext = null;
    }
  },

  observers: {
    'locations, activeId': function (locations, activeId) {
      this.refreshMarkers(locations, activeId);
    },
    focusRequest: function (request) {
      if (request && hasCoordinates(request)) {
        this.setData({
          latitude: Number(request.latitude),
          longitude: Number(request.longitude),
          scale: 17
        });
      }
    }
  },

  methods: {
    refreshMarkers(locations, activeId) {
      const located = (locations || []).filter(hasCoordinates);
      const current = String(activeId || '');

      // 选中的点排到数组末尾：地图标记按数组顺序绘制，排在后面才不会被同位置的点盖住。
      const ordered = located.slice().sort(function (a, b) {
        return (String(a.id) === current ? 1 : 0) - (String(b.id) === current ? 1 : 0);
      });

      const markers = ordered.map(function (item, index) {
        const category = normalizeCategory(item.category);
        const active = String(item.id) === current;
        const marker = {
          id: index,
          locationId: String(item.id),
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          iconPath: (active ? MARKER_ACTIVE_ICONS : MARKER_ICONS)[category],
          width: active ? MARKER_ACTIVE_SIZE : MARKER_SIZE,
          height: active ? MARKER_ACTIVE_SIZE : MARKER_SIZE
        };

        // 名称气泡只给选中的点：全挂会糊成一片，反而看不出哪个是哪个。
        // anchorY 随标记尺寸一起放大（标记 30→36），具体像素可在真机上微调。
        if (active) {
          marker.callout = {
            content: item.name,
            color: '#1a1a1a',
            fontSize: 12,
            bgColor: '#ffffff',
            borderColor: '#1a1a1a',
            borderWidth: 1,
            borderRadius: 6,
            padding: 6,
            display: 'ALWAYS',
            textAlign: 'center',
            anchorX: 0,
            anchorY: -14
          };
        }
        return marker;
      });

      const patch = { markers: markers };

      // 只在首次拿到数据时把视野适配到数据范围，避免后续刷新把用户拖回原处。
      if (!this.data.autoFitDone && located.length) {
        patch.includePoints = located.map(function (item) {
          return { latitude: Number(item.latitude), longitude: Number(item.longitude) };
        });
        this.data.autoFitDone = true;
      }

      this.setData(patch);
    },

    onMarkerTap(event) {
      const index = event.detail.markerId;
      const marker = this.data.markers[index];
      if (!marker) return;
      this.triggerEvent('select', { locationId: marker.locationId });
    },

    // 原 Web 端支持在地图上点击空白处新增；小程序 map 的 tap 事件同样回传经纬度。
    onMapTap(event) {
      const detail = event.detail || {};
      if (!Number.isFinite(Number(detail.latitude)) || !Number.isFinite(Number(detail.longitude))) return;
      this.triggerEvent('maptap', {
        latitude: Number(detail.latitude),
        longitude: Number(detail.longitude)
      });
    },

    /**
     * 视野变化 → 把当前可视矩形交给页面，页面据此筛选列表。
     *
     * 两个必须把住的点：
     * 1. regionchange 在拖动/缩放过程中会连续触发，只在 type === 'end' 取一次，并做 120ms 去抖，
     *    否则 getRegion 会被高频调用。
     * 2. 首次数据适配（include-points）之前，地图还停在默认的中心与缩放级别上，
     *    这时报出去的矩形是「假视野」，会让列表先缩到一小块再弹开。所以 autoFitDone 之前不上报。
     */
    onRegionChange(event) {
      const detail = event.detail || {};
      if (detail.type !== 'end') return;
      const self = this;
      if (this.regionTimer) clearTimeout(this.regionTimer);
      this.regionTimer = setTimeout(function () {
        self.regionTimer = null;
        self.reportRegion();
      }, 120);
    },

    reportRegion() {
      if (!this.data.autoFitDone) return;
      const self = this;
      // map 在自定义组件内，createMapContext 必须带上组件实例，否则拿不到上下文。
      if (!this.mapContext) this.mapContext = wx.createMapContext('rongmap-map', this);
      this.mapContext.getRegion({
        success(res) {
          const sw = (res && res.southwest) || {};
          const ne = (res && res.northeast) || {};
          const bounds = {
            south: Number(sw.latitude),
            west: Number(sw.longitude),
            north: Number(ne.latitude),
            east: Number(ne.longitude)
          };
          if (!Number.isFinite(bounds.south) || !Number.isFinite(bounds.north) ||
              !Number.isFinite(bounds.west) || !Number.isFinite(bounds.east)) return;
          self.triggerEvent('regionchange', { bounds: bounds });
        },
        fail() {
          // 取不到视野就沿用上一次的筛选结果，不清空列表。
        }
      });
    },

    /** 返回 Promise，页面据此决定提示文案与是否引导开启权限。 */
    locate() {
      const self = this;
      return new Promise(function (resolve, reject) {
        wx.getSetting({
          success: function (res) {
            const auth = (res && res.authSetting) || {};
            // 明确拒绝过才引导去设置页；没问过（undefined）时交给地图自己弹授权。
            if (auth['scope.userLocation'] === false) {
              reject({ errMsg: 'locate:fail auth deny' });
              return;
            }
            // show-location 打开后 <map> 会自己触发授权弹窗并显示定位点。
            self.setData({ showLocation: true, scale: 16 });
            // 组件内 createMapContext 必须带组件实例，否则拿不到模板里的 map。
            const ctx = wx.createMapContext('rongmap-map', self);
            ctx.moveToLocation({
              success: function () { resolve({}); },
              fail: function (error) { reject(error || { errMsg: 'moveToLocation:fail' }); }
            });
          },
          fail: function () { reject({ errMsg: 'getSetting:fail' }); }
        });
      });
    }
  }
});
