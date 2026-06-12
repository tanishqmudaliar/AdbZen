import type { AdbConnectionType, AdbDevice, AdbDeviceState } from "./adb.js";

function escapeHtml(text: string | null | undefined): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateLabel(state: AdbDeviceState): string {
  switch (state) {
    case "device":
      return "Connected";
    case "unauthorized":
      return "Unauthorized";
    case "offline":
      return "Offline";
    case "recovery":
      return "Recovery";
    case "bootloader":
      return "Bootloader";
    case "sideload":
      return "Sideload";
    default:
      return "Unknown";
  }
}

function stateTone(state: AdbDeviceState): string {
  if (state === "device") {
    return "ok";
  }

  if (state === "unauthorized") {
    return "warn";
  }

  return "error";
}

function connectionLabel(connectionType: AdbConnectionType): string {
  switch (connectionType) {
    case "usb":
      return "USB";
    case "wireless":
      return "Wireless";
    case "emulator":
      return "Emulator";
    default:
      return "Unknown";
  }
}

function deviceCard(device: AdbDevice): string {
  const detailRows = [
    ["Serial number", device.serial],
    ["Name / model", device.model],
    ["Product", device.product],
    ["Codename", device.device],
    ["State", stateLabel(device.state)],
    ["Connection", connectionLabel(device.connectionType)],
    ["USB info", device.usb],
    ["Features", device.features],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => {
      const safeValue = value ?? "";
      return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(safeValue)}</span></div>`;
    });

  return [
    `<div class="device-card ${stateTone(device.state)}">`,
    '<div class="device-head">',
    '<div class="device-head-left">',
    `<div class="device-title">Serial number: <span>${escapeHtml(device.serial)}</span></div>`,
    `<div class="device-subtitle">Name / model: <span>${escapeHtml(device.model ?? "-")}</span></div>`,
    `<div class="device-subtitle">Product: <span>${escapeHtml(device.product ?? "-")}</span></div>`,
    `<div class="device-subtitle">Codename: <span>${escapeHtml(device.device ?? "-")}</span></div>`,
    `</div>`,
    `<div class="device-badges">`,
    `<span class="pill ${stateTone(device.state)} status-pill-top">${escapeHtml(stateLabel(device.state))}</span>`,
    "</div>",
    "</div>",
    `<div class="device-meta">${detailRows.join("")}</div>`,
    "</div>",
  ].join("");
}

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

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .device-card {
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.03);
    width: 100%;
  }
  .device-card.ok { border-color: rgba(78, 201, 78, 0.22); }
  .device-card.warn { border-color: rgba(229, 162, 32, 0.22); }
  .device-card.error { border-color: rgba(244, 71, 71, 0.22); }
  .device-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .device-body {
    display: grid;
    gap: 3px;
  }
  .device-head-left {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .device-title {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    word-break: break-word;
  }
  .device-title span,
  .detail-value {
    font-weight: 600;
  }
  .pill {
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid transparent;
  }
  .pill.ok {
    color: #4ec94e;
    background: rgba(78, 201, 78, 0.12);
    border-color: rgba(78, 201, 78, 0.24);
  }
  .pill.warn {
    color: #e5a220;
    background: rgba(229, 162, 32, 0.12);
    border-color: rgba(229, 162, 32, 0.24);
  }
  .pill.error {
    color: #f47878;
    background: rgba(244, 71, 71, 0.12);
    border-color: rgba(244, 71, 71, 0.24);
  }
  .pill.amber {
    color: #e5a220;
    background: rgba(229, 162, 32, 0.12);
    border-color: rgba(229, 162, 32, 0.24);
  }
  .pill.neutral {
    color: var(--vscode-foreground);
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.14);
  }
  .status-pill-top {
    align-self: flex-start;
    justify-self: flex-end;
    white-space: nowrap;
  }
  .device-meta {
    margin-top: 3px;
    display: grid;
    gap: 3px;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 11px;
    line-height: 1.4;
  }
  .detail-label {
    opacity: 0.48;
    flex-shrink: 0;
  }
  .detail-value {
    text-align: right;
    word-break: break-word;
    opacity: 0.92;
  }
  .empty-state {
    padding: 12px;
    border-radius: 8px;
    border: 1px dashed var(--vscode-widget-border, rgba(255,255,255,0.14));
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.75;
  }

  .terminal-panel {
    margin-top: 10px;
    border-radius: 8px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
  }

  .terminal-header {
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .terminal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

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
  .clear-log-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
  }

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
  .terminal-line.output { color: rgba(255, 255, 255, 0.82); }
  .terminal-line.error { color: #f47878; }

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
    <span>⚠</span>
    <span id="errorText"></span>
  </div>

  <div id="deviceWarning" class="banner warn-banner hidden">
    <span>!</span>
    <span id="deviceWarningText"></span>
  </div>

  <div id="notInstalled" class="banner warn-banner hidden">
    ADB not found in PATH. Install Android Platform Tools and ensure adb is accessible from your terminal.
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
      <button class="btn btn-primary" id="btnStart"><span class="btn-icon">▶</span> Start server</button>
      <button class="btn btn-neutral" id="btnRestart"><span class="btn-icon">↻</span> Restart server</button>
      <button class="btn btn-danger" id="btnKill"><span class="btn-icon">■</span> Kill server</button>
    </div>
  </div>

  <div class="terminal-panel">
    <div class="terminal-header">
      <span>Command log</span>
      <div class="terminal-actions">
        <span id="terminalCount">0 lines</span>
        <button class="clear-log-btn" id="clearLogBtn" title="Clear command log">Clear</button>
      </div>
    </div>
    <div class="terminal-body" id="terminalBody"></div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const terminalEntries = [];

  const $ = (id) => document.getElementById(id);

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
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

  function send(command, spinning) {
    if (spinning) {
      $('refreshBtn').classList.add('spinning');
    }
    vscode.postMessage({ command });
  }

  function clearLog() {
    vscode.postMessage({ command: 'clearLog' });
  }

  function countBy(devices, predicate) {
    return devices.filter(predicate).length;
  }

  function renderDevices(devices) {
    $('deviceList').innerHTML = devices.length ? devices.map((device) => {
      const connectionLabel = device.connectionType === 'usb' ? 'USB' : device.connectionType === 'wireless' ? 'Wireless' : device.connectionType === 'emulator' ? 'Emulator' : 'Unknown';
      const stateLabel = device.state === 'device' ? 'Connected' : device.state === 'unauthorized' ? 'Unauthorized' : device.state === 'offline' ? 'Offline' : device.state;
      // State badge top-right, connection badge bottom-right
      const stateBadge = '<span class="pill ' + (device.state === 'device' ? 'ok' : device.state === 'unauthorized' ? 'warn' : 'error') + '">' + escapeHtml(stateLabel) + '</span>';
      const connBadge = '<span class="pill ' + (device.connectionType === 'usb' ? 'ok' : device.connectionType === 'wireless' ? 'amber' : 'neutral') + '">' + escapeHtml(connectionLabel) + '</span>';

      const subtitleLines = [];
      if (device.model) { subtitleLines.push('<div class="device-subtitle"><span class="detail-label">Model: </span>' + escapeHtml(device.model) + '</div>'); }
      if (device.product) { subtitleLines.push('<div class="device-subtitle"><span class="detail-label">Product: </span>' + escapeHtml(device.product) + '</div>'); }

      const details = [];
      if (device.device) { details.push('<span><span class="detail-label">Codename: </span>' + escapeHtml(device.device) + '</span>'); }
      if (device.usb) { details.push('<span><span class="detail-label">USB ID: </span>' + escapeHtml(device.usb) + '</span>'); }
      if (device.features) { details.push('<span><span class="detail-label">Features: </span>' + escapeHtml(device.features) + '</span>'); }

      return '<div class="device-card ' + (device.state === 'device' ? 'ok' : device.state === 'unauthorized' ? 'warn' : 'error') + '">' +
        '<div class="device-head">' +
          stateBadge +
          connBadge +
        '</div>' +
        '<div class="device-body">' +
          '<div class="device-serial"><span class="detail-label">Serial: </span>' + escapeHtml(device.serial) + '</div>' +
          subtitleLines.join('') +
        '</div>' +
        (details.length ? '<div class="device-meta">' + details.join('') + '</div>' : '') +
      '</div>';
    }).join('') : '<div class="empty-state">No adb devices detected yet. Connect a phone via USB with USB debugging enabled, or use wireless pairing.</div>';
  }

  function updateDeviceSummary(devices) {
    $('deviceCountText').textContent = devices.length ? devices.length + ' device' + (devices.length === 1 ? '' : 's') + ' detected' : 'No devices';
  }

  $('refreshBtn').addEventListener('click', () => send('refresh', true));
  $('clearLogBtn').addEventListener('click', () => clearLog());
  $('btnStart').addEventListener('click', () => send('start', false));
  $('btnKill').addEventListener('click', () => send('kill', false));
  $('btnRestart').addEventListener('click', () => send('restart', false));

  setInterval(() => send('refresh', false), 3500);

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

    if (data.command !== 'status') {
      return;
    }

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
      $('deviceWarning').classList.add('hidden');
      return;
    }

    if (s.error) {
      $('errorBanner').classList.remove('hidden');
      $('errorText').textContent = s.error;
    } else {
      $('errorBanner').classList.add('hidden');
    }

    const dot = $('statusDot');
    const text = $('statusText');
    const tag = $('statusTag');
    dot.className = 'dot';
    tag.className = 'status-tag hidden';
    tag.textContent = '';

    if (s.operation === 'restarting') {
      dot.classList.add('amber');
      text.textContent = 'Restarting Server';
      tag.classList.remove('hidden');
      tag.textContent = 'Restarting';
      tag.classList.add('pending');
    } else if (s.operation === 'starting') {
      dot.classList.add('amber');
      text.textContent = 'Starting Server';
      tag.classList.remove('hidden');
      tag.textContent = 'Starting';
      tag.classList.add('pending');
    } else if (s.operation === 'stopping') {
      dot.classList.add('amber');
      text.textContent = 'Stopping Server';
      tag.classList.remove('hidden');
      tag.textContent = 'Stopping';
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

    const connected = countBy(devices, (device) => device.state === 'device');
    const usb = countBy(devices, (device) => device.connectionType === 'usb');
    const wireless = countBy(devices, (device) => device.connectionType === 'wireless');
    const unauthorized = countBy(devices, (device) => device.state === 'unauthorized');

    $('metaVersion').textContent = s.version ?? '—';
    $('metaServer').textContent = s.serverRunning ? 'Online' : 'Offline';
    $('metaServer').className = 'meta-value ' + (s.serverRunning ? 'ok' : 'error');
    $('metaConnected').textContent = String(connected);
    $('metaConnected').className = 'meta-value ' + (connected > 0 ? 'ok' : '');
    $('metaUsb').textContent = String(usb);
    $('metaUsb').className = 'meta-value ' + (usb > 0 ? 'ok' : '');
    $('metaWireless').textContent = String(wireless);
    $('metaWireless').className = 'meta-value ' + (wireless > 0 ? 'warn' : '');
    $('metaUnauthorized').textContent = String(unauthorized);
    $('metaUnauthorized').className = 'meta-value ' + (unauthorized > 0 ? 'warn' : '');

    updateDeviceSummary(devices);
    renderDevices(devices);

    $('btnStart').disabled = s.serverRunning || Boolean(s.operation);
    $('btnKill').disabled = !s.serverRunning || Boolean(s.operation);
    $('btnRestart').disabled = !s.serverRunning || Boolean(s.operation);
  });
</script>
</body>
</html>`;
}
