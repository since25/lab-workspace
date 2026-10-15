import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export class ExportError extends Error {
  constructor(code, stage = 'config') {
    super(code);
    this.code = code;
    this.stage = stage;
  }
}

export async function loadConfig(envPath) {
  const file = resolve(envPath);
  let env;
  try { env = parseEnv(await readFile(file, 'utf8')); }
  catch { throw new ExportError('ENV_READ_FAILED'); }
  return parseConfig(env, dirname(file));
}

export function parseConfig(env, baseDir) {
  const required = (key, alias) => {
    const value = env[key] || (alias && env[alias]);
    if (!value?.trim()) throw new ExportError(`MISSING_${key}`);
    return value;
  };
  const json = (key, fallback) => {
    try { return JSON.parse(env[key] || fallback); }
    catch { throw new ExportError(`INVALID_${key}`); }
  };
  const frames = (value) => Array.isArray(value) && value.every(s => typeof s === 'string' && s.trim());
  const url = required('OA_URL', 'oa_url_materials');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch { throw new ExportError('INVALID_OA_URL'); }
  const steps = json('OA_NAVIGATION_STEPS', '[]');
  if (!Array.isArray(steps) || steps.some(s => !s || !['click', 'hover'].includes(s.action)
      || typeof s.selector !== 'string' || !s.selector.trim() || (s.frames && !frames(s.frames)))) {
    throw new ExportError('INVALID_OA_NAVIGATION_STEPS');
  }
  const exportFrames = json('OA_EXPORT_FRAMES', '[]');
  if (!frames(exportFrames)) throw new ExportError('INVALID_OA_EXPORT_FRAMES');
  const output = required('OA_OUTPUT_DIR');
  const timeoutMs = Number(env.OA_TIMEOUT_MS || 60000);
  const downloadTimeoutMs = Number(env.OA_DOWNLOAD_TIMEOUT_MS || 180000);
  if (![timeoutMs, downloadTimeoutMs].every(n => Number.isInteger(n) && n > 0 && n <= 300000)) {
    throw new ExportError('INVALID_TIMEOUT');
  }
  if (env.OA_BROWSER_CHANNEL && !['msedge', 'chrome'].includes(env.OA_BROWSER_CHANNEL)) {
    throw new ExportError('INVALID_OA_BROWSER_CHANNEL');
  }
  return {
    url, username: required('OA_USERNAME', 'user'), password: required('OA_PASSWORD', 'password'),
    userSelector: required('OA_USERNAME_SELECTOR'), passwordSelector: required('OA_PASSWORD_SELECTOR'),
    loginSelector: required('OA_LOGIN_SELECTOR'), successSelector: required('OA_LOGIN_SUCCESS_SELECTOR'),
    dismissSelector: env.OA_LOGIN_DISMISS_SELECTOR || '',
    steps, exportFrames, exportSelector: required('OA_EXPORT_SELECTOR'),
    outputDir: isAbsolute(output) ? output : resolve(baseDir, output),
    channel: env.OA_BROWSER_CHANNEL || undefined,
    executablePath: env.OA_BROWSER_EXECUTABLE || undefined,
    labEnvFile: env.OA_LAB_ENV_FILE ? resolve(baseDir, env.OA_LAB_ENV_FILE) : undefined,
    timeoutMs, downloadTimeoutMs,
  };
}
