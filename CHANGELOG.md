# Changelog

All notable changes to the "adbzen" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-09-26

### Added

- Automatic VS Code Marketplace publishing for tagged releases.
- Release notes generated directly from the matching changelog section.

### Fixed

- Manual release runs now correctly use the selected version tag when creating a GitHub Release.

## [1.1.0] - 2026-09-26

### Added

- Repository CI, CodeQL, dependency review, Dependabot, and tag-based VSIX release automation.

### Changed

- ADB server lifecycle handling now preserves the daemon when VS Code closes.
- Background device polling no longer resurrects an intentionally stopped ADB server.
- Added ESLint validation and VSIX packaging support.

## [1.0.0] - 2026-07-14

### Changed

- **Stable Release:** Promoted version `0.0.2` to `1.0.0` to mark the first official, stable, and production-ready release of AdbZen.

## [0.0.2] - 2026-07-14

### Added

- **WinGet ADB Detection:** Automatically scans the WinGet packages directory (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_*`) for `adb.exe`, significantly improving detection for users who installed Platform Tools via Windows Package Manager.

### Changed

- **Windows PATH Optimization:** The "Add to PATH" feature now writes directly to **User** environment variables instead of System variables. This removes the UAC/Administrator elevation prompt and makes the change immediately visible in user settings.

### Fixed

- **Status Check Efficiency:** Eliminated redundant intermediate variables in `getAdbStatus`. Mismatch detection now reads directly from `list.stderr` for faster parsing.
- **Socket Resource Handling:** Removed redundant boolean guards from `isAdbServerListening` and `scanAdbPorts` callbacks. `socket.destroy()` is now used to suppress trailing events and release network resources.
- **String Parsing:** Removed unnecessary `.trim()` calls on token keys in `parseKeyValues` that were already split by whitespace.

## [0.0.1] - 2026-07-01

### Added

- **Core ADB Management:** Start, stop, and restart the ADB server directly from the VS Code sidebar GUI.
- **Smart Status Bar:** Real-time tracking of ADB server state, including device counts separated by USB, Wireless, and Unauthorized states.
- **Wireless Pairing (mDNS):** Seamlessly pair Android 11+ devices over Wi-Fi using automated QR code generation or standard 6-digit pairing codes.
- **Interactive Shell View:** View all connected devices and launch a dedicated VS Code terminal for `adb shell` with a single click.
- **Auto-Installation:** Automatic detection of missing ADB installations with 1-click install support via package managers (Homebrew, winget, Chocolatey, Scoop, apt, dnf, pacman, etc.).
- **Smart Notifications:** Real-time VS Code native toast notifications for device connections, disconnections, and RSA authorization changes.
- **Command Log Terminal:** Integrated terminal view in the sidebar to track all raw CLI commands executed by AdbZen and their outputs.

[Unreleased]: https://github.com/tanishqmudaliar/AdbZen/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/tanishqmudaliar/AdbZen/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/tanishqmudaliar/AdbZen/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/tanishqmudaliar/AdbZen/compare/v0.0.2...v1.0.0
[0.0.2]: https://github.com/tanishqmudaliar/AdbZen/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/tanishqmudaliar/AdbZen/releases/tag/v0.0.1
