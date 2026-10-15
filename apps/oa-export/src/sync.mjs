import { execFile } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { promisify, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ExportError } from './config.mjs';

const IMPORTER = fileURLToPath(new URL('../import-materials.mjs', import.meta.url));

export async function checkImportSetup(config, importer = IMPORTER) {
  if (!config.labEnvFile) return;
  try {
    const env = parseEnv(await readFile(config.labEnvFile, 'utf8'));
    if (!env.DATABASE_URL) throw new Error();
    await access(importer);
  } catch { throw new ExportError('IMPORT_SETUP_FAILED', 'import'); }
}

export async function syncDownloadedMaterials(config, result, importer = IMPORTER) {
  if (!config.labEnvFile) return undefined;
  try {
    const { stdout } = await promisify(execFile)(process.execPath,
      [importer, '--env', config.labEnvFile, '--file', join(config.outputDir, result.filename)],
      { timeout: 120000, maxBuffer: 65536, windowsHide: true });
    const report = JSON.parse(stdout.trim());
    if (report.status !== 'success' || !['total', 'inserted', 'updated', 'unchanged'].every(k => Number.isSafeInteger(report[k]) && report[k] >= 0)) throw new Error();
    // 只保留计数，不将子进程的任意输出转存到运行日志。
    return Object.fromEntries(['total', 'inserted', 'updated', 'unchanged'].map(k => [k, report[k]]));
  } catch { throw new ExportError('IMPORT_FAILED', 'import'); }
}
