const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const JSZip = require('../src/jszip.min.js');
const exifr = require('../src/vendor/exifr-7.1.3.umd.js');

const source = fs.readFileSync(
  path.join(__dirname, '../src/photoDownloader.js'),
  'utf8'
);

for (const [label, names] of [
  ['233 photos with the same name', Array(233).fill('2022-02-25')],
  ['mixed names and path characters', ['旅行', '旅行', '0001_旅行', 'a/b', 'a\\b', '', null]],
]) {
  test(`ZIP preserves every photo: ${label}`, async () => {
    const messages = [];
    const context = vm.createContext({
      importScripts() {},
      JSZip, exifr, TextEncoder, Uint8Array,
      // Simulate image downloads with distinct bytes; use the real ZIP library.
      fetch: async (url) => ({ arrayBuffer: async () => Buffer.from(url) }),
      self: { postMessage: (message) => messages.push(message) },
    });
    vm.runInContext(source, context);
    const photos = names.map((name, index) => ({ name, url: `image-${index}` }));
    await context.self.onmessage({ data: photos });

    const complete = messages.find((message) => message.type === 'complete');
    assert.ok(complete, 'worker must produce a ZIP');
    const zip = await JSZip.loadAsync(await complete.data.zipContent.arrayBuffer());
    const files = Object.values(zip.files);
    assert.equal(files.length, photos.length, 'no overwritten photos or extra folders');
    assert.ok(files.every((file) => !file.dir && !/[\\/]/.test(file.name)));
    for (const [index, file] of files.entries()) {
      assert.equal(await file.async('string'), photos[index].url, 'photo bytes and order preserved');
    }
    assert.equal(messages.filter((message) => message.type === 'progress').length, photos.length);
    assert.equal(messages.at(-2).data, 100);
  });
}

test('album API upload times reach the ZIP with the displayed China time', async () => {
  const timestamp = Date.parse('2012-08-06T10:37:00+08:00');
  const photos = [
    { name: '截图中的照片', url: 'image-1', uploadtime: '2012-08-06 10:37:00' },
    { name: '秒时间戳', url: 'image-2', uploadtime: timestamp / 1000 },
    { name: '毫秒时间戳', url: 'image-3', uploadtime: String(timestamp) },
    { name: '另一张照片的独立日期', url: 'image-different', uploadtime: '2022-02-25 18:06:00' },
    { name: '接口详情日期优先', url: 'image-api-time', shootTime: '2025-06-07', uploadtime: '2025-09-10 14:36:00' },
    { name: '无上传时间', url: 'image-4' },
    { name: '非法日期', url: 'image-5', uploadtime: '2012-02-30 10:37:00' },
  ];
  const elements = {};
  const popup = vm.createContext({
    document: {
      addEventListener() {},
      getElementById: (id) => elements[id] ||= { value: '', style: {} },
    },
    console: { log() {} },
    fetch: async () => ({ text: async () => `callback(${JSON.stringify({
      data: { topic: { name: '测试相册' }, totalInAlbum: photos.length, photoList: photos },
    })})` }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/popup.js'), 'utf8'), popup);
  let workerPhotos;
  popup.downloadPhotos = (list) => { workerPhotos = list; };
  await popup.downloadAlbumData('https://example.com/photos?pageStart=0');

  const messages = [];
  const worker = vm.createContext({
    importScripts() {}, JSZip, exifr, TextEncoder, Uint8Array,
    fetch: async () => ({ arrayBuffer: async () => fs.readFileSync(path.join(__dirname, 'fixtures/no-time.jpg')) }),
    self: { postMessage: (message) => messages.push(message) },
  });
  vm.runInContext(source, worker);
  const before = Date.now();
  await worker.self.onmessage({ data: workerPhotos });
  const complete = messages.find((message) => message.type === 'complete');
  const zip = await JSZip.loadAsync(await complete.data.zipContent.arrayBuffer());
  const files = Object.values(zip.files);
  const expectedDates = [
    '2012-08-06T10:37:00.000Z',
    '2012-08-06T10:37:00.000Z',
    '2012-08-06T10:37:00.000Z',
    '2022-02-25T18:06:00.000Z',
  ];
  for (const [index, expectedDate] of expectedDates.entries()) {
    // DOS ZIP dates are wall-clock values; JSZip reads/writes their components as UTC.
    assert.equal(files[index].date.toISOString(), expectedDate, 'each photo keeps its own upload time');
    assert.ok((await files[index].async('nodebuffer')).includes(
      Buffer.from('QZoneUploadTime=' + expectedDate.slice(0, 19) + '+08:00')
    ), 'the same per-photo time is also embedded inside the JPEG');
  }
  assert.equal(files[4].date.toISOString(), '2025-06-07T00:00:00.000Z');
  assert.ok((await files[4].async('nodebuffer')).includes(Buffer.from('QZonePhotoTime=2025-06-07')));
  assert.ok((await files[4].async('nodebuffer')).includes(Buffer.from('QZoneUploadTime=2025-09-10T14:36:00+08:00')));
  for (const file of files.slice(5)) {
    assert.ok(file.date.getTime() >= before - 2000, 'missing/invalid dates use ZIP default');
  }
  assert.equal(complete.data.metadataSummary.embedded, 5);
  assert.equal(complete.data.metadataSummary.originalTime, 1);
  assert.equal(complete.data.metadataSummary.uploadTime, 4);
  assert.equal(complete.data.metadataSummary.missing, 2);
});
