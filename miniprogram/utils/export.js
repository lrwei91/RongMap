const fs = wx.getFileSystemManager();

// 原 Web 端用 Blob + URL.createObjectURL + <a download> 触发下载。
// 小程序没有 Blob / URL / a[download]，改写文件到 USER_DATA_PATH，
// 再按能力降级：优先 wx.shareFileMessage（可转发到聊天），否则复制到剪贴板。

const SUPPORTED_OPEN_TYPES = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];

function extensionOf(fileName) {
  const index = String(fileName).lastIndexOf('.');
  return index < 0 ? '' : String(fileName).slice(index + 1).toLowerCase();
}

function writeFile(fileName, content) {
  return new Promise(function (resolve, reject) {
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    fs.writeFile({
      filePath: filePath,
      data: content,
      encoding: 'utf8',
      success: function () { resolve(filePath); },
      fail: function () {
        console.error('[RongMap] 文件写入失败', JSON.stringify({ stage: 'writeFile' }));
        reject(new Error('文件写入失败'));
      }
    });
  });
}

function shareFile(filePath, fileName) {
  return new Promise(function (resolve, reject) {
    if (typeof wx.shareFileMessage !== 'function') {
      reject(new Error('unsupported'));
      return;
    }
    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName,
      success: function () { resolve('shared'); },
      fail: function () { reject(new Error('cancelled')); }
    });
  });
}

function openFile(filePath, extension) {
  return new Promise(function (resolve, reject) {
    if (SUPPORTED_OPEN_TYPES.indexOf(extension) < 0) {
      reject(new Error('unsupported'));
      return;
    }
    wx.openDocument({
      filePath: filePath,
      fileType: extension,
      showMenu: true,
      success: function () { resolve('opened'); },
      fail: function () { reject(new Error('openFailed')); }
    });
  });
}

function copyText(content) {
  return new Promise(function (resolve, reject) {
    wx.setClipboardData({
      data: content,
      success: function () { resolve('copied'); },
      fail: function () { reject(new Error('复制失败')); }
    });
  });
}

/**
 * 导出文本内容：先落盘，再按文件类型选择打开 / 转发 / 复制。
 * @returns {Promise<'shared'|'opened'|'copied'|'saved'>}
 */
async function exportContent(options) {
  const fileName = options.fileName;
  const content = options.content;
  const extension = extensionOf(fileName);
  let filePath = null;

  try {
    filePath = await writeFile(fileName, content);
  } catch (error) {
    filePath = null;
  }

  if (filePath) {
    try {
      return await shareFile(filePath, fileName);
    } catch (error) {
      // 用户取消转发时不要再弹剪贴板提示，静默保留文件即可。
      if (error.message === 'cancelled') return 'saved';
    }
    try {
      return await openFile(filePath, extension);
    } catch (error) {
      // CSV / JSON 不在 openDocument 支持列表内，落到剪贴板。
    }
  }

  return copyText(content);
}

module.exports = { exportContent, writeFile, copyText, extensionOf };
