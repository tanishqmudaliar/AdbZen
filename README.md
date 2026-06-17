# AdbZen: The Ultimate Android Debug Bridge Manager for VS Code

![VS Code](https://img.shields.io/badge/VS_Code-^1.85.0-007ACC?logo=visual-studio-code&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3.0-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/Status-Active_Development-brightgreen)

---

#### Video Demo: https://www.youtube.com/watch?v=BD9QanAADw0

#### Description:

AdbZen is a comprehensive, feature-rich Android Debug Bridge (ADB) manager built as an extension for Visual Studio Code. It is meticulously designed to streamline the workflow of Android developers, React Native engineers, Flutter developers, and embedded systems programmers who frequently interact with physical Android devices or emulators.

Traditionally, managing ADB requires constantly switching contexts between the code editor and an external terminal window, memorizing tedious Command Line Interface (CLI) commands, and manually typing IP addresses and pairing codes to establish wireless debugging sessions. These friction points disrupt the development flow and cause unnecessary context switching.

AdbZen solves these problems by deeply integrating ADB control directly into the VS Code interface via the Sidebar and Status Bar. It provides an intuitive, high-performance Graphical User Interface (GUI) to start, stop, and restart the ADB server, view connected devices in real-time, establish wireless connections via dynamic QR codes or mDNS broadcasting, and launch device-specific terminal shells with a single click. AdbZen acts as the bridge between your code and your test devices, completely removing the need to ever touch the raw ADB CLI again.

This extension was constructed using TypeScript, Node.js, and the VS Code Extension API. It relies heavily on VS Code's Webview API to render modern, responsive HTML/CSS/JS interfaces that dynamically adapt to the user's active IDE theme.

---

## Table of Contents

1. [Features Overview](#features-overview)
2. [Prerequisites and Installation](#prerequisites-and-installation)
3. [Comprehensive File & Directory Breakdown](#comprehensive-file--directory-breakdown)
   - [package.json](#1-packagejson)
   - [src/extension.ts](#2-srcextensionts)
   - [src/adb.ts](#3-srcadbts)
   - [src/webview.ts](#4-srcwebviewts)
   - [src/wireless.ts](#5-srcwirelessts)
   - [src/shell.ts](#6-srcshellts)
4. [In-Depth Design Choices](#in-depth-design-choices)
5. [User Interface Guide](#user-interface-guide)
6. [Under the Hood: Architecture](#under-the-hood-architecture)
7. [Advanced Usage](#advanced-usage)
8. [Troubleshooting & FAQ](#troubleshooting--faq)
9. [Development & Building from Source](#development--building-from-source)
10. [Roadmap & Future Enhancements](#roadmap--future-enhancements)
11. [Author & Acknowledgements](#author--acknowledgements)

---

## Features Overview

AdbZen is packed with utility features designed to save seconds on every interaction, which translates to hours saved over a development lifecycle.

- **Status Bar Integration:** A permanent, real-time indicator in the VS Code bottom status bar. It shows whether the ADB server is running, starting, or stopped, and displays a live count of connected USB and Wireless devices.
- **Intelligent Device Diffing:** AdbZen monitors your connected devices in the background. If a device is plugged in, unplugged, or changes state (e.g., from "unauthorized" to "connected"), VS Code native toast notifications alert you immediately.
- **One-Click Server Management:** Start, Kill, or Restart the ADB server directly from the sidebar. No more typing `adb kill-server` and `adb start-server`.
- **Wireless QR Code Pairing:** Android 11+ supports wireless debugging. AdbZen generates a secure QR code right in your editor. Scan it with your phone, and AdbZen handles the mDNS negotiation and pairs the device automatically.
- **Wireless Code Pairing:** Fallback support for pairing via the 6-digit code method provided by Android Developer Options.
- **Auto-Connect:** Once paired wirelessly, AdbZen actively scans the network for the device's secondary debug port broadcast and connects automatically.
- **Automated ADB Installation:** If ADB is missing from your system, AdbZen detects your OS and package manager (Homebrew, apt, winget, choco, pacman, etc.) and offers a one-click installation button.
- **Integrated Device Shells:** Instantly open a native VS Code terminal tab bound to a specific device's shell (`adb -s <serial> shell`). Perfect for multi-device testing.
- **Custom Theming Engine:** All UI components use VS Code's internal CSS variables, meaning AdbZen looks flawless whether you use Monokai, Dracula, or the default Light theme.

---

## Prerequisites and Installation

### Prerequisites

- **Visual Studio Code:** Version 1.85.0 or higher.
- **Operating System:** Windows 10/11, macOS (Intel or Apple Silicon), or any modern Linux distribution.
- **Android SDK Platform-Tools (ADB):** While AdbZen can install ADB for you, having it pre-installed and added to your system's PATH environment variable provides the smoothest experience.

### Installation Instructions

1.  Open Visual Studio Code.
2.  Navigate to the Extensions view by clicking the square icon on the left Activity Bar or pressing `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS).
3.  Search for **AdbZen**.
4.  Click **Install**.
5.  Once installed, a new Android device icon will appear on your Activity Bar. Click it to open the AdbZen control panel.

---

## Comprehensive File & Directory Breakdown

To fulfill the requirements of this project and provide complete transparency into the codebase, below is an exhaustive breakdown of the 6 core files located in the `src/` directory and the `package.json` manifest. These files represent the entirety of the application logic.

### 1. `package.json`

The `package.json` file is the central nervous system of any Node.js project and the manifest for the VS Code extension.

**Key Responsibilities:**

- **Metadata Declaration:** Defines the extension name (`adbzen`), display name, version, and description.
- **Engine Requirements:** Enforces the minimum VS Code compatibility (`"vscode": "^1.85.0"`).
- **Extension Contributions (`contributes`):** This is where AdbZen integrates into the VS Code UI.
  - `viewsContainers`: Registers the AdbZen logo icon in the left-hand Activity Bar.
  - `views`: Registers three distinct Webview panels inside that container: `adbzen.mainView` (Main Control), `adbzen.wirelessView` (Wireless Pairing), and `adbzen.shellView` (Device Shells).
- **Dependencies:**
  - `bonjour-service`: Crucial for mDNS (Multicast DNS) discovery. It allows the extension to scan the local Wi-Fi network for Android devices broadcasting their pairing and connection services.
  - `qrcode`: Used to generate base64 data URLs of QR codes for the touchless wireless pairing feature.
- **Scripts:** Standard npm scripts for compilation (`tsc`) and watch modes.

### 2. `src/extension.ts`

This is the primary entry point for the extension. When VS Code fires the activation event, the `activate(context: vscode.ExtensionContext)` function inside this file is executed.

**Key Responsibilities & Functions:**

- **Status Bar Initialization:** It creates two `vscode.StatusBarItem` instances.
  - `statusDotItem`: Displays a colored circle indicating server health (Green for running, Red for stopped, Amber for transitioning).
  - `statusBarItem`: Displays the device counts with rich hover tooltips.
- **Background Polling Engine:** It sets up a `setInterval` loop that ticks every 3000 milliseconds. On every tick, it queries the ADB status asynchronously and updates the status bar elements to reflect real-time changes without blocking the main UI thread.
- **Device Diffing (`diffDevices`):** A sophisticated function that compares the previous array of connected devices against the current array. By utilizing JavaScript `Map` structures, it accurately detects newly connected devices, disconnected devices, and devices that have changed states (e.g., from `unauthorized` to `device`). It then triggers native `vscode.window.showInformationMessage` toasts to alert the developer.
- **Webview Provider Registration:** It binds the logical classes (`AdbZenViewProvider`, `WirelessViewProvider`, `ShellViewProvider`) to their respective string IDs defined in the `package.json`.
- **Main View Logic (`AdbZenViewProvider`):** Contains the event listeners for the main panel, handling messages dispatched from the frontend HTML (like "start", "kill", "restart", and "installAdb"). It executes the corresponding CLI commands and feeds the stdout/stderr back to the frontend's command log.

### 3. `src/adb.ts`

This file acts as the bridge between the Node.js JavaScript environment and the underlying system's `adb` binary executable. It heavily utilizes `child_process.exec` to spawn system commands.

**Key Responsibilities & Functions:**

- **Strong Typing:** Defines exact TypeScript interfaces for `AdbDeviceState`, `AdbConnectionType`, `AdbDevice`, and `AdbStatus`. This ensures type safety across the entire extension.
- **Process Execution (`run`):** A Promisified wrapper around `child_process.exec`. It captures `stdout`, `stderr`, and exit codes safely.
- **Output Parsing (`parseAdbDevices`):** The raw string output of `adb devices -l` is notoriously difficult to parse consistently. This function splits the string by newlines, uses regex to separate columns, and parses key-value pairs (like `model:Pixel_6` or `device:oriole`). It also intelligently detects if a connection is USB, an Emulator, or Wireless based on regex patterns in the serial number.
- **Socket Verification (`isAdbServerListening`):** Instead of relying purely on CLI outputs to check if the server is running, this function attempts to open a raw TCP socket (`net.Socket`) to `127.0.0.1:5037` (the default ADB daemon port). This is significantly faster and more reliable than running a full command.
- **Fallback Paths & Detection:** If ADB is not found in the global PATH, `findAdbInCommonPaths()` searches OS-specific directories (e.g., `/opt/homebrew/bin/adb` on Mac, `C:\Android\platform-tools` on Windows).
- **Package Manager Detection:** `detectPackageManagers()` tests the system for `brew`, `winget`, `choco`, `apt`, `dnf`, etc., so the extension can automatically generate the correct installation command if ADB is missing entirely.
- **Mass Port Scanning (`scanAdbPorts`):** A highly concurrent TCP port scanner used in the Wireless tab. It attempts to connect to a massive range of ports (37000 to 47000) on a target IP address using batches of 400 concurrent sockets with tight timeouts to rapidly find open ADB pairing ports.

### 4. `src/webview.ts`

This file houses the HTML, CSS, and client-side JavaScript for the Main Status View. Instead of loading an external HTML file, the entire view is returned as a massive string literal from the `getAdbZenHtml()` function.

**Key Responsibilities:**

- **Zero-Dependency Frontend:** To maximize load speed and minimize memory footprint, no frontend frameworks (React, Vue, Angular) are used. Everything is Vanilla DOM manipulation.
- **Dynamic UI Rendering:** The embedded `<script>` tag handles incoming messages from the Extension Host. Based on the JSON payload, it toggles CSS classes to show/hide the "Not Installed" hero screen, updates the status dots, modifies the meta-information table (showing USB vs Wireless vs Emulator counts), and populates the device list cards.
- **Automated Install UI:** If the backend detects ADB is missing, this view dynamically renders an installation screen showing exactly which package manager is available and provides a button to run the install command in a VS Code terminal.
- **VS Code Theming Integration:** The CSS relies exclusively on CSS Variables injected by the VS Code host (e.g., `var(--vscode-sideBar-background)`, `var(--vscode-foreground)`, `var(--vscode-widget-border)`). This guarantees the UI looks native regardless of the user's color theme.

### 5. `src/wireless.ts`

This is arguably the most mathematically and logically complex file in the project. It handles the intricate dance of Wireless Pairing introduced in Android 11.

**Key Responsibilities & Functions:**

- **mDNS Scanning (`MdnsScanner` class):** Wraps the `bonjour-service` library. It listens for specific DNS-SD broadcasts (`adb-tls-pairing` and `adb-tls-connect`) on the local network.
- **QR Code Flow (`_startQrFlow`):** 1. Generates a cryptographically random 6-digit password. 2. Constructs a special Wi-Fi connection string payload (`WIFI:T:ADB;S:ADBZen;P:123456;;`). 3. Uses the `qrcode` library to render this as a Base64 image and displays it to the user. 4. Simultaneously begins scanning the network for the pairing broadcast. 5. When the user scans the code, the phone broadcasts its IP and temporary port. The scanner catches this, extracts the IP/Port, and automatically executes `adb pair <ip>:<port> <password>`.
- **Auto-Connect Flow (`_autoConnect`):** After successful pairing, the Android device closes the pairing port and opens a random connection port, broadcasting it via `adb-tls-connect`. The extension immediately scans for this new broadcast and issues the `adb connect` command, making the entire wireless process touchless.
- **Manual Pairing:** Provides an alternative tab for users to manually input the IP, pairing port, and 6-digit code if their camera is broken or the network blocks mDNS traffic.
- **Tabbed Interface:** The HTML payload includes a fully functional tabbed interface (QR Pair, Code Pair, Connect) managed via lightweight Vanilla JS.

### 6. `src/shell.ts`

This file implements the "Shell" Webview, designed for rapid, multi-device terminal access.

**Key Responsibilities & Functions:**

- **Isolated Polling:** While the main extension polls for status, this view independently requests a refresh of the device list when active, rendering each device as an interactive card.
- **Native Terminal Spawning:** When a user clicks the "Open Shell" button on a device card, the frontend dispatches a message containing the device's serial number. The backend `ShellViewProvider` intercepts this and uses the VS Code API `vscode.window.createTerminal()` to spawn a brand new terminal instance.
- **Command Injection:** Once the terminal is created, it automatically injects the command `adb -s <serial> shell` and forces the terminal to show. This provides an instant, isolated bash/sh environment on the selected device.
- **Custom Target Handling:** Allows users to manually type an IP address or serial number to open a shell for a device that might be hidden, located on a remote server, or connected via a reverse proxy.

---

## In-Depth Design Choices

During the architecture and development of AdbZen, several critical design decisions were made to balance performance, usability, code maintainability, and the strict sandboxing rules of Visual Studio Code.

### 1. Webviews vs. Native TreeViews

VS Code offers a native "TreeView" API for sidebar extensions (which looks and behaves exactly like the standard File Explorer). Initially, this seemed like the logical choice for listing connected devices.
**The Choice:** I opted to use HTML-based Webviews instead.
**The Reasoning:** TreeViews are heavily restricted by the VS Code API. You can only display plain text, basic icons, and context menus. Because AdbZen required complex interactive elements—such as displaying dynamically generated QR codes, input forms for 6-digit pairing codes, real-time command output logs, and horizontal progress bars for port scanning—Webviews were the _only_ viable choice. To mitigate the performance overhead of loading full web pages in the sidebar, I rigorously avoided bundling external heavy frameworks like React, Vue, or Tailwind.

### 2. Polling vs. Event Listeners for ADB Status

The extension needs to know the exact moment a device is plugged in or unplugged to update the UI and trigger notifications. ADB provides a long-running command called `adb track-devices` which keeps a persistent connection open and emits a text stream of events.
**The Choice:** I chose to use a simple polling mechanism (`setInterval` running `adb devices` every 3 seconds) rather than maintaining a persistent stream.
**The Reasoning:** While `track-devices` is theoretically a "cleaner" event-driven approach, it is notoriously brittle across different operating systems (especially Windows). If the VS Code extension host crashes or reloads, it can easily leave zombie `adb` processes running in the background, consuming memory. ADB is highly optimized by Google to respond to the `adb devices` command instantly via its background daemon, meaning the CPU overhead of polling is virtually zero, but the reliability and fault tolerance is absolutely perfect.

### 3. Centralized vs. Decentralized State

**The Choice:** Application state (like the master list of connected devices) is kept authoritative in the Extension Host (`extension.ts`), which pushes updates _down_ to the Webviews.
**The Reasoning:** VS Code Webviews are essentially sandboxed iframes. They can be dynamically destroyed and recreated by the editor when the user hides or shows the sidebar, or switches panels. By keeping the "source of truth" in the background Node.js process and pushing it to the UI via `postMessage`, the UI can instantly and flawlessly recover its state without needing to re-query the operating system.

### 4. Handling Missing ADB Executables

Many junior developers struggle to configure their system PATH variables correctly.
**The Choice:** Instead of throwing a generic "ADB command not found" error, the extension actively searches the file system and interrogates the OS.
**The Reasoning:** Good tooling should assist the user, not just report failures. If the executable exists but isn't in the PATH, the extension tells the user exactly where it was found (e.g., `C:\Android\platform-tools`). If it doesn't exist at all, the code dynamically checks for the presence of `brew`, `winget`, `choco`, or `apt` and provides a localized, one-click button to install the Android platform tools. This dramatically reduces the barrier to entry for new developers.

### 5. Separation of Concerns in Webview Panels

**The Choice:** The UI is split into three distinct Webview panels (Main Status, Wireless Pairing, Shell Access) rather than one massive, scrolling page.
**The Reasoning:** This mimics native VS Code behavior (similar to the Source Control tab, which has separate collapsible dropdown sections for Commits, Branches, and Changes). It allows users to collapse panels they aren't actively using (for example, hiding the Wireless panel entirely if they only ever use USB connections) to save valuable vertical screen real estate in the sidebar.

---

## User Interface Guide

### Main View (AdbZen)

This is your command center.

- **Status Banner:** Shows the current server status. A green dot means running, red means stopped, and spinning amber means it is currently executing a startup/shutdown command.
- **Metrics Panel:** Displays a breakdown of your connections. It categorizes them by USB, Wireless, and Emulators. It also highlights "Unauthorized" devices, reminding you to look at your phone screen and tap the RSA key fingerprint "Allow" prompt.
- **Connected Devices List:** A card-based list showing device serial numbers, connection types, and internal codenames (e.g., `pixel_6`).
- **Server Controls:** Three primary buttons: **Start Server**, **Restart Server**, and **Kill Server**.
- **Command Log:** A terminal-like window at the bottom of the panel that echoes every background command the extension runs, giving you total transparency into what the system is doing.

### Wireless Pairing View

- **QR Pair Tab:** The fastest way to connect. Open Developer Options on your phone, navigate to Wireless Debugging, select "Pair device with QR code", and point your camera at the screen. AdbZen handles the rest automatically.
- **Code Pair Tab:** If your camera is broken, select "Pair device with pairing code" on your phone. Note the 5-digit port and the 6-digit code. Enter them into the input fields in this tab.
- **Connect Tab:** Used for managing active wireless connections. It features a "Scan Ports" button. If you know your device's IP but the port keeps changing, hit scan, and AdbZen will aggressively probe the IP to find the open debug port for you.

### Shell View

- **Device Cards:** Similar to the main view, but optimized for action.
- **Open Shell Button:** Clicking this opens a standard VS Code terminal tab and drops you straight into the root or user shell of the selected device.
- **Custom Target:** A text input at the bottom allowing you to manually type a connection string if you are working with remote adb servers over VPNs.

---

## Under the Hood: Architecture

### The Communication Bridge

Because VS Code Extensions run in a separate Node.js process from the Webview (which runs in a Chromium sandbox), they cannot share memory or variables directly.

AdbZen utilizes a robust Message Passing architecture:

1.  **Frontend to Backend:** When a user clicks a button (e.g., "Kill Server"), the frontend JS executes:
    ```javascript
    vscode.postMessage({ command: "kill" });
    ```
2.  **Backend Interception:** The `extension.ts` file listens for this message:
    ```typescript
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "kill") {
        await this._killServer();
      }
    });
    ```
3.  **System Execution:** The backend executes the raw CLI command using `child_process`.
4.  **Backend to Frontend:** The backend gathers the results and pushes state back down:
    ```typescript
    this._view.webview.postMessage({ command: "status", data: newStatus });
    ```
5.  **Frontend Rendering:** The frontend JS catches the `status` message and updates the DOM elements.

### Bonjour/mDNS Service Discovery

Android's wireless debugging relies on DNS-Based Service Discovery (DNS-SD) over Multicast DNS (mDNS).
When a device is ready to pair, it broadcasts a service of type `_adb-tls-pairing._tcp.local`.
The `bonjour-service` library in `wireless.ts` joins the multicast group on the local Wi-Fi interface and listens for these UDP packets. Once a packet matches the service signature, AdbZen extracts the IP address and the dynamically assigned port, allowing it to execute the pairing command without the user ever typing an IP address.

---

## Advanced Usage

### Working with Multiple Devices

AdbZen excels when testing applications across multiple devices simultaneously.
If you have a physical phone on USB, an emulator running, and a tablet connected wirelessly:

1.  All three will appear cleanly in the **AdbZen** main list.
2.  Navigate to the **Shell** tab.
3.  You can open three separate terminal tabs by clicking "Open Shell" on each card. VS Code will automatically name the terminal tabs based on the device serial/model, keeping your workspaces highly organized.

### Troubleshooting Network Configurations

If Wireless Pairing fails, it is almost always a local network issue.

- Ensure both your development machine and the Android device are on the exact same Wi-Fi SSID.
- Ensure your router does not have "Client Isolation" or "AP Isolation" enabled (which prevents devices on the same Wi-Fi from talking to each other).
- If mDNS broadcasts are being dropped by a corporate firewall, fall back to the **Connect** tab, enter the IP manually, and use the **Scan Ports** feature.

---

## Troubleshooting & FAQ

**Q: AdbZen says "ADB Not Installed" but I know I have it!**
A: This means ADB is not in your system's global `PATH` environment variable. AdbZen attempts to look in common default directories, but if you installed it in a custom location, you must add that folder to your OS PATH. Alternatively, check the AdbZen UI—it might have found it and will show you the exact path it discovered. Restart VS Code after updating your PATH.

**Q: The QR Code pairing is timing out.**
A: Ensure your phone is awake and the camera is actively scanning the code. The mDNS broadcast only happens while the phone's QR scanning screen is active. If it still fails, your network might be blocking mDNS packets.

**Q: I authorized the device on my phone, but AdbZen still says "Unauthorized".**
A: ADB sometimes caches the RSA key status. Click the **Restart Server** button in the AdbZen main panel. This will kill the daemon, restart it, and force a fresh handshake with your device.

**Q: Can I use this with remote servers?**
A: Yes. If you have an ADB daemon running on a remote server with exposed ports, you can use the Custom Target input in the Shell tab or the Connect tab to establish a TCP/IP connection.

---

## Development & Building from Source

If you wish to contribute to AdbZen or compile it yourself from source:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/tanishqmudaliar/AdbZen.git](https://github.com/tanishqmudaliar/AdbZen.git)
    cd AdbZen
    ```
2.  **Install dependencies:**
    Ensure you have Node.js v20+ installed.
    ```bash
    npm install
    ```
3.  **Open in VS Code:**
    ```bash
    code .
    ```
4.  **Run the Extension:**
    Press `F5`. This will compile the TypeScript code and launch a new VS Code window (Extension Development Host) with AdbZen loaded.
5.  **Watch Mode:**
    Run `npm run watch` in the terminal. Any changes you make to the `.ts` files will automatically be recompiled. Use `Ctrl+R` in the Development Host window to reload the extension.

---

## Roadmap & Future Enhancements

The vision for AdbZen is to completely replace external ADB GUI tools (like Android Studio's Device Manager) for VS Code users.

**Planned Features for v1.x:**

- **Logcat Integration:** A dedicated Webview panel to stream, filter, and colorize Android logcat output directly inside VS Code.
- **APK Sideloading:** Drag-and-drop functionality to instantly push and install `.apk` files to specific devices.
- **File Explorer:** A visual file browser for the Android file system, allowing easy pulling and pushing of database files, preferences, and assets.
- **Screen Mirroring:** Integration with `scrcpy` to embed a live, interactive video feed of the device screen within a VS Code editor tab.
- **Process Management:** UI to quickly force-stop or clear data for specific application packages.

---

## Contributing

Contributions are highly encouraged! Please feel free to submit Pull Requests or open Issues for bugs and feature requests.

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-feature`).
3.  Adhere to the project's ESLint rules (run `npx eslint .` to check).
4.  Commit your changes (`git commit -m 'Add amazing feature'`).
5.  Push to the branch (`git push origin feature/amazing-feature`).
6.  Open a Pull Request.

---

## License

This project is open-source and distributed under the terms of the [MIT License](LICENSE).

---

## Author & Acknowledgements

Created and maintained by **Tanishq Mudaliar**.

Special thanks to the Open Source community, the creators of the `qrcode` and `bonjour-service` npm packages, and the VS Code Extension API documentation team.

_Stop typing IP addresses. Start coding. Find your Zen._
