# Changelog

All notable changes to the "adbzen" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - Bug Fixes & Code Quality

### Fixed

- **Add to PATH (Windows):** PATH entry is now written to **User** environment variables instead of System, making it immediately visible under "User variables" in the Environment Variables dialog. The UAC/admin elevation prompt has been removed — no administrator rights required.
- **ADB status check:** Eliminated a redundant `deviceErrors` intermediate variable in `getAdbStatus`; mismatch detection now reads directly from `list.stderr`, and the early-return path when the server is not running avoids an unnecessary trailing return.

### Changed

- **WinGet ADB path detection:** `findAdbInCommonPaths` on Windows now also scans the WinGet packages directory (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_*`) for `adb.exe`, improving detection for users who installed Platform Tools via `winget`.

### Internal

- Removed redundant `.trim()` call on already-whitespace-split token keys in `parseKeyValues`.
- Inlined the unused `normalized` intermediate variable in `detectConnectionType`.
- Removed the redundant `done` boolean guard from `isAdbServerListening` and `scanAdbPorts` socket callbacks; `socket.destroy()` is sufficient to suppress further events in both cases.

---

## [0.0.1] - Initial Release

### Added

- **Core ADB Management:** Start, stop, and restart the ADB server directly from the VS Code sidebar.
- **Smart Status Bar:** Real-time tracking of the ADB server state, including device counts separated by USB, Wireless, and Unauthorized states.
- **Wireless Pairing (mDNS):** Seamlessly pair Android devices over Wi-Fi using automated QR code generation or 6-digit pairing codes.
- **Interactive Shell View:** View all connected devices and launch a dedicated VS Code terminal for `adb shell` with a single click.
- **Auto-Installation:** Automatic detection of missing ADB installations with 1-click install support via package managers (Homebrew, winget, Chocolatey, Scoop, apt, dnf, pacman, etc.).
- **Smart Notifications:** Real-time VS Code notifications for device connections, disconnections, and authorization changes.
- **Command Log Terminal:** Integrated terminal view within the sidebar to track all raw commands executed by AdbZen and their outputs.
