(function initCtcProgressPopup() {
  "use strict";

  const storage = globalThis.CtcProgressStorage;
  const message = document.querySelector("#message");

  function setMessage(text) {
    message.textContent = text;
  }

  function countStatuses(statuses) {
    const counts = { opened: 0, todo: 0, solved: 0 };
    for (const record of Object.values(statuses)) {
      const status = record ? storage.statusCodeToName(record.s) : null;
      if (status && counts[status] !== undefined) {
        counts[status] += 1;
      }
    }
    return counts;
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString() : "Never";
  }

  async function renderDiagnostics() {
    const diagnostics = await storage.getDiagnostics();
    document.querySelector("#storage-mode").textContent = diagnostics.activeArea === "sync"
      ? "Synced storage"
      : "Local-only storage";
    document.querySelector("#sync-available").textContent = diagnostics.syncAvailable ? "Available" : "Unavailable";
    document.querySelector("#last-write").textContent = formatDate(diagnostics.lastWriteAt);
    renderLastOpened(diagnostics.lastOpened);
  }

  function renderLastOpened(lastOpened) {
    const target = document.querySelector("#last-opened");
    if (!lastOpened || !lastOpened.u) {
      target.textContent = "Never";
      return;
    }

    target.innerHTML = `<a></a><small></small>`;
    const anchor = target.querySelector("a");
    const small = target.querySelector("small");
    anchor.href = lastOpened.u;
    anchor.target = "_blank";
    anchor.textContent = lastOpened.title || lastOpened.k.replace(/^s:/, "Puzzle ");
    small.textContent = lastOpened.t ? ` ${formatDate(lastOpened.t)}` : "";
  }

  async function renderCounts() {
    const statuses = await storage.getAllStatuses();
    const counts = countStatuses(statuses);
    document.querySelector("#opened-count").textContent = String(counts.opened);
    document.querySelector("#todo-count").textContent = String(counts.todo);
    document.querySelector("#solved-count").textContent = String(counts.solved);
  }

  async function exportJson() {
    const statuses = await storage.getAllStatuses();
    const diagnostics = await storage.getDiagnostics();
    const payload = {
      schema: "ctc-progress-tracker.v2",
      exportedAt: new Date().toISOString(),
      statuses,
      meta: {
        lastOpened: diagnostics.lastOpened || null
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ctc-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Exported JSON backup.");
  }

  async function importJson(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    const statuses = payload.statuses && typeof payload.statuses === "object"
      ? payload.statuses
      : payload;

    await storage.importStatuses(statuses);
    if (payload.meta && payload.meta.lastOpened) {
      await storage.setLastOpenedRecord(payload.meta.lastOpened);
    }
    await renderCounts();
    await renderDiagnostics();
    setMessage("Imported JSON backup.");
  }

  document.querySelector("#export-json").addEventListener("click", () => {
    exportJson().catch((error) => {
      console.warn("CTC Progress Tracker: export failed", error);
      setMessage("Export failed.");
    });
  });

  document.querySelector("#import-json").addEventListener("click", () => {
    document.querySelector("#import-file").click();
  });

  document.querySelector("#import-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }

    importJson(file).catch((error) => {
      console.warn("CTC Progress Tracker: import failed", error);
      setMessage("Import failed. Check that the file is valid JSON.");
    }).finally(() => {
      event.target.value = "";
    });
  });

  document.querySelector("#clear-all").addEventListener("click", async () => {
    if (!window.confirm("Clear all CTC progress tracker data from the active browser storage area?")) {
      return;
    }

    try {
      await storage.clearAllStatuses();
      await renderCounts();
      await renderDiagnostics();
      setMessage("All progress data cleared.");
    } catch (error) {
      console.warn("CTC Progress Tracker: clear failed", error);
      setMessage("Clear failed.");
    }
  });

  document.querySelector("#test-storage").addEventListener("click", async () => {
    try {
      const diagnostics = await storage.testStorageRoundTrip();
      await renderDiagnostics();
      setMessage(`Storage test passed using ${diagnostics.activeArea === "sync" ? "synced" : "local-only"} storage.`);
    } catch (error) {
      console.warn("CTC Progress Tracker: storage test failed", error);
      setMessage("Storage test failed.");
    }
  });

  Promise.all([renderCounts(), renderDiagnostics()]).catch((error) => {
    console.warn("CTC Progress Tracker: count load failed", error);
    setMessage("Could not load storage data.");
  });
})();
