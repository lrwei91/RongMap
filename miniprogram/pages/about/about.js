Page({
  data: {
    version: '',
    envLabel: '开发版'
  },

  onLoad() {
    let info = null;
    try {
      info = wx.getAccountInfoSync().miniProgram;
    } catch (error) {
      info = null;
    }
    const envMap = { develop: '开发版', trial: '体验版', release: '正式版' };
    this.setData({
      version: (info && info.version) || '',
      envLabel: (info && envMap[info.envVersion]) || '开发版'
    });
  },

  onOpenPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: function () {
          wx.showToast({ title: '暂无隐私协议', icon: 'none' });
        }
      });
      return;
    }
    wx.showModal({
      title: '隐私说明',
      showCancel: false,
      content: '位置权限仅用于地图显示与选点；收藏地点与点评保存在云端，供空间成员共同查看。'
    });
  }
});
