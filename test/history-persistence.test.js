const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function browser(serverState, options = {}) {
  const data = new Map([['ai-image-tool.history.v1', JSON.stringify([{id:'stale'}])]]);
  const requests = [];
  const context = vm.createContext({
    document: {addEventListener() {}},
    location: {protocol:'http:'},
    localStorage: {
      getItem: key => data.get(key) || null,
      setItem(key, value) {
        if (options.blockAll || key === 'ai-image-tool.history.v1') {
          const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error;
        }
        data.set(key,value);
      }
    },
    fetch: async (url, request) => {
      const payload = JSON.parse(request.body);
      requests.push({url,payload});
      if (options.failSave && url === '/api/save-history-state') return {ok:false,json:async()=>({message:'Disk full'})};
      if (url === '/api/save-history-state') serverState.history = payload.history;
      return {ok:true,json:async()=>structuredClone(serverState)};
    },
    setTimeout,
  });
  vm.runInContext(source, context);
  return {context, requests, run:code=>vm.runInContext(code,context)};
}
test('reopening retains disk history when large image backup exceeds browser quota', async () => {
  const disk = {configs:[], presets:[], history:[{id:'latest',b64:'A'.repeat(7*1024*1024)}]};
  for (const blockAll of [false,true]) {
    const page = browser(disk,{blockAll});
    assert.equal((await page.run('loadState()')).source,'server');
    assert.equal(page.run('state.history[0].id'),'latest');
    assert.equal(page.run('state.history[0].b64.length'),7*1024*1024);
    assert.equal(page.requests.length,1);
  }
});
test('successful disk save stays successful despite failed browser backup and survives a new page', async () => {
  const disk = {configs:[],presets:[],history:[]};
  const first = browser(disk);
  first.run('state.history = [{id:"new-image", b64:"image-data"}]');
  await first.run('persistHistory()');
  const reopened = browser(disk);
  await reopened.run('loadState()');
  assert.equal(reopened.run('state.history[0].id'),'new-image');
});
test('failed history save is reported without losing generated images or claiming persistence', async () => {
  const page = browser({history:[]},{failSave:true});
  page.run('globalThis.notices = []; toast = message => notices.push(message)');
  assert.equal(await page.run('prependHistory([{id:"unsaved"}])'),false);
  assert.equal(page.run('state.history[0].id'),'unsaved');
  assert.match(page.run('notices[0]'),/Disk full/);
});
