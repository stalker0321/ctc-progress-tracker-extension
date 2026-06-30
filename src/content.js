(function initCtcProgressContent() {
  "use strict";

  const storage = globalThis.CtcProgressStorage;
  const STATE_CLASS_PREFIX = "ctc-progress-state-";
  let currentFilter = "all";
  let scanTimer = null;

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
    // Prefer the list item used by the current CTC page. Fall back to nearby
    // row-like containers so the extension remains useful if the markup changes.
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

  function ensureToolbar() {
    if (document.querySelector(".ctc-progress-toolbar")) {
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.className = "ctc-progress-toolbar";
    toolbar.innerHTML = `
      <span class="ctc-progress-toolbar-title">Progress</span>
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

  function ensureControls(entry) {
    let controls = entry.row.querySelector(`.ctc-progress-controls[data-key="${CSS.escape(entry.key)}"]`);
    if (controls) {
      return controls;
    }

    controls = document.createElement("span");
    controls.className = "ctc-progress-controls";
    controls.dataset.key = entry.key;
    controls.innerHTML = `
      <span class="ctc-progress-badge" aria-live="polite"></span>
      <button type="button" data-status="todo">Todo</button>
      <button type="button" data-status="solved">Solved</button>
      <button type="button" data-status="clear">Clear</button>
    `;

    controls.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-status]");
      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const requestedStatus = button.dataset.status;
      try {
        if (requestedStatus === "clear") {
          await storage.clearStatusByKey(entry.key);
        } else {
          await storage.setStatusByKey(entry.key, requestedStatus, entry.url);
        }
        await refresh();
      } catch (error) {
        console.warn("CTC Progress Tracker: failed to update status", error);
      }
    });

    entry.anchor.insertAdjacentElement("afterend", controls);
    return controls;
  }

  function applyStatus(entry, record) {
    const status = record ? storage.statusCodeToName(record.s) : "untouched";
    const controls = ensureControls(entry);
    const badge = controls.querySelector(".ctc-progress-badge");

    entry.row.classList.remove(
      `${STATE_CLASS_PREFIX}opened`,
      `${STATE_CLASS_PREFIX}todo`,
      `${STATE_CLASS_PREFIX}solved`
    );

    if (status !== "untouched") {
      entry.row.classList.add(`${STATE_CLASS_PREFIX}${status}`);
    }

    entry.row.dataset.ctcProgressStatus = status;
    badge.textContent = status === "untouched" ? "" : status;
    controls.querySelector('[data-status="todo"]').disabled = status === "todo";
    controls.querySelector('[data-status="solved"]').disabled = status === "solved";
    controls.querySelector('[data-status="clear"]').disabled = status === "untouched";
  }

  function applyFilter() {
    for (const row of document.querySelectorAll("[data-ctc-progress-status]")) {
      const status = row.dataset.ctcProgressStatus;
      const hide = (currentFilter === "hide-solved" && status === "solved") ||
        (currentFilter === "todo" && status !== "todo");
      row.classList.toggle("ctc-progress-hidden", hide);
    }
  }

  async function refresh() {
    ensureToolbar();
    const entries = getPuzzleEntries();
    const statuses = await storage.getStatusesForKeys(entries.map((entry) => entry.key));

    for (const entry of entries) {
      ensureControls(entry);
      applyStatus(entry, statuses[entry.key]);
      bindOpenTracking(entry);
    }

    applyFilter();
  }

  function bindOpenTracking(entry) {
    if (entry.anchor.dataset.ctcProgressBound === "true") {
      return;
    }

    entry.anchor.dataset.ctcProgressBound = "true";
    entry.anchor.addEventListener("click", () => {
      storage.markOpenedIfEmpty(entry.url)
        .then(() => refresh())
        .catch((error) => {
          console.warn("CTC Progress Tracker: failed to mark opened", error);
        });
    }, { capture: true });
  }

  function scheduleRefresh() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      refresh().catch((error) => {
        console.warn("CTC Progress Tracker: refresh failed", error);
      });
    }, 150);
  }

  if (!storage) {
    console.warn("CTC Progress Tracker: storage helper did not load");
    return;
  }

  refresh().catch((error) => {
    console.warn("CTC Progress Tracker: initial load failed", error);
  });

  new MutationObserver(scheduleRefresh).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
