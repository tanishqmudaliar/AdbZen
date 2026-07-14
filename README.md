# AdbZen

ADB manager for VS Code — wireless pairing, device shells, server control, auto-install, and real-time device visibility from the sidebar.

![VS Code](https://img.shields.io/badge/VS_Code-^1.85.0-007ACC?logo=visual-studio-code&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/Status-Active_Development-brightgreen)

**[Video Demo](https://www.youtube.com/watch?v=BD9QanAADw0)**

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
  - [Core ADB Control](#core-adb-control)
  - [Wireless Pairing & Connectivity](#wireless-pairing--connectivity)
  - [Device Productivity & UX](#device-productivity--ux)
  - [Developer Experience](#developer-experience)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Usage Guide](#usage-guide)
  - [Main View (AdbZen)](#main-view-adbzen)
  - [Wireless Pairing View](#wireless-pairing-view)
  - [Shell View](#shell-view)
  - [Advanced Usage](#advanced-usage)
- [Comprehensive File & Directory Breakdown](#comprehensive-file--directory-breakdown)
  - [`package.json`](#packagejson)
  - [`src/extension.ts`](#srcextensionts)
  - [`src/adb.ts`](#srcadbts)
  - [`src/webview.ts`](#srcwebviewts)
  - [`src/wireless.ts`](#srcwirelessts)
  - [`src/shell.ts`](#srcshellts)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

AdbZen is a VS Code extension that brings Android Debug Bridge (ADB) control directly into your editor, so you don’t have to constantly switch to external terminals for everyday device operations. It is built with TypeScript, Node.js, and the VS Code Extension API, with webview-powered interfaces for interactive controls and fast UI feedback.

The extension focuses on reducing repetitive ADB friction: server state management, device monitoring, wireless pairing, shell launching, and installation help when ADB is missing. Instead of memorizing command syntax and manual reconnection flows, developers get a sidebar-first, visual workflow designed for multi-device Android development.

---

## Features

### Core ADB Control

- **One-click server actions**: Start, restart, and kill ADB server directly from the sidebar.
- **Live status in Status Bar**:
  - server health indicator (running/stopped/transitioning),
  - connected device counts with richer hover details.
- **Background polling + smart state updates**: Keeps UI aligned with real ADB status without manual refresh.
- **Intelligent device diffing**: Detects plug/unplug/state transitions and reflects them in VS Code quickly.

### Wireless Pairing & Connectivity

- **QR-based pairing (Android 11+)**: Generate a pairing QR flow in-editor and pair from phone camera.
- **Code-based pairing fallback**: Pair via IP, pairing port, and 6-digit code.
- **mDNS discovery support**: Listens for `_adb-tls-pairing` / `_adb-tls-connect` broadcasts.
- **Auto-connect workflow**: After pairing, tracks connection advertisement and connects automatically where possible.
- **Port scan support for difficult networks**: Helps discover active ADB connect ports when network behavior is inconsistent.

### Device Productivity & UX

- **Integrated device shell launcher**: Open VS Code terminal directly into `adb -s <serial> shell`.
- **Multi-device shell handling**: Quickly spin up separate terminal sessions for different devices.
- **Custom target support**: Manually target serials/IP endpoints for non-standard workflows.
- **Theme-native UI**: Uses VS Code theme variables for consistent appearance across themes.

### Developer Experience

- **ADB detection and install assist**:
  - searches common local ADB paths,
  - checks package managers (brew, apt, winget, choco, scoop, pacman, etc.),
  - guides installation when missing.
- **Zero heavy frontend dependency model** in webviews (vanilla DOM + extension messaging).
- **Clear separation of concerns** between backend command logic and webview rendering logic.

---

## Tech Stack

| Layer                | Technologies                               |
| -------------------- | ------------------------------------------ |
| Language             | TypeScript (primary), JavaScript (minimal) |
| Runtime              | Node.js 20.x                               |
| Editor Platform      | VS Code Extension API                      |
| UI Rendering         | VS Code Webviews (HTML/CSS/Vanilla JS)     |
| Device Communication | Android Debug Bridge (ADB CLI)             |
| Network Discovery    | `bonjour-service` (mDNS / DNS-SD)          |
| QR Generation        | `qrcode`                                   |
| Process Execution    | `child_process.exec`                       |
| License              | MIT                                        |

---

## Getting Started

### Prerequisites

- **Visual Studio Code**: `^1.85.0`
- **OS**: Windows 10/11, macOS (Intel/Apple Silicon), or modern Linux
- **ADB (Platform-Tools)**:
  - Optional before install (AdbZen can help install it),
  - recommended to have available in `PATH` for smoothest startup.

### Installation

1. Open **Visual Studio Code**.
2. Go to **Extensions** (`Ctrl+Shift+X` on Windows/Linux, `Cmd+Shift+X` on macOS).
3. Search for **AdbZen**.
4. Click **Install**.
5. Open the AdbZen view from the Activity Bar (Android device icon).

For local development from source:

```bash
git clone https://github.com/tanishqmudaliar/AdbZen.git
cd AdbZen
npm install
code .
```

Then press `F5` in VS Code to launch an Extension Development Host.

---

## Project Structure

```text
AdbZen/
├── src/
│   ├── extension.ts        # Extension activation, status bar updates, provider wiring
│   ├── adb.ts              # ADB command execution, parsing, detection, package manager probing
│   ├── webview.ts          # Main view HTML/CSS/JS generation and UI behavior
│   ├── wireless.ts         # Wireless pairing flows (QR/code), mDNS scanning, auto-connect logic
│   └── shell.ts            # Device shell webview + terminal spawn messaging
├── package.json            # Extension manifest, contributions, scripts, metadata
├── tsconfig.json           # TypeScript config
├── README.md               # Project documentation
└── LICENSE                 # MIT license
```

---

## Architecture

AdbZen follows a two-context architecture native to VS Code extensions:

1. **Extension Host (Node.js context)**  
   Owns ADB process execution, status polling, parsing, and system/network interactions.
2. **Webview UI (sandboxed Chromium context)**  
   Renders interactive panels (Main, Wireless, Shell), receives state updates, dispatches user actions.

### Communication Pattern

- Webview sends intent (`vscode.postMessage`) → Extension Host receives and executes command → Extension Host pushes updated state to webview (`webview.postMessage`) → UI rerenders.
- This avoids shared mutable state between sandboxed UI and backend process logic.
- State authority remains backend-first, improving resilience when webviews are recreated by VS Code.

### Key Design Choices

- **Webviews over TreeView** for richer interactivity (tabs, logs, form-driven pairing, dynamic cards).
- **Polling over long-lived `track-devices` stream** for practical reliability and easier recovery cross-platform.
- **Backend-authoritative device state** to avoid stale webview-only state.
- **Explicit ADB-not-found handling** with guided remediation instead of generic command errors.

---

## Usage Guide

### Main View (AdbZen)

Use this as command center for day-to-day operations:

- View server health and transition state.
- Monitor USB / wireless / emulator counts.
- Inspect connected/unauthorized devices.
- Start, restart, or kill server quickly.
- Review command/log feedback from extension actions.

### Wireless Pairing View

Three workflow modes are available:

- **QR Pair**: Fastest for supported Android 11+ wireless debugging setups.
- **Code Pair**: Manual fallback with IP + pairing port + 6-digit code.
- **Connect / Scan**: Useful when pairing succeeded but connect endpoint/port changes.

### Shell View

- Shows actionable device cards.
- One click opens terminal and injects `adb -s <serial> shell`.
- Supports manual custom target entry for edge/networked scenarios.

### Advanced Usage

- Operate mixed environments (USB + emulator + wireless) simultaneously.
- Open dedicated shell terminals per device for parallel debugging.
- Use connect scan flow in restrictive networks where mDNS broadcasts are filtered.

---

## Comprehensive File & Directory Breakdown

### `package.json`

The extension manifest and integration contract with VS Code.

**Responsibilities**

- Declares extension metadata and engine compatibility.
- Defines contributed views/containers in Activity Bar.
- Registers scripts and dependencies.

**Notable contribution points**

- `viewsContainers`: registers AdbZen container.
- `views`: registers main, wireless, and shell webview views.
- Dependencies include:
  - `bonjour-service` for local network service discovery,
  - `qrcode` for wireless QR flow.

---

### `src/extension.ts`

Primary extension entrypoint executed during activation.

**Responsibilities**

- Initializes status bar items and UI state loop.
- Registers webview providers.
- Coordinates command handling from webviews.
- Maintains periodic refresh/polling for ADB status/devices.

**Notable behavior**

- Device diffing logic compares prior/current snapshots for meaningful updates.
- Backend dispatches normalized state payloads to the active webview(s).
- Centralized orchestration for server control actions and UI synchronization.

---

### `src/adb.ts`

Core ADB operations and OS-facing command layer.

**Responsibilities**

- Wraps process execution safely.
- Parses `adb devices -l` output into typed structures.
- Detects ADB executable availability and fallback paths.
- Probes package manager availability for install guidance.
- Verifies server listening behavior via socket checks.
- Provides scanning helpers for wireless workflows.

**Why it matters**

- Isolates system command complexity from UI and extension control surfaces.
- Standardizes response format and error handling for upstream consumers.

---

### `src/webview.ts`

Main panel webview content generator.

**Responsibilities**

- Produces HTML/CSS/JS payload for the primary control view.
- Handles frontend message listeners for backend updates.
- Implements dynamic rendering for installed/missing ADB states.
- Applies VS Code theme variables for native look-and-feel.

**Frontend approach**

- Vanilla DOM manipulation (no heavy framework overhead).
- Lightweight state transitions based on backend message events.

---

### `src/wireless.ts`

Wireless debugging and pairing engine.

**Responsibilities**

- mDNS scanning for pairing/connect service advertisements.
- QR pairing flow generation and session handling.
- Manual pairing flow for constrained environments.
- Auto-connect orchestration after successful pair handshake.
- Tabbed UI behaviors for pairing/connect modes.

**Operational detail**

- Handles Android wireless debug lifecycle nuances (pair endpoint vs connect endpoint).
- Supports network fallback patterns when discovery is partially blocked.

---

### `src/shell.ts`

Device-shell-focused webview behavior and terminal integration.

**Responsibilities**

- Renders device actions for shell workflows.
- Requests up-to-date device information when view is active.
- Sends selected target to backend terminal creation flow.
- Supports manual target strings for custom setups.

**Result**

- Rapid context switching into per-device shells without command typing overhead.

---

## Configuration

AdbZen is designed to work with minimal manual setup, but runtime behavior depends on environment configuration:

| Config Area               | What to Set                                        | Why It Matters                                           |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| System `PATH`             | Include ADB binary location (`platform-tools`)     | Enables direct command execution without fallback lookup |
| VS Code Version           | `^1.85.0` or newer                                 | Required for extension compatibility                     |
| Node.js (for local build) | 20.x                                               | Ensures build/runtime compatibility in development       |
| Local Network             | Same Wi-Fi subnet for host + phone (wireless mode) | Required for reliable mDNS discovery and pairing flow    |
| Router Settings           | Disable AP/client isolation for wireless pairing   | Prevents peer blocking between dev machine and device    |

---

## Troubleshooting

| Problem                                    | Likely Cause                                         | Fix                                                                             |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| “ADB Not Installed” shown but ADB exists   | ADB not exposed in global `PATH`                     | Add `platform-tools` to `PATH`, restart VS Code, or use built-in install assist |
| QR pairing times out                       | Phone not actively scanning OR mDNS traffic filtered | Keep pairing screen open; if blocked, use Code Pair and Connect workflow        |
| Device remains “Unauthorized”              | ADB auth state cache mismatch                        | Restart ADB server from AdbZen and re-approve RSA prompt on device              |
| Wireless connect unstable                  | Dynamic connect port/network filtering               | Use connect scan flow and verify both devices are on same subnet                |
| Device not discoverable on corporate Wi-Fi | Client isolation/firewall policy                     | Switch network, disable isolation if possible, or use manual target approach    |

---

## Known Limitations

- Wireless workflows are sensitive to local network policy (mDNS and peer visibility).
- Behavior can vary across OEM Android implementations and security overlays.
- Port-scan fallback is practical but network-dependent on restricted environments.
- VS Code webview lifecycle means UI can be recreated; backend state authority mitigates this but does not eliminate all transient refresh moments.

---

## Roadmap

Planned enhancements include:

- **Logcat integration** with filtering/colorization.
- **APK sideload UX** for targeted device install flows.
- **Device file explorer** for pull/push workflows.
- **Optional screen mirroring integration** (e.g., `scrcpy`-style workflow).
- **Process/app controls** (force-stop / clear data style actions).

---

## Contributing

Contributions are welcome.

1. Fork the repo.
2. Create a branch: `git checkout -b feature/amazing-feature`
3. Make your changes with clear commits.
4. Run lint/build checks locally.
5. Push branch and open a Pull Request.

If reporting bugs, include:

- OS,
- VS Code version,
- device type/Android version,
- exact reproduction steps,
- relevant AdbZen logs/screenshots.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

Made with ❤️ by [Tanishq Mudaliar](https://github.com/tanishqmudaliar)

Stop typing IP addresses. Start coding. Find your Zen.
