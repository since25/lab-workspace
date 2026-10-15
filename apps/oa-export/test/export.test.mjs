import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseConfig } from '../src/config.mjs';
import { exportMaterials, validateDownload } from '../src/export.mjs';

function env(url) {
  return {
    oa_url_materials: url, user: 'example-user', password: 'example-password',
    OA_USERNAME_SELECTOR: '#user', OA_PASSWORD_SELECTOR: '#password', OA_LOGIN_SELECTOR: '#login',
    OA_LOGIN_SUCCESS_SELECTOR: '#menu', OA_LOGIN_DISMISS_SELECTOR: '#dismiss',
    OA_NAVIGATION_STEPS: JSON.stringify([{action: 'hover', selector: '#menu'}, {action: 'click', selector: '#materials'}]),
    OA_EXPORT_FRAMES: '["#report", "#data"]', OA_EXPORT_SELECTOR: '#export',
    OA_OUTPUT_DIR: 'output', OA_TIMEOUT_MS: '2000', OA_DOWNLOAD_TIMEOUT_MS: '2000',
  };
}

async function fixture(t, downloadBody = 'code,name\nEXAMPLE-1,example\n') {
  const dir = await mkdtemp(join(tmpdir(), 'oa-export-test-'));
  const state = {logins: 0, downloads: 0, carriedCookies: 0, agent: ''};
  const sessions = new Set();
  const server = createServer(async (req, res) => {
    const loggedIn = sessions.has(req.headers.cookie);
    const html = (body) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(body); };
    if (req.url === '/login' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      if (form.get('user') === 'example-user' && form.get('password') === 'example-password') {
        state.logins++;
        const cookie = `session=example-${state.logins}`;
        sessions.add(cookie);
        res.writeHead(303, {'Set-Cookie': cookie, Location: '/home'}).end();
      } else html('<p>Login failed</p>');
    } else if (req.url === '/' || req.url === '/login') {
      if (req.headers.cookie) state.carriedCookies++;
      html('<form method="post" action="/login"><input id="user" name="user"><input id="password" name="password" type="password"><button id="login">Login</button></form>');
    } else if (!loggedIn) {
      res.writeHead(303, {Location: '/login'}).end();
    } else if (req.url === '/home') {
      html('<button id="dismiss" onclick="this.remove()">Dismiss</button><div id="menu">Menu</div><a id="materials" href="/materials">Materials</a>');
    } else if (req.url === '/materials') {
      html('<iframe id="report" src="/report"></iframe>');
    } else if (req.url === '/report') {
      html('<iframe id="data" src="/data"></iframe>');
    } else if (req.url === '/data') {
      html('<a id="export" href="/download">Export</a>');
    } else if (req.url === '/download') {
      state.downloads++;
      state.agent = req.headers['user-agent'];
      sessions.delete(req.headers.cookie);
      res.writeHead(200, {'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="example.csv"'});
      res.end(downloadBody);
    } else { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive: true, force: true});
  });
  const configEnv = env(`http://127.0.0.1:${server.address().port}/`);
  return {dir, state, configEnv, config: parseConfig(configEnv, dir)};
}

test('每次从网页重新登录，经过两层 iframe 下载，业务文件使用独立名称', async t => {
  const f = await fixture(t);
  const first = await exportMaterials(f.config);
  const second = await exportMaterials(f.config);
  assert.equal(f.state.logins, 2);
  assert.equal(f.state.downloads, 2);
  assert.equal(f.state.carriedCookies, 0);
  assert.doesNotMatch(f.state.agent, /HeadlessChrome/);
  assert.notEqual(first.filename, second.filename);
  assert.equal(await readFile(join(f.config.outputDir, first.filename), 'utf8'), 'code,name\nEXAMPLE-1,example\n');
  assert.equal((await readdir(f.config.outputDir)).length, 2);
});

test('登录失败时停止，不点击导出，不暴露凭证', async t => {
  const f = await fixture(t);
  await assert.rejects(exportMaterials({...f.config, password: 'wrong-example-password'}), e => {
    assert.equal(e.stage, 'login');
    assert.equal(e.code, 'TIMEOUT');
    assert.doesNotMatch(e.message, /password|127\.0\.0\.1/i);
    return true;
  });
  assert.equal(f.state.downloads, 0);
});

test('空下载不会落为正式文件，也不改变上次的文件', async t => {
  const f = await fixture(t, '');
  const {mkdir} = await import('node:fs/promises');
  await mkdir(f.config.outputDir);
  await writeFile(join(f.config.outputDir, 'previous.csv'), 'previous');
  await assert.rejects(exportMaterials(f.config), {code: 'EMPTY_DOWNLOAD'});
  assert.deepEqual(await readdir(f.config.outputDir), ['previous.csv']);
});

test('拒绝伪装成表格的登录页、空文件和错误扩展名；允许传统 HTML 表格 xls', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-file-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'download');
  await writeFile(file, '<html><form><input type="password"></form></html>');
  await assert.rejects(validateDownload(file, '.xlsx'), {code: 'HTML_INSTEAD_OF_EXPORT'});
  await writeFile(file, '<html><table><tr><td>example</td></tr></table></html>');
  assert.ok(await validateDownload(file, '.xls'));
  await assert.rejects(validateDownload(file, '.html'), {code: 'UNSUPPORTED_DOWNLOAD'});
  await writeFile(file, 'x');
  await assert.rejects(validateDownload(file, '.xlsx'), {code: 'INVALID_XLSX'});
  await writeFile(file, '');
  await assert.rejects(validateDownload(file, '.csv'), {code: 'EMPTY_DOWNLOAD'});
});

test('配置支持已有 env 键，拒绝错误定位配置；检查配置不会登录或下载', async t => {
  const f = await fixture(t);
  assert.equal(f.config.username, 'example-user');
  assert.throws(() => parseConfig({...f.configEnv, OA_NAVIGATION_STEPS: '[{"action":"eval"}]'}, f.dir), {code: 'INVALID_OA_NAVIGATION_STEPS'});
  assert.throws(() => parseConfig({...f.configEnv, OA_URL: 'file:///example'}, f.dir), {code: 'INVALID_OA_URL'});
  assert.throws(() => parseConfig({...f.configEnv, OA_EXPORT_FRAMES: 'null'}, f.dir), {code: 'INVALID_OA_EXPORT_FRAMES'});
  const file = join(f.dir, '.env');
  await writeFile(file, Object.entries(f.configEnv).map(([k,v]) => `${k}='${v}'`).join('\n'));
  const result = await promisify(execFile)(process.execPath, ['src/cli.mjs', '--env', file, '--check']);
  assert.equal(JSON.parse(result.stdout).status, 'config_valid');
  assert.equal(f.state.logins, 0);
});

test('已有运行锁时不登录，退出码非零且保留已有锁', async t => {
  const f = await fixture(t);
  const {mkdir} = await import('node:fs/promises');
  await mkdir(f.config.outputDir);
  await writeFile(join(f.config.outputDir, '.run.lock'), 'existing');
  const file = join(f.dir, '.env');
  await writeFile(file, Object.entries(f.configEnv).map(([k,v]) => `${k}='${v}'`).join('\n'));
  await assert.rejects(promisify(execFile)(process.execPath, ['src/cli.mjs', '--env', file]), e => {
    assert.equal(e.code, 1);
    assert.equal(JSON.parse(e.stderr).code, 'RUN_LOCKED');
    return true;
  });
  assert.equal(f.state.logins, 0);
  assert.equal(await readFile(join(f.config.outputDir, '.run.lock'), 'utf8'), 'existing');
});
