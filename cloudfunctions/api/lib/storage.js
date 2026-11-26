'use strict';

const { fail } = require('./errors');

function loadDefaultCloudSdk() {
  return require('wx-server-sdk');
}

function createStorage(cloudSdk) {
  function resolveCloud() {
    return cloudSdk || loadDefaultCloudSdk();
  }

  async function getTempUrl(fileId, maxAgeSeconds = 60) {
    if (typeof fileId !== 'string' || !fileId.trim()) {
      fail('INVALID_FILE_ID', '材料文件标识无效。');
    }
    const maxAge =
      typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
        ? Math.floor(maxAgeSeconds)
        : 60;
    let result;
    try {
      result = await resolveCloud().getTempFileURL({
        fileList: [{ fileID: fileId.trim(), maxAge }]
      });
    } catch (error) {
      fail('STORAGE_TEMP_URL_FAILED', '获取材料临时下载链接失败，请稍后重试。');
    }
    const entry =
      result && Array.isArray(result.fileList) ? result.fileList[0] : null;
    if (!entry || entry.status !== 0 || !entry.tempFileURL) {
      fail('STORAGE_TEMP_URL_FAILED', '获取材料临时下载链接失败，请稍后重试。');
    }
    return entry.tempFileURL;
  }

  async function deleteFile(fileId) {
    if (typeof fileId !== 'string' || !fileId.trim()) {
      fail('INVALID_FILE_ID', '材料文件标识无效。');
    }
    let result;
    try {
      result = await resolveCloud().deleteFile({
        fileList: [fileId.trim()]
      });
    } catch (error) {
      fail('STORAGE_DELETE_FAILED', '云存储文件删除失败，请稍后重试。');
    }
    const entry =
      result && Array.isArray(result.fileList) ? result.fileList[0] : null;
    if (!entry || entry.status !== 0) {
      fail('STORAGE_DELETE_FAILED', '云存储文件删除失败，请稍后重试。');
    }
    return { deleted: true, fileId: fileId.trim() };
  }

  async function statFile(fileId) {
    if (typeof fileId !== 'string' || !fileId.trim()) {
      return null;
    }
    try {
      const result = await resolveCloud().downloadFile({
        fileID: fileId.trim()
      });
      const content = result && result.fileContent;
      if (!content) {
        return null;
      }
      if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
        return { sizeBytes: content.byteLength };
      }
      if (typeof content.byteLength === 'number') {
        return { sizeBytes: content.byteLength };
      }
      if (typeof content.length === 'number') {
        return { sizeBytes: content.length };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  return Object.freeze({
    getTempUrl,
    deleteFile,
    statFile
  });
}

const defaultStorage = createStorage(null);

module.exports = {
  createStorage,
  getTempUrl: defaultStorage.getTempUrl,
  deleteFile: defaultStorage.deleteFile,
  statFile: defaultStorage.statFile
};
