const api = require('../../utils/api');
const store = require('../../utils/store');
const media = require('../../utils/media');
const { categoryLabel, categoryShort, formatDateTime, relativeTime } = require('../../utils/format');
const { SOURCE_LABELS } = require('../../utils/constants');
const { hasCoordinates } = require('../../utils/location');

// 键盘让位要按像素算，视口高度只有运行期知道；与 location-form 同一套做法。
function readViewportHeight() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const height = Number(info && info.windowHeight);
    return Number.isFinite(height) && height > 0 ? height : 0;
  } catch (error) {
    return 0;
  }
}

// 关闭动画时长：animationend 不跨组件可靠，用固定定时器兜底（比动画多留 40ms 余量）。
const CLOSE_MS = 280;

/**
 * 点评的展示字段一次算好：本人标记 + 首字方章 + 相对时间 + 点赞 + 图片签名 URL。
 * context = { likes: { [commentId]: {count, likedByMe} }, imageUrls: { path: url } }。
 */
function decorateComment(item, uid, context) {
  const name = item.authorName || '空间成员';
  const like = (context.likes && context.likes[item.id]) || { count: 0, likedByMe: false };
  const images = (item.images || []).map(function (path) {
    return { path: path, url: (context.imageUrls && context.imageUrls[path]) || '' };
  });
  return Object.assign({}, item, {
    isMine: item.authorId === uid,
    initial: name.slice(0, 1),
    timeText: relativeTime(item.createdAt),
    likeCount: like.count,
    likedByMe: like.likedByMe,
    images: images
  });
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    location: { type: Object, value: null },
    members: { type: Array, value: [] }
  },

  data: {
    categoryLabel: '',
    categoryShort: '',
    memberName: '',
    sourceLabel: '',
    createdAtText: '',
    updatedAtText: '',
    tagNames: [],
    canFocus: false,
    // 关闭动画：visible 变 false 后弹层先留在树上滑下去，动画结束再由 mounted 摘除
    mounted: false,
    closing: false,
    // ---- 点评 ----
    comments: [],
    commentsLoading: false,
    commentsError: '',
    commentDraft: '',
    commentSaving: false,
    commentMax: api.COMMENT_MAX,
    // 待上传的本地缩略图（chooseMedia 结果）与上限
    imageDrafts: [],
    imageMax: media.MAX_COMMENT_IMAGES,
    imageUploading: false,
    // 键盘弹起时覆盖弹层的几何，与 location-form 同款；键盘不可见时为空串。
    sheetStyle: ''
  },

  lifetimes: {
    attached() {
      const self = this;
      this.viewportHeight = readViewportHeight();
      // 请求序号：快速切换地点时丢弃过期响应，避免旧列表覆盖新地点的点评。
      this.commentsSeq = 0;
      this.wasOpen = false;
      this.lastLocationId = '';
      // 点赞去重：同一条点评在请求飞行中不接受第二次点击。
      this.likePending = {};
      if (typeof wx.onKeyboardHeightChange !== 'function') return;
      this.keyboardHeight = 0;
      this.onKeyboardHeightChange = function (res) {
        const height = Math.max(0, Math.round(Number(res && res.height) || 0));
        // 同高度回调直接丢弃，防止 setData 重排再次触发回调形成闪烁回环。
        if (height === self.keyboardHeight) return;
        self.keyboardHeight = height;
        self.applyKeyboard(height);
      };
      wx.onKeyboardHeightChange(this.onKeyboardHeightChange);
    },

    detached() {
      this.commentsSeq += 1;
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      if (this.onKeyboardHeightChange && typeof wx.offKeyboardHeightChange === 'function') {
        wx.offKeyboardHeightChange(this.onKeyboardHeightChange);
      }
      this.onKeyboardHeightChange = null;
      this.keyboardHeight = 0;
      this.likePending = {};
    }
  },

  observers: {
    /**
     * 挂载/关闭动画的唯一入口：visible=true 立即上树；
     * visible=false 先挂 closing 播滑出动画，CLOSE_MS 后再摘除。
     * 关闭途中重新打开（closing 中 visible 变 true）会取消计时并原地重播入场。
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

    'visible, location, members': function (visible, location, members) {
      if (!visible || !location) {
        this.wasOpen = false;
        return;
      }
      const opening = !this.wasOpen;
      this.wasOpen = true;
      const member = (members || []).filter(function (item) {
        return item.id === location.createdBy;
      })[0];
      const located = hasCoordinates(location);
      this.setData({
        categoryLabel: categoryLabel(location.category),
        categoryShort: categoryShort(location.category),
        // 回退词与 Web 端一致（「空间成员」），同时匹配未填称呼成员在服务端的默认名。
        memberName: (member && member.name) || location.createdByName || '空间成员',
        sourceLabel: SOURCE_LABELS[location.sourceType || 'manual'] || '手动添加',
        createdAtText: formatDateTime(location.createdAt),
        updatedAtText: formatDateTime(location.updatedAt),
        tagNames: (location.tags || []).map(function (tag) { return tag.name; }),
        canFocus: located
      });
      // 每次打开或换地点才重置输入区；只刷新列表（如成员数据更新）时不动用户正在写的内容。
      if (opening || String(location.id) !== this.lastLocationId) {
        this.lastLocationId = String(location.id);
        this.setData({ commentDraft: '', commentsError: '', comments: [], imageDrafts: [] });
      }
      this.loadComments();
    }
  },

  methods: {
    onClose() { this.triggerEvent('close'); },
    onEdit() { this.triggerEvent('edit', { id: this.data.location.id }); },
    onDelete() { this.triggerEvent('delete', { id: this.data.location.id }); },
    onFocus() { this.triggerEvent('focus', { id: this.data.location.id }); },

    onCopyAddress() {
      const address = this.data.location && this.data.location.address;
      if (!address) return;
      wx.setClipboardData({ data: address });
    },

    onNavigate() {
      const location = this.data.location;
      if (!hasCoordinates(location)) {
        wx.showToast({ title: '该地点没有位置信息', icon: 'none' });
        return;
      }
      // 原 Web 端跳高德网页版导航；小程序直接调起内置路线规划。
      wx.openLocation({
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        name: location.name,
        address: location.address,
        scale: 17
      });
    },

    /**
     * 拉取当前地点的点评，并并行取「图片签名 URL + 点赞汇总」。
     * 失败只提示，不清空已展示内容；点赞/签名各自失败单独降级（不影响文字列表）。
     */
    async loadComments() {
      const identity = store.getState().identity;
      const location = this.data.location;
      if (!identity || !location) return;
      const seq = this.commentsSeq + 1;
      this.commentsSeq = seq;
      this.setData({ commentsLoading: true, commentsError: '' });
      const self = this;
      try {
        const list = await api.listComments(identity.space.id, location.id);
        if (seq !== self.commentsSeq) return;
        const paths = [];
        list.forEach(function (item) {
          (item.images || []).forEach(function (path) { paths.push(path); });
        });
        const ids = list.map(function (item) { return item.id; });
        const settled = await Promise.all([
          media.signCommentImages(paths),
          api.listCommentLikes(identity.space.id, ids, identity.uid).catch(function () { return {}; })
        ]);
        if (seq !== self.commentsSeq) return;
        const context = { imageUrls: settled[0], likes: settled[1] };
        self.setData({
          comments: list.map(function (item) { return decorateComment(item, identity.uid, context); }),
          commentsLoading: false
        });
      } catch (error) {
        if (seq !== self.commentsSeq) return;
        self.setData({
          commentsLoading: false,
          commentsError: (error && error.message) || '点评加载失败'
        });
      }
    },

    onCommentInput(event) {
      this.setData({ commentDraft: event.detail.value });
    },

    /** 选图：相册/拍照，压缩版；数量上限扣除已选。 */
    onPickImages() {
      if (this.data.commentSaving) return;
      const remain = this.data.imageMax - this.data.imageDrafts.length;
      if (remain <= 0) return;
      const self = this;
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: function (res) {
          const picked = (res.tempFiles || []).map(function (file) {
            return { tempFilePath: file.tempFilePath };
          });
          self.setData({
            imageDrafts: self.data.imageDrafts.concat(picked).slice(0, self.data.imageMax)
          });
        },
        fail: function () {
          // 用户取消选图不算错误，静默返回。
        }
      });
    },

    onRemoveDraft(event) {
      const index = Number(event.currentTarget.dataset.index);
      this.setData({
        imageDrafts: this.data.imageDrafts.filter(function (item, idx) { return idx !== index; })
      });
    },

    onPreviewDraft(event) {
      const index = Number(event.currentTarget.dataset.index);
      const urls = this.data.imageDrafts.map(function (item) { return item.tempFilePath; });
      if (index < 0 || index >= urls.length) return;
      wx.previewImage({ urls: urls, current: urls[index] });
    },

    onPreviewImage(event) {
      const commentIndex = Number(event.currentTarget.dataset.comment);
      const imageIndex = Number(event.currentTarget.dataset.index);
      const comment = this.data.comments[commentIndex];
      if (!comment) return;
      const urls = (comment.images || []).map(function (img) { return img.url; }).filter(Boolean);
      if (!urls.length) return;
      const hit = comment.images[imageIndex];
      wx.previewImage({ urls: urls, current: (hit && hit.url) || urls[0] });
    },

    async onCommentSubmit() {
      const identity = store.getState().identity;
      const location = this.data.location;
      if (!identity || !location || this.data.commentSaving) return;
      const content = String(this.data.commentDraft || '').trim();
      const drafts = this.data.imageDrafts.slice(0, this.data.imageMax);
      if (!content && !drafts.length) {
        wx.showToast({ title: '先写点内容或选张图吧', icon: 'none' });
        return;
      }
      this.setData({ commentSaving: true, imageUploading: drafts.length > 0 });
      let uploaded = [];
      try {
        // 提交时才上传：用户中途放弃不会在云端留下孤儿文件。
        if (drafts.length) {
          uploaded = await media.uploadCommentImages(identity.uid, drafts);
          // 上传完成、开始落库：按钮文案从「上传中」切到「发布中」。
          if (this.data.imageUploading) this.setData({ imageUploading: false });
        }
        const created = await api.createComment(identity, location.id, content, location.name, uploaded);
        const imageUrls = uploaded.length ? await media.signCommentImages(uploaded) : {};
        const item = decorateComment(created, identity.uid, { likes: {}, imageUrls: imageUrls });
        this.setData({
          comments: this.data.comments.concat([item]),
          commentDraft: '',
          imageDrafts: [],
          commentSaving: false,
          imageUploading: false
        });
        // 触感反馈：发布成功震一下（不支持的环境静默降级）
        try { if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' }); } catch (error) { /* 忽略 */ }
        wx.showToast({ title: '已发布点评', icon: 'none' });
      } catch (error) {
        // 半途失败：清掉已云端的图片，避免孤儿；草稿与已选图片保留给用户重试。
        const orphans = uploaded.length ? uploaded : ((error && error.uploaded) || []);
        if (orphans.length) await media.removeQuietly(orphans);
        this.setData({ commentSaving: false, imageUploading: false });
        wx.showToast({ title: (error && error.message) || '发布失败，请稍后重试', icon: 'none' });
      }
    },

    onCommentDelete(event) {
      const id = String(event.currentTarget.dataset.id);
      const target = this.data.comments.filter(function (item) { return item.id === id; })[0];
      if (!target) return;
      const self = this;
      wx.showModal({
        title: '删除点评',
        content: '删除后成员将看不到这条点评。',
        confirmText: '删除',
        confirmColor: '#a33d36',
        success: function (res) {
          if (res.confirm) self.removeComment(target);
        }
      });
    },

    async removeComment(target) {
      const identity = store.getState().identity;
      if (!identity) return;
      try {
        await api.deleteComment(identity, target.id, target.authorId);
        this.setData({
          comments: this.data.comments.filter(function (item) { return item.id !== target.id; })
        });
        wx.showToast({ title: '已删除点评', icon: 'none' });
        // 顺手回收本条点评的图片（best-effort）：只有作者能删自己的点评，权限必然具备。
        const paths = (target.images || []).map(function (img) { return img && img.path ? img.path : img; });
        media.removeQuietly(paths);
      } catch (error) {
        wx.showToast({ title: (error && error.message) || '删除失败，请稍后重试', icon: 'none' });
      }
    },

    /** 点赞/取消：先乐观更新，失败回滚；同一条点评在请求飞行中忽略再次点击。 */
    async onToggleLike(event) {
      const id = String(event.currentTarget.dataset.id);
      const identity = store.getState().identity;
      if (!identity || !id) return;
      if (this.likePending[id]) return;
      const index = this.data.comments.map(function (item) { return item.id; }).indexOf(id);
      if (index < 0) return;
      const current = this.data.comments[index];
      const nextLiked = !current.likedByMe;
      const nextCount = Math.max(0, current.likeCount + (nextLiked ? 1 : -1));
      this.likePending[id] = true;
      this.patchCommentLike(id, nextCount, nextLiked);
      // 触感反馈：点亮时轻震（取消不震；不支持的环境静默降级）
      if (nextLiked) {
        try { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }); } catch (error) { /* 忽略 */ }
      }
      try {
        await api.toggleCommentLike(identity, id, nextLiked);
      } catch (error) {
        this.patchCommentLike(id, current.likeCount, current.likedByMe);
        wx.showToast({ title: (error && error.message) || '操作失败，请稍后重试', icon: 'none' });
      } finally {
        delete this.likePending[id];
      }
    },

    patchCommentLike(id, count, liked) {
      const comments = this.data.comments.map(function (item) {
        if (item.id !== id) return item;
        return Object.assign({}, item, { likeCount: count, likedByMe: liked });
      });
      this.setData({ comments: comments });
    },

    /**
     * 键盘弹起/收起时调整弹层几何。思路与 location-form 完全相同：
     * 高度取「视口 − 键盘」，弹层顶边恒等于 0，不会来回抖动。
     */
    applyKeyboard(height) {
      if (!height) {
        if (this.data.sheetStyle) this.setData({ sheetStyle: '' });
        return;
      }
      const viewport = this.viewportHeight || readViewportHeight();
      if (!viewport) {
        this.setData({ sheetStyle: `bottom:${height}px;` });
        return;
      }
      const available = Math.max(160, viewport - height);
      this.setData({
        sheetStyle: `bottom:${height}px;height:${available}px;max-height:${available}px;`
      });
    },

    noop() {}
  }
});
