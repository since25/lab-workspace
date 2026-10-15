import { chromium } from 'playwright-core';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExportError } from './config.mjs';

function scope(page, frames = []) {
  return frames.reduce((parent, selector) => parent.frameLocator(selector), page);
}

export async function validateDownload(file, extension) {
  const size = (await stat(file)).size;
  if (!size) throw new ExportError('EMPTY_DOWNLOAD', 'validate');
  if (!['.xls', '.xlsx', '.csv'].includes(extension)) throw new ExportError('UNSUPPORTED_DOWNLOAD', 'validate');
  const handle = await open(file, 'r');
  let head;
  try {
    const buffer = Buffer.alloc(Math.min(size, 8192));
    await handle.read(buffer, 0, buffer.length, 0);
    head = buffer;
  } finally { await handle.close(); }
  const text = head.toString('utf8');
  if (/<(?:!doctype\s+html|html|form)\b/i.test(text)
      && !(/<table\b/i.test(text) && extension === '.xls' && !/type\s*=\s*["']?password/i.test(text))) {
    throw new ExportError('HTML_INSTEAD_OF_EXPORT', 'validate');
  }
  if (extension === '.xlsx' && (head.length < 2 || head.readUInt16BE(0) !== 0x504b)) {
    throw new ExportError('INVALID_XLSX', 'validate');
  }
  return size;
}

// 每次启动独立的临时浏览器和 context，不读写 storageState / cookie / 固定用户目录。
export async function exportMaterials(config) {
  let browser;
  let context;
  let partial;
  let stage = 'browser';
  try {
    browser = await chromium.launch({headless: true, channel: config.channel, executablePath: config.executablePath});
    // OA 报表会拒绝 HeadlessChrome 标识；使用同版本的普通 Chrome 标识。
    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7';
    context = await browser.newContext({
      acceptDownloads: true, viewport: {width: 1600, height: 1000},
      userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.timeoutMs);
    stage = 'login';
    await page.goto(config.url, {waitUntil: 'load'});
    await page.locator(config.userSelector).fill(config.username);
    await page.locator(config.passwordSelector).fill(config.password);
    await page.locator(config.loginSelector).click();
    await page.locator(config.successSelector).waitFor({state: 'visible'});
    if (config.dismissSelector && await page.locator(config.dismissSelector).isVisible()) {
      await page.locator(config.dismissSelector).click();
    }
    stage = 'navigate';
    for (const step of config.steps) {
      await scope(page, step.frames).locator(step.selector)[step.action]();
    }
    stage = 'download';
    // 先监听下载再点击，避免快下载发生在监听之前。单次运行不重试登录或导出。
    const [download] = await Promise.all([
      page.waitForEvent('download', {timeout: config.downloadTimeoutMs}),
      scope(page, config.exportFrames).locator(config.exportSelector).click(),
    ]);
    if (await download.failure()) throw new ExportError('DOWNLOAD_FAILED', stage);
    const extension = extname(download.suggestedFilename()).toLowerCase();
    const filename = `materials-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}${extension}`;
    await mkdir(config.outputDir, {recursive: true, mode: 0o700});
    partial = join(config.outputDir, `${filename}.partial`);
    await download.saveAs(partial);
    stage = 'validate';
    const bytes = await validateDownload(partial, extension);
    const file = join(config.outputDir, filename);
    await rename(partial, file);
    partial = undefined;
    return {filename, bytes};
  } catch (error) {
    // Playwright 原始异常可能包含账号、地址或页面内容，不向日志传播。
    if (error instanceof ExportError) throw error;
    throw new ExportError(error?.name === 'TimeoutError' ? 'TIMEOUT' : 'EXPORT_FAILED', stage);
  } finally {
    if (partial) await rm(partial, {force: true}).catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
