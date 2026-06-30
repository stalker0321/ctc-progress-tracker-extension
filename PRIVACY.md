# Privacy

CTC Progress Tracker is designed as a privacy-friendly browser extension.

- Puzzle status data is stored only in the browser's extension storage: `chrome.storage.sync` when available, or `chrome.storage.local` as a local-only fallback.
- No puzzle status data is sent to any server owned by the author or VPS operator.
- The extension has no backend service.
- The extension does not use analytics, telemetry, advertising, external tracking, or Google OAuth.
- JSON export/import is fully user-controlled. Export creates a local backup file, and import reads a user-selected JSON file.

The only requested host permission is for `https://crackingthecryptic.com/sudokus*`, where the extension injects the progress controls.
