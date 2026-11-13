const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('large legacy gallery migrates, uploads persist across restart, and oversized JSON returns 413', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'image-history-test-'));
  const storage = path.join(temporary, 'AIImageTool');
  const toolRoot = path.join(temporary, 'tool');
  fs.mkdirSync(toolRoot);
  for (const name of ['server.js', 'bailian-models.js']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(toolRoot, name));
  }
  fs.mkdirSync(storage);
  const original = Buffer.alloc(25 * 1024 * 1024, 65);
  fs.writeFileSync(path.join(storage, 'history.json'), JSON.stringify({history:[{id:'old',b64:original.toString('base64')}]}));
  let child;
  async function start() {
    child = spawn(process.execPath, [path.join(toolRoot, 'server.js')], {
      cwd: temporary,
      env: {...process.env, APPDATA:temporary, PORT:'0'},
      stdio:['ignore','pipe','pipe']
    });
    return await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  try {
    let base = await start();
    const post = (route, payload) => fetch(base + route, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    let state = await (await post('/api/load-state', {})).json();
    assert.equal(state.history[0].b64, '');
    assert.deepEqual(Buffer.from(await (await fetch(base + state.history[0].url)).arrayBuffer()), original);
    assert.ok(fs.readdirSync(storage).some(name => name.endsWith('.bak')));
    assert.ok(fs.statSync(path.join(storage, 'history.json')).size < 1024);
    assert.ok(fs.existsSync(path.join(toolRoot, 'data', 'images', path.basename(state.history[0].url))));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
    const saved = await (await fetch(base + '/api/store-history-image', {method:'POST',body:png})).json();
    const duplicate = await (await fetch(base + '/api/store-history-image', {method:'POST',body:png})).json();
    assert.equal(saved.url, duplicate.url);
    state.history.unshift({id:'new',url:saved.url,b64:''});
    assert.equal((await post('/api/save-history-state', {history:state.history})).status, 200);
    const oversized = await post('/api/save-history-state', {history:[{b64:'A'.repeat(33*1024*1024)}]});
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'payload_too_large');
    await stop();
    // Emulate the previous release's image location before restarting.
    const name = path.basename(saved.url);
    fs.mkdirSync(path.join(storage, 'images'));
    fs.renameSync(path.join(toolRoot, 'data', 'images', name), path.join(storage, 'images', name));
    base = await start();
    assert.deepEqual(fs.readFileSync(path.join(toolRoot, 'data', 'images', name)), png);
    assert.deepEqual(fs.readFileSync(path.join(storage, 'images', name)), png);
    state = await (await post('/api/load-state', {})).json();
    assert.equal(state.history.length, 2);
    const response = await fetch(base + state.history[0].url);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal((await fetch(base + '/history-images/settings.json')).status, 404);
  } finally {
    await stop();
    fs.rmSync(temporary, {recursive:true,force:true});
  }
});
