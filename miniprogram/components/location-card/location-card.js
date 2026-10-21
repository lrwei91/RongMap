const { hasCoordinates } = require('../../utils/location');

// 展示字段（分类文案 / 相对时间 / 添加者）由页面构建列表时一并算好，
// 组件只负责渲染，避免每张卡片各挂一个 observer、各自跑一次 setData。
Component({
  properties: {
    location: { type: Object, value: null },
    active: { type: Boolean, value: false }
  },

  methods: {
    onOpen() {
      this.triggerEvent('open', { id: this.data.location.id });
    },

    // 原 Web 端用悬浮菜单；小程序改用原生操作列表，交互更贴合端上习惯。
    onMore() {
      const self = this;
      const location = this.data.location;
      const actions = [];
      if (hasCoordinates(location)) actions.push('focus');
      actions.push('edit', 'delete');
      const labels = {
        focus: '聚焦地图',
        edit: '编辑',
        delete: '移入回收站'
      };
      wx.showActionSheet({
        itemList: actions.map(function (action) { return labels[action]; }),
        success: function (res) {
          const action = actions[res.tapIndex];
          if (!action) return;
          if (action === 'delete') {
            self.triggerEvent('delete', { id: location.id });
            return;
          }
          self.triggerEvent(action, { id: location.id });
        },
        fail: function () { /* 用户取消 */ }
      });
    }
  }
});
