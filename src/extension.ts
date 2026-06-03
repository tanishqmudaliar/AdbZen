import * as vscode from "vscode";
import { exec } from "child_process";

type AdbStatus = {
  installed: boolean;
  version: string | null;
  serverRunning: boolean;
  devices: number;
  error: string | null;
};

function run(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (err: Error | null, stdout: string, stderr: string) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function getAdbStatus(): Promise<AdbStatus> {
  const version = await run("adb version");

  if (!version.stdout && !version.stderr) {
    return {
      installed: false,
      version: null,
      serverRunning: false,
      devices: 0,
      error: "ADB not found in PATH",
    };
  }

  const versionLine = version.stdout.split("\n")[0] || "";
  const versionMatch = versionLine.match(/Version\s+([\d.]+)/i);
  const versionStr = versionMatch ? versionMatch[1] : versionLine;

  const devices = await run("adb devices");
  const lines = devices.stdout
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("List"));
  const deviceCount = lines.filter((l) => l.includes("\tdevice")).length;

  const mismatch =
    devices.stderr.includes("out of date") ||
    devices.stderr.includes("doesn't match");
  const errorMsg = mismatch ? "ADB server version mismatch detected" : null;

  return {
    installed: true,
    version: versionStr,
    serverRunning:
      !devices.stderr.includes("cannot connect") &&
      !devices.stderr.includes("refused"),
    devices: deviceCount,
    error: errorMsg,
  };
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new AdbZenViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("adbzen.mainView", provider),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adbzen.openPanel", () => {
      vscode.commands.executeCommand("workbench.view.extension.adbzen-sidebar");
    }),
  );
}

class AdbZenViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    // Send status on load
    await this._sendStatus();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "start":
          await run("adb start-server");
          break;
        case "kill":
          await run("adb kill-server");
          break;
        case "restart":
          await run("adb kill-server");
          await new Promise<void>((r) => globalThis.setTimeout(r, 800));
          await run("adb start-server");
          break;
        case "refresh":
          break;
      }
      await this._sendStatus();
    });
  }

  private async _sendStatus() {
    if (!this._view) {
      return;
    }
    const status = await getAdbStatus();
    this._view.webview.postMessage({ command: "status", data: status });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
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

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .header-left { display: flex; align-items: center; gap: 8px; }
  .title { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; opacity: 0.85; text-transform: uppercase; }

  .refresh-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-foreground);
    opacity: 0.45;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1;
    transition: opacity 0.15s;
  }
  .refresh-btn:hover { opacity: 0.9; }
  .refresh-btn.spinning { animation: spin 0.7s linear infinite; }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Status card ── */
  .card {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.green  { background: #4ec94e; box-shadow: 0 0 5px #4ec94e88; }
  .dot.red    { background: #f44747; box-shadow: 0 0 5px #f4474788; }
  .dot.amber  { background: #e5a220; box-shadow: 0 0 5px #e5a22088; }
  .dot.grey   { background: #666; }

  /* ── Meta rows ── */
  .meta { display: flex; flex-direction: column; gap: 5px; }

  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }
  .meta-label { opacity: 0.45; }
  .meta-value { opacity: 0.85; font-weight: 500; }
  .meta-value.ok    { color: #4ec94e; }
  .meta-value.warn  { color: #e5a220; }
  .meta-value.error { color: #f44747; }

  /* ── Error banner ── */
  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(244, 71, 71, 0.08);
    border: 1px solid rgba(244, 71, 71, 0.25);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: #f47878;
    margin-bottom: 10px;
    line-height: 1.5;
  }
  .error-banner .icon { flex-shrink: 0; margin-top: 1px; }

  /* ── Not installed banner ── */
  .warn-banner {
    background: rgba(229, 162, 32, 0.08);
    border: 1px solid rgba(229, 162, 32, 0.25);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 11px;
    color: #e5a220;
    line-height: 1.6;
    margin-bottom: 10px;
  }

  /* ── Actions ── */
  .section-label {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.35;
    margin-bottom: 7px;
  }

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
  .btn-neutral:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); }

  .btn-icon { font-size: 13px; }

  .divider {
    height: 1px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.07));
    margin: 10px 0;
  }

  /* ── Loading skeleton ── */
  .skeleton {
    height: 12px;
    border-radius: 4px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.07));
    animation: shimmer 1.4s infinite;
  }
  @keyframes shimmer {
    0%,100% { opacity: 0.4; }
    50%      { opacity: 0.9; }
  }

  .hidden { display: none !important; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <span class="title">AdbZen</span>
  </div>
  <button class="refresh-btn" id="refreshBtn" title="Refresh status">↻</button>
</div>

<!-- Loading state -->
<div id="loading">
  <div class="card">
    <div class="skeleton" style="width:60%;margin-bottom:10px"></div>
    <div class="skeleton" style="width:40%"></div>
  </div>
</div>

<!-- Main content (hidden until data arrives) -->
<div id="main" class="hidden">

  <!-- Error banner -->
  <div id="errorBanner" class="error-banner hidden">
    <span class="icon">⚠</span>
    <span id="errorText"></span>
  </div>

  <!-- Not installed -->
  <div id="notInstalled" class="warn-banner hidden">
    ADB not found in PATH. Install Android Platform Tools and ensure
    <code>adb</code> is accessible from your terminal.
  </div>

  <!-- Status card -->
  <div class="card" id="statusCard">
    <div class="status-row">
      <div class="status-pill">
        <div class="dot" id="statusDot"></div>
        <span id="statusText"></span>
      </div>
    </div>
    <div class="meta" id="metaBlock">
      <div class="meta-row">
        <span class="meta-label">ADB version</span>
        <span class="meta-value" id="metaVersion">—</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Server</span>
        <span class="meta-value" id="metaServer">—</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Devices</span>
        <span class="meta-value" id="metaDevices">—</span>
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div id="actionsBlock">
    <div class="section-label">Server control</div>
    <div class="actions">
      <button class="btn btn-primary" id="btnStart">
        <span class="btn-icon">▶</span> Start server
      </button>
      <button class="btn btn-neutral" id="btnRestart">
        <span class="btn-icon">↻</span> Restart server
      </button>
      <button class="btn btn-danger" id="btnKill">
        <span class="btn-icon">■</span> Kill server
      </button>
    </div>
  </div>

</div>

<script>
  const vscode = acquireVsCodeApi();

  const $ = id => document.getElementById(id);

  function send(command) {
    const btn = $('refreshBtn');
    btn.classList.add('spinning');
    vscode.postMessage({ command });
  }

  $('refreshBtn').addEventListener('click', () => send('refresh'));
  $('btnStart').addEventListener('click',   () => send('start'));
  $('btnKill').addEventListener('click',    () => send('kill'));
  $('btnRestart').addEventListener('click', () => send('restart'));

  window.addEventListener('message', ({ data }) => {
    if (data.command !== 'status') { return; }
    const s = data.data;

    $('loading').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('refreshBtn').classList.remove('spinning');

    // not installed
    $('notInstalled').classList.toggle('hidden', s.installed);
    $('statusCard').classList.toggle('hidden', !s.installed);
    $('actionsBlock').classList.toggle('hidden', !s.installed);

    if (!s.installed) {
      $('errorBanner').classList.add('hidden');
      return;
    }

    // error banner
    if (s.error) {
      $('errorBanner').classList.remove('hidden');
      $('errorText').textContent = s.error;
    } else {
      $('errorBanner').classList.add('hidden');
    }

    // dot + status text
    const dot  = $('statusDot');
    const text = $('statusText');
    dot.className = 'dot';

    if (s.error) {
      dot.classList.add('amber');
      text.textContent = 'Degraded';
    } else if (s.serverRunning) {
      dot.classList.add('green');
      text.textContent = 'Server running';
    } else {
      dot.classList.add('red');
      text.textContent = 'Server stopped';
    }

    // meta
    $('metaVersion').textContent = s.version ?? '—';
    $('metaVersion').className   = 'meta-value';

    const srv = $('metaServer');
    srv.textContent  = s.serverRunning ? 'Online' : 'Offline';
    srv.className    = 'meta-value ' + (s.serverRunning ? 'ok' : 'error');

    const dev = $('metaDevices');
    dev.textContent = s.devices === 0 ? 'None' : String(s.devices);
    dev.className   = 'meta-value ' + (s.devices > 0 ? 'ok' : '');

    // toggle start button — hide if already running
    $('btnStart').disabled    = s.serverRunning;
    $('btnKill').disabled     = !s.serverRunning;
    $('btnRestart').disabled  = false;
  });
</script>
</body>
</html>`;
  }
}

export function deactivate() {}
