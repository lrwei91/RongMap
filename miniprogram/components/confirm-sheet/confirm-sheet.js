// 关闭动画时长：animationend 不跨组件可靠，用固定定时器兜底（比动画多留 40ms 余量）。
const CLOSE_MS = 280;

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '确认操作' },
    message: { type: String, value: '' },
    confirmText: { type: String, value: '确定' },
    cancelText: { type: String, value: '取消' },
    danger: { type: Boolean, value: false }
  },

  data: {
    // 关闭动画：visible 变 false 后弹层先留在树上滑下去，动画结束再由 mounted 摘除
    mounted: false,
    closing: false
  },

  lifetimes: {
    detached() {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
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
    }
  },

  methods: {
    onCancel() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      this.triggerEvent('confirm');
    },

    // 遮罩与内容区都要吃掉冒泡，避免点弹层内部时穿透到页面。
    noop() {}
  }
});
