import * as vscode from "vscode";
import {
  getAdbStatus,
  isAdbServerListening,
  run,
  getInstallCommand,
  parseAdbDevices,
} from "./adb.js";
import { getAdbZenHtml } from "./webview.js";
import { WirelessViewProvider } from "./wireless.js";
import { ShellViewProvider } from "./shell.js";

// ─── Status Bar ───────────────────────────────────────────────────────────────

let statusDotItem: vscode.StatusBarItem;
let statusBarItem: vscode.StatusBarItem;

export function updateStatusBar(
  state: "running" | "stopped" | "restarting" | "starting" | "killing",
  deviceCount = 0,
  usbCount = 0,
  wirelessCount = 0,
  unauthorizedCount = 0,
) {
  if (!statusBarItem || !statusDotItem) return;

  // ── Dot (colored) ──────────────────────────────────────────────────────────
  const dotMap: Record<string, { icon: string; color: string }> = {
    running: { icon: "$(circle-filled)", color: "#4ec94e" },
    starting: { icon: "$(sync~spin)", color: "#e5a220" },
    restarting: { icon: "$(sync~spin)", color: "#e5a220" },
    killing: { icon: "$(sync~spin)", color: "#e5a220" },
    stopped: { icon: "$(circle-slash)", color: "#f47878" },
  };
  const dot = dotMap[state];
  statusDotItem.text = dot.icon;
  statusDotItem.color = dot.color;
  statusDotItem.command = "workbench.view.extension.adbzen-sidebar";

  // ── Info (default color) ───────────────────────────────────────────────────
  let infoText = " ADB";
  const tooltipLines: string[] = [];

  if (state === "starting") {
    infoText += "  starting…";
    tooltipLines.push("ADB server is starting up…");
  } else if (state === "restarting") {
    infoText += "  restarting…";
    tooltipLines.push("ADB server is restarting…");
  } else if (state === "killing") {
    infoText += "  killing…";
    tooltipLines.push("ADB server is shutting down…");
  } else if (state === "stopped") {
    infoText += "  $(device-mobile) 0";
    tooltipLines.push("ADB server is **not running**", "Click to open AdbZen");
  } else {
    // running — show usb / wireless / unauthorized separately
    const parts: string[] = [];
    if (usbCount > 0) parts.push(`$(plug) ${usbCount}`);
    if (wirelessCount > 0) parts.push(`$(broadcast) ${wirelessCount}`);
    if (parts.length === 0) parts.push(`$(device-mobile) 0`);
    if (unauthorizedCount > 0) parts.push(`$(warning) ${unauthorizedCount}`);

    infoText += "  " + parts.join("  ");

    tooltipLines.push(
      `ADB server **running** · ${deviceCount} device${deviceCount === 1 ? "" : "s"}`,
    );
    if (usbCount > 0) tooltipLines.push(`$(plug)  USB: ${usbCount}`);
    if (wirelessCount > 0)
      tooltipLines.push(`$(broadcast)  Wireless: ${wirelessCount}`);
    if (unauthorizedCount > 0)
      tooltipLines.push(
        `$(warning)  Unauthorized: ${unauthorizedCount} — tap **Allow** on your device`,
      );

    tooltipLines.push("Click to open AdbZen");
  }

  statusBarItem.text = infoText;
  statusBarItem.color = undefined; // stays default theme color
  statusBarItem.tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));
  statusBarItem.command = "workbench.view.extension.adbzen-sidebar";
}

// ─── Notifications ────────────────────────────────────────────────────────────

export function notify(level: "info" | "warn" | "error", message: string) {
  if (level === "info")
    vscode.window.showInformationMessage(`AdbZen: ${message}`);
  if (level === "warn") vscode.window.showWarningMessage(`AdbZen: ${message}`);
  if (level === "error") vscode.window.showErrorMessage(`AdbZen: ${message}`);
}

// ─── Device tracker (for diff-based notifications) ───────────────────────────

type TrackedDevice = { serial: string; state: string };
let _prevDevices: TrackedDevice[] = [];

export function diffDevices(prev: TrackedDevice[], next: TrackedDevice[]) {
  const prevMap = new Map(prev.map((d) => [d.serial, d.state]));
  const nextMap = new Map(next.map((d) => [d.serial, d.state]));

  for (const [serial, state] of nextMap) {
    const prevState = prevMap.get(serial);

    if (prevState === undefined) {
      // brand new device
      if (state === "device") {
        notify("info", `Device connected: ${serial}`);
      } else if (state === "unauthorized") {
        notify(
          "warn",
          `Device connected but not authorized: ${serial} — check your phone and tap "Allow"`,
        );
      } else if (state === "offline") {
        notify("warn", `Device appeared offline: ${serial}`);
      } else {
        notify("info", `Device detected (${state}): ${serial}`);
      }
    } else if (prevState !== state) {
      // state changed
      if (prevState === "unauthorized" && state === "device") {
        notify("info", `Device authorized: ${serial}`);
      } else if (state === "unauthorized") {
        notify(
          "warn",
          `Device became unauthorized: ${serial} — tap "Allow" on your phone`,
        );
      } else if (state === "offline") {
        notify("warn", `Device went offline: ${serial}`);
      } else if (state === "device") {
        notify("info", `Device ready: ${serial}`);
      } else {
        notify(
          "info",
          `Device ${serial} state changed: ${prevState} → ${state}`,
        );
      }
    }
  }

  for (const [serial] of prevMap) {
    if (!nextMap.has(serial)) {
      notify("info", `Device disconnected: ${serial}`);
    }
  }
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusDotItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    101,
  );
  statusDotItem.show();
  context.subscriptions.push(statusDotItem);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  updateStatusBar("stopped");

  const mainProvider = new AdbZenViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("adbzen.mainView", mainProvider),
    vscode.window.registerWebviewViewProvider(
      "adbzen.wirelessView",
      new WirelessViewProvider(),
    ),
    vscode.window.registerWebviewViewProvider(
      "adbzen.shellView",
      new ShellViewProvider(),
    ),
  );

  // Background poller — drives status bar + device diff notifications
  const poller = setInterval(async () => {
    const status = await getAdbStatus();

    const deviceCount = status.devices.filter(
      (d) => d.state === "device",
    ).length;
    const usbCount = status.devices.filter(
      (d) => d.state === "device" && d.connectionType === "usb",
    ).length;
    const wirelessCount = status.devices.filter(
      (d) => d.state === "device" && d.connectionType === "wireless",
    ).length;
    const unauthorizedCount = status.devices.filter(
      (d) => d.state === "unauthorized",
    ).length;
    const state = status.serverRunning ? "running" : "stopped";
    updateStatusBar(
      state,
      deviceCount,
      usbCount,
      wirelessCount,
      unauthorizedCount,
    );

    // device diff
    const next = status.devices.map((d) => ({
      serial: d.serial,
      state: d.state,
    }));
    diffDevices(_prevDevices, next);
    _prevDevices = next;
  }, 3000);

  context.subscriptions.push({ dispose: () => clearInterval(poller) });
}

// ─── Main view provider ───────────────────────────────────────────────────────

class AdbZenViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _operation: string | null = null;
  private readonly _logLines: Array<{ kind: string; text: string }> = [];

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getAdbZenHtml();
    await this._sendStatus();
    this._sendLogHistory();

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
        case "clearLog":
          this._logLines.length = 0;
          this._sendLogHistory();
          break;
        case "installAdb":
          this._installAdb(msg.packageManager as string);
          break;
        case "openDownloadPage":
          await vscode.env.openExternal(
            vscode.Uri.parse(
              "https://developer.android.com/tools/releases/platform-tools",
            ),
          );
          break;
      }
    });
  }

  private async _sendStatus() {
    if (!this._view) return;
    const status = await getAdbStatus();
    status.operation = this._operation;
    this._view.webview.postMessage({ command: "status", data: status });
  }

  private _log(kind: string, text: string) {
    this._logLines.push({ kind, text });
    if (this._logLines.length > 200) this._logLines.shift();
    this._view?.webview.postMessage({ command: "log", data: { kind, text } });
  }

  private _sendLogHistory() {
    this._view?.webview.postMessage({
      command: "logHistory",
      data: this._logLines,
    });
  }

  private async _waitForServerState(
    target: boolean,
    ms = 5000,
  ): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await isAdbServerListening()) === target) return true;
      await new Promise<void>((r) => globalThis.setTimeout(r, 200));
    }
    return false;
  }

  private async _exec(cmd: string) {
    this._log("command", `> ${cmd}`);
    const r = await run(cmd);
    if (r.stdout) this._log("output", r.stdout);
    if (r.stderr) this._log("error", r.stderr);
    if (r.code && r.code !== 0)
      this._log("error", `Exited with code ${r.code}`);
    return r;
  }

  private async _startServer() {
    this._operation = "starting";
    updateStatusBar("starting");
    await this._sendStatus();
    await this._exec("adb start-server");
    const ok = await this._waitForServerState(true);
    if (ok) {
      notify("info", "ADB server started");
      updateStatusBar("running");
    } else {
      notify("error", "ADB server failed to start");
      updateStatusBar("stopped");
    }
    this._log(
      ok ? "output" : "error",
      ok ? "ADB server is running" : "Server did not start in time",
    );
    this._operation = null;
    await this._sendStatus();
  }

  private async _killServer() {
    this._operation = "stopping";
    updateStatusBar("killing");
    await this._sendStatus();
    await this._exec("adb kill-server");
    const ok = await this._waitForServerState(false);
    if (ok) {
      notify("info", "ADB server killed");
      updateStatusBar("stopped");
      _prevDevices = []; // all devices gone
    } else {
      notify("error", "ADB server did not stop in time");
    }
    this._log(
      ok ? "output" : "error",
      ok ? "ADB server is stopped" : "Server did not stop in time",
    );
    this._operation = null;
    await this._sendStatus();
  }

  private async _restartServer() {
    this._operation = "restarting";
    updateStatusBar("restarting");
    await this._sendStatus();
    notify("info", "ADB server restarting…");
    await this._exec("adb kill-server");
    const stopped = await this._waitForServerState(false);
    this._log(
      stopped ? "output" : "error",
      stopped ? "Server stopped" : "Server did not stop in time",
    );
    await this._exec("adb start-server");
    const started = await this._waitForServerState(true);
    if (started) {
      notify("info", "ADB server restarted successfully");
      updateStatusBar("running");
    } else {
      notify("error", "ADB server restart did not complete in time");
      updateStatusBar("stopped");
    }
    this._log(
      started ? "output" : "error",
      started
        ? "ADB server restarted successfully"
        : "Server restart did not finish in time",
    );
    this._operation = null;
    await this._sendStatus();
  }

  private _installAdb(packageManager: string) {
    const cmd = getInstallCommand(packageManager);
    if (!cmd) return;
    const term = vscode.window.createTerminal({ name: "Install ADB" });
    term.sendText(cmd);
    term.show();
    notify("info", `Installing ADB via ${packageManager} — check the terminal`);
  }
}

export function deactivate() {}
