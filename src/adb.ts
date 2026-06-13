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

type ExecResult = { stdout: string; stderr: string; code: number | null };

export function run(cmd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(
      cmd,
      (err: (Error & { code?: number | null }) | null, stdout, stderr) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: err?.code ?? 0,
        });
      },
    );
  });
}

const VALID_STATES = new Set<string>([
  "device",
  "unauthorized",
  "offline",
  "recovery",
  "bootloader",
  "sideload",
]);

function parseDeviceState(state: string): AdbDeviceState {
  return VALID_STATES.has(state) ? (state as AdbDeviceState) : "unknown";
}

function parseKeyValues(tokens: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const token of tokens) {
    const sep = token.indexOf(":");
    if (sep <= 0) {
      continue;
    }
    const key = token.slice(0, sep).trim();
    if (key) {
      result[key] = token.slice(sep + 1).trim() || null;
    }
  }
  return result;
}

function detectConnectionType(serial: string): AdbConnectionType {
  const normalized = serial.toLowerCase();

  if (serial.startsWith("emulator-")) {
    return "emulator";
  }

  const looksLikeWireless =
    /^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(serial) ||
    /^.+:\d+$/.test(serial) ||
    normalized.includes("adb-tls") ||
    normalized.endsWith(".local");

  if (looksLikeWireless) {
    return "wireless";
  }

  return "usb";
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("List of devices attached"))
    .map((line) => {
      const [serial = "", state = "unknown", ...tokens] = line.split(/\s+/);
      const v = parseKeyValues(tokens);
      const connectionType = detectConnectionType(serial);
      return {
        serial,
        state: parseDeviceState(state),
        connectionType,
        model: v.model ?? null,
        product: v.product ?? null,
        device: v.device ?? null,
        usb: v.usb ?? null,
        features: v.features ?? null,
        raw: line,
      };
    });
}

export async function isAdbServerListening(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v: boolean) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(5037, "127.0.0.1");
  });
}

export async function getAdbStatus(): Promise<AdbStatus> {
  const { stdout, stderr } = await run("adb version");
  if (!stdout && !stderr) {
    return {
      installed: false,
      version: null,
      serverRunning: false,
      devices: [],
      error: "ADB not found in PATH",
      operation: null,
    };
  }
  const match = (stdout.split("\n")[0] ?? "").match(/Version\s+([\d.]+)/i);
  const version = match ? match[1] : (stdout.split("\n")[0] ?? "");
  const serverRunning = await isAdbServerListening();
  let devices: AdbDevice[] = [];
  let deviceErrors = "";
  if (serverRunning) {
    const list = await run("adb devices -l");
    devices = parseAdbDevices(list.stdout);
    deviceErrors = list.stderr;
  }
  const mismatch =
    deviceErrors.includes("out of date") ||
    deviceErrors.includes("doesn't match");
  return {
    installed: true,
    version,
    serverRunning,
    devices,
    error: mismatch ? "ADB server version mismatch detected" : null,
    operation: null,
  };
}

export async function scanAdbPorts(
  ip: string,
  onFound?: (port: number) => void,
  isCancelled?: () => boolean,
): Promise<number[]> {
  const candidates: number[] = [
    5554, 5555, 5556, 5557, 5558, 5559, 5560, 5580, 5585,
  ];
  for (let p = 37000; p <= 47000; p++) {
    candidates.push(p);
  }

  const found: number[] = [];
  const BATCH = 400;
  const TIMEOUT_MS = 250;

  for (let i = 0; i < candidates.length; i += BATCH) {
    if (isCancelled?.()) {
      break;
    }
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(
        (port) =>
          new Promise<number | null>((resolve) => {
            const s = new net.Socket();
            let done = false;
            const finish = (ok: boolean) => {
              if (done) {
                return;
              }
              done = true;
              s.destroy();
              resolve(ok ? port : null);
            };
            s.setTimeout(TIMEOUT_MS);
            s.once("connect", () => finish(true));
            s.once("timeout", () => finish(false));
            s.once("error", () => finish(false));
            s.connect(port, ip);
          }),
      ),
    );
    for (const p of results) {
      if (p !== null) {
        found.push(p);
        onFound?.(p);
      }
    }
  }
  return found;
}
