import * as vscode from "vscode";
import { getAdbStatus, isAdbServerListening, run } from "./adb.js";
import { getAdbZenHtml } from "./webview.js";
import { WirelessViewProvider } from "./wireless.js";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "adbzen.mainView",
      new AdbZenViewProvider(),
    ),
    vscode.window.registerWebviewViewProvider(
      "adbzen.wirelessView",
      new WirelessViewProvider(),
    ),
    vscode.commands.registerCommand("adbzen.openPanel", () =>
      vscode.commands.executeCommand("workbench.view.extension.adbzen-sidebar"),
    ),
  );
}

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
      }
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

  private async _waitForServerState(
    target: boolean,
    ms = 5000,
  ): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await isAdbServerListening()) === target) {
        return true;
      }
      await new Promise<void>((r) => globalThis.setTimeout(r, 200));
    }
    return false;
  }

  /** Run a shell command, log cmd/stdout/stderr, return result. */
  private async _exec(cmd: string) {
    this._log("command", `> ${cmd}`);
    const r = await run(cmd);
    if (r.stdout) {
      this._log("output", r.stdout);
    }
    if (r.stderr) {
      this._log("error", r.stderr);
    }
    if (r.code && r.code !== 0) {
      this._log("error", `Exited with code ${r.code}`);
    }
    return r;
  }

  private async _startServer() {
    this._operation = "starting";
    await this._sendStatus();
    await this._exec("adb start-server");
    const ok = await this._waitForServerState(true);
    this._log(
      ok ? "output" : "error",
      ok ? "ADB server is running" : "Server did not start in time",
    );
    this._operation = null;
    await this._sendStatus();
  }

  private async _killServer() {
    this._operation = "stopping";
    await this._sendStatus();
    await this._exec("adb kill-server");
    const ok = await this._waitForServerState(false);
    this._log(
      ok ? "output" : "error",
      ok ? "ADB server is stopped" : "Server did not stop in time",
    );
    this._operation = null;
    await this._sendStatus();
  }

  private async _restartServer() {
    this._operation = "restarting";
    await this._sendStatus();
    await this._exec("adb kill-server");
    const stopped = await this._waitForServerState(false);
    this._log(
      stopped ? "output" : "error",
      stopped ? "Server stopped" : "Server did not stop in time",
    );
    await this._exec("adb start-server");
    const started = await this._waitForServerState(true);
    this._log(
      started ? "output" : "error",
      started
        ? "ADB server restarted successfully"
        : "Server restart did not finish in time",
    );
    this._operation = null;
    await this._sendStatus();
  }
}

export function deactivate() {}
