Component({
  properties: {
    tags: { type: Array, value: [] },
    selected: { type: Array, value: [] },
    allowCreate: { type: Boolean, value: true },
    label: { type: String, value: '标签' }
  },

  data: {
    chips: [],
    draftName: ''
  },

  observers: {
    'tags, selected': function (tags, selected) {
      const picked = (selected || []).map(String);
      this.setData({
        chips: (tags || []).map(function (tag) {
          return {
            id: String(tag.id),
            name: tag.name,
            checked: picked.indexOf(String(tag.id)) >= 0
          };
        })
      });
    }
  },

  methods: {
    onToggle(event) {
      const id = String(event.currentTarget.dataset.id);
      const current = (this.data.selected || []).map(String);
      const index = current.indexOf(id);
      if (index >= 0) current.splice(index, 1);
      else current.push(id);
      this.triggerEvent('change', { ids: current });
    },

    onDraftInput(event) {
      this.setData({ draftName: event.detail.value });
    },

    onCreate() {
      const name = String(this.data.draftName || '').trim();
      if (!name) {
        wx.showToast({ title: '请输入标签名称', icon: 'none' });
        return;
      }
      const exists = (this.data.tags || []).some(function (tag) { return tag.name === name; });
      if (exists) {
        wx.showToast({ title: '标签已存在', icon: 'none' });
        return;
      }
      this.setData({ draftName: '' });
      this.triggerEvent('create', { name: name });
    }
  }
});
