export function getAdbZenHtml(): string {
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

  .hidden { display: none !important; }

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

  .card {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }

  .status-row, .device-row, .terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .meta { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
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
  .meta-value.blue  { color: #6cb6ff; }

  .banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    border-radius: 6px;
    padding: 9px 10px;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 10px;
  }
  .error-banner {
    background: rgba(244, 71, 71, 0.08);
    border: 1px solid rgba(244, 71, 71, 0.25);
    color: #f47878;
  }
  .warn-banner {
    background: rgba(229, 162, 32, 0.08);
    border: 1px solid rgba(229, 162, 32, 0.25);
    color: #e5a220;
  }

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
  .btn-neutral:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
  }
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

  /* ── Device list ── */
  .device-list { display: flex; flex-direction: column; gap: 8px; }

  .device-card {
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.09));
    border-radius: 8px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.04);
    transition: border-color 0.15s;
  }
  .device-card.ok    { border-color: rgba(78,201,78,0.22); }
  .device-card.warn  { border-color: rgba(229,162,32,0.22); }
  .device-card.error { border-color: rgba(244,71,71,0.22); }
  .device-card.muted { opacity: 0.6; }

  .device-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .device-info { min-width: 0; flex: 1; }
  .device-serial {
    font-size: 12px;
    font-weight: 700;
    word-break: break-all;
    line-height: 1.3;
  }
  .device-badges {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* ── Meta line ── */
  .device-meta {
    font-size: 10.5px;
    opacity: 0.6;
    line-height: 1.55;
    margin-bottom: 0;
  }
  .device-meta span + span::before { content: " · "; }

  /* ── Unauth notice ── */
  .unauth-note {
    font-size: 10px;
    color: #e5a220;
    opacity: 0.85;
    margin-top: 6px;
    line-height: 1.45;
  }

  /* ── Pills ── */
  .pill {
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .pill.ok      { color: #4ec94e; background: rgba(78,201,78,0.12);   border-color: rgba(78,201,78,0.26); }
  .pill.warn    { color: #e5a220; background: rgba(229,162,32,0.12);  border-color: rgba(229,162,32,0.26); }
  .pill.error   { color: #f47878; background: rgba(244,71,71,0.12);   border-color: rgba(244,71,71,0.26); }
  .pill.amber   { color: #e5a220; background: rgba(229,162,32,0.12);  border-color: rgba(229,162,32,0.26); }
  .pill.neutral { color: var(--vscode-foreground); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); }
  .pill.blue    { color: #6cb6ff; background: rgba(108,182,255,0.10); border-color: rgba(108,182,255,0.24); }

  .empty-state {
    padding: 12px;
    border-radius: 8px;
    border: 1px dashed var(--vscode-widget-border, rgba(255,255,255,0.14));
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.75;
  }

  /* ── Terminal ── */
  .terminal-panel {
    margin-top: 10px;
    border-radius: 8px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    background: rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .terminal-header {
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  .terminal-line { margin-bottom: 4px; }
  .terminal-line.command { color: var(--vscode-foreground); }
  .terminal-line.output  { color: rgba(255,255,255,0.82); }
  .terminal-line.error   { color: #f47878; }

  .skeleton {
    height: 12px;
    border-radius: 4px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.07));
    animation: shimmer 1.4s infinite;
  }

  /* ── Not Installed Card ── */
  .ni-hero {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }
  .ni-icon-wrap { font-size: 22px; line-height: 1; flex-shrink: 0; margin-top: 1px; }
  .ni-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .ni-desc { font-size: 11px; line-height: 1.55; opacity: 0.65; }

  .ni-path-banner {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.5;
    background: rgba(229,162,32,0.08);
    border: 1px solid rgba(229,162,32,0.25);
    color: #e5a220;
    margin-bottom: 10px;
  }
  .ni-path-banner code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    word-break: break-all;
  }

  .ni-actions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }

  .ni-details {
    border-radius: 6px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    overflow: hidden;
  }
  .ni-details summary {
    padding: 8px 10px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.65;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: opacity 0.15s;
  }
  .ni-details summary::-webkit-details-marker { display: none; }
  .ni-details summary::before {
    content: '▶';
    font-size: 8px;
    display: inline-block;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .ni-details[open] summary::before { transform: rotate(90deg); }
  .ni-details summary:hover { opacity: 1; }
  .ni-manual {
    padding: 10px 12px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  }
  .ni-manual ol { padding-left: 16px; display: flex; flex-direction: column; gap: 7px; }
  .ni-manual li { font-size: 11px; line-height: 1.55; }
  .ni-manual code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: rgba(255,255,255,0.07);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
  }
  @keyframes shimmer { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }
</style>
</head>
<body>

<div id="loading">
  <div class="card">
    <div class="skeleton" style="width:60%;margin-bottom:10px"></div>
    <div class="skeleton" style="width:40%"></div>
  </div>
</div>

<div id="main" class="hidden">
  <div id="errorBanner" class="banner error-banner hidden">
    <span>⚠</span><span id="errorText"></span>
  </div>

  <div id="notInstalled" class="hidden">
    <div class="card">
      <div class="ni-hero">
        <div class="ni-icon-wrap">📦</div>
        <div>
          <div class="ni-title">ADB Not Installed</div>
          <div class="ni-desc">Android Debug Bridge (ADB) is required to communicate with Android devices. It's a free tool from Google.</div>
        </div>
      </div>

      <div id="niPathBanner" class="ni-path-banner hidden">
        <span>⚠</span>
        <span>ADB was found at <code id="niAdbPath"></code> but is not on your PATH. Try restarting VS Code first.</span>
      </div>

      <div class="ni-actions">
        <button id="btnInstallAdb" class="btn btn-primary hidden">
          <span class="btn-icon">⬇</span>
          <span id="btnInstallLabel">Install ADB</span>
        </button>
        <button id="btnAddToPath" class="btn btn-primary hidden">
          <span class="btn-icon">🛠</span>
          Add ADB to PATH
        </button>
        <button id="btnDownloadAdb" class="btn btn-neutral">
          <span class="btn-icon">🌐</span>
          Open Download Page
        </button>
        <button id="btnRecheckAdb" class="btn btn-neutral">
          <span class="btn-icon">↻</span>
          Check Again
        </button>
      </div>

      <details class="ni-details">
        <summary>Manual installation steps</summary>
        <div id="niManualSteps" class="ni-manual"></div>
      </details>
    </div>
  </div>

  <div class="card" id="statusCard">
    <div class="status-row">
      <div class="status-pill">
        <div class="dot" id="statusDot"></div>
        <span id="statusText"></span>
        <span id="statusTag" class="status-tag hidden"></span>
      </div>
      <button class="refresh-btn" id="refreshBtn" title="Refresh status">↻</button>
    </div>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">ADB version</span><span class="meta-value" id="metaVersion">—</span></div>
      <div class="meta-row"><span class="meta-label">Server</span><span class="meta-value" id="metaServer">—</span></div>
      <div class="meta-row"><span class="meta-label">Connected</span><span class="meta-value" id="metaConnected">—</span></div>
      <div class="meta-row"><span class="meta-label">USB devices</span><span class="meta-value" id="metaUsb">—</span></div>
      <div class="meta-row"><span class="meta-label">Wireless devices</span><span class="meta-value" id="metaWireless">—</span></div>
      <div class="meta-row"><span class="meta-label">Emulators</span><span class="meta-value" id="metaEmulators">—</span></div>
      <div class="meta-row"><span class="meta-label">Unauthorized</span><span class="meta-value" id="metaUnauthorized">—</span></div>
    </div>
  </div>

  <div class="card" id="deviceCard">
    <div class="device-row">
      <div>
        <div class="section-label">Connected devices</div>
        <div id="deviceCountText" style="font-size:12px;font-weight:600;">No devices</div>
      </div>
    </div>
    <div style="margin-top:10px" class="device-list" id="deviceList"></div>
  </div>

  <div id="actionsBlock">
    <div class="section-label">Server control</div>
    <div class="actions">
      <button class="btn btn-primary"  id="btnStart"><span class="btn-icon">▶</span> Start server</button>
      <button class="btn btn-neutral"  id="btnRestart"><span class="btn-icon">↻</span> Restart server</button>
      <button class="btn btn-danger"   id="btnKill"><span class="btn-icon">■</span> Kill server</button>
    </div>
  </div>

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
</div>

<script>
  const vscode = acquireVsCodeApi();
  const terminalEntries = [];
  const $ = (id) => document.getElementById(id);
  let _installingAdb = false;

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function renderTerminal() {
    const body = $('terminalBody');
    body.innerHTML = terminalEntries
      .map(({ kind, text }) => '<div class="terminal-line ' + kind + '">' + escapeHtml(text) + '</div>')
      .join('');
    $('terminalCount').textContent = terminalEntries.length + ' line' + (terminalEntries.length === 1 ? '' : 's');
    body.scrollTop = body.scrollHeight;
  }

  function send(command, spinning) {
    if (spinning) { $('refreshBtn').classList.add('spinning'); }
    vscode.postMessage({ command });
  }

  function countBy(devices, pred) { return devices.filter(pred).length; }

  // ── Shared metadata maps (same as shell panel) ───────────────────────────

  const CONN_META = {
    usb:      { label: 'USB',      pillClass: 'ok'      },
    wireless: { label: 'Wireless', pillClass: 'amber'   },
    emulator: { label: 'Emulator', pillClass: 'blue'    },
    unknown:  { label: 'Unknown',  pillClass: 'neutral' },
  };

  const STATE_META = {
    device:       { label: 'Connected',    pillClass: 'ok',      tone: 'ok'    },
    unauthorized: { label: 'Unauthorized', pillClass: 'warn',    tone: 'warn'  },
    offline:      { label: 'Offline',      pillClass: 'error',   tone: 'error' },
    recovery:     { label: 'Recovery',     pillClass: 'amber',   tone: 'warn'  },
    bootloader:   { label: 'Bootloader',   pillClass: 'amber',   tone: 'warn'  },
    sideload:     { label: 'Sideload',     pillClass: 'neutral', tone: 'ok'    },
    unknown:      { label: 'Unknown',      pillClass: 'neutral', tone: 'muted' },
  };

  function renderDevices(devices) {
    if (!devices.length) {
      $('deviceList').innerHTML = '<div class="empty-state">No adb devices detected yet. Connect a phone via USB with USB debugging enabled, or use wireless pairing.</div>';
      return;
    }

    $('deviceList').innerHTML = devices.map((d) => {
      const sm   = STATE_META[d.state]         || STATE_META.unknown;
      const cm   = CONN_META[d.connectionType] || CONN_META.unknown;
      const tone = sm.tone;

      const metaParts = [
        d.model   ? 'Model: '   + escapeHtml(d.model)   : '',
        d.product ? 'Product: ' + escapeHtml(d.product) : '',
        d.device  ? 'Codename: ' + escapeHtml(d.device) : '',
        d.usb     ? 'USB: '     + escapeHtml(d.usb)     : '',
      ].filter(Boolean);

      const metaHtml = metaParts.length
        ? '<div class="device-meta">' + metaParts.map(p => '<span>' + p + '</span>').join('') + '</div>'
        : '';

      const unauthNote = d.state === 'unauthorized'
        ? '<div class="unauth-note">⚠ Check your phone and tap "Allow" on the USB debugging prompt.</div>'
        : '';

      return (
        '<div class="device-card ' + tone + '">' +
          '<div class="device-top">' +
            '<div class="device-info">' +
              '<div class="device-serial">' + escapeHtml(d.serial) + '</div>' +
            '</div>' +
            '<div class="device-badges">' +
              '<span class="pill ' + sm.pillClass + '">' + escapeHtml(sm.label) + '</span>' +
              '<span class="pill ' + cm.pillClass + '">' + escapeHtml(cm.label) + '</span>' +
            '</div>' +
          '</div>' +
          metaHtml +
          unauthNote +
        '</div>'
      );
    }).join('');
  }

  $('refreshBtn').addEventListener('click', () => send('refresh', true));
  $('btnInstallAdb').addEventListener('click', () => {
    const pm = $('btnInstallAdb').dataset.packageManager;
    if (!pm) { return; }
    vscode.postMessage({ command: 'installAdb', packageManager: pm });
  });
  $('btnDownloadAdb').addEventListener('click', () => {
    vscode.postMessage({ command: 'openDownloadPage' });
  });
  $('btnAddToPath').addEventListener('click', () => {
    vscode.postMessage({ command: 'addToPath' });
  });
  $('btnRecheckAdb').addEventListener('click', () => {
    $('btnRecheckAdb').disabled = true;
    vscode.postMessage({ command: 'refresh' });
    setTimeout(() => { $('btnRecheckAdb').disabled = false; }, 1200);
  });
  $('clearLogBtn').addEventListener('click', () => { vscode.postMessage({ command: 'clearLog' }); });
  $('btnStart').addEventListener('click',   () => send('start',   false));
  $('btnKill').addEventListener('click',    () => send('kill',    false));
  $('btnRestart').addEventListener('click', () => send('restart', false));

  setInterval(() => send('refresh', false), 3500);

  function getManualSteps(platform) {
    if (platform === 'darwin') {
      return '<ol>' +
        '<li>Install <strong>Homebrew</strong> from <code>brew.sh</code> if not already installed</li>' +
        '<li>Run: <code>brew install android-platform-tools</code></li>' +
        '<li>Restart VS Code — ADB will be detected automatically</li>' +
      '</ol>';
    }
    if (platform === 'win32') {
      return '<ol>' +
        '<li>Click <strong>Open Download Page</strong> above and download the Windows zip</li>' +
        '<li>Extract it to a permanent folder like <code>C:\\platform-tools</code></li>' +
        '<li>Add that folder to your <strong>System PATH</strong> (search "Edit environment variables")</li>' +
        '<li>Restart VS Code — ADB will be detected automatically</li>' +
      '</ol>';
    }
    return '<ol>' +
      '<li>Ubuntu / Debian: <code>sudo apt update && sudo apt install adb</code></li>' +
      '<li>Fedora: <code>sudo dnf install android-tools</code></li>' +
      '<li>Arch: <code>sudo pacman -S android-tools</code></li>' +
      '<li>Restart VS Code — ADB will be detected automatically</li>' +
    '</ol>';
  }

  function applyPlatformInfo(platformInfo) {
    if (!platformInfo) { return; }
    const { platform, packageManagers, pathIssue, adbFoundAt } = platformInfo;

    if (pathIssue && adbFoundAt) {
      $('niPathBanner').classList.remove('hidden');
      $('niAdbPath').textContent = adbFoundAt;
      $('btnAddToPath').classList.remove('hidden');
    } else {
      $('niPathBanner').classList.add('hidden');
      $('btnAddToPath').classList.add('hidden');
    }

    if (Array.isArray(packageManagers) && packageManagers.length > 0) {
      const pm = packageManagers[0];
      const pmLabels = {
        brew: 'Homebrew', winget: 'winget', choco: 'Chocolatey',
        scoop: 'Scoop', apt: 'apt', 'apt-get': 'apt-get',
        dnf: 'dnf', pacman: 'pacman', zypper: 'zypper',
      };
      $('btnInstallLabel').textContent = 'Install via ' + (pmLabels[pm] || pm);
      $('btnInstallAdb').dataset.packageManager = pm;
      $('btnInstallAdb').disabled = false;
      $('btnInstallAdb').classList.remove('hidden');
    } else {
      $('btnInstallAdb').classList.add('hidden');
    }

    $('niManualSteps').innerHTML = getManualSteps(platform);
  }

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
    const devices = Array.isArray(s.devices) ? s.devices : [];

    $('loading').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('refreshBtn').classList.remove('spinning');
    $('notInstalled').classList.toggle('hidden', s.installed);
    $('statusCard').classList.toggle('hidden', !s.installed);
    $('deviceCard').classList.toggle('hidden', !s.installed);
    $('actionsBlock').classList.toggle('hidden', !s.installed);

    if (!s.installed) {
      $('errorBanner').classList.add('hidden');
      applyPlatformInfo(s.platformInfo);
      return;
    }

    // ADB is now installed — reset install state if it just appeared
    _installingAdb = false;

    if (s.error) {
      $('errorBanner').classList.remove('hidden');
      $('errorText').textContent = s.error;
    } else {
      $('errorBanner').classList.add('hidden');
    }

    const dot  = $('statusDot');
    const text = $('statusText');
    const tag  = $('statusTag');
    dot.className = 'dot';
    tag.className = 'status-tag hidden';
    tag.textContent = '';

    const opLabels = { restarting: ['Restarting Server', 'Restarting'], starting: ['Starting Server', 'Starting'], stopping: ['Stopping Server', 'Stopping'] };
    if (s.operation && opLabels[s.operation]) {
      const [label, tagText] = opLabels[s.operation];
      dot.classList.add('amber');
      text.textContent = label;
      tag.classList.remove('hidden');
      tag.textContent = tagText;
      tag.classList.add('pending');
    } else if (s.error) {
      dot.classList.add('amber');
      text.textContent = 'Degraded';
    } else if (s.serverRunning) {
      dot.classList.add('green');
      text.textContent = 'Server Running';
    } else {
      dot.classList.add('red');
      text.textContent = 'Server Stopped';
    }

    const connected    = countBy(devices, (d) => d.state === 'device');
    const usb          = countBy(devices, (d) => d.connectionType === 'usb');
    const wireless     = countBy(devices, (d) => d.connectionType === 'wireless');
    const emulators    = countBy(devices, (d) => d.connectionType === 'emulator');
    const unauthorized = countBy(devices, (d) => d.state === 'unauthorized');

    $('metaVersion').textContent     = s.version ?? '—';
    $('metaServer').textContent      = s.serverRunning ? 'Online' : 'Offline';
    $('metaServer').className        = 'meta-value ' + (s.serverRunning ? 'ok' : 'error');
    $('metaConnected').textContent   = String(connected);
    $('metaConnected').className     = 'meta-value ' + (connected > 0 ? 'ok' : '');
    $('metaUsb').textContent         = String(usb);
    $('metaUsb').className           = 'meta-value ' + (usb > 0 ? 'ok' : '');
    $('metaWireless').textContent    = String(wireless);
    $('metaWireless').className      = 'meta-value ' + (wireless > 0 ? 'warn' : '');
    $('metaEmulators').textContent   = String(emulators);
    $('metaEmulators').className     = 'meta-value ' + (emulators > 0 ? 'blue' : '');
    $('metaUnauthorized').textContent = String(unauthorized);
    $('metaUnauthorized').className   = 'meta-value ' + (unauthorized > 0 ? 'warn' : '');

    $('deviceCountText').textContent = devices.length
      ? devices.length + ' device' + (devices.length === 1 ? '' : 's') + ' detected'
      : 'No devices';
    renderDevices(devices);

    $('btnStart').disabled   = s.serverRunning   || Boolean(s.operation);
    $('btnKill').disabled    = !s.serverRunning  || Boolean(s.operation);
    $('btnRestart').disabled = !s.serverRunning  || Boolean(s.operation);
  });
</script>
</body>
</html>`;
}
