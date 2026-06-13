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

  // ── private helpers ──────────────────────────────────────────────────────

  private _stopMdns() {
    this._mdns?.stop();
    this._mdns = undefined;
  }

  private _log(kind: string, text: string) {
    this._logLines.push({ kind, text });
    if (this._logLines.length > 200) {
      this._logLines.shift();
    }
    this._view?.webview.postMessage({ command: "log", data: { kind, text } });
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

  /** Run a command, log it, return result. */
  private async _exec(cmd: string) {
    this._log("command", `> ${cmd}`);
    const r = await run(cmd);
    if (r.stdout) {
      this._log("output", r.stdout);
    }
    if (r.stderr) {
      this._log("error", r.stderr);
    }
    return r;
  }

  // ── QR flow ──────────────────────────────────────────────────────────────

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
        const r = await this._exec(`adb pair ${ip}:${port} ${password}`);
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
    const scan = new MdnsScanner();
    scan.scan(
      MDNS_CONNECT_TYPE,
      async (ip, port) => {
        const target = ip || pairedIp;
        const r = await this._exec(`adb connect ${target}:${port}`);
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

  // ── Code pair flow ────────────────────────────────────────────────────────

  private async _pairWithCode(ip: string, port: string, code: string) {
    if (!ip || !port || !code) {
      this._post("status", {
        mode: "error",
        message: "Fill in all three fields",
      });
      return;
    }
    this._post("status", { mode: "pairing" });
    const r = await this._exec(`adb pair ${ip}:${port} ${code}`);
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

  // ── Connect / disconnect ──────────────────────────────────────────────────

  private async _adbConnect(ip: string, port: string) {
    if (!ip || !port) {
      this._post("status", {
        mode: "error",
        message: "Enter IP address and debug port",
      });
      return;
    }
    const r = await this._exec(`adb connect ${ip}:${port}`);
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
    await this._exec(cmd);
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

  /* ── Tabs ── */
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

  /* ── Cards ── */
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

  /* ── Steps card ── */
  .steps-card {
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 11px 13px;
    margin-bottom: 10px;
    background: rgba(255,255,255,0.02);
  }
  .steps {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .steps li {
    display: flex;
    gap: 8px;
    font-size: 11px;
    line-height: 1.55;
    align-items: flex-start;
  }
  .step-num {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.14);
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
    opacity: 0.7;
  }
  .steps li strong { font-weight: 600; }

  .port-note {
    margin-top: 10px;
    font-size: 10px;
    padding: 7px 9px;
    border-radius: 5px;
    background: rgba(229, 162, 32, 0.07);
    border: 1px solid rgba(229, 162, 32, 0.2);
    color: #e5a220;
    line-height: 1.55;
  }
  .port-note strong { font-weight: 600; }

  /* ── Fields ── */
  .field-group { margin-bottom: 9px; }
  .field-group:last-of-type { margin-bottom: 0; }
  .field-label {
    display: block;
    font-size: 10px;
    opacity: 0.5;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
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
  .input::placeholder { opacity: 0.35; }
  .code-input {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-align: center;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* ── Buttons ── */
  .actions { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
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
  .btn-primary  { background: #4ec94e22; border-color: #4ec94e55; color: #4ec94e; }
  .btn-primary:hover:not(:disabled)  { background: #4ec94e33; }
  .btn-danger   { background: rgba(244,71,71,0.08); border-color: rgba(244,71,71,0.3); color: #f47878; }
  .btn-danger:hover:not(:disabled)   { background: rgba(244,71,71,0.15); }
  .btn-neutral  { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: var(--vscode-foreground); }
  .btn-neutral:hover:not(:disabled)  { background: rgba(255,255,255,0.1); }

  /* ── QR ── */
  .qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 4px 0; }
  .qr-wrap img { border-radius: 8px; border: 2px solid rgba(255,255,255,0.1); max-width: 180px; display: block; }
  .qr-hint { font-size: 11px; text-align: center; opacity: 0.6; line-height: 1.5; }

  /* ── Status banners ── */
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
  .status-banner.ok    { background: rgba(78,201,78,0.08);   border: 1px solid rgba(78,201,78,0.25);   color: #4ec94e; }
  .status-banner.warn  { background: rgba(229,162,32,0.08);  border: 1px solid rgba(229,162,32,0.25);  color: #e5a220; }
  .status-banner.error { background: rgba(244,71,71,0.08);   border: 1px solid rgba(244,71,71,0.25);   color: #f47878; }

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

  /* ── Recent connections ── */
  .history-section { margin-bottom: 10px; }
  .history-label {
    font-size: 10px;
    opacity: 0.38;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .history-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .history-chip {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-foreground);
    cursor: pointer;
    transition: background 0.12s;
  }
  .history-chip:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); }

  /* ── Disconnect confirmation modal ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 16px;
  }
  .modal {
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.18));
    border-radius: 10px;
    padding: 16px;
    width: 100%;
    max-width: 260px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .modal-icon { font-size: 20px; text-align: center; margin-bottom: 8px; }
  .modal-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; text-align: center; }
  .modal-body  { font-size: 11px; line-height: 1.55; opacity: 0.75; margin-bottom: 14px; text-align: center; }
  .modal-body code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
  .modal-actions { display: flex; gap: 8px; }
  .modal-actions .btn { flex: 1; padding: 6px 10px; font-size: 11px; }

  /* ── Terminal ── */
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
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
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
  .terminal-line { margin-bottom: 3px; }
  .terminal-line.command { color: var(--vscode-foreground); }
  .terminal-line.output  { color: rgba(255,255,255,0.8); }
  .terminal-line.error   { color: #f47878; }
</style>
</head>
<body>

<!-- ══════════ Disconnect Confirmation Modal ══════════ -->
<div id="disconnect-modal" class="modal-overlay hidden">
  <div class="modal">
    <div class="modal-icon">⚡</div>
    <div class="modal-title">Disconnect device?</div>
    <div class="modal-body" id="modal-body-text">This will end the ADB session.</div>
    <div class="modal-actions">
      <button class="btn btn-neutral" id="cancelDisconnect">Cancel</button>
      <button class="btn btn-danger"  id="confirmDisconnect">Disconnect</button>
    </div>
  </div>
</div>

<!-- Tab bar -->
<div class="tabs">
  <button class="tab-btn active" data-tab="qr">⬛ QR Pair</button>
  <button class="tab-btn"        data-tab="code">🔢 Code Pair</button>
  <button class="tab-btn"        data-tab="connect">⚡ Connect</button>
</div>

<!-- ══════════ QR PAIR TAB ══════════ -->
<div id="tab-qr" class="tab-panel">

  <div class="steps-card">
    <div class="section-label">How to pair with QR</div>
    <ol class="steps">
      <li><span class="step-num">1</span><span>Enable <strong>Developer Options</strong> on your phone if you haven't already</span></li>
      <li><span class="step-num">2</span><span>Open <strong>Settings → Developer Options → Wireless Debugging</strong></span></li>
      <li><span class="step-num">3</span><span>Tap <strong>"Pair device with QR code"</strong></span></li>
      <li><span class="step-num">4</span><span>Click <strong>Generate QR Code</strong> below and point your phone camera at it</span></li>
      <li><span class="step-num">5</span><span>AdbZen will automatically pair and connect — no extra steps needed</span></li>
    </ol>
  </div>

  <div class="card">
    <div id="qr-idle">
      <button class="btn btn-primary" id="btnGenerateQr">Generate QR Code</button>
    </div>
    <div id="qr-active" class="hidden">
      <div class="qr-wrap">
        <img id="qrImage" src="" alt="QR Code" />
        <div class="qr-hint">Point your phone camera at this code.<br>Keep this window open until pairing completes.</div>
      </div>
      <button class="btn btn-neutral" id="btnCancelQr" style="margin-top:8px">Cancel</button>
    </div>
  </div>

  <div id="qr-status-area"></div>

</div>

<!-- ══════════ CODE PAIR TAB ══════════ -->
<div id="tab-code" class="tab-panel hidden">

  <div class="steps-card">
    <div class="section-label">How to pair with a code</div>
    <ol class="steps">
      <li><span class="step-num">1</span><span>Open <strong>Settings → Developer Options → Wireless Debugging</strong></span></li>
      <li><span class="step-num">2</span><span>Tap <strong>"Pair device with pairing code"</strong></span></li>
      <li><span class="step-num">3</span><span>Note the <strong>pairing port</strong> (e.g. <code style="font-family:monospace;font-size:10px;background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px">:37291</code>) and <strong>6-digit code</strong> shown on this sub-screen</span></li>
      <li><span class="step-num">4</span><span>Enter them below and tap <strong>Pair Device</strong></span></li>
      <li><span class="step-num">5</span><span>After success, go to the <strong>Connect tab</strong> to complete the connection</span></li>
    </ol>
    <div class="port-note">
      ⚠ The <strong>pairing port</strong> is a <em>one-time temporary port</em> from the "Pair device" sub-screen — it's different from the debug port on the main Wireless Debugging screen.
    </div>
  </div>

  <div class="card">
    <div class="field-group">
      <label class="field-label">IP Address</label>
      <input class="input" id="pairIp" type="text" placeholder="192.168.x.x" autocomplete="off" />
    </div>
    <div class="field-group">
      <label class="field-label">Pairing Port <span style="opacity:0.4;font-size:9px;text-transform:none;letter-spacing:0">(from the "Pair device" sub-screen)</span></label>
      <input class="input" id="pairPort" type="number" placeholder="e.g. 37291" />
    </div>
    <div class="field-group">
      <label class="field-label">6-digit Pairing Code</label>
      <input class="input code-input" id="pairCode" type="text" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="btnPair">Pair Device</button>
    </div>
  </div>

  <div id="code-status-area"></div>

</div>

<!-- ══════════ CONNECT TAB ══════════ -->
<div id="tab-connect" class="tab-panel hidden">

  <div class="steps-card">
    <div class="section-label">How to connect</div>
    <ol class="steps">
      <li><span class="step-num">1</span><span>Pair your device first using the <strong>QR</strong> or <strong>Code Pair</strong> tab (once per device, survives reboots)</span></li>
      <li><span class="step-num">2</span><span>Open <strong>Wireless Debugging</strong> on your phone</span></li>
      <li><span class="step-num">3</span><span>Use the <strong>IP address and port</strong> shown on the <em>main</em> Wireless Debugging screen</span></li>
      <li><span class="step-num">4</span><span>Tap <strong>Connect</strong> — the debug port changes every session</span></li>
    </ol>
    <div class="port-note">
      The <strong>debug port</strong> (e.g. <code style="font-family:monospace;font-size:10px;background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px">:46019</code>) is on the <strong>main Wireless Debugging screen</strong>, not the "Pair device" sub-screen.
    </div>
  </div>

  <div class="card">
    <div class="field-group">
      <label class="field-label">IP Address</label>
      <input class="input" id="connectIp" type="text" placeholder="192.168.x.x" autocomplete="off" />
    </div>
    <div class="field-group">
      <label class="field-label">Debug Port <span style="opacity:0.4;font-size:9px;text-transform:none;letter-spacing:0">(from "IP address and port" on main screen)</span></label>
      <input class="input" id="connectPort" type="number" placeholder="e.g. 46019" />
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="btnConnect">Connect</button>
      <button class="btn btn-danger"  id="btnDisconnect">Disconnect This Device</button>
      <button class="btn btn-neutral" id="btnDisconnectAll">Disconnect All Wireless</button>
    </div>
  </div>

  <div id="historySection" class="history-section hidden">
    <div class="history-label">Recent connections — click to fill</div>
    <div class="history-chips" id="historyList"></div>
  </div>

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

  // ── Tab switching ────────────────────────────────────────────────────────
  let activeTab = 'qr';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      $('tab-' + tab).classList.remove('hidden');
      activeTab = tab;
      clearStatus(tab);
    });
  });

  // ── Status banner helpers ────────────────────────────────────────────────
  function escapeHtml(t) {
    return String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  }

  function makeBanner(tone, icon, text) {
    const d = document.createElement('div');
    d.className = 'status-banner ' + tone;
    d.innerHTML = '<span>' + icon + '</span><span>' + escapeHtml(text) + '</span>';
    return d;
  }

  function makeSpinnerBanner(text) {
    const d = document.createElement('div');
    d.className = 'status-banner warn';
    d.innerHTML = '<span class="spinner"></span><span>' + escapeHtml(text) + '</span>';
    return d;
  }

  function setStatus(tab, node) {
    const area = $(tab + '-status-area');
    if (!area) { return; }
    area.innerHTML = '';
    if (node) { area.appendChild(node); }
  }

  function clearStatus(tab) { setStatus(tab, null); }

  // ── Recent connections history ───────────────────────────────────────────
  const recentConns = [];
  const MAX_HISTORY = 5;

  function addToHistory(ip, port) {
    if (!ip || !port) { return; }
    const idx = recentConns.findIndex(r => r.ip === ip && r.port === port);
    if (idx !== -1) { recentConns.splice(idx, 1); }
    recentConns.unshift({ ip, port });
    if (recentConns.length > MAX_HISTORY) { recentConns.pop(); }
    renderHistory();
  }

  function renderHistory() {
    const section = $('historySection');
    const list    = $('historyList');
    if (!recentConns.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    list.innerHTML = recentConns
      .map(r => '<button class="history-chip" data-ip="' + escapeHtml(r.ip) + '" data-port="' + escapeHtml(r.port) + '">' + escapeHtml(r.ip) + ':' + escapeHtml(r.port) + '</button>')
      .join('');
    list.querySelectorAll('.history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $('connectIp').value   = chip.dataset.ip;
        $('connectPort').value = chip.dataset.port;
        clearStatus('connect');
      });
    });
  }

  // ── Disconnect confirmation modal ────────────────────────────────────────
  let pendingDisconnect = null;

  function showDisconnectModal(ip, port, labelText) {
    pendingDisconnect = { ip, port };
    const body = ip && port
      ? 'Disconnect <code>' + escapeHtml(ip + ':' + port) + '</code> from ADB?'
      : 'Disconnect <strong>all</strong> wireless ADB devices?';
    $('modal-body-text').innerHTML = body;
    $('disconnect-modal').classList.remove('hidden');
  }

  $('cancelDisconnect').addEventListener('click', () => {
    $('disconnect-modal').classList.add('hidden');
    pendingDisconnect = null;
  });

  $('confirmDisconnect').addEventListener('click', () => {
    if (!pendingDisconnect) { return; }
    $('disconnect-modal').classList.add('hidden');
    vscode.postMessage({ command: 'disconnect', ip: pendingDisconnect.ip, port: pendingDisconnect.port });
    pendingDisconnect = null;
  });

  // Close modal on backdrop click
  $('disconnect-modal').addEventListener('click', (e) => {
    if (e.target === $('disconnect-modal')) {
      $('disconnect-modal').classList.add('hidden');
      pendingDisconnect = null;
    }
  });

  // ── Incoming messages ────────────────────────────────────────────────────
  window.addEventListener('message', ({ data }) => {
    if (data.command === 'logHistory') {
      terminalEntries.splice(0, terminalEntries.length, ...data.data);
      renderTerminal();
      return;
    }
    if (data.command === 'log') {
      terminalEntries.push(data.data);
      if (terminalEntries.length > 200) { terminalEntries.shift(); }
      renderTerminal();
      return;
    }
    if (data.command !== 'status') { return; }

    const s = data.data;

    switch (s.mode) {
      case 'idle':
        setStatus('qr', null);
        setStatus('code', null);
        setStatus('connect', null);
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        $('btnPair').disabled    = false;
        $('btnConnect').disabled = false;
        break;

      case 'qr-waiting':
        $('qr-idle').classList.add('hidden');
        $('qr-active').classList.remove('hidden');
        $('qrImage').src = s.qrDataUrl;
        setStatus('qr', makeSpinnerBanner('Waiting for phone to scan the QR code…'));
        break;

      case 'pairing':
        setStatus(activeTab, makeSpinnerBanner('Pairing with device…'));
        $('btnPair').disabled = true;
        break;

      case 'connecting':
        setStatus('qr', makeSpinnerBanner('Paired! Looking for debug port advertisement…'));
        break;

      case 'connected':
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        setStatus(activeTab, makeBanner('ok', '✓', 'Connected to ' + s.ip + ':' + s.port));
        $('btnPair').disabled    = false;
        $('btnConnect').disabled = false;
        if (s.ip)   { $('connectIp').value   = s.ip; }
        if (s.port) { $('connectPort').value  = s.port; }
        addToHistory(s.ip, s.port);
        break;

      case 'pair-success':
        setStatus('code', makeBanner('ok', '✓', 'Paired! Switch to the Connect tab, enter the debug port from the main Wireless Debugging screen, and tap Connect.'));
        $('btnPair').disabled = false;
        break;

      case 'paired-no-connect':
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        setStatus('qr', makeBanner('warn', '!', s.message));
        break;

      case 'error':
        $('qr-idle').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
        setStatus(activeTab, makeBanner('error', '✕', s.message || 'An error occurred'));
        $('btnPair').disabled    = false;
        $('btnConnect').disabled = false;
        break;
    }
  });

  // ── Button handlers ──────────────────────────────────────────────────────
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
    const ip   = $('connectIp').value.trim();
    const port = $('connectPort').value.trim();
    if (!ip || !port) {
      setStatus('connect', makeBanner('error', '✕', 'Enter an IP and port to disconnect a specific device, or use "Disconnect All Wireless"'));
      return;
    }
    showDisconnectModal(ip, port);
  });

  $('btnDisconnectAll').addEventListener('click', () => {
    showDisconnectModal('', '');
  });

  $('clearLogBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'clearLog' });
  });

  // Enter key shortcuts
  ['pairIp', 'pairPort', 'pairCode'].forEach(id =>
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { $('btnPair').click(); } })
  );
  ['connectIp', 'connectPort'].forEach(id =>
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { $('btnConnect').click(); } })
  );

  // ── Terminal ─────────────────────────────────────────────────────────────
  const terminalEntries = [];

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
