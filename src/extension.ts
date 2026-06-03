import * as vscode from "vscode";
import { exec } from "child_process";

type AdbStatus = {
  installed: boolean;
  version: string | null;
  serverRunning: boolean;
  devices: number;
  error: string | null;
  operation: string | null;
};

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

function run(cmd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(
      cmd,
      (
        err: (Error & { code?: number | null }) | null,
        stdout: string,
        stderr: string,
      ) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: err?.code ?? 0,
        });
      },
    );
  });
}

async function isAdbServerListening(): Promise<boolean> {
  const probe = await run(
    'powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5037 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1) { \"LISTENING\" }"',
  );

  return probe.stdout.includes("LISTENING");
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
      operation: null,
    };
  }

  const versionLine = version.stdout.split("\n")[0] || "";
  const versionMatch = versionLine.match(/Version\s+([\d.]+)/i);
  const versionStr = versionMatch ? versionMatch[1] : versionLine;

  const serverRunning = await isAdbServerListening();
  let deviceCount = 0;
  let deviceErrors = "";

  if (serverRunning) {
    const devices = await run("adb devices");
    const lines = devices.stdout
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("List"));
    deviceCount = lines.filter((l) => l.includes("\tdevice")).length;
    deviceErrors = devices.stderr;
  }

  const mismatch =
    deviceErrors.includes("out of date") ||
    deviceErrors.includes("doesn't match");
  const errorMsg = mismatch ? "ADB server version mismatch detected" : null;

  return {
    installed: true,
    version: versionStr,
    serverRunning,
    devices: deviceCount,
    error: errorMsg,
    operation: null,
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
  private _operation: string | null = null;
  private readonly _logLines: Array<{ kind: string; text: string }> = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    // Send status on load
    await this._sendStatus();
    this._sendLogHistory();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "start":
          await this._startServer();
          break;
        case "kill":
          await this._killServer();
          break;
        case "restart":
          await this._restartServer();
          break;
        case "refresh":
          await this._sendStatus();
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
    status.operation = this._operation;
    this._view.webview.postMessage({ command: "status", data: status });
  }

  private _postLog(kind: string, text: string) {
    const entry = { kind, text };
    this._logLines.push(entry);
    if (this._logLines.length > 200) {
      this._logLines.shift();
    }

    if (this._view) {
      this._view.webview.postMessage({ command: "log", data: entry });
    }
  }

  private _sendLogHistory() {
    if (!this._view) {
      return;
    }

    this._view.webview.postMessage({
      command: "logHistory",
      data: this._logLines,
    });
  }

  private async _waitForServerState(shouldRun: boolean, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if ((await isAdbServerListening()) === shouldRun) {
        return;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200));
    }
  }

  private async _startServer() {
    this._operation = "starting";
    this._postLog("command", "> adb start-server");
    await this._sendStatus();

    const result = await run("adb start-server");
    if (result.stdout) {
      this._postLog("output", result.stdout);
    }
    if (result.stderr) {
      this._postLog("error", result.stderr);
    }
    if (result.code && result.code !== 0) {
      this._postLog("error", `Command exited with code ${result.code}`);
    }

    await this._waitForServerState(true);
    this._operation = null;
  }

  private async _killServer() {
    this._operation = "stopping";
    this._postLog("command", "> adb kill-server");
    await this._sendStatus();

    const result = await run("adb kill-server");
    if (result.stdout) {
      this._postLog("output", result.stdout);
    }
    if (result.stderr) {
      this._postLog("error", result.stderr);
    }
    if (result.code && result.code !== 0) {
      this._postLog("error", `Command exited with code ${result.code}`);
    }

    await this._waitForServerState(false);
    this._operation = null;
  }

  private async _restartServer() {
    this._operation = "restarting";
    this._postLog("command", "> adb kill-server");
    this._postLog("command", "> adb start-server");
    await this._sendStatus();

    const killResult = await run("adb kill-server");
    if (killResult.stdout) {
      this._postLog("output", killResult.stdout);
    }
    if (killResult.stderr) {
      this._postLog("error", killResult.stderr);
    }
    if (killResult.code && killResult.code !== 0) {
      this._postLog("error", `kill-server exited with code ${killResult.code}`);
    }

    await this._waitForServerState(false);

    const startResult = await run("adb start-server");
    if (startResult.stdout) {
      this._postLog("output", startResult.stdout);
    }
    if (startResult.stderr) {
      this._postLog("error", startResult.stderr);
    }
    if (startResult.code && startResult.code !== 0) {
      this._postLog(
        "error",
        `start-server exited with code ${startResult.code}`,
      );
    }

    await this._waitForServerState(true);
    this._operation = null;
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

  .status-tag {
    margin-left: 8px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .status-tag.running {
    background: rgba(78, 201, 78, 0.14);
    color: #4ec94e;
    border-color: rgba(78, 201, 78, 0.28);
  }
  .status-tag.stopped {
    background: rgba(244, 71, 71, 0.1);
    color: #f47878;
    border-color: rgba(244, 71, 71, 0.26);
  }
  .status-tag.pending {
    background: rgba(229, 162, 32, 0.14);
    color: #e5a220;
    border-color: rgba(229, 162, 32, 0.28);
  }

  .divider {
    height: 1px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.07));
    margin: 10px 0;
  }

  .terminal-panel {
    margin-top: 10px;
    border-radius: 8px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
  }

  .terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .terminal-body {
    max-height: 180px;
    overflow: auto;
    padding: 8px 10px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .terminal-line { margin-bottom: 4px; }
  .terminal-line.command { color: var(--vscode-foreground); }
  .terminal-line.output { color: rgba(255, 255, 255, 0.82); }
  .terminal-line.error { color: #f47878; }

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
        <span id="statusTag" class="status-tag hidden"></span>
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

  <div class="terminal-panel">
    <div class="terminal-header">
      <span>Command log</span>
      <span id="terminalCount">0 lines</span>
    </div>
    <div class="terminal-body" id="terminalBody"></div>
  </div>

</div>

<script>
  const vscode = acquireVsCodeApi();

  const $ = id => document.getElementById(id);
  const terminalEntries = [];

  function escapeHtml(text) {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function renderTerminal() {
    const body = $('terminalBody');
    body.innerHTML = terminalEntries
      .map(({ kind, text }) => '<div class="terminal-line ' + kind + '">' + escapeHtml(text) + '</div>')
      .join('');
    $('terminalCount').textContent = terminalEntries.length + ' line' + (terminalEntries.length === 1 ? '' : 's');
    body.scrollTop = body.scrollHeight;
  }

  function pushTerminal(kind, text) {
    terminalEntries.push({ kind, text });
    renderTerminal();
  }

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
    if (data.command === 'logHistory') {
      terminalEntries.splice(0, terminalEntries.length, ...data.data);
      renderTerminal();
      return;
    }

    if (data.command === 'log') {
      pushTerminal(data.data.kind, data.data.text);
      return;
    }

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
    const tag  = $('statusTag');
    dot.className = 'dot';
    tag.className = 'status-tag hidden';
    tag.textContent = '';

    if (s.operation === 'restarting') {
      dot.classList.add('amber');
      text.textContent = 'Restarting server';
      tag.classList.remove('hidden');
      tag.textContent = 'Restarting';
      tag.classList.add('pending');
    } else if (s.operation === 'starting') {
      dot.classList.add('amber');
      text.textContent = 'Starting server';
      tag.classList.remove('hidden');
      tag.textContent = 'Starting';
      tag.classList.add('pending');
    } else if (s.operation === 'stopping') {
      dot.classList.add('amber');
      text.textContent = 'Stopping server';
      tag.classList.remove('hidden');
      tag.textContent = 'Stopping';
      tag.classList.add('pending');
    } else if (s.error) {
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
