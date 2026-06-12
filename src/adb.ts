import { exec } from "child_process";
import * as net from "net";

export type AdbDeviceState =
  | "device"
  | "unauthorized"
  | "offline"
  | "recovery"
  | "bootloader"
  | "sideload"
  | "unknown";

export type AdbConnectionType = "usb" | "wireless" | "emulator" | "unknown";

export type AdbDevice = {
  serial: string;
  state: AdbDeviceState;
  connectionType: AdbConnectionType;
  model: string | null;
  product: string | null;
  device: string | null;
  usb: string | null;
  features: string | null;
  raw: string;
};

export type AdbStatus = {
  installed: boolean;
  version: string | null;
  serverRunning: boolean;
  devices: AdbDevice[];
  error: string | null;
  operation: string | null;
};

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export function run(cmd: string): Promise<ExecResult> {
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

function parseDeviceState(state: string): AdbDeviceState {
  switch (state) {
    case "device":
    case "unauthorized":
    case "offline":
    case "recovery":
    case "bootloader":
    case "sideload":
      return state;
    default:
      return "unknown";
  }
}

function parseKeyValues(tokens: string[]): Record<string, string | null> {
  const values: Record<string, string | null> = {};

  for (const token of tokens) {
    const separatorIndex = token.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = token.slice(0, separatorIndex).trim();
    const value = token.slice(separatorIndex + 1).trim();
    if (key) {
      values[key] = value || null;
    }
  }

  return values;
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => {
      const [serial = "", state = "unknown", ...tokens] = line.split(/\s+/);
      const values = parseKeyValues(tokens);
      const connectionType: AdbConnectionType = serial.includes(":")
        ? "wireless"
        : serial.startsWith("emulator-")
          ? "emulator"
          : "usb";

      return {
        serial,
        state: parseDeviceState(state),
        connectionType,
        model: values.model ?? null,
        product: values.product ?? null,
        device: values.device ?? null,
        usb: values.usb ?? null,
        features: values.features ?? null,
        raw: line,
      };
    });
}

export async function isAdbServerListening(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(5037, "127.0.0.1");
  });
}

export async function getAdbStatus(): Promise<AdbStatus> {
  const version = await run("adb version");

  if (!version.stdout && !version.stderr) {
    return {
      installed: false,
      version: null,
      serverRunning: false,
      devices: [],
      error: "ADB not found in PATH",
      operation: null,
    };
  }

  const versionLine = version.stdout.split("\n")[0] || "";
  const versionMatch = versionLine.match(/Version\s+([\d.]+)/i);
  const versionStr = versionMatch ? versionMatch[1] : versionLine;

  const serverRunning = await isAdbServerListening();
  let devices: AdbDevice[] = [];
  let deviceErrors = "";

  if (serverRunning) {
    const deviceList = await run("adb devices -l");
    devices = parseAdbDevices(deviceList.stdout);
    deviceErrors = deviceList.stderr;
  }

  const mismatch =
    deviceErrors.includes("out of date") ||
    deviceErrors.includes("doesn't match");
  const errorMsg = mismatch ? "ADB server version mismatch detected" : null;

  return {
    installed: true,
    version: versionStr,
    serverRunning,
    devices,
    error: errorMsg,
    operation: null,
  };
}
