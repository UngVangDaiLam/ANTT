/**
 * Điều khiển Chrome thật (headless) qua DevTools Protocol, chỉ dùng Node và Chrome đã cài: không cần
 * thư viện nào (D83). Dùng chung cho ui-check.mjs và login-bench.mjs.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('Không tìm thấy Chrome. Đặt biến CHROME_PATH.');
  return found;
}

/**
 * Mở Chrome headless với một profile tạm, trả về các hàm điều khiển trang.
 * @returns {Promise<{
 *   send: (method: string, params?: object) => Promise<any>,
 *   js: (expression: string) => Promise<any>,
 *   waitFor: (expression: string, what: string, ms?: number) => Promise<void>,
 *   consoleErrors: string[],
 *   close: () => Promise<void>,
 * }>}
 */
export async function launchPage() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'secure-notes-cdp-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      // Bản triển khai trên localhost dùng chứng chỉ do Caddy tự ký.
      '--ignore-certificate-errors',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      // Chrome chưa sẵn sàng, thử lại.
    }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('Không kết nối được Chrome.');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let lastId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(d.exception?.description ?? d.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, (msg) =>
        msg.error
          ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
          : resolve(msg.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function js(expression) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async function waitFor(expression, what, ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(expression).catch(() => false)) return;
      await sleep(20);
    }
    throw new Error(`hết giờ chờ: ${what}`);
  }

  async function close() {
    ws.close();
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  return { send, js, waitFor, consoleErrors, close };
}
