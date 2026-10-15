import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkImportSetup, syncDownloadedMaterials } from '../src/sync.mjs';

test('未配置入库时保持只导出；配置检查不连接数据库', async t => {
  assert.equal(await syncDownloadedMaterials({}, {}), undefined);
  const dir = await mkdtemp(join(tmpdir(), 'oa-sync-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = join(dir, 'lab.env');
  const importer = join(dir, 'import.mjs');
  await writeFile(env, 'DATABASE_URL=postgres://example:example@127.0.0.1:1/example\n');
  await writeFile(importer, 'throw new Error("must not run during check");');
  await checkImportSetup({ labEnvFile: env }, importer);
  await assert.rejects(checkImportSetup({ labEnvFile: env }, join(dir, 'missing.mjs')), { code: 'IMPORT_SETUP_FAILED' });
});

test('导出后调用独立增量入口，仅保存计数；入库失败保留原下载文件并返回脱敏错误', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-sync-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const importer = join(dir, 'import.mjs');
  const file = join(dir, 'example.csv');
  await writeFile(file, 'example-content');
  const config = { outputDir: dir, labEnvFile: join(dir, 'lab.env') };
  await writeFile(importer, 'console.log(JSON.stringify({status:"success",total:3,inserted:1,updated:1,unchanged:1,unsafeField:"example-private-data"}));');
  assert.deepEqual(await syncDownloadedMaterials(config, { filename: 'example.csv' }, importer), { total: 3, inserted: 1, updated: 1, unchanged: 1 });
  await writeFile(importer, 'console.error("example-private-database-error");process.exitCode=1;');
  await assert.rejects(syncDownloadedMaterials(config, { filename: 'example.csv' }, importer), e => {
    assert.equal(e.code, 'IMPORT_FAILED');
    assert.doesNotMatch(e.message, /private/);
    return true;
  });
  assert.equal(await readFile(file, 'utf8'), 'example-content');
});
