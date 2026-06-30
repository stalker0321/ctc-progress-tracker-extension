# CTC Progress Tracker Extension

Manifest V3 Chromium-family browser extension for tracking progress on the Cracking the Cryptic sudoku list at `https://crackingthecryptic.com/sudokus`. It is intended to work in Chrome, Chromium, and Vivaldi.

## What it does

- Adds small controls beside each detected playable puzzle link: `Todo`, `Solved`, and `Clear`.
- Automatically marks a puzzle as `opened` when its playable puzzle link is clicked, but only when that puzzle has no existing status.
- Shows lightweight visual states on the list:
  - `untouched`: no stored record and no highlight
  - `opened`: subtle blue/neutral tint and badge
  - `todo`: stronger yellow/orange tint and badge
  - `solved`: green tint/badge and slightly faded row
- Adds page controls for `Show all`, `Hide solved`, and `Only todo`.
- Provides a popup with opened/todo/solved counts, storage diagnostics, JSON export, JSON import, and confirmed clear-all.

The extension does not sync SudokuPad grid progress and does not use a backend, Google OAuth, analytics, external tracking, or any VPS service.

## Installation in Chrome or Chromium

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/home/vodkolyan/projects/ctc-progress-tracker-extension`.
5. Visit `https://crackingthecryptic.com/sudokus`.

## Installation in Vivaldi

1. Open `vivaldi://extensions`.
2. Enable `Developer Mode`.
3. Click `Load unpacked`.
4. Select this folder: `/home/vodkolyan/projects/ctc-progress-tracker-extension`.
5. Visit `https://crackingthecryptic.com/sudokus`.

To confirm cross-device sync in Vivaldi, install the unpacked extension on both laptops, sign in with the same Vivaldi account, enable extension/storage sync if Vivaldi offers that setting, and use the popup's `Test sync write/read` action on each laptop.

## Storage behavior

Primary storage is `chrome.storage.sync`, so progress can sync through the browser account when the browser supports and enables extension sync storage. If `chrome.storage.sync` is unavailable or a sync operation fails, the extension falls back to `chrome.storage.local` and the popup shows `Local-only storage`.

The popup diagnostics show:

- whether the `chrome.storage.sync` API is available
- whether the active storage area is synced or local-only
- the last successful storage write time
- a `Test sync write/read` action, using local-only storage if sync is unavailable or has already failed

JSON export/import works with either synced or local-only storage.

Schema:

- Metadata key: `ctcProgress:meta`
- Shard keys: `ctcProgress:shard:0` through `ctcProgress:shard:63`
- Each shard is an object keyed by compact puzzle keys.
- Current CTC puzzle URLs like `https://crackingthecryptic.com/sudoku?id=3310` normalize to compact keys like `s:3310`.
- Stored records use short fields:
  - `s`: status code, one of `o`, `t`, or `s`
  - `t`: update timestamp in epoch milliseconds
  - `u`: normalized puzzle URL, included for human-readable export/import backups

Status codes:

- `o` = opened
- `t` = todo
- `s` = solved

The extension uses 64 shards because Chromium-family sync storage has small per-item limits. With the current CTC catalog size, this keeps each shard comfortably below typical per-item sync limits while avoiding one item per puzzle.

## Permissions

- `storage`: stores progress in browser extension storage.
- `https://crackingthecryptic.com/sudokus*`: injects the progress controls only on the CTC sudoku list page.

No broader site permissions are requested.

## Known fragile parts

- The live page currently renders puzzle entries as list items containing playable links like `/sudoku?id=3310` and separate watch links like `/sudokuwatch?id=3310`.
- Detection intentionally keys only on playable `/sudoku?id=...` links and ignores watch links.
- Row detection prefers the nearest `li`, then falls back to nearby row-like containers. If CTC changes to a very different layout, controls may appear in a less ideal location or not appear.
- The extension observes DOM changes and rescans defensively, but it does not depend on any official CTC API.
- Filter results may not be covered if CTC navigates away from `/sudokus`, because the extension intentionally requests only the minimal sudoku-list host permission.

## Manual test checklist

- Load the unpacked extension and open `https://crackingthecryptic.com/sudokus`.
- Confirm each puzzle row gets `Todo`, `Solved`, and `Clear` controls.
- Click a puzzle title and confirm it is marked `opened` after returning to the list.
- Set a puzzle to `Todo`, click its title, and confirm it remains `Todo`.
- Set a puzzle to `Solved`, click its title, and confirm it remains `Solved`.
- Change a `Todo` puzzle to `Solved`.
- Clear a `Solved` puzzle and confirm the highlight and badge disappear.
- Use `Hide solved`, `Only todo`, and `Show all`.
- Open the extension popup and confirm counts match visible statuses.
- Confirm the popup shows synced storage or local-only storage clearly.
- Run `Test sync write/read` in the popup.
- Export JSON, clear all data, import the JSON, and confirm statuses are restored.
- In Vivaldi, repeat storage tests on both laptops while signed into the same Vivaldi account to verify actual browser sync behavior.
