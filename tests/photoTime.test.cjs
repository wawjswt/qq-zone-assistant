const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const JSZip = require('../src/jszip.min.js');
const exifr = require('../src/vendor/exifr-7.1.3.umd.js');
const source = fs.readFileSync(path.join(__dirname, '../src/photoDownloader.js'), 'utf8');
const fixture = (file) => fs.readFileSync(path.join(__dirname, 'fixtures', file));

function createWorker(extra = {}) {
  const context = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, Blob, setTimeout, clearTimeout, self: {}, ...extra,
  });
  context.postMessage = extra.self?.postMessage || (() => {});
  vm.runInContext('self = globalThis', context);
  // Load the actual bundled browser scripts, as a real extension Worker does.
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
    }
  };
  vm.runInContext(source, context);
  return context;
}

for (const ext of ['jpg', 'png']) {
  test(`${ext}: original capture date wins over digitization, modification and upload dates`, async () => {
    const selected = await createWorker().selectPhotoTime(fixture(`capture-time.${ext}`), {
      uploadtime: '2025-09-10 14:36:00', shootTime: '2025-07-01',
    });
    assert.equal(selected.date.toISOString(), '2025-06-07T12:34:57.000Z');
    assert.equal(selected.source, 'EXIF:DateTimeOriginal');
  });
}

test('uses API capture date when file metadata is absent, then upload time as fallback', async () => {
  const context = createWorker();
  const bytes = fixture('no-time.jpg');
  const selected = await context.selectPhotoTime(bytes, {
    rawshoottime: 0, shootTime: '2025-06-07', uploadtime: '2025-09-10 14:36:00',
  });
  assert.equal(selected.date.toISOString(), '2025-06-07T00:00:00.000Z');
  assert.equal(selected.text, '2025-06-07');
  assert.equal(selected.source, 'QQ空间:shootTime');
  const fallback = await context.selectPhotoTime(bytes, {
    rawshoottime: '0000-00-00', shootTime: '2025-02-30', uploadtime: '2012-08-06 10:37:00',
  });
  assert.equal(fallback.date.toISOString(), '2012-08-06T10:37:00.000Z');
  assert.equal(fallback.source, 'QQ空间:uploadtime');
  assert.equal(await context.selectPhotoTime(Buffer.from('broken'), {}), null);
  assert.equal((await context.selectPhotoTime(Buffer.from('broken'), {
    uploadtime: '2012-08-06 10:37:00',
  })).source, 'QQ空间:uploadtime');
});

test('invalid EXIF original date is skipped in favor of a valid digitization date', async () => {
  const bytes = Buffer.from(fixture('capture-time.jpg').toString('latin1')
    .replace('2025:06:07 12:34:57', '0000:00:00 00:00:00'), 'latin1');
  const selected = await createWorker().selectPhotoTime(bytes, { uploadtime: '2025-09-10 14:36:00' });
  assert.equal(selected.source, 'EXIF:CreateDate');
  assert.equal(selected.date.toISOString(), '2025-06-08T12:34:57.000Z');
});

test('photos without capture dates retain camera metadata, with or without upload time', async () => {
  for (const ext of ['jpg', 'png']) {
    const original = fixture(`metadata-no-time.${ext}`);
    const originalMetadata = await exifr.parse(original, { reviveValues: false });
    assert.equal(originalMetadata.Make, 'SAMSUNG');
    assert.equal(originalMetadata.Model, 'ST60');
    assert.equal(originalMetadata.ISO, 400);
    const messages = [];
    const worker = createWorker({
      fetch: async () => ({ arrayBuffer: async () => original }),
      self: { postMessage: (message) => messages.push(message) },
    });
    await worker.self.onmessage({ data: [
      { name: '无时间', url: 'photo' },
      { name: '仅有上传时间', url: 'photo', uploadtime: '2025-09-10 14:36:00' },
    ] });
    const complete = messages.find((message) => message.type === 'complete');
    const zip = await JSZip.loadAsync(await complete.data.zipContent.arrayBuffer());
    const first = await zip.file(`0001_无时间.${ext}`).async('nodebuffer');
    const second = await zip.file(`0002_仅有上传时间.${ext}`).async('nodebuffer');
    assert.deepEqual(first, original, 'no-time image stays byte-for-byte identical');
    const actualMetadata = await exifr.parse(second, { reviveValues: false });
    assert.equal(actualMetadata.Make, originalMetadata.Make);
    assert.equal(actualMetadata.Model, originalMetadata.Model);
    assert.equal(actualMetadata.ISO, originalMetadata.ISO);
    assert.deepEqual(actualMetadata.FNumber, originalMetadata.FNumber);
    assert.equal(complete.data.metadataSummary.missing, 1);
    assert.equal(complete.data.metadataSummary.uploadTime, 1);
  }
});

test('ZIP dates and embedded preferred-time fields follow each photo while upload times stay separate', async () => {
  const messages = [];
  const worker = createWorker({
    fetch: async (url) => ({ arrayBuffer: async () => fixture(url) }),
    self: { postMessage: (message) => messages.push(message) },
  });
  await worker.self.onmessage({ data: [
    { name: '有拍摄时间', url: 'capture-time.jpg', uploadtime: '2025-09-10 14:36:00' },
    { name: '无拍摄时间', url: 'no-time.jpg', uploadtime: '2012-08-06 10:37:00' },
    { name: '有拍摄时间无上传时间', url: 'capture-time.png' },
  ] });
  const complete = messages.find((message) => message.type === 'complete');
  const zip = await JSZip.loadAsync(await complete.data.zipContent.arrayBuffer());
  const files = Object.values(zip.files);
  assert.equal(files.length, 3);
  assert.equal(files[0].date.toISOString(), '2025-06-07T12:34:56.000Z'); // DOS ZIP precision: 2 seconds
  assert.equal(files[1].date.toISOString(), '2012-08-06T10:37:00.000Z');
  assert.equal(files[2].date.toISOString(), '2025-06-07T12:34:56.000Z');
  const first = await files[0].async('nodebuffer');
  assert.ok(first.includes(Buffer.from('QZonePhotoTime=2025-06-07T12:34:57')));
  assert.ok(first.includes(Buffer.from('QZoneTimeSource=EXIF:DateTimeOriginal')));
  assert.ok(first.includes(Buffer.from('QZoneUploadTime=2025-09-10T14:36:00+08:00')));
  assert.equal((await exifr.parse(first, { reviveValues: false })).DateTimeOriginal, '2025:06:07 12:34:57');
});
