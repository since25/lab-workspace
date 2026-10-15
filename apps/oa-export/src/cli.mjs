import { appendFile, mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ExportError, loadConfig } from './config.mjs';
import { exportMaterials } from './export.mjs';
import { checkImportSetup, syncDownloadedMaterials } from './sync.mjs';

let config;
let lock;
let lockPath;
try {
  const args = process.argv.slice(2);
  if (!args[0] || !['--env'].includes(args[0]) || !args[1]
      || args.slice(2).some(a => a !== '--check') || args.length > 3) {
    throw new ExportError('USAGE_node_src_cli.mjs_--env_PATH_[--check]');
  }
  config = await loadConfig(args[1]);
  await checkImportSetup(config);
  if (args.includes('--check')) {
    console.log(JSON.stringify({status: 'config_valid'}));
  } else {
    await mkdir(config.outputDir, {recursive: true, mode: 0o700});
    lockPath = join(config.outputDir, '.run.lock');
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw new ExportError('RUN_LOCKED', 'startup'); }
    const result = await exportMaterials(config);
    const imported = await syncDownloadedMaterials(config, result);
    const entry = {at: new Date().toISOString(), status: 'success', ...result, ...(imported && {imported})};
    await appendFile(join(config.outputDir, 'runs.jsonl'), JSON.stringify(entry) + '\n', {mode: 0o600});
    console.log(JSON.stringify(entry));
  }
} catch (error) {
  const entry = {at: new Date().toISOString(), status: 'failed',
    code: error instanceof ExportError ? error.code : 'IO_FAILED',
    stage: error instanceof ExportError ? error.stage : 'local_io'};
  if (config && lock) {
    await appendFile(join(config.outputDir, 'runs.jsonl'), JSON.stringify(entry) + '\n', {mode: 0o600}).catch(() => {});
  }
  console.error(JSON.stringify(entry));
  process.exitCode = 1;
} finally {
  if (lock) {
    await lock.close();
    await rm(lockPath, {force: true});
  }
}
