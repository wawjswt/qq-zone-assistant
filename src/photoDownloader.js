/*
 * @Author: wz && vgqk@qq.com
 * @Date: 2024-12-15 02:39:11
 *
 * Copyright (c) 2024 by wz, All Rights Reserved.
 */

importScripts('jszip.min.js', 'vendor/exifr-7.1.3.umd.js');

// ZIP 的 DOS 时间不带时区；JSZip 使用 UTC 分量写入，保留 QQ 空间显示的北京时间。
function getUploadDate(uploadtime) {
  const value = String(uploadtime ?? '').trim();
  let date;
  if (/^\d{10}(\d{3})?$/.test(value)) {
    const milliseconds = Number(value) * (value.length === 10 ? 1000 : 1);
    date = new Date(milliseconds + 8 * 60 * 60 * 1000);
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute, second = '00'] = match;
    const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    date = new Date(normalized);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) return null;
  }
  // DOS 时间支持 1980–2107 年，缺失或异常数据沿用 ZIP 默认时间。
  return date.getUTCFullYear() >= 1980 && date.getUTCFullYear() <= 2107 ? date : null;
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uploadTimeText(date) {
  return date.toISOString().slice(0, 19) + '+08:00';
}

async function selectPhotoTime(bytes, photo) {
  let metadata = {};
  try {
    // 保留原始日期字符串，避免读取工具按电脑时区自动转换。
    metadata = await exifr.parse(bytes, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal', 'OffsetTimeDigitized', 'OffsetTime'],
      reviveValues: false,
    }) || {};
  } catch {
    // 缺少 / 损坏的 EXIF 不应阻止下载，继续尝试接口中的拍摄时间。
  }
  for (const [tag, offsetTag] of [
    ['DateTimeOriginal', 'OffsetTimeOriginal'],
    ['CreateDate', 'OffsetTimeDigitized'],
    ['ModifyDate', 'OffsetTime'],
  ]) {
    const value = String(metadata[tag] ?? '').trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const date = getUploadDate(value);
    if (date) {
      const offset = /^[+-]\d{2}:\d{2}$/.test(metadata[offsetTag]) ? metadata[offsetTag] : '';
      return { date, text: date.toISOString().slice(0, 19) + offset, source: `EXIF:${tag}` };
    }
  }
  for (const field of ['rawshoottime', 'shootTime', 'shoottime']) {
    const value = String(photo[field] ?? '').trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = getUploadDate(dateOnly ? `${value} 00:00:00` : value);
    if (date) return { date, text: dateOnly ? value : uploadTimeText(date), source: `QQ空间:${field}` };
  }
  const date = getUploadDate(photo.uploadtime);
  return date ? { date, text: uploadTimeText(date), source: 'QQ空间:uploadtime' } : null;
}

function photoTimeMetadata(uploadDate, selectedTime) {
  const fields = {};
  if (uploadDate) fields.QZoneUploadTime = uploadTimeText(uploadDate);
  if (selectedTime) {
    fields.QZonePhotoTime = selectedTime.text;
    fields.QZoneTimeSource = selectedTime.source;
  }
  return fields;
}

function getImageExtension(bytes) {
  const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0xff, 0xd8, 0xff)) return 'jpg';
  if (startsWith(137, 80, 78, 71, 13, 10, 26, 10)) return 'png';
  if (startsWith(71, 73, 70, 56)) return 'gif';
  if (startsWith(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'webp';
  if (startsWith(66, 77)) return 'bmp';
  return 'bin';
}

// 仅添加元数据，不解码或重压缩图片，已有 EXIF / 相机信息和图像数据原样保留。
function embedUploadTime(bytes, date, selectedTime = null) {
  const extension = getImageExtension(bytes);
  const unchanged = { bytes, extension, embedded: false };
  const fields = photoTimeMetadata(date, selectedTime);
  if (!Object.keys(fields).length) return unchanged;
  const encoder = new TextEncoder();
  if (extension === 'jpg') {
    // JPEG COM 是独立的内部备注，不覆盖 EXIF 拍摄时间或现有备注。
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda) {
        const comment = encoder.encode(Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n'));
        const length = comment.length + 2;
        const segment = concatBytes(new Uint8Array([0xff, 0xfe, length >> 8, length & 255]), comment);
        return { bytes: concatBytes(bytes.subarray(0, offset), segment, bytes.subarray(offset)), extension, embedded: true };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) return unchanged;
      offset += 2 + length;
    }
  } else if (extension === 'png') {
    // 在 IHDR 后添加独立 iTXt 字段，CRC 覆盖类型和数据。
    if (bytes.length < 33 || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return unchanged;
    const chunks = Object.entries(fields).map(([key, value]) => {
      const data = encoder.encode(`${key}\0\0\0\0\0${value}`);
      const chunk = new Uint8Array(data.length + 12);
      const view = new DataView(chunk.buffer);
      view.setUint32(0, data.length);
      chunk.set(encoder.encode('iTXt'), 4);
      chunk.set(data, 8);
      let crc = 0xffffffff;
      for (const byte of chunk.subarray(4, chunk.length - 4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
      return chunk;
    });
    return { bytes: concatBytes(bytes.subarray(0, 33), ...chunks, bytes.subarray(33)), extension, embedded: true };
  }
  return unchanged;
}

self.onmessage = async (event) => {
  try {
    const list = event.data;
    const zip = new JSZip();

    const totalImages = list.length;
    const sequenceWidth = Math.max(4, String(totalImages).length);
    let downloadedImages = 0;
    const metadataSummary = { embedded: 0, sidecar: 0, missing: 0, originalTime: 0, uploadTime: 0 };

    for (const photo of list) {
      const response = await fetch(photo.url);
      if (!response.ok) throw new Error(`第 ${downloadedImages + 1} 张照片下载失败（HTTP ${response.status}）`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // 每张照片使用唯一序号，避免同名覆盖，并保持相册顺序。
      const sequence = String(downloadedImages + 1).padStart(sequenceWidth, '0');
      const safeName = String(photo.name ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '未命名';
      const uploadDate = getUploadDate(photo.uploadtime);
      const selectedTime = await selectPhotoTime(bytes, photo);
      const image = embedUploadTime(bytes, uploadDate, selectedTime);
      const filename = `${sequence}_${safeName}.${image.extension}`;
      const options = selectedTime ? { date: selectedTime.date } : {};
      if (selectedTime) {
        if (selectedTime.source === 'QQ空间:uploadtime') metadataSummary.uploadTime++;
        else metadataSummary.originalTime++;
      }
      zip.file(filename, image.bytes, options);
      if (image.embedded) {
        metadataSummary.embedded++;
      } else if (selectedTime) {
        // 尚不支持的格式保留原文件，并显式保存旁车信息，不能冒充已嵌入成功。
        zip.file(`${filename}.metadata.json`, JSON.stringify({
          file: filename,
          ...photoTimeMetadata(uploadDate, selectedTime),
          source: 'QQ空间',
          note: '此格式未内嵌时间信息，请将本文件与图片一同保存。',
        }, null, 2), options);
        metadataSummary.sidecar++;
      } else {
        metadataSummary.missing++;
      }
      downloadedImages++;

      // 通知主线程进度
      self.postMessage({
        type: 'progress',
        data: (downloadedImages / totalImages) * 100,
      });
    }

    // 生成 ZIP 文件
    const zipContent = await zip.generateAsync({ type: 'blob' });
    self.postMessage({ type: 'complete', data: { zipContent, metadataSummary } });
  } catch (error) {
    self.postMessage({
      type: 'error',
      data: error instanceof Error ? `下载失败：${error.message}` : '下载失败，请检查网络后重试。',
    });
  }
};
