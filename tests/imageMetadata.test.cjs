const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const JSZip = require('../src/jszip.min.js');
const exifr = require('../src/vendor/exifr-7.1.3.umd.js');
const source = fs.readFileSync(path.join(__dirname, '../src/photoDownloader.js'), 'utf8');
const fixture = (ext) => fs.readFileSync(path.join(__dirname, `fixtures/photo.${ext}`));

function workerContext(extra = {}) {
  const context = vm.createContext({ importScripts() {}, JSZip, exifr, TextEncoder, Uint8Array, self: {}, ...extra });
  vm.runInContext(source, context);
  return context;
}

for (const ext of ['jpg', 'png']) {
  test(`${ext}: embeds each upload time while preserving original image bytes and metadata`, () => {
    const context = workerContext();
    const original = fixture(ext);
    for (const time of ['2012-08-06 10:37:00', '2022-02-25 18:06:01']) {
      const date = context.getUploadDate(time);
      const result = context.embedUploadTime(original, date);
      assert.equal(result.extension, ext);
      assert.equal(result.embedded, true);
      const bytes = Buffer.from(result.bytes);
      const timestamp = time.replace(' ', 'T') + '+08:00';
      assert.ok(bytes.includes(Buffer.from(timestamp)), 'upload time is inside image');
      assert.ok(bytes.includes(Buffer.from('QZoneUploadTime')));
      // Removing only the inserted metadata must reconstruct the original file exactly.
      if (ext === 'jpg') {
        const offset = bytes.indexOf(Buffer.from([0xff, 0xfe]));
        const end = offset + 2 + bytes.readUInt16BE(offset + 2);
        assert.deepEqual(Buffer.concat([bytes.subarray(0, offset), bytes.subarray(end)]), original);
      } else {
        const type = bytes.indexOf(Buffer.from('iTXt'));
        const offset = type - 4;
        const end = offset + 12 + bytes.readUInt32BE(offset);
        assert.deepEqual(Buffer.concat([bytes.subarray(0, offset), bytes.subarray(end)]), original);
      }
    }
    assert.deepEqual(Buffer.from(context.embedUploadTime(original, null).bytes), original);
  });
}

test('unsupported format stays intact and upload time is preserved in a named sidecar', async () => {
  const original = fixture('webp');
  const messages = [];
  const worker = workerContext({
    fetch: async () => ({ arrayBuffer: async () => original }),
    self: { postMessage: (message) => messages.push(message) },
  });
  await worker.self.onmessage({ data: [{ name: '照片', url: 'test', uploadtime: '2012-08-06 10:37:00' }] });
  const complete = messages.find((message) => message.type === 'complete');
  const zip = await JSZip.loadAsync(await complete.data.zipContent.arrayBuffer());
  assert.deepEqual(await zip.file('0001_照片.webp').async('nodebuffer'), original);
  const metadata = JSON.parse(await zip.file('0001_照片.webp.metadata.json').async('string'));
  assert.equal(metadata.QZoneUploadTime, '2012-08-06T10:37:00+08:00');
  assert.equal(complete.data.metadataSummary.sidecar, 1);
});
