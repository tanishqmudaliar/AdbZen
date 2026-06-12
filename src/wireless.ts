/**
 * wireless.ts — Wireless pairing tab for ADB Zen
 *
 * New dependencies (add to package.json before building):
 *   "bonjour-service": "^1.2.1",
 *   "qrcode": "^1.5.4"
 * Dev dependencies:
 *   "@types/qrcode": "^1.5.5"
 *
 * New view to register in package.json > contributes.views > adbzen-sidebar:
 *   { "id": "adbzen.wirelessView", "name": "Wireless Pairing" }
 *
 * In extension.ts add:
 *   import { WirelessViewProvider } from "./wireless.js";
 *   context.subscriptions.push(
 *     vscode.window.registerWebviewViewProvider("adbzen.wirelessView", new WirelessViewProvider())
 *   );
 */

import * as net from "net";
import * as vscode from "vscode";
import { run } from "./adb.js";
import Bonjour from "bonjour-service";
import type { Service } from "bonjour-service";
import * as QRCode from "qrcode";

// ─── Constants ────────────────────────────────────────────────────────────────

const MDNS_PAIRING_TYPE = "adb-tls-pairing";
const MDNS_CONNECT_TYPE = "adb-tls-connect";
const QR_SERVICE_NAME = "ADBZen";
const SCAN_TIMEOUT_MS = 30_000;

// ─── mDNS helper ─────────────────────────────────────────────────────────────

class MdnsScanner {
  private bonjour = new Bonjour();
  private timer?: NodeJS.Timeout;
  private browser?: ReturnType<typeof this.bonjour.find>;

  scan(
    type: string,
    onDevice: (ip: string, port: number) => void,
    onTimeout?: () => void,
  ) {
    this.browser = this.bonjour.find({ type }, (service: Service) => {
      const ip = service.addresses?.find((a) => net.isIP(a) === 4);
      if (ip) {
        this.stop();
        onDevice(ip, service.port);
      }
    });

    this.timer = setTimeout(() => {
      this.stop();
      onTimeout?.();
    }, SCAN_TIMEOUT_MS);
  }

  stop() {
    try {
      this.browser?.stop();
    } catch {
      /* ignore */
    }
    clearTimeout(this.timer);
    try {
      this.bonjour.destroy();
    } catch {
      /* ignore */
    }
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class WirelessViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _mdns?: MdnsScanner;
  private _logLines: Array<{ kind: string; text: string }> = [];

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWirelessHtml();
    this._sendLogHistory();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "generateQr":
          await this._startQrFlow();
          break;
        case "cancelQr":
          this._stopMdns();
          this._post("status", { mode: "idle" });
          break;
        case "pairCode":
          await this._pairWithCode(msg.ip, msg.port, msg.code);
          break;
        case "connect":
          await this._adbConnect(msg.ip, msg.port);
          break;
        case "disconnect":
          await this._adbDisconnect(msg.ip, msg.port);
          break;
        case "clearLog":
          this._logLines = [];
          this._sendLogHistory();
          break;
      }
    });

    webviewView.onDidDispose(() => this._stopMdns());
  }

  // ── private helpers ──

  private _stopMdns() {
    this._mdns?.stop();
    this._mdns = undefined;
  }

  private _log(kind: string, text: string) {
    const entry = { kind, text };
    this._logLines.push(entry);
    if (this._logLines.length > 200) {
      this._logLines.shift();
    }
    this._view?.webview.postMessage({ command: "log", data: entry });
  }

  private _sendLogHistory() {
    this._view?.webview.postMessage({
      command: "logHistory",
      data: this._logLines,
    });
  }

  private _post(command: string, data: unknown) {
    this._view?.webview.postMessage({ command, data });
  }

  // ── QR flow ──

  private async _startQrFlow() {
    this._stopMdns();

    const password = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    const payload = `WIFI:T:ADB;S:${QR_SERVICE_NAME};P:${password};;`;

    let dataUrl: string;
    try {
      dataUrl = await QRCode.toDataURL(payload, { width: 196, margin: 2 });
    } catch (err) {
      this._log("error", `QR generation failed: ${String(err)}`);
      this._post("status", {
        mode: "error",
        message: "QR generation failed — is the qrcode package installed?",
      });
      return;
    }

    this._post("status", { mode: "qr-waiting", qrDataUrl: dataUrl });
    this._log(
      "output",
      "QR ready. On phone: Wireless Debugging → Pair device with QR code → scan this code",
    );

    this._mdns = new MdnsScanner();
    this._mdns.scan(
      MDNS_PAIRING_TYPE,
      async (ip, port) => {
        this._post("status", { mode: "pairing" });
        this._log("command", `> adb pair ${ip}:${port} ${password}`);

        const r = await run(`adb pair ${ip}:${port} ${password}`);
        if (r.stdout) {
          this._log("output", r.stdout);
        }
        if (r.stderr) {
          this._log("error", r.stderr);
        }

        const ok = (r.stdout + r.stderr)
          .toLowerCase()
          .includes("successfully paired");
        if (!ok) {
          this._post("status", {
            mode: "error",
            message: r.stderr || r.stdout || "Pairing failed",
          });
          return;
        }

        this._post("status", { mode: "connecting" });
        this._log("output", "Paired! Scanning for debug port advertisement…");
        this._autoConnect(ip);
      },
      () => {
        this._post("status", {
          mode: "error",
          message:
            "Timeout — phone did not respond within 30 s. Ensure phone and PC are on the same Wi-Fi.",
        });
        this._log("error", "mDNS timeout: no pairing advertisement received");
      },
    );
  }

  private _autoConnect(pairedIp: string) {
    const connectScan = new MdnsScanner();
    connectScan.scan(
      MDNS_CONNECT_TYPE,
      async (ip, port) => {
        const target = ip || pairedIp;
        this._log("command", `> adb connect ${target}:${port}`);
        const r = await run(`adb connect ${target}:${port}`);
        if (r.stdout) {
          this._log("output", r.stdout);
        }
        if (r.stderr) {
          this._log("error", r.stderr);
        }

        const ok = r.stdout.toLowerCase().includes("connected");
        this._post(
          "status",
          ok
            ? { mode: "connected", ip: target, port: String(port) }
            : { mode: "error", message: r.stdout || r.stderr },
        );
      },
      () => {
        this._post("status", {
          mode: "paired-no-connect",
          message:
            "Paired! Auto-connect timed out — use the Connect tab with the debug port shown on your phone.",
        });
        this._log(
          "output",
          "Pairing done. mDNS connect scan timed out — connect manually via Connect tab.",
        );
      },
    );
  }

  // ── Code pair flow ──

  private async _pairWithCode(ip: string, port: string, code: string) {
    if (!ip || !port || !code) {
      this._post("status", {
        mode: "error",
        message: "Fill in all three fields",
      });
      return;
    }
    this._post("status", { mode: "pairing" });
    this._log("command", `> adb pair ${ip}:${port} ${code}`);

    const r = await run(`adb pair ${ip}:${port} ${code}`);
    if (r.stdout) {
      this._log("output", r.stdout);
    }
    if (r.stderr) {
      this._log("error", r.stderr);
    }

    const ok = (r.stdout + r.stderr)
      .toLowerCase()
      .includes("successfully paired");
    this._post(
      "status",
      ok
        ? { mode: "pair-success" }
        : {
            mode: "error",
            message:
              r.stderr ||
              r.stdout ||
              "Pairing failed — double-check IP, port, and code",
          },
    );
  }

  // ── Connect / disconnect ──

  private async _adbConnect(ip: string, port: string) {
    if (!ip || !port) {
      this._post("status", {
        mode: "error",
        message: "Enter IP address and debug port",
      });
      return;
    }
    this._log("command", `> adb connect ${ip}:${port}`);
    const r = await run(`adb connect ${ip}:${port}`);
    if (r.stdout) {
      this._log("output", r.stdout);
    }
    if (r.stderr) {
      this._log("error", r.stderr);
    }

    const ok = r.stdout.toLowerCase().includes("connected");
    this._post(
      "status",
      ok
        ? { mode: "connected", ip, port }
        : { mode: "error", message: r.stdout || r.stderr },
    );
  }

  private async _adbDisconnect(ip: string, port: string) {
    const target = ip && port ? `${ip}:${port}` : "";
    const cmd = target ? `adb disconnect ${target}` : "adb disconnect";
    this._log("command", `> ${cmd}`);
    const r = await run(cmd);
    if (r.stdout) {
      this._log("output", r.stdout);
    }
    if (r.stderr) {
      this._log("error", r.stderr);
    }
    this._post("status", { mode: "idle" });
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

export function getWirelessHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 12px;
  }

  .hidden { display: none !important; }

  /* ── tabs ── */
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    padding-bottom: 8px;
  }
  .tab-btn {
    flex: 1;
    padding: 5px 4px;
    border-radius: 6px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    background: none;
    color: var(--vscode-foreground);
    opacity: 0.5;
    transition: opacity 0.15s, background 0.15s;
    text-align: center;
  }
  .tab-btn:hover { opacity: 0.8; background: rgba(255,255,255,0.05); }
  .tab-btn.active {
    opacity: 1;
    background: rgba(255,255,255,0.07);
    border-color: var(--vscode-widget-border, rgba(255,255,255,0.12));
  }

  /* ── cards ── */
  .card {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }

  .section-label {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.35;
    margin-bottom: 6px;
  }

  .hint {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.65;
  }

  .port-explainer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
  }
  .port-box {
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 10px;
    line-height: 1.5;
  }
  .port-box.debug {
    background: rgba(78, 201, 78, 0.08);
    border: 1px solid rgba(78, 201, 78, 0.2);
  }
  .port-box.pair {
    background: rgba(229, 162, 32, 0.08);
    border: 1px solid rgba(229, 162, 32, 0.2);
  }
  .port-box-label {
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 9px;
    margin-bottom: 2px;
  }
  .port-box.debug .port-box-label { color: #4ec94e; }
  .port-box.pair  .port-box-label { color: #e5a220; }

  /* ── fields ── */
  .field-group { margin-bottom: 9px; }
  .field-label {
    display: block;
    font-size: 11px;
    opacity: 0.55;
    margin-bottom: 4px;
  }
  .field-row { display: flex; gap: 6px; }
  .field-row .input { flex: 1; min-width: 0; }
  .input {
    width: 100%;
    padding: 6px 9px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-input-background, rgba(255,255,255,0.06));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.12));
    color: var(--vscode-foreground);
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  .input::placeholder { opacity: 0.4; }
  .input.code-input {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-align: center;
  }

  /* ── buttons ── */
  .actions { display: flex; flex-direction: column; gap: 6px; }
  .btn {
    width: 100%;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: opacity 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }
  .btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .btn-primary {
    background: #4ec94e22;
    border-color: #4ec94e55;
    color: #4ec94e;
  }
  .btn-primary:hover:not(:disabled) { background: #4ec94e33; }
  .btn-danger {
    background: rgba(244,71,71,0.08);
    border-color: rgba(244,71,71,0.3);
    color: #f47878;
  }
  .btn-danger:hover:not(:disabled) { background: rgba(244,71,71,0.15); }
  .btn-neutral {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05));
    border-color: var(--vscode-widget-border, rgba(255,255,255,0.1));
    color: var(--vscode-foreground);
  }
  .btn-neutral:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
  }

  /* ── QR area ── */
  .qr-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px 0 4px;
  }
  .qr-wrap img {
    border-radius: 8px;
    border: 2px solid rgba(255,255,255,0.1);
    display: block;
    max-width: 180px;
  }
  .qr-hint {
    font-size: 11px;
    text-align: center;
    opacity: 0.6;
    line-height: 1.5;
  }

  /* ── status banners ── */
  .status-banner {
    border-radius: 7px;
    padding: 9px 11px;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 10px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .status-banner.ok {
    background: rgba(78, 201, 78, 0.08);
    border: 1px solid rgba(78, 201, 78, 0.25);
    color: #4ec94e;
  }
  .status-banner.warn {
    background: rgba(229, 162, 32, 0.08);
    border: 1px solid rgba(229, 162, 32, 0.25);
    color: #e5a220;
  }
  .status-banner.error {
    background: rgba(244, 71, 71, 0.08);
    border: 1px solid rgba(244, 71, 71, 0.25);
    color: #f47878;
  }

  .spinner {
    display: inline-block;
    width: 11px; height: 11px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
    margin-top: 1px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── terminal ── */
  .terminal-panel {
    margin-top: 10px;
    border-radius: 8px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    background: rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .terminal-actions { display: flex; align-items: center; gap: 8px; }
  .clear-log-btn {
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05));
    color: var(--vscode-foreground);
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .clear-log-btn:hover { background: rgba(255,255,255,0.1); }
  .terminal-body {
    height: calc(6 * 1.5em + 16px);
    overflow: auto;
    padding: 8px 10px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .terminal-line.command { color: var(--vscode-foreground); }
  .terminal-line.output  { color: rgba(255,255,255,0.8); }
  .terminal-line.error   { color: #f47878; }
  .terminal-line { margin-bottom: 3px; }
</style>
</head>
<body>

<!-- Tab bar -->
<div class="tabs">
  <button class="tab-btn active" data-tab="qr">⬛ QR Pair</button>
  <button class="tab-btn"        data-tab="code">🔢 Code Pair</button>
  <button class="tab-btn"        data-tab="connect">⚡ Connect</button>
</div>

<!-- ══════════ QR PAIR tab ══════════ -->
<div id="tab-qr" class="tab-panel">

  <div class="card">
    <div class="section-label">On your phone</div>
    <div class="hint">Settings → Developer Options → Wireless Debugging →<br><strong>Pair device with QR code</strong></div>
  </div>

  <div class="card">
    <!-- idle state -->
    <div id="qr-idle">
      <button class="btn btn-primary" id="btnGenerateQr">Generate QR Code</button>
    </div>

    <!-- QR displayed, waiting for phone to scan -->
    <div id="qr-active" class="hidden">
      <div class="qr-wrap">
        <img id="qrImage" src="" alt="QR Code" />
        <div class="qr-hint">Point your phone camera at this code</div>
      </div>
      <button class="btn btn-neutral" id="btnCancelQr" style="margin-top:8px">Cancel</button>
    </div>
  </div>

  <!-- status for QR tab -->
  <div id="qr-status-area"></div>

</div>

<!-- ══════════ CODE PAIR tab ══════════ -->
<div id="tab-code" class="tab-panel hidden">

  <div class="card">
    <div class="section-label">Two-port explainer</div>
    <div class="hint">Wireless Debugging shows two different ports for two different jobs:</div>
    <div class="port-explainer">
      <div class="port-box debug">
        <div class="port-box-label">Debug port</div>
        Main screen "IP address and port"<br>e.g. <code>:46019</code><br>Use with <strong>Connect</strong> tab every session.
      </div>
      <div class="port-box pair">
        <div class="port-box-label">Pairing port</div>
        "Pair with pairing code" screen<br>e.g. <code>:37291</code><br>Temporary. Use <strong>once</strong> with the 6-digit code.
      </div>
    </div>
  </div>

  <div class="card">
    <div class="section-label">On your phone: Wireless Debugging → Pair device with pairing code</div>

    <div class="field-group" style="margin-top:8px">
      <label class="field-label">IP Address</label>
      <input class="input" id="pairIp" type="text" placeholder="192.168.x.x" />
    </div>

    <div class="field-group">
      <label class="field-label">Pairing Port <span style="opacity:0.4">(the temporary port from the pairing screen)</span></label>
      <input class="input" id="pairPort" type="number" placeholder="e.g. 37291" />
    </div>

    <div class="field-group">
      <label class="field-label">6-digit Pairing Code</label>
      <input class="input code-input" id="pairCode" type="text" placeholder="000000" maxlength="6" inputmode="numeric" />
    </div>

    <button class="btn btn-primary" id="btnPair">Pair Device</button>
  </div>

  <!-- status for Code tab -->
  <div id="code-status-area"></div>

</div>

<!-- ══════════ CONNECT tab ══════════ -->
<div id="tab-connect" class="tab-panel hidden">

  <div class="card">
    <div class="section-label">Connect (after pairing)</div>
    <div class="hint">Enter the IP and <strong>debug port</strong> shown on the main Wireless Debugging screen — not the pairing port.</div>
  </div>

  <div class="card">
    <div class="field-group">
      <label class="field-label">IP Address</label>
      <input class="input" id="connectIp" type="text" placeholder="192.168.x.x" />
    </div>

    <div class="field-group">
      <label class="field-label">Debug Port <span style="opacity:0.4">(from "IP address and port" on phone)</span></label>
      <input class="input" id="connectPort" type="number" placeholder="e.g. 46019" />
    </div>

    <div class="actions">
      <button class="btn btn-primary"  id="btnConnect">Connect</button>
      <button class="btn btn-danger"   id="btnDisconnect">Disconnect</button>
    </div>

    <div style="margin-top:8px">
      <label class="field-label">Or disconnect a specific device</label>
      <div class="field-row">
        <input class="input" id="disconnectTarget" type="text" placeholder="192.168.x.x:port (blank = all)" />
      </div>
    </div>
  </div>

  <!-- status for Connect tab -->
  <div id="connect-status-area"></div>

</div>

<!-- ══════════ Terminal log ══════════ -->
<div class="terminal-panel">
  <div class="terminal-header">
    <span>Command log</span>
    <div class="terminal-actions">
      <span id="terminalCount">0 lines</span>
      <button class="clear-log-btn" id="clearLogBtn">Clear</button>
    </div>
  </div>
  <div class="terminal-body" id="terminalBody"></div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);

  // ── tab switching ──────────────────────────────────────────────────────────
  let activeTab = 'qr';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      $('tab-' + tab).classList.remove('hidden');
      activeTab = tab;
      // clear the status area of the newly shown tab so stale banners don't linger
      setStatus(tab, null);
    });
  });

  // ── status helpers ─────────────────────────────────────────────────────────
  function makeBanner(tone, icon, text) {
    const d = document.createElement('div');
    d.className = 'status-banner ' + tone;
    d.innerHTML = icon + ' <span>' + escapeHtml(text) + '</span>';
    return d;
  }

  function makeSpinnerBanner(text) {
    const d = document.createElement('div');
    d.className = 'status-banner warn';
    d.innerHTML = '<span class="spinner"></span> <span>' + escapeHtml(text) + '</span>';
    return d;
  }

  function setStatus(tab, node) {
    const area = $(tab + '-status-area');
    if (!area) return;
    area.innerHTML = '';
    if (node) area.appendChild(node);
  }

  // ── incoming messages ──────────────────────────────────────────────────────
  window.addEventListener('message', ({ data }) => {
    if (data.command === 'logHistory') {
      terminalEntries.splice(0, terminalEntries.length, ...data.data);
      renderTerminal();
      return;
    }
    if (data.command === 'log') {
      terminalEntries.push(data.data);
      if (terminalEntries.length > 200) terminalEntries.shift();
      renderTerminal();
      return;
    }
    if (data.command !== 'status') return;

    const s = data.data;

    switch (s.mode) {
      case 'idle':
        setStatus('qr', null);
        setStatus('code', null);
        setStatus('connect', null);
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        $('btnPair').disabled = false;
        $('btnConnect').disabled = false;
        break;

      case 'qr-waiting':
        $('qr-idle').classList.add('hidden');
        $('qr-active').classList.remove('hidden');
        $('qrImage').src = s.qrDataUrl;
        setStatus('qr', makeSpinnerBanner('Waiting for phone to scan…'));
        break;

      case 'pairing':
        setStatus(activeTab, makeSpinnerBanner('Pairing…'));
        $('btnPair').disabled = true;
        break;

      case 'connecting':
        setStatus('qr', makeSpinnerBanner('Paired! Connecting…'));
        break;

      case 'connected':
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        setStatus(activeTab, makeBanner('ok', '✓', 'Connected to ' + s.ip + ':' + s.port));
        $('btnPair').disabled = false;
        $('btnConnect').disabled = false;
        // Pre-fill Connect tab fields
        if (s.ip) { $('connectIp').value = s.ip; }
        if (s.port) { $('connectPort').value = s.port; }
        break;

      case 'pair-success':
        setStatus('code', makeBanner('ok', '✓', 'Paired! Switch to the Connect tab and enter the debug port to connect.'));
        $('btnPair').disabled = false;
        break;

      case 'paired-no-connect':
        setStatus('qr', makeBanner('warn', '!', s.message));
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        break;

      case 'error':
        setStatus(activeTab, makeBanner('error', '✕', s.message || 'An error occurred'));
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        $('btnPair').disabled = false;
        $('btnConnect').disabled = false;
        break;
    }
  });

  // ── button handlers ────────────────────────────────────────────────────────
  $('btnGenerateQr').addEventListener('click', () => {
    vscode.postMessage({ command: 'generateQr' });
  });

  $('btnCancelQr').addEventListener('click', () => {
    vscode.postMessage({ command: 'cancelQr' });
    $('qr-idle').classList.remove('hidden');
    $('qr-active').classList.add('hidden');
    setStatus('qr', null);
  });

  $('btnPair').addEventListener('click', () => {
    vscode.postMessage({
      command: 'pairCode',
      ip:   $('pairIp').value.trim(),
      port: $('pairPort').value.trim(),
      code: $('pairCode').value.trim(),
    });
  });

  $('btnConnect').addEventListener('click', () => {
    vscode.postMessage({
      command: 'connect',
      ip:   $('connectIp').value.trim(),
      port: $('connectPort').value.trim(),
    });
  });

  $('btnDisconnect').addEventListener('click', () => {
    const raw = $('disconnectTarget').value.trim();
    const ip   = raw.includes(':') ? raw.split(':')[0] : ($('connectIp').value.trim() || raw);
    const port = raw.includes(':') ? raw.split(':')[1] : $('connectPort').value.trim();
    vscode.postMessage({ command: 'disconnect', ip, port });
  });

  $('clearLogBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'clearLog' });
  });

  // Allow Enter key to trigger pair/connect
  ['pairIp', 'pairPort', 'pairCode'].forEach(id =>
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') $('btnPair').click(); })
  );
  ['connectIp', 'connectPort'].forEach(id =>
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') $('btnConnect').click(); })
  );

  // ── terminal ───────────────────────────────────────────────────────────────
  const terminalEntries = [];

  function escapeHtml(t) {
    return String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  function renderTerminal() {
    const body = $('terminalBody');
    body.innerHTML = terminalEntries
      .map(({ kind, text }) => '<div class="terminal-line ' + kind + '">' + escapeHtml(text) + '</div>')
      .join('');
    $('terminalCount').textContent = terminalEntries.length + ' line' + (terminalEntries.length === 1 ? '' : 's');
    body.scrollTop = body.scrollHeight;
  }
</script>
</body>
</html>`;
}
