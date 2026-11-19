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
    const input = document.getElementById('maxCount');
    const rawMaxCount = input.value.trim();
    const maxCount = rawMaxCount === '' ? null : Number(rawMaxCount);
    if (maxCount !== null && (!Number.isSafeInteger(maxCount) || maxCount < 1)) {
      showStatus('数量无效', '请输入大于 0 的整数，或留空下载全部照片。');
      input.focus();
      return;
    }

    updateButtonState(true);
    showStatus('正在连接相册', '正在读取当前 QQ 空间页面的相册信息…', false);

    getCurrentAlbumUrl()
      .then((albumUrl) => {
        if (albumUrl) {
          downloadAlbumData(albumUrl, maxCount).catch(handleDownloadError);
        } else {
          updateButtonState(false);
          showStatus('尚未识别当前相册', '请刷新当前 QQ 空间相册页面后重试。');
        }
      })
      .catch(handleDownloadError);
  });

  loadAlbumOverview();
});

async function loadAlbumOverview() {
  setAlbumOverview('正在识别相册…', '正在读取图片数量', 'loading');

  try {
    const albumUrl = await getCurrentAlbumUrl();
    if (!albumUrl) {
      setAlbumOverview('未识别到当前相册', '请在当前标签页打开 QQ 空间相册', 'empty');
      return;
    }

    // 只读取一张照片的信息，用接口返回的总数快速填充弹窗概览。
    const photoData = await fetchPhotoList(buildFetchUrl(albumUrl, 0, 1));
    if (!Number.isSafeInteger(photoData.totalInAlbum) || photoData.totalInAlbum < 0) {
      throw new Error('QQ 空间没有返回照片总数。');
    }
  } catch (error) {
    console.error('相册识别失败：', error);
    setAlbumOverview('相册识别失败', '请刷新 QQ 空间相册页面后重试', 'error');
  }
}

function getCurrentAlbumUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error('无法读取当前标签页，请重新打开扩展。'));
        return;
      }

      const activeTabId = tabs?.[0]?.id;
      chrome.storage.local.get(['albumUrl', 'albumTabId'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error('无法读取相册信息，请重新打开扩展。'));
          return;
        }

        const albumUrl = result?.albumUrl;
        const albumTabId = result?.albumTabId;
        // 来源标签页不匹配或记录较旧时不展示，避免把上次相册误当作当前相册。
        if (!albumUrl || !Number.isInteger(albumTabId) || albumTabId !== activeTabId) {
          resolve('');
          return;
        }

        resolve(albumUrl);
      });
    });
  });
}

function setAlbumOverview(title, countText, state = 'ready') {
  const card = document.querySelector('.album-note');
  card.classList.remove('is-loading', 'is-error', 'is-empty');
  if (state !== 'ready') card.classList.add(`is-${state}`);
  document.getElementById('albumTitle').textContent = title;
  document.getElementById('albumCount').textContent = countText;
}

/**
 * 下载相册数据
 * @param {*} albumUrl
 * @returns
 */
async function downloadAlbumData(albumUrl, maxCount) {
  if (!albumUrl) {
    updateButtonState(false);
    showStatus('尚未选择相册', '请先在 QQ 空间打开需要下载的相册。');
    return;
  }

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

  if (resultArray.length === 0) {
    updateButtonState(false);
    showStatus('相册没有照片', '这个相册没有可下载的照片。');
    return;
  }

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
  if (!Number.isSafeInteger(totalInAlbum) || totalInAlbum < 0) {
    throw new Error('无法读取相册照片总数，请刷新 QQ 空间后重试。');
  }
  logMessage('相册照片总数：', totalInAlbum);

  // 确定实际需要获取的数量
  const actualCount = maxCount !== null ? Math.min(totalInAlbum, maxCount) : totalInAlbum;
  logMessage('计划下载数量：', actualCount);

  let photoList = photoData.photoList || [];
  document.getElementById('statusMessage').textContent = `正在读取照片列表… 0 / ${actualCount} 张`;

  // 如果已获取数量不足，继续分页获取
  while (photoList.length < actualCount) {
    const pageStart = photoList.length;
    const nextPageUrl = buildFetchUrl(url, pageStart);
    const photoData = await fetchPhotoList(nextPageUrl);
    const nextPagePhotos = photoData.photoList;
    photoList = photoList.concat(nextPagePhotos);
    document.getElementById('statusMessage').textContent = `正在读取照片列表… ${Math.min(photoList.length, actualCount)} / ${actualCount} 张`;

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
  if (!response.ok) {
    throw new Error(`相册接口返回错误（HTTP ${response.status}），请刷新 QQ 空间后重试。`);
  }
  const data = await response.text();
  const start = data.indexOf('(') + 1;
  const end = data.lastIndexOf(')');
  if (start === 0 || end < start) {
    throw new Error('没有读懂 QQ 空间返回的数据，请刷新相册后重试。');
  }
  const jsonData = JSON.parse(data.slice(start, end));
  const albumData = jsonData.data;
  const rawTotalInAlbum = albumData?.totalInAlbum;
  const totalInAlbum = rawTotalInAlbum == null || rawTotalInAlbum === '' ? null : Number(rawTotalInAlbum);
  if (
    !albumData?.topic?.name ||
    !Array.isArray(albumData.photoList) ||
    (totalInAlbum !== null && (!Number.isSafeInteger(totalInAlbum) || totalInAlbum < 0))
  ) {
    throw new Error('无法读取这个相册，可能尚未登录或相册暂不受支持。');
  }
  logMessage('获取到的相册数据：', jsonData);

  // 总数存在时更新弹窗概览；分页响应缺少总数时保留已识别的数量。
  albumTitle = albumData.topic.name;
  if (totalInAlbum !== null) {
    setAlbumOverview(albumTitle, `已识别 ${totalInAlbum} 张照片`);
  }

  // 返回照片列表和总数
  return {
    photoList: albumData.photoList,
    totalInAlbum,
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
    } else if (type === 'error') {
      worker.terminate();
      updateButtonState(false);
      showStatus('下载失败', data || '下载照片时发生错误，请检查网络后重试。');
    }
  };
  worker.onerror = () => {
    worker.terminate();
    updateButtonState(false);
    showStatus('下载失败', '下载过程中发生错误，请检查网络或刷新 QQ 空间后重试。');
  };
  worker.onmessageerror = () => {
    worker.terminate();
    updateButtonState(false);
    showStatus('下载失败', '收到无法处理的数据，请重新打开相册后重试。');
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

function showStatus(title, message, warning = true) {
  const box = document.getElementById('downloadBox');
  box.style.display = 'block';
  box.classList.toggle('is-warning', warning);
  box.classList.remove('is-complete');
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusMessage').textContent = message;
  document.getElementById('progressText').textContent = '';
  document.getElementById('progressBar').value = 0;
}

function handleDownloadError(error) {
  updateButtonState(false);
  showStatus('下载失败', error instanceof Error ? error.message : '下载失败，请检查网络后重试。');
}

/**
 * 设置按钮状态的函数
 * @param {*} isDisabled
 */
function updateButtonState(isDisabled) {
  const button = document.getElementById('downloadAblum');
  button.disabled = isDisabled;
  button.querySelector('span').textContent = isDisabled ? '正在准备下载…' : '下载相册';
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
