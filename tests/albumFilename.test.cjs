const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('downloaded ZIP uses its album name and replaces illegal filename characters', async () => {
  const workers = [];
  const downloads = [];
  const elements = {};
  let title;
  const context = vm.createContext({
    document: {
      addEventListener() {},
      getElementById: (id) => elements[id] ||= { value: '', style: {} },
      createElement: () => ({ click() { downloads.push(this.download); } }),
      body: { appendChild() {}, removeChild() {} },
    },
    Worker: class {
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() {}
    },
    URL: { createObjectURL: () => 'blob:test' },
    setTimeout() {},
    console: { log() {} },
    fetch: async () => ({ text: async () => `callback(${JSON.stringify({ data: {
      topic: { name: title }, totalInAlbum: 1, photoList: [{ name: 'photo', url: 'image' }],
    } })})` }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/popup.js'), 'utf8'), context);
  const cases = [
    ['2012-08-05装修图片', '2012-08-05装修图片.zip'],
    ['旅行/北京\\上海', '旅行-北京-上海.zip'],
    ['a:b*c?d"e<f>g|h', 'a-b-c-d-e-f-g-h.zip'],
    ['', '相册.zip'],
    ['   ', '相册.zip'],
    ['CON', '-CON.zip'],
    ['照片. ', '照片-.zip'],
  ];
  for (const [albumTitle] of cases) {
    title = albumTitle;
    await context.downloadAlbumData('https://example.com/photos?pageStart=0');
  }
  // Finish after all titles have changed: each download must retain its own name.
  for (const worker of workers) {
    worker.onmessage({ data: { type: 'complete', data: { zipContent: {} } } });
  }
  assert.deepEqual(downloads, cases.map(([, filename]) => filename));
});
