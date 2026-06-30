(function initCtcProgressContent() {
  "use strict";

  const storage = globalThis.CtcProgressStorage;
  const STATE_CLASS_PREFIX = "ctc-progress-state-";
  let currentFilter = "all";
  let scanTimer = null;

  function currentUrl() {
    return new URL(window.location.href);
  }

  function isListPage() {
    const path = currentUrl().pathname;
    return path === "/sudokus" || path === "/filter";
  }

  function isPuzzlePage() {
    const url = currentUrl();
    return url.pathname === "/sudoku" && url.searchParams.has("id");
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
    // Prefer the list item used by the current CTC list/filter pages. Fall back
    // to nearby row-like containers so layout changes fail softly.
    return anchor.closest("li, tr, article, section, div") || anchor.parentElement;
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

    removeStateClasses(entry.row);
    if (status !== "untouched") {
      entry.row.classList.add(`${STATE_CLASS_PREFIX}${status}`);
    }

    entry.row.dataset.ctcProgressStatus = status;
    badge.textContent = status === "untouched" ? "" : status;
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

    removeStateClasses(panel);
    if (status !== "untouched") {
      panel.classList.add(`${STATE_CLASS_PREFIX}${status}`);
    }

    badge.textContent = status === "untouched" ? "untouched" : status;
    panel.querySelector('[data-status="todo"]').disabled = status === "todo";
    panel.querySelector('[data-status="solved"]').disabled = status === "solved";
    panel.querySelector('[data-status="clear"]').disabled = status === "untouched";
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
    await refreshPuzzlePage();
  }

  function getPuzzleTitle() {
    const heading = document.querySelector("h1");
    return heading && heading.textContent.trim() ? heading.textContent.trim() : document.title;
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
