import * as vscode from "vscode";
import { getAdbStatus, isAdbServerListening, run } from "./adb.js";
import { getAdbZenHtml } from "./webview.js";
import { WirelessViewProvider } from "./wireless.js";

export function activate(context: vscode.ExtensionContext) {
  const provider = new AdbZenViewProvider();
  const wirelessProvider = new WirelessViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("adbzen.mainView", provider),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "adbzen.wirelessView",
      wirelessProvider,
    ),
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
        case "clearLog":
          this._logLines.length = 0;
          this._sendLogHistory();
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

  private async _waitForServerState(
    shouldRun: boolean,
    timeoutMs = 5000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if ((await isAdbServerListening()) === shouldRun) {
        return true;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200));
    }

    return false;
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

    const started = await this._waitForServerState(true);
    this._postLog(
      started ? "output" : "error",
      started
        ? "ADB server is running"
        : "ADB server did not report as running in time",
    );
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

    const stopped = await this._waitForServerState(false);
    this._postLog(
      stopped ? "output" : "error",
      stopped ? "ADB server is stopped" : "ADB server did not stop in time",
    );
    this._operation = null;
  }

  private async _restartServer() {
    this._operation = "restarting";
    await this._sendStatus();

    this._postLog("command", "> adb kill-server");
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

    const stopped = await this._waitForServerState(false);
    this._postLog(
      stopped ? "output" : "error",
      stopped ? "ADB server is stopped" : "ADB server did not stop in time",
    );

    this._postLog("command", "> adb start-server");
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

    const started = await this._waitForServerState(true);
    this._postLog(
      started ? "output" : "error",
      started
        ? "ADB server restarted successfully"
        : "ADB server restart did not finish in time",
    );
    this._operation = null;
  }

  private _getHtml(): string {
    return getAdbZenHtml();
  }
}

export function deactivate() {}
