(function initCtcProgressContent() {
  "use strict";

  const storage = globalThis.CtcProgressStorage;
  const STATE_CLASS_PREFIX = "ctc-progress-state-";
  let currentFilter = "all";
  let scanTimer = null;
  let solvedPopupDetected = false;

  function currentUrl() {
    return new URL(window.location.href);
  }

  function isListPage() {
    const path = currentUrl().pathname;
    return path === "/sudokus" || path === "/filter";
  }

  function isPuzzlePage() {
    const url = currentUrl();
    return url.hostname === "crackingthecryptic.com" &&
      url.pathname === "/sudoku" &&
      url.searchParams.has("id");
  }

  function isSudokuPadPage() {
    return currentUrl().hostname === "sudokupad.app";
  }

  function isPlayablePuzzleLink(anchor) {
    try {
      const url = new URL(anchor.href, window.location.href);
      return url.hostname === "crackingthecryptic.com" &&
        url.pathname === "/sudoku" &&
        url.searchParams.has("id");
    } catch (_error) {
      return false;
    }
  }

  function findPuzzleRow(anchor) {
    // Prefer real row/list containers. For generic div/section layouts, choose
    // the smallest nearby container that appears to hold only this puzzle link;
    // broad page containers can include the toolbar and must not be filter-hidden.
    const semanticRow = anchor.closest("li, tr, article");
    if (semanticRow) {
      return semanticRow;
    }

    let candidate = anchor.parentElement;
    while (candidate && candidate !== document.body) {
      if (candidate.matches("div, section")) {
        const playableLinks = Array.from(candidate.querySelectorAll("a[href]"))
          .filter(isPlayablePuzzleLink);
        if (playableLinks.length === 1 && !candidate.querySelector(".ctc-progress-toolbar")) {
          return candidate;
        }
      }
      candidate = candidate.parentElement;
    }

    return anchor.parentElement;
  }

  function getPuzzleEntries() {
    const seenKeys = new Set();
    const entries = [];

    for (const anchor of document.querySelectorAll("a[href]")) {
      if (!isPlayablePuzzleLink(anchor)) {
        continue;
      }

      const key = storage.keyFromUrl(anchor.href);
      if (seenKeys.has(key)) {
        continue;
      }

      const row = findPuzzleRow(anchor);
      if (!row) {
        continue;
      }

      seenKeys.add(key);
      entries.push({ anchor, row, key, url: anchor.href });
    }

    return entries;
  }

  function ensureListToolbar() {
    if (document.querySelector(".ctc-progress-toolbar")) {
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.className = "ctc-progress-toolbar";
    toolbar.innerHTML = `
      <span class="ctc-progress-toolbar-title">Progress</span>
      <span class="ctc-progress-last-opened" hidden></span>
      <button type="button" data-filter="all">Show all</button>
      <button type="button" data-filter="hide-solved">Hide solved</button>
      <button type="button" data-filter="todo">Only todo</button>
    `;

    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) {
        return;
      }

      currentFilter = button.dataset.filter;
      updateToolbarState();
      applyFilter();
    });

    const main = document.querySelector("main") || document.body;
    main.insertBefore(toolbar, main.firstChild);
    updateToolbarState();
  }

  function updateToolbarState() {
    for (const button of document.querySelectorAll(".ctc-progress-toolbar button[data-filter]")) {
      button.classList.toggle("ctc-progress-active", button.dataset.filter === currentFilter);
    }
  }

  function ensureListBadge(entry) {
    let badge = entry.row.querySelector(`.ctc-progress-list-badge[data-key="${CSS.escape(entry.key)}"]`);
    if (badge) {
      return badge;
    }

    badge = document.createElement("span");
    badge.className = "ctc-progress-badge ctc-progress-list-badge";
    badge.dataset.key = entry.key;
    badge.setAttribute("aria-live", "polite");
    entry.anchor.insertAdjacentElement("afterend", badge);
    return badge;
  }

  function removeStateClasses(element) {
    element.classList.remove(
      `${STATE_CLASS_PREFIX}opened`,
      `${STATE_CLASS_PREFIX}todo`,
      `${STATE_CLASS_PREFIX}solved`
    );
  }

  function applyListStatus(entry, record) {
    const status = record ? storage.statusCodeToName(record.s) : "untouched";
    const badge = ensureListBadge(entry);
    const statusLabel = formatStatusLabel(status, record);

    removeStateClasses(entry.row);
    if (status !== "untouched") {
      entry.row.classList.add(`${STATE_CLASS_PREFIX}${status}`);
    }

    entry.row.dataset.ctcProgressStatus = status;
    badge.textContent = status === "untouched" ? "" : statusLabel;
    badge.hidden = status === "untouched";
  }

  function applyLastOpened(entries, lastOpened) {
    const container = document.querySelector(".ctc-progress-last-opened");
    for (const entry of entries) {
      entry.row.classList.toggle("ctc-progress-last-row", Boolean(lastOpened && entry.key === lastOpened.k));
    }

    if (!container) {
      return;
    }

    if (!lastOpened || !lastOpened.u) {
      container.hidden = true;
      container.textContent = "";
      return;
    }

    const label = lastOpened.title || lastOpened.k.replace(/^s:/, "Puzzle ");
    container.hidden = false;
    container.innerHTML = `<span>Last opened:</span> <a></a>`;
    const anchor = container.querySelector("a");
    anchor.href = lastOpened.u;
    anchor.textContent = label;
    anchor.title = lastOpened.t ? new Date(lastOpened.t).toLocaleString() : "";
  }

  function applyFilter() {
    for (const row of document.querySelectorAll("[data-ctc-progress-status]")) {
      if (row.matches(".ctc-progress-toolbar") || row.querySelector(".ctc-progress-toolbar")) {
        row.classList.remove("ctc-progress-hidden");
        continue;
      }

      const status = row.dataset.ctcProgressStatus;
      const hide = (currentFilter === "hide-solved" && status === "solved") ||
        (currentFilter === "todo" && status !== "todo");
      row.classList.toggle("ctc-progress-hidden", hide);
    }
  }

  async function refreshListPage() {
    ensureListToolbar();
    const entries = getPuzzleEntries();
    const statuses = await storage.getStatusesForKeys(entries.map((entry) => entry.key));
    const diagnostics = await storage.getDiagnostics();

    for (const entry of entries) {
      applyListStatus(entry, statuses[entry.key]);
    }

    applyLastOpened(entries, diagnostics.lastOpened);
    applyFilter();
  }

  function ensurePuzzlePanel() {
    let panel = document.querySelector(".ctc-progress-puzzle-panel");
    if (panel) {
      return panel;
    }

    panel = document.createElement("div");
    panel.className = "ctc-progress-puzzle-panel";
    panel.innerHTML = `
      <span class="ctc-progress-toolbar-title">Progress</span>
      <span class="ctc-progress-badge" aria-live="polite"></span>
      <button type="button" data-status="todo">Todo</button>
      <button type="button" data-status="solved">Solved</button>
      <button type="button" data-status="clear">Clear</button>
    `;

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-status]");
      if (!button) {
        return;
      }

      const key = storage.keyFromUrl(window.location.href);
      const requestedStatus = button.dataset.status;

      try {
        if (requestedStatus === "clear") {
          await storage.clearStatusByKey(key);
        } else {
          await storage.setStatusByKey(key, requestedStatus, window.location.href);
        }
        await refreshPuzzlePage();
      } catch (error) {
        console.warn("CTC Progress Tracker: failed to update puzzle status", error);
      }
    });

    const main = document.querySelector("main") || document.body;
    main.insertBefore(panel, main.firstChild);
    return panel;
  }

  function applyPuzzleStatus(record) {
    const status = record ? storage.statusCodeToName(record.s) : "untouched";
    const panel = ensurePuzzlePanel();
    const badge = panel.querySelector(".ctc-progress-badge");
    const statusLabel = formatStatusLabel(status, record);

    removeStateClasses(panel);
    if (status !== "untouched") {
      panel.classList.add(`${STATE_CLASS_PREFIX}${status}`);
    }

    badge.textContent = status === "untouched" ? "untouched" : statusLabel;
    panel.querySelector('[data-status="todo"]').disabled = status === "todo";
    panel.querySelector('[data-status="solved"]').disabled = status === "solved";
    panel.querySelector('[data-status="clear"]').disabled = status === "untouched";
  }

  function formatStatusLabel(status, record) {
    if (status === "solved" && record && record.d) {
      return `solved ${record.d}`;
    }
    return status;
  }

  async function refreshPuzzlePage() {
    const key = storage.keyFromUrl(window.location.href);
    const record = await storage.getStatusByKey(key);
    applyPuzzleStatus(record);
  }

  async function initPuzzlePage() {
    // Marking on page load is reliable in browsers where async click handlers
    // can be interrupted by navigation away from the list page.
    await storage.markOpenedIfEmpty(window.location.href);
    await storage.markLastOpened(window.location.href, getPuzzleTitle());
    await storeSudokuPadMapping();
    await refreshPuzzlePage();
    watchSolvedPopup();
  }

  async function storeSudokuPadMapping() {
    const iframe = document.querySelector('iframe[src*="sudokupad.app"]');
    if (!iframe || !iframe.src) {
      return;
    }

    await storage.setAppPuzzleMapping(iframe.src, window.location.href, getPuzzleTitle());
  }

  function getPuzzleTitle() {
    const heading = document.querySelector("h1");
    return heading && heading.textContent.trim() ? heading.textContent.trim() : document.title;
  }

  function watchSolvedPopup() {
    detectSolvedPopup().catch((error) => {
      console.warn("CTC Progress Tracker: solved popup detection failed", error);
    });

    new MutationObserver(() => {
      detectSolvedPopup().catch((error) => {
        console.warn("CTC Progress Tracker: solved popup detection failed", error);
      });
    }).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function detectSolvedPopup() {
    if (solvedPopupDetected) {
      return;
    }

    const dialog = findSolvedDialog();
    if (!dialog) {
      return;
    }

    const solveDuration = extractSolveDuration(dialog);
    const target = await getCurrentPuzzleTarget();
    if (!target) {
      return;
    }

    solvedPopupDetected = true;
    await storage.setStatusByKey(target.key, "solved", target.url, { d: solveDuration });
    if (isPuzzlePage()) {
      await refreshPuzzlePage();
    }
  }

  async function getCurrentPuzzleTarget() {
    if (isSudokuPadPage()) {
      const mapping = await storage.getPuzzleMappingForAppUrl(window.location.href);
      return mapping ? { key: mapping.k, url: mapping.u } : null;
    }

    return {
      key: storage.keyFromUrl(window.location.href),
      url: window.location.href
    };
  }

  function findSolvedDialog() {
    for (const dialog of document.querySelectorAll(".dialog-overlay .dialog, [role='dialog'], dialog")) {
      const text = normalizeText(dialog.textContent);
      const hasSolvedText = text.includes("you solved the puzzle") &&
        text.includes("solution is correct");
      const hasCtcSolvedShape = dialog.querySelector("#clipboardcopy") &&
        dialog.querySelector("#solvedcounter");

      if (hasSolvedText || hasCtcSolvedShape) {
        return dialog;
      }
    }

    return null;
  }

  function extractSolveDuration(dialog) {
    const clipboardText = dialog.querySelector("#clipboardcopy") &&
      dialog.querySelector("#clipboardcopy").textContent;
    const text = clipboardText || dialog.textContent || "";
    const match = String(text).match(/Time:\s*([0-9:.]+)/i);
    return match ? match[1].trim().slice(0, 32) : undefined;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function scheduleListRefresh() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      refreshListPage().catch((error) => {
        console.warn("CTC Progress Tracker: list refresh failed", error);
      });
    }, 150);
  }

  if (!storage) {
    console.warn("CTC Progress Tracker: storage helper did not load");
    return;
  }

  if (isPuzzlePage()) {
    initPuzzlePage().catch((error) => {
      console.warn("CTC Progress Tracker: puzzle load failed", error);
    });
    return;
  }

  if (isSudokuPadPage()) {
    watchSolvedPopup();
    return;
  }

  if (isListPage()) {
    refreshListPage().catch((error) => {
      console.warn("CTC Progress Tracker: initial list load failed", error);
    });

    new MutationObserver(scheduleListRefresh).observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
