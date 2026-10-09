import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// An invalid Fetch id is benign only when CDP confirms this exact network request
// was cancelled. Navigation/target-close timing alone is not sufficient evidence.
export function createInterceptionTracker(waitMs = 300) {
  const failures = new Map(), waiters = new Map();
  const cancelled = [], errors = [];
  function loadingFailed(params) {
    failures.set(params.requestId, params);
    if (failures.size > 512) failures.delete(failures.keys().next().value);
    waiters.get(params.requestId)?.forEach(resolve => resolve(params));
  }
  async function failed(error, context) {
    let failure = failures.get(context.networkId);
    if (error.code === -32602 && error.message === "Invalid InterceptionId." && context.networkId && !failure) {
      failure = await new Promise(resolve => {
        const listeners = waiters.get(context.networkId) ?? new Set();
        const done = value => { clearTimeout(timer); listeners.delete(done); if (!listeners.size) waiters.delete(context.networkId); resolve(value); };
        const timer = setTimeout(() => done(undefined), waitMs);
        listeners.add(done); waiters.set(context.networkId, listeners);
      });
    }
    const diagnostic = { ...context, code: error.code, message: error.message, loadingFailed: failure ?? null };
    if (error.code === -32602 && error.message === "Invalid InterceptionId." && failure?.canceled === true) {
      cancelled.push(diagnostic); return true;
    }
    errors.push(diagnostic); return false;
  }
  return { loadingFailed, failed, cancelled, errors };
}
export async function launchBrowser(base) {
  const binary = process.env.BROWSER ?? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
  if (!binary) throw new Error("Installed Edge/Chrome not found; set BROWSER to an existing executable.");
  const profile = mkdtempSync(join(tmpdir(), "m2-cdp-")), port = 9500 + Math.floor(Math.random() * 300);
  const browser = spawn(binary, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let ws, sequence = 0, pageTargetId;
  const pending = new Map(), events = new Map();
  const consoleErrors = [], exceptions = [], blocked = [];
  const interception = createInterceptionTracker(), interceptionTasks = new Set();
  try {
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const target = targets.find(target => target.type === "page");
        if (target) { pageTargetId = target.id; ws = new WebSocket(target.webSocketDebuggerUrl); }
      } catch { /* browser startup */ }
      if (!ws) await pause(100);
    }
    if (!ws) throw new Error("CDP browser startup timed out");
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const operation = pending.get(message.id); pending.delete(message.id); clearTimeout(operation.timer);
        message.error ? operation.reject(Object.assign(new Error(message.error.message), { code: message.error.code, method: operation.method })) : operation.resolve(message.result);
      } else if (message.method) events.get(message.method)?.(message.params);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    events.set("Runtime.consoleAPICalled", params => { if (params.type === "error") consoleErrors.push(params.args.map(argument => argument.value ?? argument.description).join(" ")); });
    events.set("Runtime.exceptionThrown", params => exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text));
    events.set("Network.loadingFailed", interception.loadingFailed);
    async function intercept(params) {
      try {
        const url = new URL(params.request.url);
        if (params.request.method !== "GET" && url.pathname.startsWith("/api/")) {
          blocked.push({ reason: "non-GET API", path: url.pathname });
          await send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
        } else if (url.origin === base) await send("Fetch.continueRequest", { requestId: params.requestId });
        else if (url.pathname.startsWith("/api/")) {
          // Even a build configured with an external API can only reach local fixtures.
          blocked.push({ reason: "external API redirected to fixture", path: url.pathname });
          await send("Fetch.continueRequest", { requestId: params.requestId, url: `${base}${url.pathname}${url.search}` });
        } else {
          blocked.push({ reason: "external network blocked", path: url.pathname });
          await send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
        }
      } catch (error) {
        const cancelled = await interception.failed(error, { targetId: pageTargetId, session: "page-websocket", requestId: params.requestId, networkId: params.networkId, frameId: params.frameId, url: params.request.url, method: error.method });
        if (!cancelled) exceptions.push(error.message);
      }
    }
    events.set("Fetch.requestPaused", params => {
      const task = intercept(params); interceptionTasks.add(task);
      void task.finally(() => interceptionTasks.delete(task));
    });
    async function settleInterceptions() {
      // Flush earlier page-session messages before inspecting diagnostic arrays.
      await send("Runtime.evaluate", { expression: "0" });
      while (interceptionTasks.size) await Promise.all([...interceptionTasks]);
    }
    await send("Page.enable"); await send("Page.bringToFront"); await send("Runtime.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    async function waitFor(expression, label, timeout = 12000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await evaluate(`Boolean(${expression})`)) return; await pause(70); }
      throw new Error(`Browser condition timed out: ${label}`);
    }
    const clickDiagnostics = [];
    async function click(selector) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const bounds = await evaluate(`(async () => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return {reason:'missing target'};
          el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
          await new Promise(requestAnimationFrame);
          const before = el.getBoundingClientRect();
          await new Promise(requestAnimationFrame);
          const r = el.getBoundingClientRect();
          if (document.querySelector(${JSON.stringify(selector)}) !== el || !el.isConnected) return {reason:'target replaced'};
          if (['x','y','width','height'].some(key=>Math.abs(before[key]-r[key])>0.5)) return {reason:'unstable bounds'};
          const left=Math.max(0,r.left), right=Math.min(innerWidth,r.right), top=Math.max(0,r.top), bottom=Math.min(innerHeight,r.bottom);
          if (right<=left || bottom<=top) return {reason:'target outside viewport'};
          const x=(left+right)/2, y=(top+bottom)/2, hit=document.elementFromPoint(x,y);
          if (!hit || !el.contains(hit)) return {reason:'point blocked',hit:hit?.tagName};
          return {x,y,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
        })()`);
        if (!bounds.reason) {
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: bounds.x, y: bounds.y });
          // Hover can change layout. Recheck the same point before pressing.
          const ready = await evaluate(`(() => {
            const el=document.querySelector(${JSON.stringify(selector)}), expected=${JSON.stringify(bounds)};
            if (!el) return false;
            const r=el.getBoundingClientRect(), hit=document.elementFromPoint(expected.x,expected.y);
            return ['x','y','width','height'].every(key=>Math.abs(r[key]-expected.rect[key])<=0.5) && !!hit && el.contains(hit);
          })()`);
          if (ready) {
            clickDiagnostics.push({ selector, attempt, x: bounds.x, y: bounds.y });
            await send("Input.dispatchMouseEvent", { type: "mousePressed", x: bounds.x, y: bounds.y, button: "left", clickCount: 1 });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bounds.x, y: bounds.y, button: "left", clickCount: 1 });
            return;
          }
          bounds.reason = "point or layout changed after hover";
        }
        clickDiagnostics.push({ selector, attempt, reason: bounds.reason });
        await pause(70);
      }
      throw new Error(`No stable visible mouse target: ${selector}`);
    }
    async function key(key, code = key) {
      const virtual = { Enter: 13, " ": 32, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 }[key];
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, ...(key === " " || key === "Enter" ? { text: key === "Enter" ? "\r" : " " } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
    }
    return { send, evaluate, waitFor, click, key, clickDiagnostics, consoleErrors, exceptions, blocked, settleInterceptions,
      cancelledInterceptions: interception.cancelled, interceptionErrors: interception.errors,
      async close() {
        ws.close(); browser.kill(); await pause(350);
        const root = resolve(tmpdir());
        if (!resolve(profile).startsWith(`${root}${sep}`)) throw new Error("Browser profile escaped temporary directory");
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } };
  } catch (error) { ws?.close(); browser.kill(); throw error; }
}
