/**
 * 点评配图与云存储工具。
 *
 * 图片存放在 runtime bucket 的 shared/<uid>/comments/ 前缀下：
 * shared 目录「所有登录用户可读、仅 owner 可写删」；点评也只有作者本人能删，
 * 所以删除点评时作者有权限顺手回收自己上传的图片。
 * 当前 SDK（0.1.3-dev）没有 sharedPath 助手，路径在这里手拼（SDK 会做安全校验）。
 */
const { cloud } = require('./cloud');

const MAX_COMMENT_IMAGES = 3;
const SIGNED_URL_TTL = 3600;

const EXT_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic'
};

/** 从文件路径或裸扩展名里取小写扩展名；取不到返回空串。 */
function extOf(filePathOrExt) {
  const text = String(filePathOrExt || '').toLowerCase().split('?')[0].split('#')[0];
  const dot = text.lastIndexOf('.');
  const ext = dot >= 0 ? text.slice(dot + 1) : text;
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : '';
}

/** 生成点评图片的存储路径（唯一名）；不认识的后缀统一落 .jpg。 */
function commentImagePath(uid, ext) {
  const safeExt = EXT_CONTENT_TYPES[ext] ? ext : 'jpg';
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return 'shared/' + uid + '/comments/' + nonce + '.' + safeExt;
}

function inferContentType(filePathOrExt) {
  return EXT_CONTENT_TYPES[extOf(filePathOrExt)] || 'image/jpeg';
}

/** 读取临时文件为 ArrayBuffer：小程序没有 DOM File，SDK 的 body 直接收 ArrayBuffer。 */
function readFileArrayBuffer(filePath) {
  return new Promise(function (resolve, reject) {
    try {
      wx.getFileSystemManager().readFile({
        filePath: filePath,
        success: function (res) { resolve(res.data); },
        fail: function () { reject(new Error('读取图片失败')); }
      });
    } catch (error) {
      reject(new Error('读取图片失败'));
    }
  });
}

/**
 * 串行上传选中的图片（chooseMedia 的 tempFiles），返回 object key 数组。
 * 中途失败时把「已上传的 key」挂在错误对象 uploaded 上，由调用方清理，避免孤儿文件。
 */
async function uploadCommentImages(uid, drafts) {
  const files = Array.isArray(drafts) ? drafts.slice(0, MAX_COMMENT_IMAGES) : [];
  const paths = [];
  for (let index = 0; index < files.length; index += 1) {
    const tempFilePath = (files[index] && files[index].tempFilePath) || '';
    try {
      const path = commentImagePath(uid, extOf(tempFilePath));
      const buffer = await readFileArrayBuffer(tempFilePath);
      const result = await cloud.storage.upload(path, buffer, { contentType: inferContentType(tempFilePath) });
      if (result && result.error) throw new Error('图片上传失败');
      paths.push(path);
    } catch (error) {
      error.uploaded = paths.slice();
      throw error;
    }
  }
  return paths;
}

/** 批量换签名 URL（1–3600 秒）；失败或部分缺失都只影响对应图片，返回空映射表示全部降级。 */
async function signCommentImages(paths, expiresIn) {
  const unique = Array.from(new Set((paths || []).filter(function (path) {
    return typeof path === 'string' && path;
  })));
  if (!unique.length) return {};
  try {
    const ttl = Math.min(3600, Math.max(60, expiresIn || SIGNED_URL_TTL));
    const result = await cloud.storage.createSignedUrls(unique, ttl);
    if (!result || result.error || !Array.isArray(result.data)) return {};
    const map = {};
    result.data.forEach(function (item) {
      const url = item && (item.signedUrl || item.signedURL);
      if (item && item.path && url) map[item.path] = url;
    });
    return map;
  } catch (error) {
    return {};
  }
}

/** best-effort 删除（孤儿/随删图片）：失败只留日志语义，不打断主流程。 */
async function removeQuietly(paths) {
  const keys = (paths || []).filter(function (path) {
    return typeof path === 'string' && path;
  });
  if (!keys.length) return;
  try {
    await cloud.storage.remove(keys);
  } catch (error) {
    // 清理失败可接受：文件留在 shared 目录，不影响功能。
  }
}

module.exports = {
  MAX_COMMENT_IMAGES,
  commentImagePath,
  inferContentType,
  uploadCommentImages,
  signCommentImages,
  removeQuietly
};
