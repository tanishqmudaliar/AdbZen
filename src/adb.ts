import { exec } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";

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
  platformInfo: AdbPlatformInfo | null;
};

export type AdbPlatformInfo = {
  platform: "darwin" | "win32" | "linux";
  packageManagers: string[];
  pathIssue: boolean;
  adbFoundAt: string | null;
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
    const key = token.slice(0, sep);
    if (key) {
      result[key] = token.slice(sep + 1).trim() || null;
    }
  }
  return result;
}

function detectConnectionType(serial: string): AdbConnectionType {
  if (serial.startsWith("emulator-")) return "emulator";
  if (
    /^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(serial) ||
    /^.+:\d+$/.test(serial) ||
    serial.toLowerCase().includes("adb-tls") ||
    serial.toLowerCase().endsWith(".local")
  )
    return "wireless";
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
    const finish = (v: boolean) => {
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

function getPlatformName(): "darwin" | "win32" | "linux" {
  const p = process.platform;
  if (p === "darwin" || p === "win32") return p;
  return "linux";
}

function findWingetAdbPath(localAppData: string): string | null {
  try {
    const pkgRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
    if (!fs.existsSync(pkgRoot)) return null;
    const match = fs
      .readdirSync(pkgRoot)
      .find((entry) => entry.startsWith("Google.PlatformTools_"));
    if (!match) return null;
    const adbPath = path.join(pkgRoot, match, "platform-tools", "adb.exe");
    return fs.existsSync(adbPath) ? adbPath : null;
  } catch {
    return null;
  }
}

async function findAdbInCommonPaths(): Promise<string | null> {
  const platform = getPlatformName();
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/usr/local/bin/adb",
      "/opt/homebrew/bin/adb",
      path.join(home, "Library/Android/sdk/platform-tools/adb"),
      path.join(home, "Android/sdk/platform-tools/adb"),
    );
  } else if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const wingetAdb = findWingetAdbPath(localAppData);
    if (wingetAdb) candidates.push(wingetAdb);
    candidates.push(
      path.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"),
      "C:\\Android\\platform-tools\\adb.exe",
      "C:\\Program Files\\Android\\platform-tools\\adb.exe",
      "C:\\Program Files (x86)\\Android\\platform-tools\\adb.exe",
    );
  } else {
    candidates.push(
      "/usr/bin/adb",
      "/usr/local/bin/adb",
      path.join(home, "Android/Sdk/platform-tools/adb"),
      path.join(home, ".android/sdk/platform-tools/adb"),
    );
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function detectPackageManagers(): Promise<string[]> {
  const platform = getPlatformName();

  const checks: Array<{ name: string; cmd: string }> =
    platform === "darwin"
      ? [{ name: "brew", cmd: "which brew" }]
      : platform === "win32"
        ? [
            { name: "winget", cmd: "where winget" },
            { name: "choco", cmd: "where choco" },
            { name: "scoop", cmd: "where scoop" },
          ]
        : [
            { name: "apt", cmd: "which apt" },
            { name: "apt-get", cmd: "which apt-get" },
            { name: "dnf", cmd: "which dnf" },
            { name: "pacman", cmd: "which pacman" },
            { name: "zypper", cmd: "which zypper" },
          ];

  const results = await Promise.all(
    checks.map(async ({ name, cmd }) => {
      const r = await run(cmd);
      return r.code === 0 && r.stdout.trim() ? name : null;
    }),
  );

  return results.filter((n): n is string => n !== null);
}

export function getInstallCommand(packageManager: string): string {
  const commands: Record<string, string> = {
    brew: "brew install android-platform-tools",
    winget: "winget install Google.PlatformTools",
    choco: "choco install adb",
    scoop: "scoop install adb",
    apt: "sudo apt update && sudo apt install -y adb",
    "apt-get": "sudo apt-get update && sudo apt-get install -y adb",
    dnf: "sudo dnf install -y android-tools",
    pacman: "sudo pacman -S --noconfirm android-tools",
    zypper: "sudo zypper install -y android-tools",
  };
  return commands[packageManager] ?? "";
}

export async function getPlatformInfo(): Promise<AdbPlatformInfo> {
  const platform = getPlatformName();
  const [packageManagers, adbFoundAt] = await Promise.all([
    detectPackageManagers(),
    findAdbInCommonPaths(),
  ]);
  return {
    platform,
    packageManagers,
    pathIssue: adbFoundAt !== null,
    adbFoundAt,
  };
}

export async function getAdbStatus(): Promise<AdbStatus> {
  const { stdout } = await run("adb version");
  const isInstalled = /android debug bridge/i.test(stdout);

  if (!isInstalled) {
    const platformInfo = await getPlatformInfo();
    return {
      installed: false,
      version: null,
      serverRunning: false,
      devices: [],
      error: null,
      operation: null,
      platformInfo,
    };
  }

  const match = (stdout.split("\n")[0] ?? "").match(/Version\s+([\d.]+)/i);
  const version = match ? match[1] : (stdout.split("\n")[0] ?? "");
  const serverRunning = await isAdbServerListening();
  let devices: AdbDevice[] = [];
  if (serverRunning) {
    const list = await run("adb devices -l");
    devices = parseAdbDevices(list.stdout);
    const mismatch =
      list.stderr.includes("out of date") ||
      list.stderr.includes("doesn't match");
    return {
      installed: true,
      version,
      serverRunning,
      devices,
      error: mismatch ? "ADB server version mismatch detected" : null,
      operation: null,
      platformInfo: null,
    };
  }
  return {
    installed: true,
    version,
    serverRunning,
    devices,
    error: null,
    operation: null,
    platformInfo: null,
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
            const finish = (ok: boolean) => {
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
