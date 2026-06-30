(function initCtcProgressStorage(global) {
  "use strict";

  const STATUS_TO_CODE = {
    opened: "o",
    todo: "t",
    solved: "s"
  };
  const CODE_TO_STATUS = {
    o: "opened",
    t: "todo",
    s: "solved"
  };
  const VALID_STATUS_CODES = new Set(Object.values(STATUS_TO_CODE));

  const META_KEY = "ctcProgress:meta";
  const SHARD_PREFIX = "ctcProgress:shard:";

  // chrome.storage.sync has an 8 KB per-item quota in Chromium-family browsers.
  // 64 shards keeps the current CTC catalog of roughly 3,300 puzzles at about
  // 52 records per shard, leaving room for timestamps/URLs and future growth.
  const SHARD_COUNT = 64;

  let activeAreaPromise = null;

  function hasStorageArea(name) {
    return Boolean(global.chrome && chrome.storage && chrome.storage[name]);
  }

  function area(name) {
    return chrome.storage[name];
  }

  function callbackError() {
    return chrome.runtime && chrome.runtime.lastError
      ? new Error(chrome.runtime.lastError.message)
      : null;
  }

  function getFromArea(areaName, keys) {
    return new Promise((resolve, reject) => {
      area(areaName).get(keys, (items) => {
        const error = callbackError();
        if (error) {
          reject(error);
          return;
        }
        resolve(items || {});
      });
    });
  }

  function setInArea(areaName, items) {
    return new Promise((resolve, reject) => {
      area(areaName).set(items, () => {
        const error = callbackError();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  function removeFromArea(areaName, keys) {
    return new Promise((resolve, reject) => {
      area(areaName).remove(keys, () => {
        const error = callbackError();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async function chooseActiveArea() {
    if (!hasStorageArea("sync")) {
      return "local";
    }

    try {
      await getFromArea("sync", META_KEY);
      return "sync";
    } catch (_error) {
      return "local";
    }
  }

  async function activeAreaName() {
    if (!activeAreaPromise) {
      activeAreaPromise = chooseActiveArea();
    }
    return activeAreaPromise;
  }

  async function withActiveArea(operation) {
    let areaName = await activeAreaName();
    try {
      return await operation(areaName);
    } catch (error) {
      if (areaName === "sync" && hasStorageArea("local")) {
        activeAreaPromise = Promise.resolve("local");
        return operation("local");
      }
      throw error;
    }
  }

  function normalizePuzzleUrl(input) {
    const url = new URL(input, "https://crackingthecryptic.com");
    const id = url.searchParams.get("id");

    // The CTC list currently uses /sudoku?id=1234 for playable puzzle links.
    // Normalize to that canonical shape so equivalent relative/absolute URLs share one key.
    if (url.hostname === "crackingthecryptic.com" && url.pathname === "/sudoku" && id) {
      return `https://crackingthecryptic.com/sudoku?id=${id}`;
    }

    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  }

  function normalizeAppUrl(input) {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString();
  }

  function keyFromUrl(input) {
    const normalizedUrl = normalizePuzzleUrl(input);
    const url = new URL(normalizedUrl);
    const id = url.hostname === "crackingthecryptic.com" &&
      url.pathname === "/sudoku" &&
      url.searchParams.get("id");

    if (id) {
      return `s:${id}`;
    }

    return `u:${base64UrlEncode(normalizedUrl).slice(0, 80)}`;
  }

  function base64UrlEncode(value) {
    return btoa(unescape(encodeURIComponent(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function shardNameForKey(key) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = ((hash * 31) + key.charCodeAt(index)) >>> 0;
    }
    return `${SHARD_PREFIX}${hash % SHARD_COUNT}`;
  }

  function getShardNameList() {
    return Array.from({ length: SHARD_COUNT }, (_value, index) => `${SHARD_PREFIX}${index}`);
  }

  function normalizeStatusCode(status) {
    if (VALID_STATUS_CODES.has(status)) {
      return status;
    }
    return STATUS_TO_CODE[status] || null;
  }

  function statusCodeToName(code) {
    return CODE_TO_STATUS[code] || "untouched";
  }

  function cleanRecord(record, fallbackTime) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const code = normalizeStatusCode(record.s);
    if (!code) {
      return null;
    }

    return {
      s: code,
      t: Number.isFinite(record.t) ? record.t : fallbackTime,
      u: typeof record.u === "string" ? record.u : undefined
    };
  }

  async function writeMeta(areaName, extra) {
    const now = new Date().toISOString();
    const items = await getFromArea(areaName, META_KEY);
    const meta = {
      ...(items[META_KEY] || {}),
      ...extra,
      schema: "ctc-progress-tracker.v2",
      storageArea: areaName,
      lastWriteAt: now
    };
    await setInArea(areaName, { [META_KEY]: meta });
    return meta;
  }

  async function getStatusByKey(key) {
    return withActiveArea(async (areaName) => {
      const shardName = shardNameForKey(key);
      const items = await getFromArea(areaName, shardName);
      const shard = items[shardName] || {};
      return cleanRecord(shard[key], Date.now());
    });
  }

  async function setStatusByKey(key, status, sourceUrl) {
    const code = normalizeStatusCode(status);
    if (!code) {
      throw new Error(`Invalid status: ${status}`);
    }

    return withActiveArea(async (areaName) => {
      const shardName = shardNameForKey(key);
      const items = await getFromArea(areaName, shardName);
      const shard = items[shardName] || {};
      shard[key] = {
        s: code,
        t: Date.now(),
        u: sourceUrl ? normalizePuzzleUrl(sourceUrl) : undefined
      };

      await setInArea(areaName, { [shardName]: shard });
      await writeMeta(areaName);
      return shard[key];
    });
  }

  async function markOpenedIfEmpty(url) {
    const key = keyFromUrl(url);
    const existing = await getStatusByKey(key);
    if (existing) {
      return existing;
    }
    return setStatusByKey(key, "opened", url);
  }

  async function markLastOpened(url, title) {
    const normalizedUrl = normalizePuzzleUrl(url);
    const lastOpened = {
      k: keyFromUrl(normalizedUrl),
      u: normalizedUrl,
      t: Date.now(),
      title: typeof title === "string" ? title.slice(0, 160) : undefined
    };

    return withActiveArea(async (areaName) => writeMeta(areaName, { lastOpened }));
  }

  async function setLastOpenedRecord(lastOpened) {
    if (!lastOpened || typeof lastOpened.u !== "string") {
      return;
    }

    const normalizedUrl = normalizePuzzleUrl(lastOpened.u);
    const clean = {
      k: typeof lastOpened.k === "string" ? lastOpened.k : keyFromUrl(normalizedUrl),
      u: normalizedUrl,
      t: Number.isFinite(lastOpened.t) ? lastOpened.t : Date.now(),
      title: typeof lastOpened.title === "string" ? lastOpened.title.slice(0, 160) : undefined
    };

    await withActiveArea(async (areaName) => writeMeta(areaName, { lastOpened: clean }));
  }

  async function setAppPuzzleMapping(appUrl, puzzleUrl, title) {
    const appKey = normalizeAppUrl(appUrl);
    const puzzleKey = keyFromUrl(puzzleUrl);
    const puzzleRecord = {
      k: puzzleKey,
      u: normalizePuzzleUrl(puzzleUrl),
      title: typeof title === "string" ? title.slice(0, 160) : undefined,
      t: Date.now()
    };

    await withActiveArea(async (areaName) => {
      const items = await getFromArea(areaName, META_KEY);
      const meta = items[META_KEY] || {};
      const appPuzzleMap = { ...(meta.appPuzzleMap || {}) };
      appPuzzleMap[appKey] = puzzleRecord;

      // Keep the mapping small. It only needs to bridge recently opened CTC
      // puzzle pages to their SudokuPad iframe URL for solved-popup detection.
      const sorted = Object.entries(appPuzzleMap)
        .sort((left, right) => (right[1].t || 0) - (left[1].t || 0))
        .slice(0, 100);

      await writeMeta(areaName, { appPuzzleMap: Object.fromEntries(sorted) });
    });
  }

  async function getPuzzleMappingForAppUrl(appUrl) {
    const appKey = normalizeAppUrl(appUrl);
    return withActiveArea(async (areaName) => {
      const items = await getFromArea(areaName, META_KEY);
      const meta = items[META_KEY] || {};
      return meta.appPuzzleMap && meta.appPuzzleMap[appKey] ? meta.appPuzzleMap[appKey] : null;
    });
  }

  async function clearStatusByKey(key) {
    return withActiveArea(async (areaName) => {
      const shardName = shardNameForKey(key);
      const items = await getFromArea(areaName, shardName);
      const shard = items[shardName] || {};
      delete shard[key];
      await setInArea(areaName, { [shardName]: shard });
      await writeMeta(areaName);
    });
  }

  async function getAllStatuses() {
    return withActiveArea(async (areaName) => {
      const shardNames = getShardNameList();
      const items = await getFromArea(areaName, shardNames);
      const statuses = {};

      for (const shardName of shardNames) {
        const shard = items[shardName] || {};
        for (const [key, record] of Object.entries(shard)) {
          const clean = cleanRecord(record, Date.now());
          if (clean) {
            statuses[key] = clean;
          }
        }
      }

      return statuses;
    });
  }

  async function getStatusesForKeys(keys) {
    return withActiveArea(async (areaName) => {
      const result = {};
      const uniqueShards = [...new Set(keys.map(shardNameForKey))];
      const items = await getFromArea(areaName, uniqueShards);

      for (const key of keys) {
        const shard = items[shardNameForKey(key)] || {};
        result[key] = cleanRecord(shard[key], Date.now());
      }

      return result;
    });
  }

  async function importStatuses(statuses) {
    return withActiveArea(async (areaName) => {
      const shards = {};
      const now = Date.now();

      for (const [key, record] of Object.entries(statuses || {})) {
        const clean = cleanRecord(record, now);
        if (!clean) {
          continue;
        }

        const shardName = shardNameForKey(key);
        if (!shards[shardName]) {
          shards[shardName] = {};
        }

        shards[shardName][key] = clean;
      }

      await removeFromArea(areaName, getShardNameList());
      if (Object.keys(shards).length > 0) {
        await setInArea(areaName, shards);
      }
      await writeMeta(areaName);
    });
  }

  async function clearAllStatuses() {
    return withActiveArea(async (areaName) => {
      await removeFromArea(areaName, [META_KEY, ...getShardNameList()]);
      await writeMeta(areaName, { clearedAt: new Date().toISOString() });
    });
  }

  async function getDiagnostics() {
    const syncAvailable = hasStorageArea("sync");
    const localAvailable = hasStorageArea("local");
    const active = await activeAreaName();
    let meta = null;

    try {
      const items = await getFromArea(active, META_KEY);
      meta = items[META_KEY] || null;
    } catch (_error) {
      meta = null;
    }

    return {
      syncAvailable,
      localAvailable,
      activeArea: active,
      lastWriteAt: meta && meta.lastWriteAt ? meta.lastWriteAt : null,
      lastSyncTestAt: meta && meta.lastSyncTestAt ? meta.lastSyncTestAt : null,
      lastOpened: meta && meta.lastOpened ? meta.lastOpened : null
    };
  }

  async function testStorageRoundTrip() {
    return withActiveArea(async (areaName) => {
      const testKey = "ctcProgress:diagnostic";
      const value = {
        value: Math.random().toString(36).slice(2),
        t: Date.now()
      };

      await setInArea(areaName, { [testKey]: value });
      const items = await getFromArea(areaName, testKey);
      const ok = Boolean(items[testKey] && items[testKey].value === value.value);
      await removeFromArea(areaName, testKey);

      if (!ok) {
        throw new Error(`${areaName} storage write/read test failed`);
      }

      await writeMeta(areaName, { lastSyncTestAt: new Date().toISOString() });
      return getDiagnostics();
    });
  }

  global.CtcProgressStorage = {
    STATUS_TO_CODE,
    CODE_TO_STATUS,
    normalizePuzzleUrl,
    normalizeAppUrl,
    keyFromUrl,
    statusCodeToName,
    getStatusByKey,
    getStatusesForKeys,
    getAllStatuses,
    setStatusByKey,
    markOpenedIfEmpty,
    markLastOpened,
    setLastOpenedRecord,
    setAppPuzzleMapping,
    getPuzzleMappingForAppUrl,
    clearStatusByKey,
    importStatuses,
    clearAllStatuses,
    getDiagnostics,
    testStorageRoundTrip
  };
})(globalThis);
