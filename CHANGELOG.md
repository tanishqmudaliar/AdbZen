# Changelog

All notable changes to the "adbzen" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - Initial Release

### Added

- **Core ADB Management:** Start, stop, and restart the ADB server directly from the VS Code sidebar.
- **Smart Status Bar:** Real-time tracking of the ADB server state, including device counts separated by USB, Wireless, and Unauthorized states.
- **Wireless Pairing (mDNS):** Seamlessly pair Android devices over Wi-Fi using automated QR code generation or 6-digit pairing codes.
- **Interactive Shell View:** View all connected devices and launch a dedicated VS Code terminal for `adb shell` with a single click.
- **Auto-Installation:** Automatic detection of missing ADB installations with 1-click install support via package managers (Homebrew, winget, apt, dnf, pacman, etc.).
- **Smart Notifications:** Real-time VS Code notifications for device connections, disconnections, and authorization changes.
- **Command Log Terminal:** Integrated terminal view within the sidebar to track all raw commands executed by AdbZen and their outputs.
