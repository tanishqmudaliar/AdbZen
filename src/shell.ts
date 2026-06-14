import * as vscode from "vscode";
import { run, parseAdbDevices } from "./adb.js";

// ─── Provider ────────────────────────────────────────────────────────────────

export class ShellViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _pollTimer?: NodeJS.Timeout;

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getShellHtml();

    // Send device list immediately, then poll every 3 s
    await this._sendDevices();
    this._pollTimer = setInterval(() => this._sendDevices(), 3000);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "refresh":
          await this._sendDevices();
          break;
        case "openShell":
          this._openShell(msg.serial, msg.label);
          break;
        case "openCustomShell":
          this._openCustomShell(msg.target);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async _sendDevices() {
    if (!this._view) {
      return;
    }
    const r = await run("adb devices -l");
    const devices = parseAdbDevices(r.stdout);
    this._view.webview.postMessage({ command: "devices", data: devices });
  }

  private _openShell(serial: string, label: string) {
    const term = vscode.window.createTerminal({
      name: `adb shell · ${label}`,
    });
    term.sendText(`adb -s ${serial} shell`);
    term.show();
  }

  private _openCustomShell(target: string) {
    if (!target.trim()) {
      return;
    }
    const term = vscode.window.createTerminal({
      name: `adb shell · ${target.trim()}`,
    });
    term.sendText(`adb -s ${target.trim()} shell`);
    term.show();
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

export function getShellHtml(): string {
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

  /* ── Section label ── */
  .section-label {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.35;
    margin-bottom: 8px;
  }

  /* ── Header row ── */
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .header-title {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.85;
  }
  .refresh-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-foreground);
    opacity: 0.45;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    transition: opacity 0.15s;
  }
  .refresh-btn:hover { opacity: 0.9; }
  .refresh-btn.spinning { animation: spin 0.7s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Device cards ── */
  .device-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

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
  .device-model {
    font-size: 11px;
    opacity: 0.65;
    margin-top: 2px;
  }
  .device-badges {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
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
  .pill.ok      { color: #4ec94e; background: rgba(78,201,78,0.12);  border-color: rgba(78,201,78,0.26); }
  .pill.warn    { color: #e5a220; background: rgba(229,162,32,0.12); border-color: rgba(229,162,32,0.26); }
  .pill.error   { color: #f47878; background: rgba(244,71,71,0.12);  border-color: rgba(244,71,71,0.26); }
  .pill.amber   { color: #e5a220; background: rgba(229,162,32,0.12); border-color: rgba(229,162,32,0.26); }
  .pill.neutral { color: var(--vscode-foreground); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); }
  .pill.blue    { color: #6cb6ff; background: rgba(108,182,255,0.10); border-color: rgba(108,182,255,0.24); }

  /* ── Meta row inside card ── */
  .device-meta {
    font-size: 10.5px;
    opacity: 0.6;
    line-height: 1.55;
    margin-bottom: 8px;
  }
  .device-meta span + span::before { content: " · "; }

  /* ── Shell button ── */
  .shell-btn {
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    margin-top: 4px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid rgba(78,201,78,0.32);
    background: rgba(78,201,78,0.08);
    color: #4ec94e;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.12s;
  }
  .shell-btn:hover:not(:disabled) { background: rgba(78,201,78,0.18); }
  .shell-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    border-color: rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04);
    color: var(--vscode-foreground);
  }

  /* ── Unauthorized notice ── */
  .unauth-note {
    font-size: 10px;
    color: #e5a220;
    opacity: 0.85;
    margin-top: 6px;
    line-height: 1.45;
  }

  /* ── Empty state ── */
  .empty-state {
    padding: 14px;
    border-radius: 8px;
    border: 1px dashed var(--vscode-widget-border, rgba(255,255,255,0.14));
    font-size: 11px;
    line-height: 1.6;
    opacity: 0.7;
    margin-bottom: 14px;
    text-align: center;
  }

  /* ── Divider ── */
  .divider {
    height: 1px;
    background: var(--vscode-widget-border, rgba(255,255,255,0.07));
    margin: 14px 0;
  }

  /* ── Custom target card ── */
  .custom-card {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 12px 14px;
  }
  .custom-desc {
    font-size: 11px;
    opacity: 0.55;
    line-height: 1.5;
    margin-bottom: 10px;
  }
  .custom-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .input {
    flex: 1;
    padding: 6px 9px;
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-input-background, rgba(255,255,255,0.06));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.12));
    color: var(--vscode-foreground);
    outline: none;
    transition: border-color 0.15s;
    min-width: 0;
  }
  .input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  .input::placeholder { opacity: 0.35; }
  .go-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid rgba(78,201,78,0.32);
    background: rgba(78,201,78,0.10);
    color: #4ec94e;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .go-btn:hover { background: rgba(78,201,78,0.2); }
</style>
</head>
<body>

<!-- ── Device list ── -->
<div class="header-row">
  <div class="header-title">ADB Devices</div>
  <button class="refresh-btn" id="refreshBtn" title="Refresh device list">↻</button>
</div>

<div id="deviceList" class="device-list">
  <!-- populated by JS -->
  <div class="empty-state">Loading devices…</div>
</div>

<!-- ── Custom target ── -->
<div class="divider"></div>

<div class="section-label">Custom target</div>
<div class="custom-card">
  <div class="custom-desc">
    Open a shell for any serial, IP:port, or transport not listed above (e.g. a device on a remote adb server).
  </div>
  <div class="custom-row">
    <input class="input" id="customTarget" type="text" placeholder="serial  /  192.168.x.x:port" autocomplete="off" spellcheck="false" />
    <button class="go-btn" id="btnCustomShell">⌨ Shell</button>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  function escapeHtml(t) {
    return String(t)
      .replaceAll('&','&amp;').replaceAll('<','&lt;')
      .replaceAll('>','&gt;').replaceAll('"','&quot;');
  }

  // ── Connection-type metadata ─────────────────────────────────────────────

  const CONN_META = {
    usb:      { label: 'USB',      pillClass: 'ok'     },
    wireless: { label: 'Wireless', pillClass: 'amber'  },
    emulator: { label: 'Emulator', pillClass: 'blue'   },
    unknown:  { label: 'Unknown',  pillClass: 'neutral' },
  };

  const STATE_META = {
    device:       { label: 'Connected',    pillClass: 'ok',    tone: 'ok'    },
    unauthorized: { label: 'Unauthorized', pillClass: 'warn',  tone: 'warn'  },
    offline:      { label: 'Offline',      pillClass: 'error', tone: 'error' },
    recovery:     { label: 'Recovery',     pillClass: 'amber', tone: 'warn'  },
    bootloader:   { label: 'Bootloader',   pillClass: 'amber', tone: 'warn'  },
    sideload:     { label: 'Sideload',     pillClass: 'neutral',tone: 'ok'  },
    unknown:      { label: 'Unknown',      pillClass: 'neutral',tone: 'muted'},
  };

  function renderDevices(devices) {
    const list = $('deviceList');

    if (!devices.length) {
      list.innerHTML =
        '<div class="empty-state">' +
          'No ADB devices found.<br>' +
          'Connect a phone via USB with USB debugging enabled,<br>' +
          'or pair &amp; connect wirelessly via the Wireless Pairing panel.' +
        '</div>';
      return;
    }

    list.innerHTML = devices.map((d) => {
      const sm   = STATE_META[d.state]          || STATE_META.unknown;
      const cm   = CONN_META[d.connectionType]  || CONN_META.unknown;
      const tone = sm.tone;
      const canShell = d.state === 'device';

      // Human-readable label: prefer model, else shorten serial
      const label = d.model || d.serial;

      // Meta chips: product, device codename, usb id
      const metaParts = [
        d.product ? 'Product: ' + escapeHtml(d.product) : '',
        d.device  ? 'Codename: ' + escapeHtml(d.device)  : '',
        d.usb     ? 'USB: '     + escapeHtml(d.usb)      : '',
      ].filter(Boolean);

      const metaHtml = metaParts.length
        ? '<div class="device-meta">' + metaParts.map(p => '<span>' + p + '</span>').join('') + '</div>'
        : '';

      const unauthNote = d.state === 'unauthorized'
        ? '<div class="unauth-note">⚠ Check your phone and tap "Allow" on the USB debugging prompt.</div>'
        : '';

      return \`
        <div class="device-card \${escapeHtml(tone)}">
          <div class="device-top">
            <div class="device-info">
              <div class="device-serial">\${escapeHtml(d.serial)}</div>
              \${d.model ? '<div class="device-model">' + escapeHtml(d.model) + '</div>' : ''}
            </div>
            <div class="device-badges">
              <span class="pill \${escapeHtml(sm.pillClass)}">\${escapeHtml(sm.label)}</span>
              <span class="pill \${escapeHtml(cm.pillClass)}">\${escapeHtml(cm.label)}</span>
            </div>
          </div>
          \${metaHtml}
          \${unauthNote}
          <button
            class="shell-btn"
            \${canShell ? '' : 'disabled'}
            data-serial="\${escapeHtml(d.serial)}"
            data-label="\${escapeHtml(label)}"
            title="\${canShell ? 'Open adb shell for ' + escapeHtml(d.serial) : 'Device must be in Connected state'}"
          >
            ⌨ Open Shell
          </button>
        </div>
      \`;
    }).join('');

    // Wire up shell buttons
    list.querySelectorAll('.shell-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openShell',
          serial: btn.dataset.serial,
          label:  btn.dataset.label,
        });
      });
    });
  }

  // ── Message handler ──────────────────────────────────────────────────────

  window.addEventListener('message', ({ data }) => {
    if (data.command === 'devices') {
      $('refreshBtn').classList.remove('spinning');
      renderDevices(data.data);
    }
  });

  // ── Refresh ──────────────────────────────────────────────────────────────

  $('refreshBtn').addEventListener('click', () => {
    $('refreshBtn').classList.add('spinning');
    vscode.postMessage({ command: 'refresh' });
  });

  // ── Custom shell ─────────────────────────────────────────────────────────

  $('btnCustomShell').addEventListener('click', () => {
    const target = $('customTarget').value.trim();
    if (!target) { return; }
    vscode.postMessage({ command: 'openCustomShell', target });
  });

  $('customTarget').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { $('btnCustomShell').click(); }
  });
</script>
</body>
</html>`;
}
