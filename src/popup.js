/*
 * @Author: wz && vgqk@qq.com
 * @Date: 2024-12-14 18:49:41
 *
 * Copyright (c) 2024 by wz, All Rights Reserved.
 */

// 相册名称
let albumTitle = '';

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('downloadAblum');
  button.addEventListener('click', () => {
    logMessage('下载按钮被点击了!');

    // 从 chrome.storage 获取 URL
    chrome.storage.local.get(['albumUrl'], (result) => {
      const albumUrl = result.albumUrl;
      if (albumUrl) {
        logMessage('chrome.storage 获取的 URL：', albumUrl);
        updateButtonState(true);
        downloadAlbumData(albumUrl); // 使用获取到的 URL
      } else {
        showStatus('尚未选择相册', '请先在 QQ 空间打开需要下载的相册。');
      }
    });
  });
});

/**
 * 下载相册数据
 * @param {*} albumUrl
 * @returns
 */
async function downloadAlbumData(albumUrl) {
  if (!albumUrl) {
    updateButtonState(false);
    showStatus('尚未选择相册', '请先在 QQ 空间打开需要下载的相册。');
    return;
  }

  // 获取用户设置的最大下载数量
  const maxCountInput = document.getElementById('maxCount');
  const maxCount = maxCountInput.value ? parseInt(maxCountInput.value, 10) : null;

  const downloadBox = document.getElementById('downloadBox');
  downloadBox.style.display = 'block'; // 显示下载盒子
  downloadBox.classList.remove('is-complete', 'is-warning');
  document.getElementById('statusTitle').textContent = '正在读取相册';
  document.getElementById('statusMessage').textContent = '';
  document.getElementById('progressText').textContent = '…';

  const photoList = await getAlbumPhotoList(albumUrl, maxCount);

  const resultArray = photoList.map((photo) => ({
    name: photo.name,
    url: photo.url,
    uploadtime: photo.uploadtime,
    rawshoottime: photo.rawshoottime,
    shootTime: photo.shootTime,
    shoottime: photo.shoottime,
  }));

  downloadPhotos(resultArray);
}

/**
 * 获取相册全部数据
 * @param {*} url
 * @param {number|null} maxCount 最大下载数量，null 表示不限制
 * @returns
 */
async function getAlbumPhotoList(url, maxCount = null) {
  // 解析 URL
  url = buildFetchUrl(url);

  // 获取初始的照片列表
  const photoData = await fetchPhotoList(url);
  const totalInAlbum = photoData.totalInAlbum;
  logMessage('相册照片总数：', totalInAlbum);

  // 确定实际需要获取的数量
  const actualCount = maxCount !== null ? Math.min(totalInAlbum, maxCount) : totalInAlbum;
  logMessage('计划下载数量：', actualCount);

  let photoList = photoData.photoList || [];

  // 如果已获取数量不足，继续分页获取
  while (photoList.length < actualCount) {
    const pageStart = photoList.length;
    const nextPageUrl = buildFetchUrl(url, pageStart);
    const photoData = await fetchPhotoList(nextPageUrl);
    const nextPagePhotos = photoData.photoList;
    photoList = photoList.concat(nextPagePhotos);

    // 如果返回的照片数量少于请求的数量，说明已经没有更多照片了
    if (nextPagePhotos.length < 500) {
      break;
    }
  }

  // 截取到实际需要的数量
  const finalPhotoList = photoList.slice(0, actualCount);
  logMessage('即将下载的数据列表：', finalPhotoList);
  return finalPhotoList;
}

/**
 * 获取照片列表的辅助函数
 * @param {*} url
 * @returns
 */
async function fetchPhotoList(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include', // 这会发送包含cookie的请求
  });
  const data = await response.text();
  const start = data.indexOf('(') + 1;
  const end = data.lastIndexOf(')');
  const jsonData = JSON.parse(data.slice(start, end));
  const albumData = jsonData.data;
  logMessage('获取到的相册数据：', jsonData);

  // 展示正在下载的相册
  albumTitle = albumData.topic.name;
  document.getElementById('albumTitle').textContent = albumTitle; // 设置相册标题

  // 返回照片列表和总数
  return {
    photoList: albumData.photoList,
    totalInAlbum: albumData.totalInAlbum,
  };
}

/**
 * 解析url
 * @param {*} albumUrl
 * @param {*} pageStart
 * @param {*} pageNum
 * @returns
 */
function buildFetchUrl(albumUrl, pageStart = 0, pageNum = 500) {
  const urlParts = albumUrl.split('?');
  const baseUrl = urlParts[0];
  const queryString = urlParts[1];

  // 将查询字符串转换为对象
  const params = {};
  queryString.split('&').forEach((param) => {
    const [key, value] = param.split('=');
    params[key] = value;
  });

  // 修改 pageStart 和 pageNum 的值
  params['pageStart'] = pageStart;
  params['pageNum'] = pageNum;

  // 重新构建查询字符串
  const newQueryString = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  // 重新构建完整的 URL
  albumUrl = `${baseUrl}?${newQueryString}`;

  // 输出修改后的 URL
  return albumUrl;
}

/**
 * 打包下载照片zip
 * @param {*} list
 */
function downloadPhotos(list) {
  // 开始下载时固定当前相册名称，避免后续状态变化影响文件名。
  let safeAlbumTitle = String(albumTitle ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '-') || '相册';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeAlbumTitle)) {
    safeAlbumTitle = `-${safeAlbumTitle}`;
  }
  const zipFilename = `${safeAlbumTitle}.zip`;
  const progressBar = document.getElementById('progressBar');
  const downloadBox = document.getElementById('downloadBox');
  progressBar.value = 0; // 初始化进度条
  document.getElementById('progressText').textContent = '0%';
  document.getElementById('statusTitle').textContent = '正在打包照片';

  const worker = new Worker('photoDownloader.js'); // 引入 Web Worker

  // 向 Worker 发送任务
  worker.postMessage(list);

  // 监听 Worker 的消息
  worker.onmessage = (event) => {
    const { type, data } = event.data;

    if (type === 'progress') {
      progressBar.value = data; // 更新进度条
      document.getElementById('progressText').textContent = `${Math.round(data)}%`;
    } else if (type === 'complete') {
      // 下载完成，生成 ZIP 文件
      const { zipContent, metadataSummary } = data;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipContent);
      link.download = zipFilename;
      document.body.appendChild(link);
      link.click(); // 触发下载
      document.body.removeChild(link);

      document.getElementById('statusTitle').textContent = '下载完成';
      document.getElementById('statusMessage').textContent = buildCompletionMessage(metadataSummary);
      document.getElementById('progressText').textContent = '完成';
      downloadBox.classList.add('is-complete');
      updateButtonState(false);
      worker.terminate(); // 任务完成后终止 Worker
    }
  };
}

function buildCompletionMessage(metadataSummary) {
  if (!metadataSummary) return '相册压缩包已开始下载。';
  const lines = [
    `相册压缩包已开始下载。`,
    `${metadataSummary.originalTime} 张使用照片原始时间，${metadataSummary.uploadTime} 张使用上传时间。`,
    `时间信息已写入 ${metadataSummary.embedded} 张图片。`,
  ];
  if (metadataSummary.sidecar) lines.push(`${metadataSummary.sidecar} 张照片的时间信息保存在同名 .metadata.json 文件中。`);
  if (metadataSummary.missing) lines.push(`${metadataSummary.missing} 张照片没有可用时间信息。`);
  return lines.join('\n');
}

function showStatus(title, message) {
  const box = document.getElementById('downloadBox');
  box.style.display = 'block';
  box.classList.remove('is-complete');
  box.classList.add('is-warning');
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('albumTitle').textContent = '';
  document.getElementById('statusMessage').textContent = message;
  document.getElementById('progressText').textContent = '';
  document.getElementById('progressBar').value = 0;
}

/**
 * 设置按钮状态的函数
 * @param {*} isDisabled
 */
function updateButtonState(isDisabled) {
  const button = document.getElementById('downloadAblum');
  button.disabled = isDisabled;
}

/**
 * console日志封装
 * @param  {...any} messages
 */
function logMessage(...messages) {
  const stack = new Error().stack; // 获取调用栈
  const stackLines = stack.split('\n'); // 将堆栈信息按行分割
  const callerLine = stackLines[2]; // 获取调用该函数的行信息

  // 提取文件名和行号
  const match = callerLine.match(/\((.*):(\d+):\d+\)/);
  const location = match ? `${match[1]}:${match[2]}` : 'unknown location';

  // 打印日志
  console.log(`[${location}]`, ...messages); // 使用扩展运算符打印所有消息
}
