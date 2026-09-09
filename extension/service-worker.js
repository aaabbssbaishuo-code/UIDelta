import { createStoredZip } from "./zip-store.js";

const ACTIVE_TABS_KEY = "uiLensActiveTabs";
const DB_NAME = "uidelta-review";
const DB_VERSION = 3;
const STORE_SESSIONS = "sessions";
const STORE_ISSUES = "issues";
const STORE_ASSETS = "assets";
const MIN_CAPTURE_INTERVAL_MS = 550;
const PENDING_ASSET_TTL_MS = 30 * 60 * 1000;
const FINALIZATION_TTL_MS = 5 * 60 * 1000;
const COMPLETED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EXPORT_BYTES = 96 * 1024 * 1024;
const MAX_CONTEXT_WIDTH = 1600;
const MAX_CONTEXT_HEIGHT = 1200;
const MAX_DETAIL_WIDTH = 1200;
const MAX_DETAIL_HEIGHT = 900;
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MESSAGE_TYPES = new Set([
  "GET_TAB_STATE",
  "SET_TAB_INSPECTOR",
  "TOGGLE_TAB_INSPECTOR",
  "SYNC_TAB_STATE",
  "UIDELTA_GET_STATE",
  "UIDELTA_PUT_SESSION",
  "UIDELTA_PUT_DESIGN",
  "UIDELTA_SET_SESSION_STATUS",
  "UIDELTA_FINALIZE_SESSION",
  "UIDELTA_TOUCH_PAGE",
  "UIDELTA_RESERVE_ISSUE",
  "UIDELTA_PUT_ISSUE",
  "UIDELTA_DELETE_ISSUE",
  "UIDELTA_DELETE_ISSUES",
  "UIDELTA_CAPTURE_EVIDENCE",
  "UIDELTA_PUT_REFERENCE_ASSET",
  "UIDELTA_GET_ASSET",
  "UIDELTA_GET_DELIVERY_PREVIEW",
  "UIDELTA_DELETE_ASSETS",
  "UIDELTA_EXPORT_SESSION",
  "UIDELTA_EXPORT_DELIVERABLE",
  "UIDELTA_IMPORT_DELIVERABLE"
]);

let databasePromise;
let captureQueue = Promise.resolve();
let lastCaptureAt = 0;
let tabStateWriteQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.get(ACTIVE_TABS_KEY)
    .then((stored) => {
      if (!stored[ACTIVE_TABS_KEY]) return chrome.storage.session.set({ [ACTIVE_TABS_KEY]: {} });
      return undefined;
    })
    .catch(() => {});
  openDatabase().then(async (db) => {
    await recoverStaleFinalizations(db);
    await cleanupExpiredPendingAssets(db);
    await cleanupStaleCompletedSessions(db);
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !MESSAGE_TYPES.has(message.type)) return undefined;

  Promise.resolve()
    .then(() => handleMessage(message, sender))
    .then((response) => sendResponse(response && typeof response === "object" ? response : { ok: true }))
    .catch((error) => sendResponse(toFailure(error)));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-inspector") return;
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (typeof tab?.id === "number") return toggleInspector(tab.id);
      return undefined;
    })
    .catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab?.id === "number") toggleInspector(tab.id).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabState(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isInspectableUrl(tab.url)) return;
  getTabState(tabId)
    .then((state) => {
      if (state.enabled && state.origin === normalizeOrigin(tab.url)) return injectAndConfigure(tabId, true, state);
      if (state.enabled) return removeTabState(tabId);
      return undefined;
    })
    .catch(() => {});
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_TAB_STATE":
      return getTabState(resolveTabId(message.tabId, sender));
    case "SET_TAB_INSPECTOR":
      return setInspectorEnabled(resolveTabId(message.tabId, sender), Boolean(message.enabled));
    case "TOGGLE_TAB_INSPECTOR":
      return toggleInspector(resolveTabId(message.tabId, sender));
    case "SYNC_TAB_STATE": {
      const tabId = resolveTabId(message.tabId, sender);
      if (typeof tabId !== "number") throw new Error("没有找到当前标签页。");
      await writeTabState(tabId, Boolean(message.enabled), getSenderOrigin(sender), message);
      return { ok: true, enabled: Boolean(message.enabled) };
    }
    case "UIDELTA_GET_STATE":
      return getReviewState(message.origin, sender);
    case "UIDELTA_PUT_SESSION":
      return putSession(message.session, sender);
    case "UIDELTA_PUT_DESIGN":
      return putDesignSource(message.sessionId, message.design, sender);
    case "UIDELTA_SET_SESSION_STATUS":
      return setSessionStatus(message.sessionId, message.status, sender);
    case "UIDELTA_FINALIZE_SESSION":
      return finalizeSession(message.sessionId, sender);
    case "UIDELTA_TOUCH_PAGE":
      return touchSessionPage(message.sessionId, message.pageSnapshot, sender);
    case "UIDELTA_RESERVE_ISSUE":
      return reserveIssueSequence(message.sessionId, sender);
    case "UIDELTA_PUT_ISSUE":
      return putIssue(message.issue, sender);
    case "UIDELTA_DELETE_ISSUE":
      return deleteIssue(message.issueId, sender);
    case "UIDELTA_DELETE_ISSUES":
      return deleteIssues(message, sender);
    case "UIDELTA_CAPTURE_EVIDENCE":
      return captureEvidence(message, sender);
    case "UIDELTA_PUT_REFERENCE_ASSET":
      return putReferenceAsset(message, sender);
    case "UIDELTA_GET_ASSET":
      return getAsset(message.assetId, sender, Boolean(message.thumbnail));
    case "UIDELTA_GET_DELIVERY_PREVIEW":
      return getDeliveryPreview(message.format);
    case "UIDELTA_DELETE_ASSETS":
      return deleteAssets(message.assetIds, sender);
    case "UIDELTA_EXPORT_SESSION":
      return exportSession(message.sessionId, sender, false);
    case "UIDELTA_EXPORT_DELIVERABLE":
      return exportDeliverable(message.sessionId, sender, message.format, message.issueIds);
    case "UIDELTA_IMPORT_DELIVERABLE":
      return importDeliverable(message.sessionId, message.payload, message.assetData, sender);
    default:
      throw new Error("不支持的 UIDelta 消息。");
  }
}

async function getDeliveryPreview(format) {
  // Static examples only: never accept a path or fetch a user-provided URL.
  if (!["html", "xlsx", "zip"].includes(format)) return { ok: false, error: "未知示例类型" };
  const response = await fetch(chrome.runtime.getURL("previews/" + format + "-preview@2x.png"));
  if (!response.ok) return { ok: false, error: "示例图片加载失败" };
  return { ok: true, dataUrl: await blobToDataUrl(await response.blob()) };
}

function resolveTabId(tabId, sender) {
  if (typeof sender.tab?.id === "number") return sender.tab.id;
  return typeof tabId === "number" ? tabId : undefined;
}

async function toggleInspector(tabId) {
  const current = await getTabState(tabId);
  if (!current.ok) return current;
  return setInspectorEnabled(tabId, !current.enabled);
}

async function setInspectorEnabled(tabId, enabled) {
  if (typeof tabId !== "number") return { ok: false, error: "没有找到当前标签页。" };

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInspectableUrl(tab.url)) {
      return { ok: false, error: "UIDelta 只能在普通网页中运行。" };
    }

    const previous = await getTabState(tabId);
    const context = previous.origin === normalizeOrigin(tab.url) ? { ...previous, browseMode: false } : { browseMode: false };
    if (enabled) {
      await injectAndConfigure(tabId, true, context);
    } else {
      try {
        await configureExistingLens(tabId, false);
      } catch (_) {
        // The page may have reloaded; clearing the session state is still enough.
      }
    }

    // Content may have just flushed newer draft text while being configured.
    // Preserve that latest same-origin draft instead of replaying the old copy.
    await writeTabState(tabId, enabled, normalizeOrigin(tab.url), { browseMode: false });
    return { ok: true, enabled };
  } catch (error) {
    return toFailure(error, "无法在此页面启用 UIDelta。");
  }
}

async function injectAndConfigure(tabId, enabled, context = {}) {
  try {
    return await configureExistingLens(tabId, enabled, context);
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["compare-engine.js", "content.js"] });
    return configureExistingLens(tabId, enabled, context);
  }
}

async function configureExistingLens(tabId, enabled, context = {}) {
  return chrome.tabs.sendMessage(tabId, { type: "UI_LENS_SET_ENABLED", enabled, context });
}

async function getTabState(tabId) {
  if (typeof tabId !== "number") return { ok: false, enabled: false, error: "没有找到当前标签页。" };
  const stored = await chrome.storage.session.get(ACTIVE_TABS_KEY);
  const activeTabs = stored[ACTIVE_TABS_KEY] || {};
  const entry = activeTabs[String(tabId)];
  if (entry === true) return { ok: true, enabled: true, origin: "" };
  return {
    ok: true, enabled: entry?.enabled === true, origin: nonEmptyString(entry?.origin),
    browseMode: entry?.browseMode === true,
    inspectMode: ["ui", "annotation", "region"].includes(entry?.inspectMode) ? entry.inspectMode : "annotation",
    view: nonEmptyString(entry?.view), composerDraft: entry?.composerDraft || null
  };
}

function writeTabState(tabId, enabled, origin = "", context = {}) {
  const operation = tabStateWriteQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.session.get(ACTIVE_TABS_KEY);
    const activeTabs = { ...(stored[ACTIVE_TABS_KEY] || {}) };
    const normalizedOrigin = normalizeOrigin(origin);
    const previous = activeTabs[String(tabId)];
    const sameOrigin = previous?.origin === normalizedOrigin;
    const draft = Object.hasOwn(context, "composerDraft") ? context.composerDraft : sameOrigin ? previous.composerDraft : null;
    if (enabled || draft) {
      activeTabs[String(tabId)] = {
        enabled, origin: normalizedOrigin,
        browseMode: Object.hasOwn(context, "browseMode") ? context.browseMode === true : sameOrigin && previous.browseMode === true,
        inspectMode: ["ui", "annotation", "region"].includes(context.inspectMode) ? context.inspectMode : sameOrigin ? previous.inspectMode : "annotation",
        view: nonEmptyString(context.view || (sameOrigin && previous.view)),
        composerDraft: draft && typeof draft === "object" ? draft : null
      };
    } else delete activeTabs[String(tabId)];
    await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: activeTabs });
  });
  tabStateWriteQueue = operation;
  return operation;
}

function removeTabState(tabId) {
  return writeTabState(tabId, false, "", { composerDraft: null });
}

async function getReviewState(originInput, sender) {
  const db = await openDatabase();
  await recoverStaleFinalizations(db);
  await cleanupExpiredPendingAssets(db);
  await cleanupStaleCompletedSessions(db);
  const sessions = await getAll(db, STORE_SESSIONS);
  const senderOrigin = getSenderOrigin(sender);
  const requestedOrigin = normalizeOrigin(originInput);
  const genericFileRequest = requestedOrigin === "file://" && senderOrigin.startsWith("file:///");
  if (senderOrigin && requestedOrigin && requestedOrigin !== senderOrigin && !genericFileRequest) {
    throw new Error("不能读取其他站点的 Review Session。");
  }
  const origin = senderOrigin || requestedOrigin;
  const resumableSessions = sessions
    .filter((session) => isResumableSession(session) && (!origin || normalizeOrigin(session.origin || session.url) === origin))
    .sort((first, second) => sortableTime(second) - sortableTime(first));
  const session = resumableSessions[0] || null;
  const issues = session ? await getAllByIndex(db, STORE_ISSUES, "sessionId", session.id) : [];
  issues.sort((first, second) => sortableTime(first, "createdAt") - sortableTime(second, "createdAt"));
  return {
    ok: true,
    session,
    activeSession: session?.status === "active" ? session : null,
    issues,
    tabState: await getTabState(resolveTabId(undefined, sender))
  };
}

async function putSession(input, sender) {
  if (!isRecord(input)) throw new Error("Session 数据无效。");
  const db = await openDatabase();
  const id = nonEmptyString(input.id || input.sessionId) || makeId("session");
  const transaction = db.transaction([STORE_SESSIONS, STORE_ISSUES], "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    const issueStore = transaction.objectStore(STORE_ISSUES);
    let existing = await requestResult(store.get(id));
    const senderOrigin = getSenderOrigin(sender);
    const inputOrigin = normalizeOrigin(input.origin || input.url || existing?.origin || existing?.url);
    const genericFileInput = inputOrigin === "file://" && senderOrigin.startsWith("file:///");
    if (senderOrigin && inputOrigin && senderOrigin !== inputOrigin && !genericFileInput) {
      throw new Error("不能为其他站点创建或修改 Review Session。");
    }
    const targetOrigin = senderOrigin || inputOrigin;
    if (!existing && (input.status === "active" || input.status === "paused" || !input.status)) {
      const sameOriginSessions = (await requestResult(store.index("origin").getAll(targetOrigin)))
        .map((session) => restoreExpiredFinalizationInStore(session, store));
      const resumable = sameOriginSessions
        .filter(isResumableSession)
        .sort((first, second) => sortableTime(second) - sortableTime(first))[0];
      if (resumable) {
        const issues = await requestResult(issueStore.index("sessionId").getAll(resumable.id));
        issues.sort((first, second) => sortableTime(first, "createdAt") - sortableTime(second, "createdAt"));
        await done;
        return { ok: true, session: resumable, issues, resumed: true };
      }
    }
    if (existing) {
      assertSessionOwnership(existing, sender);
      existing = restoreExpiredFinalizationInStore(existing, store);
      if (existing.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
      const currentRevision = finiteNumber(existing.revision, 0);
      const hasInputRevision = Number.isSafeInteger(Number(input.revision)) && Number(input.revision) >= 0;
      if (currentRevision > 0 && !hasInputRevision) {
        throw new Error("Session 版本已变化，请刷新后重试。");
      }
      const inputRevision = hasInputRevision ? Number(input.revision) : 0;
      if (inputRevision !== currentRevision) throw new Error("Session 已在其他页面更新，请刷新后重试。");
      if ((existing.status === "completed" || existing.status === "ended") && input.status !== existing.status) {
        throw new Error("已结束的 Review Session 不能重新激活。");
      }
    }
    const now = new Date().toISOString();
    const session = {
      ...(existing || {}),
      ...input,
      id,
      origin: targetOrigin,
      status: nonEmptyString(input.status) || existing?.status || "active",
      revision: finiteNumber(existing?.revision, 0) + 1,
      createdAt: input.createdAt || existing?.createdAt || now,
      updatedAt: now
    };
    store.put(session);
    await done;
    return { ok: true, session };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function setSessionStatus(sessionIdInput, statusInput, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  const status = nonEmptyString(statusInput);
  if (!sessionId || !["active", "paused"].includes(status)) throw new Error("Session 状态请求无效。");
  const db = await openDatabase();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    let session = await requestResult(store.get(sessionId));
    if (!session) throw new Error("Review Session 已不存在。");
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, store);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (!isResumableSession(session)) throw new Error("已结束的 Review Session 不能改变状态。");
    const now = new Date().toISOString();
    const updatedSession = {
      ...session,
      status,
      pausedAt: status === "paused" ? now : session.pausedAt,
      resumedAt: status === "active" ? now : session.resumedAt,
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: now
    };
    store.put(updatedSession);
    await done;
    return { ok: true, session: updatedSession };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function putDesignSource(sessionIdInput, designInput, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId) throw new Error("缺少 Review Session。");
  const design = sanitizeDesignSource(designInput);
  const db = await openDatabase();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    let session = await requestResult(store.get(sessionId));
    if (!session) throw new Error("Review Session 已不存在。");
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, store);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (!isResumableSession(session)) throw new Error("已结束的 Review Session 不能修改设计绑定。");
    const now = new Date().toISOString();
    const updatedSession = {
      ...session,
      figmaBinding: design.binding,
      designSnapshot: design.snapshot,
      designSnapshotVersion: design.snapshot ? 2 : null,
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: now
    };
    store.put(updatedSession);
    await done;
    return { ok: true, session: updatedSession };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

function sanitizeDesignSource(input) {
  if (!isRecord(input)) return { binding: null, snapshot: null };
  const rawBinding = isRecord(input.binding) ? input.binding : {};
  const binding = {
    url: nonEmptyString(rawBinding.url),
    fileKey: nonEmptyString(rawBinding.fileKey),
    nodeId: nonEmptyString(rawBinding.nodeId),
    frameName: nonEmptyString(rawBinding.frameName)
  };
  const rawSnapshot = isRecord(input.snapshot) ? structuredClone(input.snapshot) : null;
  if (!rawSnapshot) return { binding: Object.values(binding).some(Boolean) ? binding : null, snapshot: null };
  if (!Array.isArray(rawSnapshot.nodes) || rawSnapshot.nodes.length > 5000) {
    throw new Error("Design Snapshot 最多支持 5000 个节点。");
  }
  const serialized = JSON.stringify(rawSnapshot);
  if (serialized.length > 8 * 1024 * 1024) throw new Error("Design Snapshot 过大，请只导入当前 Frame。");
  return {
    binding: Object.values(binding).some(Boolean) ? binding : null,
    snapshot: { ...rawSnapshot, schemaVersion: 2, nodes: rawSnapshot.nodes.slice(0, 5000) }
  };
}

async function finalizeSession(sessionIdInput, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId) throw new Error("缺少 Review Session。");
  const token = makeId("finalize");
  const lockedSession = await lockSessionForFinalization(sessionId, token, sender);
  try {
    const exportResponse = await exportSession(sessionId, sender, true);
    const session = await settleSessionFinalization(sessionId, token, true, sender);
    return { ...exportResponse, session };
  } catch (error) {
    await settleSessionFinalization(sessionId, token, false, sender, lockedSession.status).catch(() => {});
    throw error;
  }
}

async function lockSessionForFinalization(sessionId, token, sender) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    let session = await requestResult(store.get(sessionId));
    if (!session) throw new Error("Review Session 已不存在。");
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, store);
    if (!isResumableSession(session)) throw new Error("Review Session 已经结束。");
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    const now = new Date().toISOString();
    const lockedSession = {
      ...session,
      status: "paused",
      finalizingToken: token,
      finalizingPreviousStatus: session.status === "paused" ? "paused" : "active",
      finalizingExpiresAtMs: Date.now() + FINALIZATION_TTL_MS,
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: now
    };
    store.put(lockedSession);
    await done;
    return lockedSession;
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function settleSessionFinalization(sessionId, token, completed, sender, fallbackStatus = "active") {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    const session = await requestResult(store.get(sessionId));
    if (!session) throw new Error("Review Session 已不存在。");
    assertSessionOwnership(session, sender);
    if (session.finalizingToken !== token) throw new Error("最终导出锁已经变化，请重新打开 UIDelta。");
    const now = new Date().toISOString();
    const updatedSession = { ...session };
    delete updatedSession.finalizingToken;
    delete updatedSession.finalizingPreviousStatus;
    delete updatedSession.finalizingExpiresAtMs;
    updatedSession.status = completed ? "completed" : (session.finalizingPreviousStatus || fallbackStatus || "active");
    updatedSession.endedAt = completed ? now : undefined;
    updatedSession.revision = finiteNumber(session.revision, 0) + 1;
    updatedSession.updatedAt = now;
    store.put(updatedSession);
    await done;
    return updatedSession;
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function touchSessionPage(sessionIdInput, pageSnapshot, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId || !isRecord(pageSnapshot)) throw new Error("页面轨迹数据无效。");
  const pageUrl = nonEmptyString(pageSnapshot.url);
  if (!pageUrl || normalizeOrigin(pageUrl) !== getSenderOrigin(sender)) {
    throw new Error("不能记录其他站点的页面轨迹。");
  }
  const db = await openDatabase();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    let session = await requestResult(store.get(sessionId));
    if (!session) throw new Error("Review Session 已不存在。");
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, store);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (!isResumableSession(session)) throw new Error("已结束的 Review Session 不能追加页面轨迹。");
    const pages = Array.isArray(session.pages) ? [...session.pages] : [];
    if (!pages.includes(pageUrl)) pages.push(pageUrl);
    const visits = Array.isArray(session.pageVisits) ? [...session.pageVisits] : [];
    const snapshot = structuredClone(pageSnapshot);
    if (visits[visits.length - 1]?.url === pageUrl) visits[visits.length - 1] = snapshot;
    else visits.push(snapshot);
    const updatedSession = {
      ...session,
      pages,
      pageVisits: visits.slice(-200),
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: new Date().toISOString()
    };
    store.put(updatedSession);
    await done;
    return { ok: true, session: updatedSession };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function reserveIssueSequence(sessionIdInput, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId) throw new Error("缺少 Review Session。");
  const db = await openDatabase();
  const transaction = db.transaction([STORE_SESSIONS, STORE_ISSUES], "readwrite");
  const done = transactionDone(transaction);
  try {
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const [storedSession, issues] = await Promise.all([
      requestResult(sessionStore.get(sessionId)),
      requestResult(issueStore.index("sessionId").getAll(sessionId))
    ]);
    if (!storedSession) throw new Error("Review Session 已不存在。");
    let session = storedSession;
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, sessionStore);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (session.status !== "active") throw new Error("请先继续本次走查。");
    const maxSequence = issues.reduce((maximum, issue) => Math.max(maximum, positiveSafeInteger(issue.sequence, 0)), 0);
    const sequence = Math.max(positiveSafeInteger(session.nextIssueNumber, 1), positiveSafeInteger(maxSequence + 1, 1));
    const updatedSession = {
      ...session,
      nextIssueNumber: sequence + 1,
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: new Date().toISOString()
    };
    sessionStore.put(updatedSession);
    await done;
    return { ok: true, sequence, displayId: `UI-${String(sequence).padStart(3, "0")}`, session: updatedSession };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function putIssue(input, sender) {
  if (!isRecord(input)) throw new Error("Issue 数据无效。");
  const sessionId = nonEmptyString(input.sessionId);
  if (!sessionId) throw new Error("Issue 缺少 sessionId。");
  const db = await openDatabase();
  const id = nonEmptyString(input.id || input.issueId) || makeId("issue");
  const transaction = db.transaction([STORE_ISSUES, STORE_SESSIONS, STORE_ASSETS], "readwrite");
  const done = transactionDone(transaction);
  try {
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const assetStore = transaction.objectStore(STORE_ASSETS);
    const [storedSession, existing, sessionIssues, linkedAssets] = await Promise.all([
      requestResult(sessionStore.get(sessionId)),
      requestResult(issueStore.get(id)),
      requestResult(issueStore.index("sessionId").getAll(sessionId)),
      requestResult(assetStore.index("issueId").getAll(id))
    ]);
    if (!storedSession) throw new Error("找不到 Issue 对应的 Review Session。");
    let session = storedSession;
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, sessionStore);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (!existing && session.status !== "active") throw new Error("当前 Review Session 已暂停或结束，不能新增 Issue。");
    if (existing && (session.status === "completed" || session.status === "ended")) throw new Error("已结束的 Review Session 不能修改 Issue。");
    if (existing && existing.sessionId !== sessionId) throw new Error("不能把已有 Issue 移动到另一场 Review Session。");
    const suppliedRevision = Number(input.revision);
    const hasSuppliedRevision = Number.isSafeInteger(suppliedRevision) && suppliedRevision >= 0;
    const currentIssueRevision = finiteNumber(existing?.revision, 0);
    if (existing && currentIssueRevision > 0 && (!hasSuppliedRevision || suppliedRevision !== currentIssueRevision)) {
      throw new Error("Issue 已在其他页面更新，请刷新后重试。");
    }
    if (!existing && hasSuppliedRevision && suppliedRevision > 0) {
      throw new Error("Issue 已被删除，不能按旧版本重新创建。");
    }

    const now = new Date().toISOString();
    const maxSequence = sessionIssues.reduce((maximum, issue) => Math.max(maximum, finiteNumber(issue.sequence, 0)), 0);
    const usedSequences = new Set(sessionIssues.map((issue) => positiveSafeInteger(issue.sequence, 0)));
    const requestedSequence = positiveSafeInteger(input.sequence, 0);
    const sequence = existing
      ? positiveSafeInteger(existing.sequence, positiveSafeInteger(input.sequence, 1))
      : requestedSequence > 0 && finiteNumber(input.numberingEpoch, 0) === finiteNumber(session.numberingEpoch, 0) && !usedSequences.has(requestedSequence)
        ? requestedSequence
        : Math.max(positiveSafeInteger(session.nextIssueNumber, 1), positiveSafeInteger(maxSequence + 1, 1));
    const type = nonEmptyString(input.type || existing?.type) || "ui";
    const issue = {
      ...(existing || {}),
      ...input,
      id,
      sessionId,
      type,
      sequence,
      numberingEpoch: finiteNumber(session.numberingEpoch, 0),
      displayId: `${issueTypePrefix(type)}-${String(sequence).padStart(3, "0")}`,
      revision: currentIssueRevision + 1,
      createdAt: input.createdAt || existing?.createdAt || now,
      updatedAt: now
    };
    const attachmentEntries = [
      ["context", nonEmptyString(issue.attachments?.context)],
      ["detail", nonEmptyString(issue.attachments?.detail)],
      ...Array.from(new Set(Array.isArray(issue.attachments?.references) ? issue.attachments.references.map(nonEmptyString).filter(Boolean).slice(0, 10) : [])).map((assetId) => ["reference", assetId])
    ].filter(([, assetId]) => Boolean(assetId));
    const requiredEntries = attachmentEntries.filter(([kind]) => kind === "context" || kind === "detail");
    if (requiredEntries.length !== 2) throw new Error("每条 Issue 都需要完整的 Context 与 Detail 截图。");
    const attachmentIds = attachmentEntries.map(([, assetId]) => assetId);
    if (new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Issue 不能重复引用同一张附件。");
    const linkedAssetsById = new Map(linkedAssets.map((asset) => [asset.id, asset]));
    const attachmentAssets = [];
    for (const [kind, assetId] of attachmentEntries) {
      const asset = linkedAssetsById.get(assetId);
      if (!asset) throw new Error("Issue 的截图资源已经失效，请重新截图。");
      if (asset.sessionId !== sessionId || asset.issueId !== id) throw new Error("Issue 引用了不属于它的截图资源。");
      if (asset.kind !== kind) throw new Error("Issue 的截图类型与附件位置不匹配。");
      attachmentAssets.push({ ...asset, pending: false, expiresAt: null, expiresAtMs: null, committedAt: now });
    }
    const pageKey = nonEmptyString(issue.pageSnapshot?.url);
    const pages = Array.isArray(session.pages) ? [...session.pages] : [];
    if (pageKey && !pages.includes(pageKey)) pages.push(pageKey);
    const updatedSession = {
      ...session,
      pages,
      nextIssueNumber: Math.max(finiteNumber(session.nextIssueNumber, 1), sequence + 1),
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: now
    };
    issueStore.put(issue);
    sessionStore.put(updatedSession);
    const desiredAttachmentIds = new Set(attachmentIds);
    for (const asset of linkedAssets) {
      if (!desiredAttachmentIds.has(asset.id)) assetStore.delete(asset.id);
    }
    for (const asset of attachmentAssets) assetStore.put(asset);
    await done;
    return { ok: true, issue, session: updatedSession };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function deleteIssue(issueIdInput, sender) {
  const issueId = nonEmptyString(issueIdInput);
  if (!issueId) throw new Error("缺少 issueId。");
  const result = await deleteIssues({ issueIds:[issueId] }, sender);
  return { ...result, issueId, deleted:result.deletedIssueIds.includes(issueId) };
}

async function deleteIssues(message, sender) {
  if (!Array.isArray(message.issueIds) || !message.issueIds.length || message.issueIds.length > 10000) throw new Error("请选择要删除的问题。");
  const ids = Array.from(new Set(message.issueIds.map(nonEmptyString)));
  if (ids.some((id) => !id)) throw new Error("问题编号无效。");
  const requestedSessionId = nonEmptyString(message.sessionId);
  if (ids.length > 1 && !requestedSessionId) throw new Error("批量删除缺少走查编号。");
  const db = await openDatabase();
  const transaction = db.transaction([STORE_ISSUES, STORE_SESSIONS, STORE_ASSETS], "readwrite");
  const done = transactionDone(transaction);
  try {
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const assetStore = transaction.objectStore(STORE_ASSETS);
    const existing = (await Promise.all(ids.map((id) => requestResult(issueStore.get(id))))).filter(Boolean);
    if (!existing.length && !requestedSessionId) {
      await done;
      return { ok:true, deletedIssueIds:[], deletedAssetIds:[] };
    }
    const sessionId = requestedSessionId || existing[0].sessionId;
    if (existing.some((issue) => issue.sessionId !== sessionId)) throw new Error("只能删除本次走查的问题。");
    const [storedSession, assetGroups] = await Promise.all([
      requestResult(sessionStore.get(sessionId)),
      Promise.all(existing.map((issue) => requestResult(assetStore.index("issueId").getAll(issue.id))))
    ]);
    if (!storedSession) throw new Error("Issue 对应的 Review Session 已不存在。");
    let session = storedSession;
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, sessionStore);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (session.status === "completed" || session.status === "ended") {
      throw new Error("已结束的 Review Session 不能删除 Issue。");
    }
    const assetIds = assetGroups.flat().map((asset) => asset.id);
    for (const issue of existing) issueStore.delete(issue.id);
    for (const assetId of assetIds) assetStore.delete(assetId);
    // Reset only for an explicit clear and only if no concurrent/new record
    // survives. The emptiness check and counter write share this transaction.
    const remaining = message.resetSequence === true
      ? await requestResult(issueStore.index("sessionId").getAll(sessionId)) : null;
    const resetSequence = remaining?.length === 0;
    if (existing.length) {
      session = { ...session, ...(resetSequence ? { nextIssueNumber:1, numberingEpoch:finiteNumber(session.numberingEpoch, 0) + 1 } : {}), revision:finiteNumber(session.revision, 0) + 1, updatedAt:new Date().toISOString() };
      sessionStore.put(session);
    }
    await done;
    return { ok:true, session, deletedIssueIds:existing.map((issue) => issue.id), deletedAssetIds:assetIds };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function captureEvidence(message, sender) {
  const captureStartedAt = Date.now();
  const issueId = nonEmptyString(message.issueId);
  const captureToken = nonEmptyString(message.captureToken);
  if (!issueId) throw new Error("截图缺少 issueId。");
  if (!captureToken) throw new Error("截图缺少 captureToken。");
  if (typeof sender.tab?.id !== "number" || typeof sender.tab?.windowId !== "number") {
    throw new Error("无法确定截图所在的标签页。");
  }
  if (!isInspectableUrl(sender.tab.url)) throw new Error("当前页面不支持截图。");

  const requestedRect = normalizeRect(message.rect);
  const requestedViewport = normalizeViewport(message.viewport);
  const db = await openDatabase();
  await recoverStaleFinalizations(db);
  await cleanupExpiredPendingAssets(db);
  const issue = await getOne(db, STORE_ISSUES, issueId);
  const requestedSessionId = nonEmptyString(issue?.sessionId || message.sessionId);
  const session = requestedSessionId
    ? await getOne(db, STORE_SESSIONS, requestedSessionId)
    : await findLatestActiveSessionForSender(db, sender);
  if (!session) throw new Error("Issue 对应的 Review Session 已不存在。");
  if (session.status !== "active") throw new Error("当前 Review Session 已结束，不能继续截图。");
  assertSessionOwnership(session, sender);

  const expectedUrl = nonEmptyString(message.pageUrl) || sender.tab.url;
  const capture = await captureVisibleTabForSender(sender, expectedUrl, captureToken, Boolean(message.preserveMeasurement));
  const rect = capture.beforeState?.rect || requestedRect;
  const viewport = capture.beforeState?.viewport || requestedViewport;
  const screenshotBlob = await (await fetch(capture.dataUrl)).blob();
  const bitmap = await createImageBitmap(screenshotBlob);

  try {
    const scaleX = bitmap.width / viewport.width;
    const scaleY = bitmap.height / viewport.height;
    const pixelRect = {
      left: (rect.left - viewport.offsetLeft) * scaleX,
      top: (rect.top - viewport.offsetTop) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY
    };
    const label = nonEmptyString(message.label) || issueId;
    const contextImage = await renderContextImage(bitmap, pixelRect, label, scaleX, scaleY);
    const detail = await renderDetailImage(bitmap, pixelRect, label, scaleX, scaleY);
    await assertCaptureCanCommit(db, session, issue, sender, expectedUrl);
    const sessionId = session.id;
    const timestamp = new Date().toISOString();
    const pending = true;
    const expiresAtMs = Date.now() + PENDING_ASSET_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const safeLabel = sanitizePathSegment(label, "issue");
    const captureState = {
      ...capture.beforeState,
      capturedAt: timestamp
    };
    const contextAsset = {
      id: makeId("asset"), issueId, sessionId, kind: "context",
      filename: `${safeLabel}-context.png`, mimeType: "image/png",
      width: contextImage.width, height: contextImage.height, blob: contextImage.blob, thumbnailBlob: contextImage.thumbnailBlob, pending, expiresAt, expiresAtMs,
      sourceUrl: expectedUrl, captureState, createdAt: timestamp
    };
    const detailAsset = {
      id: makeId("asset"), issueId, sessionId, kind: "detail",
      filename: `${safeLabel}-detail.png`, mimeType: "image/png",
      width: detail.width, height: detail.height, blob: detail.blob, thumbnailBlob: detail.thumbnailBlob, pending, expiresAt, expiresAtMs,
      sourceUrl: expectedUrl, captureState, createdAt: timestamp
    };
    await putMany(db, STORE_ASSETS, [contextAsset, detailAsset]);
    return {
      ok: true,
      contextAssetId: contextAsset.id,
      detailAssetId: detailAsset.id,
      assetIds: [contextAsset.id, detailAsset.id],
      captureState,
      captureDurationMs: Date.now() - captureStartedAt,
      assets: { context: publicAsset(contextAsset), detail: publicAsset(detailAsset) }
    };
  } finally {
    bitmap.close();
  }
}

async function putReferenceAsset(message, sender) {
  const issueId = nonEmptyString(message.issueId);
  const sessionId = nonEmptyString(message.sessionId);
  const dataUrl = typeof message.dataUrl === "string" ? message.dataUrl : "";
  if (!issueId || !sessionId || !dataUrl.startsWith("data:image/")) throw new Error("参考图片数据无效。");
  const sourceBlob = await (await fetch(dataUrl)).blob();
  if (!sourceBlob.size || sourceBlob.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error("参考图片需小于 8MB。");
  const db = await openDatabase();
  const session = await getOne(db, STORE_SESSIONS, sessionId);
  if (!session || session.status !== "active") throw new Error("当前走查不可添加参考图片。");
  assertSessionOwnership(session, sender);
  const existing = await getAllByIndex(db, STORE_ASSETS, "issueId", issueId);
  if (existing.filter((asset) => asset.kind === "reference").length >= 10) throw new Error("每个问题最多添加 10 张参考图片。");
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const thumbnailBlob = await renderThumbnail(bitmap, bitmap.width, bitmap.height);
    const now = new Date().toISOString();
    const expiresAtMs = Date.now() + PENDING_ASSET_TTL_MS;
    const asset = {
      id: makeId("asset"), issueId, sessionId, kind: "reference",
      filename: `${sanitizePathSegment(nonEmptyString(message.name) || "reference", "reference")}.png`,
      mimeType: sourceBlob.type || "image/png", width: bitmap.width, height: bitmap.height,
      blob: sourceBlob, thumbnailBlob, pending: true, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs,
      createdAt: now
    };
    await putOne(db, STORE_ASSETS, asset);
    return { ok: true, asset: publicAsset(asset) };
  } finally {
    bitmap.close();
  }
}

async function getAsset(assetIdInput, sender, thumbnail) {
  const assetId = nonEmptyString(assetIdInput);
  if (!assetId) throw new Error("缺少 assetId。");
  const db = await openDatabase();
  const asset = await getOne(db, STORE_ASSETS, assetId);
  if (!asset) return { ok: false, error: "找不到截图资源。" };
  await assertAssetOwnership(db, asset, sender);
  const blob = thumbnail && asset.thumbnailBlob instanceof Blob ? asset.thumbnailBlob : await assetToBlob(asset);
  return { ok: true, asset: publicAsset(asset), dataUrl: await blobToDataUrl(blob) };
}

async function deleteAssets(assetIdsInput, sender) {
  const assetIds = Array.isArray(assetIdsInput)
    ? [...new Set(assetIdsInput.map(nonEmptyString).filter(Boolean))]
    : [];
  if (assetIds.length === 0) throw new Error("没有可删除的 assetId。");
  const db = await openDatabase();
  const transaction = db.transaction([STORE_ASSETS, STORE_ISSUES, STORE_SESSIONS], "readwrite");
  const done = transactionDone(transaction);
  try {
    const assetStore = transaction.objectStore(STORE_ASSETS);
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const existingAssets = (await Promise.all(assetIds.map((assetId) => requestResult(assetStore.get(assetId))))).filter(Boolean);
    for (const asset of existingAssets) {
      let sessionId = asset.sessionId;
      if (!sessionId && asset.issueId) {
        const issue = await requestResult(issueStore.get(asset.issueId));
        sessionId = issue?.sessionId;
      }
      const session = sessionId ? await requestResult(sessionStore.get(sessionId)) : null;
      if (!session) throw new Error("截图资源缺少可验证的 Review Session。");
      assertSessionOwnership(session, sender);
      if (!asset.pending) throw new Error("已提交的截图只能随 Issue 一起更新或删除。");
    }
    for (const assetId of assetIds) assetStore.delete(assetId);
    await done;
    return { ok: true, assetIds, deletedCount: existingAssets.length };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function exportSession(sessionIdInput, sender, asCompleted = false) {
  const delivery = await prepareDeliveryBundle(sessionIdInput, sender, null, asCompleted);
  return downloadZipDelivery(delivery);
}

async function exportDeliverable(sessionIdInput, sender, formatInput, issueIds) {
  const format = nonEmptyString(formatInput).toLowerCase();
  if (!["html", "xlsx", "zip"].includes(format)) throw new Error("不支持的交付格式。");
  const delivery = await prepareDeliveryBundle(sessionIdInput, sender, issueIds, false);
  if (format === "zip") return downloadZipDelivery(delivery);
  if (format === "html") {
    const html = await buildHtmlReport(delivery.session, delivery.issues, delivery.assets, delivery.exportedAt);
    return downloadDeliveryArtifact(html, "text/html", makeDeliverableFilename(delivery.session, delivery.exportedAt, "html"), delivery);
  }
  const workbook = await buildXlsxReport(delivery.session, delivery.issues, delivery.assets, delivery.exportedAt);
  const bytes = await createStoredZip(workbook);
  return downloadDeliveryArtifact(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", makeDeliverableFilename(delivery.session, delivery.exportedAt, "xlsx"), delivery);
}

async function prepareDeliveryBundle(sessionIdInput, sender, issueIdsInput, asCompleted) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId) throw new Error("缺少 sessionId。");
  const db = await openDatabase();
  await recoverStaleFinalizations(db);
  const bundle = await getReviewBundle(db, sessionId);
  const session = bundle.session;
  if (!session) throw new Error("找不到要导出的 Review Session。");
  assertSessionOwnership(session, sender);
  if (session.finalizingToken && !asCompleted) throw new Error("Review Session 正在生成最终证据包，请稍候。");
  const {
    finalizingToken: _finalizingToken,
    finalizingPreviousStatus: _finalizingPreviousStatus,
    finalizingExpiresAtMs: _finalizingExpiresAtMs,
    ...stableSession
  } = session;
  const exportedSession = asCompleted
    ? { ...stableSession, status: "completed", endedAt: new Date().toISOString() }
    : stableSession;
  const requestedIds = Array.isArray(issueIdsInput) ? [...new Set(issueIdsInput.map(nonEmptyString).filter(Boolean))] : [];
  const knownIds = new Set(bundle.issues.map((issue) => issue.id));
  if (requestedIds.length && requestedIds.some((id) => !knownIds.has(id))) throw new Error("交付清单包含不存在的 Issue，请刷新后重试。");
  const selectedIds = requestedIds.length ? new Set(requestedIds) : null;
  const issues = bundle.issues.filter((issue) => !selectedIds || selectedIds.has(issue.id));
  issues.sort((first, second) => sortableTime(first, "createdAt") - sortableTime(second, "createdAt"));
  if (!issues.length) throw new Error("请至少选择一个 Issue 后交付。");

  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const assets = [];
  const selectedAssetIds = new Set();
  for (const issue of issues) {
    if (!issue.attachments?.context || !issue.attachments?.detail) {
      throw new Error(`${issue.displayId || issue.id} 的截图证据不完整，请重新记录后再导出。`);
    }
    const attachmentPairs = [
      ["context", issue.attachments?.context], ["detail", issue.attachments?.detail],
      ...(Array.isArray(issue.attachments?.references) ? issue.attachments.references.map((assetId) => ["reference", assetId]) : [])
    ];
    for (const [kind, rawAssetId] of attachmentPairs) {
      const assetId = nonEmptyString(rawAssetId);
      if (!assetId) continue;
      const asset = assetsById.get(assetId);
      if (!asset || asset.pending) throw new Error(`${issue.displayId || issue.id} 的 ${kind} 截图缺失，请重新记录后再导出。`);
      if (asset.sessionId !== sessionId || asset.issueId !== issue.id || asset.kind !== kind) {
        throw new Error(`${issue.displayId || issue.id} 的 ${kind} 截图关联无效。`);
      }
      if (!selectedAssetIds.has(asset.id)) {
        selectedAssetIds.add(asset.id);
        assets.push(asset);
      }
    }
  }
  const exportAssets = assignExportPaths(assets, issues);
  const exportPathsByAssetId = new Map(exportAssets.map((asset) => [asset.id, asset.exportPath]));
  const exportedIssues = issues.map((issue) => ({
    ...issue,
    developerFields: buildDeveloperFields(issue),
    attachmentPaths: {
      context: exportPathsByAssetId.get(issue.attachments?.context) || null,
      detail: exportPathsByAssetId.get(issue.attachments?.detail) || null,
      references: (Array.isArray(issue.attachments?.references) ? issue.attachments.references : []).map((assetId) => exportPathsByAssetId.get(assetId)).filter(Boolean),
      descriptionImages: (Array.isArray(issue.attachments?.descriptionImages) ? issue.attachments.descriptionImages : []).filter((id) => issue.attachments?.references?.includes(id)).map((id) => exportPathsByAssetId.get(id)).filter(Boolean)
    }
  }));
  const exportedAt = new Date().toISOString();
  return {
    session: exportedSession,
    issues: exportedIssues,
    assets: exportAssets,
    exportedAt
  };
}

async function downloadZipDelivery(delivery) {
  const manifest = buildDeliveryManifest(delivery.session, delivery.issues, delivery.assets, delivery.exportedAt);
  const archiveEntries = [
    { name: "report.md", data: buildMarkdownReport(delivery.session, delivery.issues, delivery.assets, delivery.exportedAt) },
    { name: "issues.json", data: JSON.stringify(manifest, null, 2) }
  ];
  for (const asset of delivery.assets) archiveEntries.push({ name: asset.exportPath, data: await assetToBlob(asset) });
  const estimatedBytes = estimateStoredZipBytes(archiveEntries);
  if (estimatedBytes > MAX_EXPORT_BYTES) throw new Error("证据包预计超过 96MB，请拆分交付清单后再导出。");
  const zip = await createStoredZip(archiveEntries);
  return downloadDeliveryArtifact(zip, "application/zip", makeExportFilename(delivery.session, delivery.exportedAt), delivery);
}

function buildDeliveryManifest(session, issues, assets, exportedAt) {
  return {
    schemaVersion: 4,
    format: "uidelta-evidence-bundle",
    exportedAt,
    session,
    issues,
    assets: assets.map(({ blob: _blob, thumbnailBlob: _thumbnailBlob, dataUrl: _dataUrl, ...asset }) => asset)
  };
}

async function downloadDeliveryArtifact(data, mimeType, filename, delivery) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("交付文件超过 96MB，请拆分交付清单后再导出。");
  const url = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  const downloadId = await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
  const downloadItem = await waitForDownloadCompletion(downloadId);
  return {
    ok: true,
    downloadId,
    filename,
    downloadPath: nonEmptyString(downloadItem?.filename),
    issueCount: delivery.issues.length,
    assetCount: delivery.assets.length
  };
}

async function importDeliverable(sessionIdInput, payload, assetDataInput, sender) {
  const sessionId = nonEmptyString(sessionIdInput);
  if (!sessionId) throw new Error("缺少导入目标 Review Session。");
  if (!isRecord(payload)) throw new Error("UIDelta 交付数据无效。");
  const schemaVersion = Number(payload.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 3 || schemaVersion > 4) throw new Error("不支持的 UIDelta 交付版本。");
  const incomingIssues = Array.isArray(payload.issues)
    ? payload.issues.filter((issue) => isRecord(issue)).slice(0, 100)
    : [];
  if (!incomingIssues.length) throw new Error("交付数据中没有可导入的 Issue。");
  const incomingAssets = Array.isArray(payload.assets) ? payload.assets.filter((asset) => isRecord(asset)) : [];
  const assetsByPath = new Map(incomingAssets.map((asset) => [nonEmptyString(asset.exportPath), asset]).filter(([path]) => Boolean(path)));
  const dataByPath = new Map((Array.isArray(assetDataInput) ? assetDataInput : [])
    .filter((entry) => isRecord(entry) && nonEmptyString(entry.exportPath) && typeof entry.dataUrl === "string" && entry.dataUrl.startsWith("data:image/"))
    .map((entry) => [entry.exportPath, entry.dataUrl]));
  if (dataByPath.size > 500) throw new Error("交付包中的截图数量超过安全上限。");

  const db = await openDatabase();
  const transaction = db.transaction([STORE_SESSIONS, STORE_ISSUES, STORE_ASSETS], "readwrite");
  const done = transactionDone(transaction);
  try {
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const assetStore = transaction.objectStore(STORE_ASSETS);
    let session = await requestResult(sessionStore.get(sessionId));
    if (!session) throw new Error("找不到导入目标 Review Session。");
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, sessionStore);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (session.status !== "active") throw new Error("请先继续本次走查后再导入交付包。");
    const existingIssues = await requestResult(issueStore.index("sessionId").getAll(sessionId));
    const sourceIds = new Set(existingIssues.flatMap((issue) => [issue.id, issue.importedFrom?.issueId]).filter(Boolean));
    const maxSequence = existingIssues.reduce((maximum, issue) => Math.max(maximum, positiveSafeInteger(issue.sequence, 0)), 0);
    let sequence = Math.max(positiveSafeInteger(session.nextIssueNumber, 1), maxSequence + 1);
    const now = new Date().toISOString();
    const imported = [];
    const skippedDuplicateIds = [];
    const pages = Array.isArray(session.pages) ? [...session.pages] : [];

    for (const incoming of incomingIssues) {
      const sourceIssueId = nonEmptyString(incoming.id);
      if (!sourceIssueId) throw new Error("导入 Issue 缺少稳定 ID。");
      if (sourceIds.has(sourceIssueId)) {
        skippedDuplicateIds.push(sourceIssueId);
        continue;
      }
      const paths = isRecord(incoming.attachmentPaths) ? incoming.attachmentPaths : {};
      const attachmentPathSets = [
        ["context", nonEmptyString(paths.context)],
        ["detail", nonEmptyString(paths.detail)],
        ...Array.from(new Set(Array.isArray(paths.references) ? paths.references.map(nonEmptyString).filter(Boolean).slice(0, 10) : [])).map((path) => ["reference", path])
      ];
      if (!attachmentPathSets[0][1] || !attachmentPathSets[1][1]) {
        throw new Error(`${incoming.displayId || sourceIssueId} 缺少完整截图证据。`);
      }
      const issueId = makeId("issue");
      const attachments = { references: [], descriptionImages:[] };
      for (const [kind, path] of attachmentPathSets) {
        const sourceAsset = assetsByPath.get(path);
        const dataUrl = dataByPath.get(path);
        if (!sourceAsset || !dataUrl) throw new Error(`${incoming.displayId || sourceIssueId} 的 ${kind} 截图缺失。`);
        const blob = dataUrlToBlob(dataUrl);
        if (blob.size > MAX_EXPORT_BYTES) throw new Error("单张导入截图超过安全上限。");
        const assetId = makeId("asset");
        const asset = {
          id: assetId,
          issueId,
          sessionId,
          kind,
          filename: nonEmptyString(sourceAsset.filename) || `${sanitizePathSegment(incoming.displayId || sourceIssueId, "issue")}-${kind}.png`,
          mimeType: nonEmptyString(sourceAsset.mimeType) || blob.type || "image/png",
          width: positiveSafeInteger(sourceAsset.width, 1),
          height: positiveSafeInteger(sourceAsset.height, 1),
          blob,
          thumbnailBlob: blob,
          pending: false,
          expiresAt: null,
          expiresAtMs: null,
          createdAt: now,
          committedAt: now,
          importedFrom: { exportPath: path, sourceAssetId: nonEmptyString(sourceAsset.id) || null }
        };
        assetStore.put(asset);
        if (kind === "reference") attachments.references.push(assetId);
        else attachments[kind] = assetId;
        if (kind === "reference" && Array.isArray(paths.descriptionImages) && paths.descriptionImages.includes(path)) attachments.descriptionImages.push(assetId);
      }
      const type = ["ui", "functional", "content"].includes(incoming.type) ? incoming.type : "ui";
      const issue = {
        id: issueId,
        sessionId,
        sequence,
        displayId: `${issueTypePrefix(type)}-${String(sequence).padStart(3, "0")}`,
        revision: 1,
        type,
        title: nonEmptyString(incoming.title) || firstLine(incoming.description) || "导入的问题",
        description: typeof incoming.description === "string" ? incoming.description.slice(0, 10000) : "",
        resultReference: typeof incoming.resultReference === "string" ? incoming.resultReference.slice(0, 10000) : "",
        priority: nonEmptyString(incoming.priority) || "queued",
        severity: nonEmptyString(incoming.severity) || "cosmetic",
        pageSnapshot: isRecord(incoming.pageSnapshot) ? structuredClone(incoming.pageSnapshot) : {},
        elementAnchor: isRecord(incoming.elementAnchor) ? structuredClone(incoming.elementAnchor) : null,
        webSnapshot: isRecord(incoming.webSnapshot) ? structuredClone(incoming.webSnapshot) : null,
        designSnapshot: isRecord(incoming.designSnapshot) ? structuredClone(incoming.designSnapshot) : null,
        diffs: Array.isArray(incoming.diffs) ? structuredClone(incoming.diffs).slice(0, 100) : [],
        measurement: isRecord(incoming.measurement) ? structuredClone(incoming.measurement) : null,
        region: isRecord(incoming.region) ? structuredClone(incoming.region) : null,
        changeProposal: isRecord(incoming.changeProposal) ? structuredClone(incoming.changeProposal) : null,
        attachments,
        source: "uidelta-import",
        importedFrom: {
          source: "uidelta",
          sessionId: nonEmptyString(payload.session?.id) || null,
          issueId: sourceIssueId,
          importedAt: now
        },
        createdAt: nonEmptyString(incoming.createdAt) || now,
        updatedAt: now
      };
      const pageUrl = nonEmptyString(issue.pageSnapshot?.url);
      if (pageUrl && !pages.includes(pageUrl)) pages.push(pageUrl);
      issueStore.put(issue);
      imported.push(issue);
      sourceIds.add(sourceIssueId);
      sequence += 1;
    }
    const updatedSession = {
      ...session,
      pages,
      nextIssueNumber: Math.max(positiveSafeInteger(session.nextIssueNumber, 1), sequence),
      revision: finiteNumber(session.revision, 0) + 1,
      updatedAt: now
    };
    sessionStore.put(updatedSession);
    await done;
    return { ok: true, session: updatedSession, issues: imported, skippedDuplicateIds };
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match || !/^image\/(png|jpe?g|webp|gif)$/i.test(match[1])) throw new Error("导入截图格式无效。");
  const binary = atob(match[2].replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function waitForDownloadCompletion(downloadId) {
  const [existing] = await chrome.downloads.search({ id: downloadId });
  if (existing?.state === "complete") return existing;
  if (existing?.state === "interrupted") throw new Error("证据包下载被中断，请重试。");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("证据包下载超时，本次走查仍保持可恢复状态。")), 120000);
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      if (delta.state.current === "complete") finish();
      else if (delta.state.current === "interrupted") finish(new Error("证据包下载被中断，请重试。"));
    };
    const finish = async (error) => {
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(listener);
      if (error) reject(error);
      else {
        try {
          const [downloadItem] = await chrome.downloads.search({ id: downloadId });
          resolve(downloadItem || null);
        } catch (searchError) {
          reject(searchError);
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function renderContextImage(bitmap, pixelRect, label, scaleX, scaleY) {
  const outputScale = Math.min(1, MAX_CONTEXT_WIDTH / bitmap.width, MAX_CONTEXT_HEIGHT / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * outputScale));
  const height = Math.max(1, Math.round(bitmap.height * outputScale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建截图画布。");
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, width, height);
  drawHighlight(context, {
    left: pixelRect.left * outputScale,
    top: pixelRect.top * outputScale,
    width: pixelRect.width * outputScale,
    height: pixelRect.height * outputScale
  }, label, scaleX * outputScale, scaleY * outputScale);
  const [blob, thumbnailBlob] = await Promise.all([
    canvas.convertToBlob({ type: "image/png" }),
    renderThumbnail(canvas, canvas.width, canvas.height)
  ]);
  return { blob, thumbnailBlob, width, height };
}

async function renderDetailImage(bitmap, pixelRect, label, scaleX, scaleY) {
  const paddingX = 40 * scaleX;
  const paddingY = 40 * scaleY;
  const cropLeft = clamp(Math.floor(pixelRect.left - paddingX), 0, bitmap.width - 1);
  const cropTop = clamp(Math.floor(pixelRect.top - paddingY), 0, bitmap.height - 1);
  const cropRight = clamp(Math.ceil(pixelRect.left + pixelRect.width + paddingX), cropLeft + 1, bitmap.width);
  const cropBottom = clamp(Math.ceil(pixelRect.top + pixelRect.height + paddingY), cropTop + 1, bitmap.height);
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;
  const outputScale = Math.min(1, MAX_DETAIL_WIDTH / cropWidth, MAX_DETAIL_HEIGHT / cropHeight);
  const width = Math.max(1, Math.round(cropWidth * outputScale));
  const height = Math.max(1, Math.round(cropHeight * outputScale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建局部截图画布。");
  context.drawImage(bitmap, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, width, height);
  drawHighlight(context, {
    left: (pixelRect.left - cropLeft) * outputScale,
    top: (pixelRect.top - cropTop) * outputScale,
    width: pixelRect.width * outputScale,
    height: pixelRect.height * outputScale
  }, label, scaleX * outputScale, scaleY * outputScale);
  const [blob, thumbnailBlob] = await Promise.all([
    canvas.convertToBlob({ type: "image/png" }),
    renderThumbnail(canvas, width, height)
  ]);
  return { blob, thumbnailBlob, width, height };
}

async function renderThumbnail(source, sourceWidth, sourceHeight) {
  const scale = Math.min(1, 160 / sourceWidth, 96 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建截图缩略图。");
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/png" });
}

function drawHighlight(context, inputRect, label, scaleX, scaleY) {
  const canvasWidth = context.canvas.width;
  const canvasHeight = context.canvas.height;
  const left = clamp(inputRect.left, 0, canvasWidth);
  const top = clamp(inputRect.top, 0, canvasHeight);
  const right = clamp(inputRect.left + inputRect.width, 0, canvasWidth);
  const bottom = clamp(inputRect.top + inputRect.height, 0, canvasHeight);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const unit = Math.max(1, Math.min(scaleX, scaleY));
  const lineWidth = Math.max(2, Math.round(2 * unit));

  context.save();
  context.fillStyle = "rgba(15, 139, 255, 0.14)";
  context.strokeStyle = "#0f8bff";
  context.lineWidth = lineWidth;
  context.fillRect(left, top, width, height);
  context.strokeRect(left + lineWidth / 2, top + lineWidth / 2, Math.max(0, width - lineWidth), Math.max(0, height - lineWidth));

  const fontSize = Math.max(12, Math.round(12 * unit));
  const horizontalPadding = Math.max(7, Math.round(7 * unit));
  const labelHeight = Math.max(24, Math.round(24 * unit));
  context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textBaseline = "middle";
  const text = String(label).slice(0, 32);
  const labelWidth = Math.ceil(context.measureText(text).width + horizontalPadding * 2);
  const labelLeft = clamp(left, 0, Math.max(0, canvasWidth - labelWidth));
  const preferredTop = top - labelHeight - lineWidth;
  const labelTop = preferredTop >= 0 ? preferredTop : clamp(bottom + lineWidth, 0, Math.max(0, canvasHeight - labelHeight));
  roundedRect(context, labelLeft, labelTop, labelWidth, labelHeight, Math.max(4, Math.round(5 * unit)));
  context.fillStyle = "#0f8bff";
  context.fill();
  context.fillStyle = "#ffffff";
  context.fillText(text, labelLeft + horizontalPadding, labelTop + labelHeight / 2);
  context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  const actualRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + actualRadius, y);
  context.lineTo(x + width - actualRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + actualRadius);
  context.lineTo(x + width, y + height - actualRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - actualRadius, y + height);
  context.lineTo(x + actualRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - actualRadius);
  context.lineTo(x, y + actualRadius);
  context.quadraticCurveTo(x, y, x + actualRadius, y);
  context.closePath();
}

function normalizeRect(input) {
  if (!isRecord(input)) throw new Error("截图区域 rect 无效。");
  const left = finiteNumber(input.left, finiteNumber(input.x, NaN));
  const top = finiteNumber(input.top, finiteNumber(input.y, NaN));
  const width = finiteNumber(input.width, finiteNumber(input.right, NaN) - left);
  const height = finiteNumber(input.height, finiteNumber(input.bottom, NaN) - top);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("截图区域 rect 缺少有效的坐标或尺寸。");
  }
  return { left, top, width, height };
}

function normalizeViewport(input) {
  if (!isRecord(input)) throw new Error("截图缺少 viewport。");
  const visualViewport = isRecord(input.visualViewport) ? input.visualViewport : input;
  const width = finiteNumber(visualViewport.width, finiteNumber(input.width, finiteNumber(input.innerWidth, NaN)));
  const height = finiteNumber(visualViewport.height, finiteNumber(input.height, finiteNumber(input.innerHeight, NaN)));
  const offsetLeft = finiteNumber(visualViewport.offsetLeft, 0);
  const offsetTop = finiteNumber(visualViewport.offsetTop, 0);
  const scrollX = finiteNumber(input.scrollX, 0);
  const scrollY = finiteNumber(input.scrollY, 0);
  const scale = finiteNumber(visualViewport.scale, 1);
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("viewport 缺少有效的宽高。");
  }
  return { width, height, offsetLeft, offsetTop, scrollX, scrollY, scale };
}

async function assertSenderTabIsActive(senderTab, expectedUrl) {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: senderTab.windowId });
  if (activeTab?.id !== senderTab.id) {
    throw new Error("截图时标签页发生切换，请回到当前页面后重试。");
  }
  const currentTab = await chrome.tabs.get(senderTab.id);
  if (currentTab.windowId !== senderTab.windowId || (expectedUrl && currentTab.url !== expectedUrl)) {
    throw new Error("截图时页面发生跳转，请在目标页面重新记录。");
  }
  if (normalizeOrigin(currentTab.url) !== normalizeOrigin(senderTab.url)) {
    throw new Error("截图时页面来源发生变化，已取消本次取证。");
  }
}

function captureVisibleTabForSender(sender, expectedUrl, captureToken, preserveMeasurement = false) {
  const senderTab = sender.tab;
  const current = captureQueue.catch(() => {}).then(async () => {
    const elapsed = Date.now() - lastCaptureAt;
    if (elapsed < MIN_CAPTURE_INTERVAL_MS) await delay(MIN_CAPTURE_INTERVAL_MS - elapsed);
    await assertSenderTabIsActive(senderTab, expectedUrl);
    let overlayRestored = false;
    try {
      const beforeState = normalizeCaptureState(
        await withTimeout(
          setCaptureOverlayVisibility(sender, false, captureToken, preserveMeasurement),
          2500,
          "页面未及时完成截图准备，请保持窗口可见后重试。"
        ),
        expectedUrl
      );
      const dataUrl = await withTimeout(
        chrome.tabs.captureVisibleTab(senderTab.windowId, { format: "png" }),
        6000,
        "浏览器截图超时，请保持窗口可见后重试。"
      );
      lastCaptureAt = Date.now();
      await assertSenderTabIsActive(senderTab, expectedUrl);
      const afterResponse = await withTimeout(
        setCaptureOverlayVisibility(sender, true, captureToken, preserveMeasurement),
        2500,
        "页面未及时恢复 UIDelta 浮层。"
      );
      overlayRestored = true;
      const afterState = normalizeCaptureState(afterResponse, expectedUrl);
      assertStableCaptureState(beforeState, afterState);
      return { dataUrl, beforeState, afterState };
    } finally {
      if (!overlayRestored) {
        await withTimeout(
          setCaptureOverlayVisibility(sender, true, captureToken, preserveMeasurement),
          2500,
          "页面未及时恢复 UIDelta 浮层。"
        ).catch(() => {});
      }
    }
  });
  captureQueue = current;
  return current;
}

async function setCaptureOverlayVisibility(sender, visible, captureToken, preserveMeasurement = false) {
  const options = sender.documentId ? { documentId: sender.documentId } : undefined;
  const message = { type: "UIDELTA_CAPTURE_OVERLAY", visible, captureToken, preserveMeasurement };
  const response = options
    ? await chrome.tabs.sendMessage(sender.tab.id, message, options)
    : await chrome.tabs.sendMessage(sender.tab.id, message);
  if (!response?.ok) throw new Error(response?.error || "无法确认当前页面的 UIDelta 截图状态。");
  return response;
}

function normalizeCaptureState(input, expectedUrl) {
  if (!isRecord(input)) throw new Error("页面没有返回有效的截图状态。");
  const pageUrl = nonEmptyString(input.pageUrl);
  const documentToken = nonEmptyString(input.documentToken);
  if (!pageUrl || pageUrl !== expectedUrl) throw new Error("截图时页面发生跳转，请重新记录。");
  if (!documentToken) throw new Error("无法确认截图所在的页面文档。");
  return {
    pageUrl,
    documentToken,
    rect: normalizeRect(input.rect),
    viewport: normalizeViewport(input.viewport)
  };
}

function assertStableCaptureState(beforeState, afterState) {
  if (beforeState.documentToken !== afterState.documentToken || beforeState.pageUrl !== afterState.pageUrl) {
    throw new Error("截图时页面发生刷新或跳转，请重新记录。");
  }
  const beforeValues = captureGeometryValues(beforeState);
  const afterValues = captureGeometryValues(afterState);
  const moved = beforeValues.some((value, index) => Math.abs(value - afterValues[index]) > 2);
  if (moved) throw new Error("元素在截图过程中发生移动，请重试。");
}

function captureGeometryValues(state) {
  return [
    state.rect.left,
    state.rect.top,
    state.rect.width,
    state.rect.height,
    state.viewport.width,
    state.viewport.height,
    state.viewport.offsetLeft,
    state.viewport.offsetTop,
    state.viewport.scrollX,
    state.viewport.scrollY,
    state.viewport.scale
  ];
}

async function assertCaptureCanCommit(db, session, initialIssue, sender, expectedUrl) {
  await assertSenderTabIsActive(sender.tab, expectedUrl);
  const currentSession = await getOne(db, STORE_SESSIONS, session.id);
  if (!currentSession || currentSession.status !== "active") {
    throw new Error("Review Session 已暂停或结束，截图未保存。");
  }
  assertSessionOwnership(currentSession, sender);
  if (initialIssue) {
    const currentIssue = await getOne(db, STORE_ISSUES, initialIssue.id);
    if (!currentIssue || currentIssue.sessionId !== session.id) {
      throw new Error("Issue 已被删除或移动，截图未保存。");
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const sessions = db.objectStoreNames.contains(STORE_SESSIONS)
        ? request.transaction.objectStore(STORE_SESSIONS)
        : db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
      ensureIndex(sessions, "origin", "origin");
      ensureIndex(sessions, "status", "status");
      ensureIndex(sessions, "updatedAt", "updatedAt");
      const issues = db.objectStoreNames.contains(STORE_ISSUES)
        ? request.transaction.objectStore(STORE_ISSUES)
        : db.createObjectStore(STORE_ISSUES, { keyPath: "id" });
      ensureIndex(issues, "sessionId", "sessionId");
      ensureIndex(issues, "updatedAt", "updatedAt");
      const assets = db.objectStoreNames.contains(STORE_ASSETS)
        ? request.transaction.objectStore(STORE_ASSETS)
        : db.createObjectStore(STORE_ASSETS, { keyPath: "id" });
      ensureIndex(assets, "issueId", "issueId");
      ensureIndex(assets, "sessionId", "sessionId");
      ensureIndex(assets, "expiresAtMs", "expiresAtMs");
      if (event.oldVersion < 2) {
        const cursorRequest = assets.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const asset = { ...cursor.value };
          if (asset.pending) {
            const parsedExpiry = Date.parse(asset.expiresAt || 0);
            asset.expiresAtMs = Number.isFinite(parsedExpiry) ? parsedExpiry : 0;
            cursor.update(asset);
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error || new Error("无法打开 UIDelta 本地数据库。"));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("UIDelta 数据库升级被其他页面阻塞，请重新加载扩展。"));
    };
  });
  return databasePromise;
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function getOne(db, storeName, key) {
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

function getAll(db, storeName) {
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

function getAllByIndex(db, storeName, indexName, key) {
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).index(indexName).getAll(key));
}

async function getReviewBundle(db, sessionId) {
  const transaction = db.transaction([STORE_SESSIONS, STORE_ISSUES, STORE_ASSETS], "readonly");
  const done = transactionDone(transaction);
  const sessionRequest = transaction.objectStore(STORE_SESSIONS).get(sessionId);
  const issueRequest = transaction.objectStore(STORE_ISSUES).index("sessionId").getAll(sessionId);
  const assetRequest = transaction.objectStore(STORE_ASSETS).index("sessionId").getAll(sessionId);
  const [session, issues, assets] = await Promise.all([
    requestResult(sessionRequest), requestResult(issueRequest), requestResult(assetRequest)
  ]);
  await done;
  return { session, issues, assets };
}

async function putOne(db, storeName, value) {
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

async function putMany(db, storeName, values) {
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const value of values) store.put(value);
  await transactionDone(transaction);
}

async function cleanupExpiredPendingAssets(db) {
  const now = Date.now();
  const transaction = db.transaction(STORE_ASSETS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_ASSETS);
    const index = store.index("expiresAtMs");
    let expiredCount = 0;
    await new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.upperBound(now));
      request.onerror = () => reject(request.error || new Error("清理过期截图失败。"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (cursor.value.pending) {
          cursor.delete();
          expiredCount += 1;
        } else {
          const asset = { ...cursor.value };
          delete asset.expiresAtMs;
          cursor.update(asset);
        }
        cursor.continue();
      };
    });
    await done;
    return expiredCount;
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

async function recoverStaleFinalizations(db) {
  const now = Date.now();
  const transaction = db.transaction(STORE_SESSIONS, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(STORE_SESSIONS);
    const sessions = await requestResult(store.getAll());
    let recovered = 0;
    for (const session of sessions) {
      const restored = restoreExpiredFinalizationInStore(session, store, now);
      if (restored !== session) recovered += 1;
    }
    await done;
    return recovered;
  } catch (error) {
    try { transaction.abort(); } catch (_) {}
    await done.catch(() => {});
    throw error;
  }
}

function restoreExpiredFinalizationInStore(session, sessionStore, nowMs = Date.now()) {
  if (!session?.finalizingToken || finiteNumber(session.finalizingExpiresAtMs, 0) > nowMs) return session;
  const restored = { ...session };
  delete restored.finalizingToken;
  delete restored.finalizingPreviousStatus;
  delete restored.finalizingExpiresAtMs;
  restored.status = session.finalizingPreviousStatus === "paused" ? "paused" : "active";
  restored.revision = finiteNumber(session.revision, 0) + 1;
  restored.updatedAt = new Date(nowMs).toISOString();
  sessionStore.put(restored);
  return restored;
}

async function cleanupStaleCompletedSessions(db) {
  const cutoff = Date.now() - COMPLETED_SESSION_RETENTION_MS;
  const sessions = (await getAll(db, STORE_SESSIONS)).filter((session) => {
    if (session.status !== "completed" && session.status !== "ended") return false;
    return sortableTime(session) < cutoff;
  });
  for (const session of sessions) {
    const [issues, assets] = await Promise.all([
      getAllByIndex(db, STORE_ISSUES, "sessionId", session.id),
      getAllByIndex(db, STORE_ASSETS, "sessionId", session.id)
    ]);
    const transaction = db.transaction([STORE_SESSIONS, STORE_ISSUES, STORE_ASSETS], "readwrite");
    transaction.objectStore(STORE_SESSIONS).delete(session.id);
    const issueStore = transaction.objectStore(STORE_ISSUES);
    for (const issue of issues) issueStore.delete(issue.id);
    const assetStore = transaction.objectStore(STORE_ASSETS);
    for (const asset of assets) assetStore.delete(asset.id);
    await transactionDone(transaction);
  }
  return sessions.length;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 操作失败。"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务已中止。"));
  });
}

function isResumableSession(session) {
  if (!session || session.endedAt || session.status === "ended" || session.status === "completed") return false;
  return session.status === "active" || session.status === "paused" || session.active === true;
}

function sortableTime(record, key = "updatedAt") {
  const value = Date.parse(record?.[key] || record?.startedAt || record?.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeOrigin(value) {
  const text = nonEmptyString(value);
  if (!text) return "";
  if (text === "null") return "file://";
  try {
    const url = new URL(text);
    if (url.protocol === "file:") {
      if (!url.pathname || url.pathname === "/") return "file://";
      const directory = url.pathname.endsWith("/") ? url.pathname : url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
      return "file://" + directory;
    }
    return url.origin;
  } catch (_) {
    return text.replace(/\/$/, "").toLowerCase();
  }
}

function getSenderOrigin(sender) {
  return sender?.tab?.url ? normalizeOrigin(sender.tab.url) : "";
}

function assertSessionOwnership(session, sender) {
  const senderOrigin = getSenderOrigin(sender);
  if (!senderOrigin) return;
  const sessionOrigin = normalizeOrigin(session?.origin || session?.url);
  if (!sessionOrigin || sessionOrigin !== senderOrigin) {
    throw new Error("当前页面不能访问其他站点的 Review 数据。");
  }
}

async function findLatestActiveSessionForSender(db, sender) {
  const senderOrigin = getSenderOrigin(sender);
  if (!senderOrigin) return null;
  const sessions = await getAll(db, STORE_SESSIONS);
  return sessions
    .filter((session) => session.status === "active" && normalizeOrigin(session.origin || session.url) === senderOrigin)
    .sort((first, second) => sortableTime(second) - sortableTime(first))[0] || null;
}

async function assertAssetOwnership(db, asset, sender) {
  if (!getSenderOrigin(sender)) return;
  let sessionId = asset.sessionId;
  if (!sessionId && asset.issueId) {
    const issue = await getOne(db, STORE_ISSUES, asset.issueId);
    sessionId = issue?.sessionId;
  }
  const session = sessionId ? await getOne(db, STORE_SESSIONS, sessionId) : null;
  if (!session) throw new Error("截图资源缺少可验证的 Review Session。");
  assertSessionOwnership(session, sender);
}

function assignExportPaths(assets, issues) {
  const issueById = new Map(issues.map((issue, index) => [issue.id, { issue, index }]));
  const used = new Set();
  const orderedAssets = [...assets].sort((first, second) => {
    const firstIndex = issueById.get(first.issueId)?.index ?? Number.MAX_SAFE_INTEGER;
    const secondIndex = issueById.get(second.issueId)?.index ?? Number.MAX_SAFE_INTEGER;
    if (firstIndex !== secondIndex) return firstIndex - secondIndex;
    return assetKindOrder(first.kind) - assetKindOrder(second.kind);
  });
  return orderedAssets.map((asset) => {
    const entry = issueById.get(asset.issueId);
    const fallback = entry ? `UI-${String(entry.index + 1).padStart(3, "0")}` : "asset";
    const label = entry?.issue.displayId || entry?.issue.key || entry?.issue.label || entry?.issue.number || fallback;
    const base = `${sanitizePathSegment(String(label), fallback)}-${sanitizePathSegment(asset.kind, "image")}`;
    let filename = `${base}.png`;
    let suffix = 2;
    while (used.has(filename.toLowerCase())) filename = `${base}-${suffix++}.png`;
    used.add(filename.toLowerCase());
    return { ...asset, exportPath: `assets/${filename}` };
  });
}

function assetKindOrder(kind) {
  if (kind === "context") return 0;
  if (kind === "detail") return 1;
  return 2;
}

function buildMarkdownReport(session, issues, assets, exportedAt) {
  const groups = new Map();
  for (const asset of assets) {
    if (!groups.has(asset.issueId)) groups.set(asset.issueId, []);
    groups.get(asset.issueId).push(asset);
  }
  const lines = [
    `# UIDelta 走查问题 · ${markdownText(session.name || session.title || "未命名项目")}`, "",
    `- 走查会话：\`${markdownText(session.id)}\``,
    `- 走查状态：${markdownText(session.status || "active")}`,
    `- 来源站点：${markdownText(session.origin || "-")}`,
    `- 开始时间：${markdownText(session.startedAt || session.createdAt || "-")}`,
    `- 导出时间：${exportedAt}`,
    `- 问题数：${issues.length}`, ""
  ];
  if (issues.length === 0) {
    lines.push("_本次走查没有记录 Issue。_", "");
    return lines.join("\n");
  }
  lines.push("## 问题汇总", "", "| 编号 | 类型 | 走查问题 | 元素定位 | 实测 / 说明 |", "| --- | --- | --- | --- | --- |");
  issues.forEach((issue, index) => {
    const label = issue.displayId || `UI-${String(index + 1).padStart(3, "0")}`;
    const actual = deliveryActualDetails(issue);
    lines.push(`| ${markdownText(label)} | ${markdownText(deliveryTypeLabel(issue.type))} | ${markdownText(issue.title || firstLine(issue.description) || "未命名问题")} | ${markdownText(deliveryElementLocator(issue))} | ${markdownText(actual.summary)} |`);
  });
  lines.push("");
  issues.forEach((issue, index) => {
    const label = issue.displayId || issue.key || issue.label || issue.number || `UI-${String(index + 1).padStart(3, "0")}`;
    const title = issue.title || firstLine(issue.description) || "未命名问题";
    const pageUrl = issue.pageSnapshot?.url || issue.url || session.url || "-";
    const developer = buildDeveloperFields(issue);
    const actual = deliveryActualDetails(issue);
    lines.push(
      `## ${markdownText(String(label))} · ${markdownText(title)}`, "",
      `- 记录模式：${markdownText(developer.captureMode)}`,
      `- 类型：${markdownText(deliveryTypeLabel(issue.type))}`,
      `- 优先级：${markdownText(deliveryPriorityLabel(issue.priority))}`,
      `- 影响程度：${markdownText(deliverySeverityLabel(issue.severity))}`,
      `- 页面：${markdownText(pageUrl)}`, "",
      "### 元素定位", "",
      `- 定位说明：${markdownText(deliveryElementLocator(issue))}`,
      `- DOM 选择器：${markdownInlineCode(developer.elementLocator.selector || "未记录")}`,
      `- 标签：${markdownText(developer.elementLocator.tag || "-")}；测试标识：${markdownText(developer.elementLocator.testId || "-")}`,
      `- 文本：${markdownText(developer.elementLocator.text || "-")}`, "",
      "### 实测 / 开发字段", "",
      `- 实测尺寸：${markdownText(actual.rect.width ?? "-")} × ${markdownText(actual.rect.height ?? "-")}px`,
      `- 页面坐标：X ${markdownText(actual.rect.x ?? "-")} / Y ${markdownText(actual.rect.y ?? "-")}`,
      `- 布局：${markdownText(actual.layout)}`,
      `- 间距：${markdownText(actual.spacing)}`,
      `- 字体：${markdownText(actual.typography)}`,
      `- 文字色：${markdownText(actual.color)}；背景色：${markdownText(actual.background)}；圆角：${markdownText(actual.borderRadius)}`, ""
    );
    if (issue.description) lines.push(markdownText(issue.description), "");
    if (issue.resultReference) lines.push("### 结果参考", "", markdownText(issue.resultReference), "");
    if (issue.designSnapshot) {
      lines.push(
        "### 设计比对", "",
        `- 设计节点：${markdownText(issue.designSnapshot.name || issue.designSnapshot.id || "-")}`,
        ""
      );
      if (Array.isArray(issue.diffs) && issue.diffs.length) {
        lines.push("| 属性 | 期望值 | 实测值 | 差异 |", "| --- | --- | --- | --- |");
        for (const diff of issue.diffs) {
          lines.push(`| ${markdownText(deliveryPropertyLabel(diff.property))} | ${markdownText(diff.expected || "-")} | ${markdownText(diff.actual || "-")} | ${markdownText(diff.delta || "-")} |`);
        }
        lines.push("");
      } else {
        lines.push("未发现明显差异。", "");
      }
    }
    if (issue.measurement) {
      const measurement = issue.measurement;
      lines.push(
        "### 实测间距", "",
        `- 起点：${markdownText(measurement.from?.name || measurement.from?.preferredSelector || "-")}`,
        `- 终点：${markdownText(measurement.to?.name || measurement.to?.preferredSelector || "-")}`
      );
      if (Array.isArray(measurement.segments) && measurement.segments.length) {
        lines.push("", "| 方向 | 实测值 |", "| --- | ---: |");
        for (const segment of measurement.segments) {
          const axis = segment.axis === "horizontal" ? "横向" : segment.axis === "vertical" ? "纵向" : segment.axis || "-";
          lines.push(`| ${markdownText(axis)} | ${markdownText(segment.value ?? "-")}px |`);
        }
      } else {
        lines.push("- 实测：元素重叠或没有可测间距");
      }
      lines.push("");
    }
    for (const asset of groups.get(issue.id) || []) {
      const title = asset.kind === "detail" ? "Detail" : asset.kind === "reference" ? (issue.attachments?.descriptionImages?.includes(asset.id) ? "问题附图" : "结果参考") : "Context";
      lines.push(`![${title}](${asset.exportPath})`, "");
    }
  });
  return lines.join("\n");
}

async function buildHtmlReport(session, issues, assets, exportedAt) {
  const assetsByIssue = new Map();
  for (const asset of assets) {
    if (!assetsByIssue.has(asset.issueId)) assetsByIssue.set(asset.issueId, []);
    assetsByIssue.get(asset.issueId).push({ ...asset, dataUrl: await blobToDataUrl(await assetToBlob(asset)) });
  }
  const cards = issues.map((issue, index) => buildHtmlIssueCard(issue, assetsByIssue.get(issue.id) || [], index)).join("\n");
  const title = htmlText(session.name || session.title || "走查报告");
  const date = new Date(exportedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + title + ' · UIDelta</title><style>' + htmlReportStyles() + '</style></head>',
    '<body data-report-key="' + htmlAttribute(session.id || exportedAt) + '"><main class="shell"><header class="top">',
    '<div class="brand">' + htmlReportIcon("brand") + '<span>UIDelta <span class="brand-divider">/</span> 走查报告</span></div>',
    '<div class="title-row"><div class="project"><h1>' + title + '</h1><p class="meta">',
    dateLabel ? '<time datetime="' + htmlAttribute(exportedAt) + '">' + htmlText(dateLabel) + '</time><span>·</span>' : "",
    '离线报告</p></div><button class="button export-status" id="export-status" type="button" title="下载处理状态 JSON">' + htmlReportIcon("download") + '导出状态</button></div>',
    '<div class="progress-row"><span id="progress-label">已处理 0 / ' + issues.length + '</span><progress id="progress" value="0" max="' + Math.max(1, issues.length) + '" aria-label="问题处理进度"></progress></div></header>',
    '<section class="toolbar" aria-label="问题筛选"><label class="search">' + htmlReportIcon("search") + '<input id="search" type="search" aria-label="搜索问题" placeholder="搜索问题、编号或页面" autocomplete="off"></label>',
    '<select id="type" aria-label="问题类型"><option value="">全部类型</option><option value="ui">UI</option><option value="functional">功能</option><option value="content">文案</option></select>',
    '<select id="severity" aria-label="影响程度"><option value="">全部影响</option><option value="crash">崩溃</option><option value="blocked">阻塞</option><option value="degraded">体验下降</option><option value="cosmetic">视觉瑕疵</option></select></section>',
    '<div class="list-bar"><div class="status-filters" role="group" aria-label="处理状态"><button type="button" data-filter="" aria-pressed="true">全部 <span data-count="all">' + issues.length + '</span></button>',
    '<button type="button" data-filter="pending" aria-pressed="false">待处理 <span data-count="pending">' + issues.length + '</span></button><button type="button" data-filter="done" aria-pressed="false">已处理 <span data-count="done">0</span></button>',
    '</div><span id="summary" class="meta" role="status"></span></div><p id="storage-notice" class="notice" role="status" hidden></p>',
    '<section class="cards" id="cards" aria-label="问题清单">' + cards + '</section>',
    '<div class="empty-state" id="empty" hidden><h2>' + (issues.length ? "没有匹配的问题" : "暂无问题") + '</h2>' + (issues.length ? '<button type="button" class="button" id="reset-filters">重置筛选</button>' : "") + '</div>',
    '<p class="report-note">状态保存在当前浏览器，可导出 JSON 留存。</p><noscript><p class="notice">启用 JavaScript 后可筛选、标记处理状态及放大截图。</p></noscript></main>',
    '<dialog id="viewer" class="viewer" aria-labelledby="viewer-title" aria-describedby="viewer-help"><header class="viewer-head"><h2 id="viewer-title">证据预览</h2><button class="icon-button" type="button" id="viewer-close" aria-label="关闭预览" autofocus>' + htmlReportIcon("close") + '</button></header>',
    '<div class="viewer-stage" id="viewer-stage"><div id="viewer-image"></div><div class="viewer-message"><p id="viewer-message" role="status"></p><button class="button" id="viewer-retry" type="button" hidden>重新加载</button></div></div>',
    '<footer class="viewer-foot"><span id="viewer-help">← → 切换 · Esc 关闭</span><div class="viewer-navigation"><button class="icon-button" id="viewer-prev" type="button" aria-label="上一张">' + htmlReportIcon("left") + '</button><span id="viewer-counter" aria-live="polite"></span><button class="icon-button" id="viewer-next" type="button" aria-label="下一张">' + htmlReportIcon("right") + '</button></div></footer></dialog>',
    '<script>(' + initHtmlReport.toString() + ')();</script></body></html>'
  ].join("\n");
}

function htmlReportIcon(name) {
  const paths = {
    brand: '<path d="M5 4h14v12h-5l-5 4v-4H5z"/><path d="M8 8h8M8 12h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.check) + '</svg>';
}

function htmlReportStyles() {
  return `
:root{color-scheme:light;--ink:#252a25;--muted:#666e63;--line:#dfe3da;--canvas:#f5f6f2;--surface:#fff;--soft:#f3f5ef;--accent:#bc4122;--brand:#f65f39;--accent-soft:#fff0e9;--success:#286341;--success-line:#a9cbb3;--success-soft:#f0f7f1;--danger:#a03737;--radius:16px;--ease:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--canvas);color:var(--ink);font:.875rem/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}button,input,select{font:inherit}button,a,input,select,summary{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:disabled{cursor:default;opacity:.45}button svg,a svg,.search svg{width:18px;height:18px;flex:none}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button{transition:background-color 180ms,border-color 180ms,color 180ms}h1,h2,h3,p{margin:0}button,a{touch-action:manipulation}
.shell{width:min(1120px,calc(100% - 48px));margin:auto}.top{padding:32px 0 24px}.brand{display:flex;gap:10px;align-items:center;font-weight:600;font-size:.75rem;color:var(--muted)}.brand>svg{width:30px;height:30px;padding:4px;border-radius:8px;background:var(--brand);color:#fff}.brand-divider{margin:0 8px;color:var(--line)}.title-row{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:20px}.project{min-width:0}.project h1{font-size:1.875rem;line-height:1.25;letter-spacing:-.035em;overflow-wrap:anywhere}.meta{font-size:.75rem;color:var(--muted)}.project .meta{display:flex;gap:8px;margin-top:8px}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:6px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-weight:600;text-decoration:none}.button:hover{background:var(--soft);border-color:#bfc7b7}.export-status{flex:none}.progress-row{display:flex;align-items:center;gap:12px;margin-top:20px;font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}.progress-row progress{appearance:none;width:180px;height:6px;border:0;border-radius:6px;overflow:hidden;background:var(--line);accent-color:var(--success)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--success);border-radius:6px;transition:width 320ms var(--ease)}progress::-moz-progress-bar{background:var(--success)}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.search{display:flex;align-items:center;gap:8px;flex:1 1 260px;min-width:0;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--canvas)}.search:focus-within{outline:2px solid var(--accent);outline-offset:1px}.search input{width:100%;min-width:0;height:38px;background:transparent;border:0;outline:none;color:var(--ink)}.search input::placeholder{color:var(--muted)}.toolbar select{min-width:0;max-width:100%;min-height:38px;padding:0 30px 0 10px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--surface)}.list-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:18px 0 14px}.status-filters{display:flex;gap:4px;flex-wrap:wrap}.status-filters button{display:flex;align-items:center;gap:6px;border:0;border-radius:8px;padding:8px 10px;background:transparent;color:var(--muted);font-weight:600;min-height:36px}.status-filters button:hover{background:var(--line)}.status-filters button[aria-pressed=true]{background:var(--ink);color:#fff}.status-filters span{font-size:.75rem;font-variant-numeric:tabular-nums;opacity:.85}
.cards{display:grid;gap:16px}.issue{min-width:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);transition:background-color 320ms var(--ease),border-color 320ms var(--ease),box-shadow 320ms var(--ease);scroll-margin-top:20px}.issue-head{padding:20px 24px 0}.issue-topline{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}.issue-id{font:.75rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:var(--accent);margin-right:4px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;background:var(--soft);color:var(--muted);font-size:.75rem}.chip.major{color:var(--danger);background:#fff0ed}.state-label{margin-left:auto;display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--muted);white-space:nowrap}.state-label:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.issue h2{font-size:1.125rem;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.issue-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,300px);gap:28px;padding:18px 24px 24px}.issue-copy{min-width:0}.description{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:18px;font-size:.875rem;line-height:1.7}.facts{display:flex;flex-wrap:wrap;gap:12px 24px;margin:0 0 20px;padding:12px 0;border-block:1px solid var(--line)}.facts div{min-width:100px}.facts dt{font-size:.75rem;color:var(--muted);margin-bottom:2px}.facts dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.technical{margin-top:4px;border:1px solid var(--line);border-radius:10px}.technical>summary{cursor:pointer;padding:10px 12px;color:var(--muted);font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center}.technical>summary:after{content:"+";font-size:1.125rem;font-weight:400}.technical[open]>summary:after{content:"−"}.technical summary::-webkit-details-marker{display:none}.technical[open]>summary{border-bottom:1px solid var(--line)}.technical-body{padding:4px 12px 12px}.technical-group{padding-top:12px}.technical h3,.changes h3{font-size:.75rem;font-weight:600;margin:0 0 8px;color:var(--muted)}.properties{margin:0;display:grid;gap:7px;font-size:.75rem}.properties>div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px}.properties dt{color:var(--muted)}.properties dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.properties code{font-size:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.changes{margin-bottom:16px;padding-left:12px;border-left:2px solid var(--brand)}.changes p{overflow-wrap:anywhere;margin:5px 0}
.evidence{display:flex;flex-direction:column;gap:12px;min-width:0;align-self:start}.evidence-button{position:relative;display:block;width:100%;padding:0;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--soft);text-align:left;color:var(--muted);cursor:zoom-in}.evidence-button:hover{border-color:var(--accent);background:var(--accent-soft)}.evidence-button img{display:block;width:100%;height:140px;object-fit:contain;background:var(--soft)}.evidence-button[data-kind=detail] img{height:116px}.evidence-caption{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;font-size:.75rem;font-weight:600;border-top:1px solid var(--line)}.evidence-caption svg{width:14px;height:14px}.image-error{display:grid;height:100px;place-items:center;font-size:.75rem;color:var(--muted)}.no-evidence{padding:24px 12px;text-align:center;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:.75rem}
.issue-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-top:1px solid var(--line)}.page-source{min-width:0;max-width:70%;display:flex;gap:8px;align-items:center;color:var(--muted);font-size:.75rem}.page-source>span{flex:none}.page-link{display:inline-flex;gap:6px;align-items:center;min-width:0;color:inherit;text-decoration:none}.page-link span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-link svg{width:14px;height:14px}.page-link:hover{color:var(--accent)}.done-button{flex:none;min-height:44px;min-width:140px;padding:10px 18px;background:var(--accent-soft);border:1px solid #f3b9a7;border-radius:9px;color:var(--accent);font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px}.done-button svg{width:18px;height:18px;opacity:.6}.done-button:hover{background:#ffe3d6;border-color:var(--brand)}.issue.is-done{background:var(--success-soft);border-color:var(--success-line);box-shadow:inset 4px 0 0 var(--success)}.issue.is-done .state-label,.issue.is-done .issue-id{color:var(--success)}.issue.is-done h2{color:#4d6555}.issue.is-done .chip{background:#e1ede3;color:#4d6555}.issue.is-done .done-button{color:#fff;background:var(--success);border-color:var(--success)}.issue.is-done .done-button svg{opacity:1}.issue.is-done .done-button:hover{background:#1d5032}
.notice{padding:12px 16px;margin:0 0 16px;border:1px solid #ebc3ab;border-radius:8px;color:#824522;background:#fff5e9;font-size:.75rem}.empty-state{text-align:center;padding:64px 16px;border:1px dashed var(--line);border-radius:16px;background:var(--surface)}.empty-state h2{font-size:1rem;margin-bottom:14px}.report-note{color:var(--muted);font-size:.75rem;text-align:center;padding:24px 0 40px}
.viewer{padding:0;width:min(1100px,calc(100vw - 32px));max-width:1100px;max-height:calc(100dvh - 32px);border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);box-shadow:0 24px 80px #18211938}.viewer::backdrop{background:rgba(31,39,32,.62)}.viewer[open]{animation:viewer-in 240ms var(--ease)}.viewer-head,.viewer-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px}.viewer-head{border-bottom:1px solid var(--line)}.viewer-head h2{font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon-button{display:inline-grid;place-items:center;width:36px;height:36px;padding:8px;flex:none;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--surface)}.icon-button:hover:not(:disabled){background:var(--soft)}.icon-button svg{width:18px;height:18px}.viewer-stage{position:relative;height:min(68dvh,760px);min-height:100px;background:var(--soft)}#viewer-image{height:100%;width:100%;padding:16px}#viewer-image img{display:block;width:100%;height:100%;object-fit:contain}.viewer-image-ready{animation:image-in 260ms var(--ease)}.viewer-message{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;pointer-events:none}.viewer-message button{pointer-events:auto}.viewer-foot{border-top:1px solid var(--line);font-size:.75rem;color:var(--muted)}.viewer-navigation{display:flex;gap:12px;align-items:center;flex:none}#viewer-counter{font-variant-numeric:tabular-nums;min-width:40px;text-align:center}@keyframes viewer-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}@keyframes image-in{from{opacity:0}to{opacity:1}}
@media(max-width:760px){.shell{width:calc(100% - 24px)}.top{padding-top:24px}.title-row{gap:12px;align-items:flex-start}.project h1{font-size:1.5rem}.issue-body{grid-template-columns:1fr;gap:20px}.evidence{width:100%}.evidence-button img{height:180px}.evidence-button[data-kind=detail] img{height:140px}.issue-head{padding:16px 16px 0}.issue-body{padding:16px}.issue-foot{padding:12px 16px}.toolbar select{flex:1}.search{flex-basis:100%}.state-label{margin-left:0}.list-bar .meta{width:100%}.viewer-stage{height:60dvh}}
@media(max-width:420px){.title-row{flex-wrap:wrap}.issue-foot{flex-wrap:wrap}.page-source{max-width:100%;width:100%}.done-button{width:100%}.facts{gap:12px}.properties>div{grid-template-columns:60px minmax(0,1fr);gap:8px}.viewer{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}.viewer-head,.viewer-foot{padding:8px}.viewer-foot{flex-wrap:wrap}.viewer-stage{height:54dvh}.progress-row progress{flex:1;min-width:0}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media print{body{background:#fff}.shell{width:100%}.toolbar,.list-bar,.export-status,.report-note,.done-button,dialog{display:none!important}.issue{break-inside:avoid;box-shadow:none}.issue-body{grid-template-columns:minmax(0,1fr) 240px}.technical-body{display:block}.top{padding-top:0}}
`;
}

function buildHtmlIssueCard(issue, assets, index) {
  const id = issue.id || String(index);
  // Report order is presentation only. Never renumber stored issues or keys
  // used by screenshots, imports and saved resolution status.
  const displayId = issueTypePrefix(issue.type) + "-" + String(index + 1).padStart(3, "0");
  const originalDisplayId = issue.displayId || displayId;
  const findEvidence = (kind) => issue.attachments?.[kind]
    ? assets.find((asset) => asset.id === issue.attachments[kind] && asset.kind === kind)
    : assets.find((asset) => asset.kind === kind);
  const references = assets.filter((asset) => asset.kind === "reference" && (
    !Array.isArray(issue.attachments?.references) || issue.attachments.references.includes(asset.id)
  ));
  const evidence = [
    htmlEvidenceFigure(findEvidence("context"), "全景", displayId),
    htmlEvidenceFigure(findEvidence("detail"), "细节", displayId),
    ...references.map((asset, i) => htmlEvidenceFigure(asset, (issue.attachments?.descriptionImages?.includes(asset.id) ? "问题附图 " : "结果参考 ") + (i + 1), displayId))
  ].filter(Boolean).join("");
  const description = nonEmptyString(issue.description);
  const rawTitle = nonEmptyString(issue.title).replace(/^【[^】]+】\s*/, "");
  const title = rawTitle && rawTitle !== "待补充描述" ? rawTitle : firstLine(description) || "待补充描述";
  // Remove only the duplicated first line, never the remaining description.
  const body = description && description.split(/\r?\n/, 1)[0] === title
    ? description.slice(description.indexOf("\n") < 0 ? description.length : description.indexOf("\n") + 1).trim()
    : description;
  const actual = deliveryActualDetails(issue);
  const rect = actual.rect;
  const facts = [
    ["尺寸", rect.width !== null && rect.height !== null ? rect.width + " × " + rect.height + " px" : ""],
    ["坐标", rect.x !== null && rect.y !== null ? "X " + rect.x + " · Y " + rect.y : ""],
    ["测距", actual.measurement]
  ].filter(([, value]) => value);
  const snapshot = issue.webSnapshot || {};
  const technical = [
    htmlReportPropertyGroup("定位", [
      ["原始编号", originalDisplayId !== displayId ? originalDisplayId + "（对应原截图与证据包）" : ""],
      ["选择器", deliverySelector(issue)], ["标签", issue.elementAnchor?.tag],
      ["文本", issue.elementAnchor?.text], ["父级", issue.elementAnchor?.parentFingerprint],
      ["测试标识", issue.elementAnchor?.testId], ["元素 ID", issue.elementAnchor?.id],
      ["记录方式", issue.region || issue.captureMode === "region" ? "框选" : ""]
    ]),
    htmlReportPropertyGroup("布局", [
      ["布局", snapshot.layout?.display], ["方向", snapshot.layout?.flexDirection],
      ["主轴", snapshot.layout?.justifyContent], ["交叉轴", snapshot.layout?.alignItems],
      ["内边距", snapshot.spacing?.padding ? formatBoxSnapshot(snapshot.spacing.padding) : ""],
      ["外边距", snapshot.spacing?.margin ? formatBoxSnapshot(snapshot.spacing.margin) : ""],
      ["间距", snapshot.spacing?.gap], ["圆角", snapshot.appearance?.borderRadius]
    ]),
    htmlReportPropertyGroup("文字与外观", [
      ["字体", snapshot.typography?.fontFamily], ["字号", snapshot.typography?.fontSize],
      ["行高", snapshot.typography?.lineHeight], ["字重", snapshot.typography?.fontWeight],
      ["文字色", snapshot.typography?.color], ["背景色", snapshot.appearance?.backgroundColor]
    ]),
    htmlReportPropertyGroup("测距对象", [
      ["起点", issue.measurement?.from?.preferredSelector || issue.measurement?.from?.name],
      ["终点", issue.measurement?.to?.preferredSelector || issue.measurement?.to?.name]
    ])
  ].filter(Boolean).join("");
  const change = htmlReportChanges("修改建议", issue.changeProposal?.changes, "before", "after");
  const diffs = htmlReportChanges("设计对比 · 期望 → 实测", issue.diffs, "expected", "actual");
  const severity = ({ minor: "cosmetic", major: "degraded" })[issue.severity] || issue.severity || "cosmetic";
  const source = [displayId, originalDisplayId, title, description, issue.resultReference, issue.pageSnapshot?.title, issue.pageSnapshot?.route, deliveryElementLocator(issue), actual.summary].filter(Boolean).join(" ").toLowerCase();
  const page = nonEmptyString(issue.pageSnapshot?.url);
  let safePage = "", hostname = "";
  try {
    const parsed = new URL(page);
    if (["http:", "https:"].includes(parsed.protocol)) { safePage = parsed.href; hostname = parsed.hostname; }
  } catch { /* Invalid or missing page URLs remain plain text, never active links. */ }
  const pageLabel = nonEmptyString(issue.pageSnapshot?.title) || nonEmptyString(issue.pageSnapshot?.route) || hostname;
  const pageContent = pageLabel ? '<span>页面</span>' + (safePage
    ? '<a class="page-link" href="' + htmlAttribute(safePage) + '" target="_blank" rel="noopener noreferrer" title="' + htmlAttribute(page) + '"><span>' + htmlText(pageLabel) + '</span>' + htmlReportIcon("external") + '</a>'
    : '<span class="page-link"><span>' + htmlText(pageLabel) + '</span></span>') : "";
  return [
    '<article class="issue" data-id="' + htmlAttribute(id) + '" data-display-id="' + htmlAttribute(displayId) + '" data-type="' + htmlAttribute(issue.type || "ui") + '" data-severity="' + htmlAttribute(severity) + '" data-search="' + htmlAttribute(source) + '">',
    '<header class="issue-head"><div class="issue-topline"><span class="issue-id">' + htmlText(displayId) + '</span><div class="chips"><span class="chip">' + htmlText(deliveryTypeLabel(issue.type)) + '</span><span class="chip">' + htmlText(deliveryPriorityLabel(issue.priority)) + '</span><span class="chip' + (["crash", "blocked", "degraded"].includes(severity) ? ' major' : '') + '">' + htmlText(deliverySeverityLabel(issue.severity)) + '</span></div><span class="state-label">待处理</span></div><h2>' + htmlText(title) + '</h2></header>',
    '<div class="issue-body"><div class="issue-copy">',
    body ? '<p class="description">' + htmlText(body) + '</p>' : "",
    issue.resultReference ? '<section class="changes"><h3>结果参考</h3><p class="description">' + htmlText(issue.resultReference) + '</p></section>' : "",
    facts.length ? '<dl class="facts">' + facts.map(([label, value]) => '<div><dt>' + htmlText(label) + '</dt><dd>' + htmlText(value) + '</dd></div>').join("") + '</dl>' : "",
    change, diffs,
    technical ? '<details class="technical"><summary>技术详情</summary><div class="technical-body">' + technical + '</div></details>' : "",
    '</div><div class="evidence">' + (evidence || '<div class="no-evidence">暂无截图</div>') + '</div></div>',
    '<footer class="issue-foot"><div class="page-source">' + pageContent + '</div><button type="button" class="done-button" data-status="' + htmlAttribute(id) + '" data-initial-done="' + ["已处理", "已解决"].includes(issue.resolutionStatus) + '" aria-pressed="false" aria-label="标记 ' + htmlAttribute(displayId) + ' 已处理">' + htmlReportIcon("check") + '<span>标记已处理</span></button></footer></article>'
  ].join("\n");
}

function htmlReportPropertyGroup(title, rows) {
  const values = rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim() && value !== "未记录");
  if (!values.length) return "";
  return '<section class="technical-group"><h3>' + htmlText(title) + '</h3><dl class="properties">' + values.map(([label, value]) => '<div><dt>' + htmlText(label) + '</dt><dd>' + htmlText(value) + '</dd></div>').join("") + '</dl></section>';
}

function htmlReportChanges(title, items, before, after) {
  if (!Array.isArray(items) || !items.length) return "";
  return '<section class="changes"><h3>' + htmlText(title) + '</h3>' + items.map((item) => '<p>' + htmlText(deliveryPropertyLabel(item.property)) + '：' + htmlText(item[before] ?? "—") + ' → ' + htmlText(item[after] ?? "—") + '</p>').join("") + '</section>';
}

function htmlEvidenceFigure(asset, label, displayId) {
  if (!asset?.dataUrl || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(asset.dataUrl)) return "";
  return '<button class="evidence-button" type="button" data-evidence data-kind="' + htmlAttribute(asset.kind) + '" data-label="' + htmlAttribute(label) + '" aria-label="查看 ' + htmlAttribute(displayId) + ' ' + htmlAttribute(label) + '截图" aria-haspopup="dialog"><img src="' + htmlAttribute(asset.dataUrl) + '" alt="' + htmlAttribute(displayId) + ' ' + htmlAttribute(label) + '截图" loading="lazy" decoding="async"><span class="image-error" hidden>图片加载失败 · 点击重试</span><span class="evidence-caption">' + htmlText(label) + htmlReportIcon("expand") + '</span></button>';
}

// Serialized into the offline report. No worker globals, external dependencies,
// or user strings may be interpolated into this function.
function initHtmlReport() {
  const $ = (selector) => document.querySelector(selector);
  const cards = [...document.querySelectorAll(".issue")];
  const statusButtons = [...document.querySelectorAll("[data-status]")];
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  const search = $("#search"), type = $("#type"), severity = $("#severity");
  const notice = $("#storage-notice");
  const key = "uidelta-report-status:v2:" + document.body.dataset.reportKey;
  const legacyKey = "uidelta-report-status:" + location.pathname;
  const saved = Object.create(null);
  let statusFilter = "";
  function warn(message) { notice.textContent = message; notice.hidden = false; }
  try {
    const stored = JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacyKey) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const button of statusButtons) {
        if (Object.prototype.hasOwnProperty.call(stored, button.dataset.status) && typeof stored[button.dataset.status] === "boolean") saved[button.dataset.status] = stored[button.dataset.status];
      }
    }
  } catch { warn("无法读取上次状态。本次仍可标记，请导出状态留存。"); }
  for (const button of statusButtons) {
    if (!(button.dataset.status in saved)) saved[button.dataset.status] = button.dataset.initialDone === "true";
  }
  function paintStatus(button) {
    const done = saved[button.dataset.status] === true;
    const card = button.closest(".issue");
    card.classList.toggle("is-done", done);
    card.dataset.done = String(done);
    card.querySelector(".state-label").textContent = done ? "已处理" : "待处理";
    button.setAttribute("aria-pressed", String(done));
    button.setAttribute("aria-label", (done ? "撤回 " : "标记 ") + card.dataset.displayId + (done ? " 的已处理状态" : " 已处理"));
    button.title = done ? "点击恢复为待处理" : "标记已处理";
    button.querySelector("span").textContent = done ? "已处理" : "标记已处理";
  }
  function update() {
    const query = search.value.trim().toLowerCase();
    let shown = 0, done = 0;
    for (const card of cards) {
      const complete = saved[card.dataset.id] === true;
      if (complete) done++;
      const visible = (!query || card.dataset.search.includes(query))
        && (!type.value || card.dataset.type === type.value)
        && (!severity.value || card.dataset.severity === severity.value)
        && (!statusFilter || (statusFilter === "done" ? complete : !complete));
      if (!visible && card.contains(document.activeElement)) filterButtons.find((button) => button.dataset.filter === statusFilter)?.focus();
      card.hidden = !visible;
      if (visible) shown++;
    }
    $("#summary").textContent = shown + " / " + cards.length + " 个问题";
    $("#progress-label").textContent = "已处理 " + done + " / " + cards.length;
    $("#progress").value = done;
    for (const [name, count] of [["all", cards.length], ["pending", cards.length - done], ["done", done]]) $('[data-count="' + name + '"]').textContent = count;
    $("#empty").hidden = shown > 0;
    for (const button of filterButtons) button.setAttribute("aria-pressed", String(button.dataset.filter === statusFilter));
  }
  for (const button of statusButtons) {
    paintStatus(button);
    button.addEventListener("click", () => {
      saved[button.dataset.status] = !saved[button.dataset.status];
      paintStatus(button);
      try {
        // Exports may contain different subsets of the same session. Update
        // this issue only, preserving statuses written by another report.
        let previous = {};
        try { previous = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* Replace corrupt state. */ }
        const merged = Object.create(null);
        if (previous && typeof previous === "object" && !Array.isArray(previous)) {
          for (const [id, value] of Object.entries(previous)) if (typeof value === "boolean") merged[id] = value;
        }
        for (const [id, value] of Object.entries(saved)) if (!(id in merged)) merged[id] = value;
        merged[button.dataset.status] = saved[button.dataset.status];
        localStorage.setItem(key, JSON.stringify(merged));
        notice.hidden = true;
      } catch { warn("状态仅保留在本次打开中。请导出状态，避免关闭后丢失。"); }
      update();
    });
  }
  for (const field of [search, type, severity]) field.addEventListener("input", update);
  for (const button of filterButtons) button.addEventListener("click", () => { statusFilter = button.dataset.filter; update(); });
  $("#reset-filters")?.addEventListener("click", () => { search.value = type.value = severity.value = statusFilter = ""; update(); search.focus(); });
  $("#export-status").addEventListener("click", () => {
    let url, anchor;
    try {
      const data = { schemaVersion: 1, source: "UIDelta HTML report", exportedAt: new Date().toISOString(), status: saved };
      url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "uidelta-report-status.json";
      document.body.append(anchor);
      anchor.click();
    } catch { warn("状态导出失败，请重试。"); }
    finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });

  const viewer = $("#viewer"), imageHost = $("#viewer-image"), message = $("#viewer-message");
  const retry = $("#viewer-retry"), prev = $("#viewer-prev"), next = $("#viewer-next");
  let group = [], current = 0, origin = null, previousOverflow = "";
  function showImage(index) {
    current = (index + group.length) % group.length;
    const item = group[current];
    const card = item.closest(".issue");
    const label = card.dataset.displayId + " · " + item.dataset.label;
    $("#viewer-title").textContent = label;
    $("#viewer-counter").textContent = current + 1 + " / " + group.length;
    prev.disabled = next.disabled = group.length < 2;
    retry.hidden = true;
    message.textContent = "加载图片…";
    const image = document.createElement("img");
    image.alt = label + "截图";
    image.hidden = true;
    imageHost.replaceChildren(image);
    image.addEventListener("load", () => {
      if (imageHost.firstElementChild !== image) return;
      image.hidden = false;
      image.classList.add("viewer-image-ready");
      message.textContent = "";
    });
    image.addEventListener("error", () => {
      if (imageHost.firstElementChild !== image) return;
      image.hidden = true;
      message.textContent = "图片无法加载";
      retry.hidden = false;
    });
    image.src = item.querySelector("img").src;
  }
  for (const button of document.querySelectorAll("[data-evidence]")) {
    const image = button.querySelector("img");
    const failed = () => { image.hidden = true; button.querySelector(".image-error").hidden = false; };
    image.addEventListener("error", failed);
    if (image.complete && !image.naturalWidth) failed();
    button.addEventListener("click", () => {
      group = [...button.closest(".issue").querySelectorAll("[data-evidence]")];
      origin = button;
      previousOverflow = document.body.style.overflow;
      viewer.showModal();
      document.body.style.overflow = "hidden";
      showImage(group.indexOf(button));
      $("#viewer-close").focus();
    });
  }
  $("#viewer-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => {
    document.body.style.overflow = previousOverflow;
    imageHost.replaceChildren();
    origin?.focus({ preventScroll: true });
  });
  viewer.addEventListener("click", (event) => {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
  });
  viewer.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); viewer.close(); return; }
    if (event.key === "Tab") {
      const controls = [...viewer.querySelectorAll("button")].filter((button) => !button.hidden && !button.disabled);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); showImage(current + (event.key === "ArrowLeft" ? -1 : 1)); }
  });
  prev.addEventListener("click", () => showImage(current - 1));
  next.addEventListener("click", () => showImage(current + 1));
  retry.addEventListener("click", () => showImage(current));
  update();
}
function deliveryTypeLabel(value) {
  return ({ ui: "界面", functional: "功能", content: "文案" })[String(value || "").toLowerCase()] || String(value || "界面");
}

function deliveryPriorityLabel(value) {
  return ({ immediate: "立刻处理", soon: "尽快处理", queued: "待排期", later: "暂不处理" })[String(value || "").toLowerCase()] || String(value || "待排期");
}

function deliverySeverityLabel(value) {
  return ({ crash: "崩溃", blocked: "阻塞", degraded: "体验较差", cosmetic: "轻微瑕疵", minor: "轻微瑕疵", major: "体验较差" })[String(value || "").toLowerCase()] || String(value || "轻微瑕疵");
}

function deliveryPropertyLabel(value) {
  return ({
    width: "宽度", height: "高度", display: "布局方式", flexDirection: "布局方向",
    justifyContent: "主轴对齐", alignItems: "交叉轴对齐", fontFamily: "字体",
    fontWeight: "字重", fontSize: "字号", lineHeight: "行高", letterSpacing: "字间距",
    color: "文字颜色", backgroundColor: "背景色", padding: "内边距", margin: "外边距",
    gap: "间距", borderRadius: "圆角", boxShadow: "阴影", opacity: "透明度"
  })[String(value || "")] || String(value || "属性");
}

function deliveryCaptureModeLabel(issue) {
  const mode = String(issue?.captureMode || "").toLowerCase();
  if (mode === "ui" || issue?.changeProposal) return "UI 模式";
  if (mode === "region" || issue?.region) return "自由框选模式";
  return "走查模式";
}

function deliveryPixel(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function deliveryRect(issue) {
  const rect = issue?.region || issue?.elementAnchor?.rect || {};
  const width = deliveryPixel(rect.width ?? issue?.webSnapshot?.dimensions?.width);
  const height = deliveryPixel(rect.height ?? issue?.webSnapshot?.dimensions?.height);
  const x = deliveryPixel(rect.left ?? rect.x ?? rect.viewportX);
  const y = deliveryPixel(rect.top ?? rect.y ?? rect.viewportY);
  return { width, height, x, y };
}

function deliverySelector(issue) {
  const anchor = issue?.elementAnchor || {};
  return nonEmptyString(anchor.preferredSelector)
    || nonEmptyString(anchor.fallbackSelector)
    || (Array.isArray(anchor.shadowSelectors) ? anchor.shadowSelectors.filter(nonEmptyString).join(" >>> ") : "")
    || nonEmptyString(anchor.identityKey);
}

function deliveryElementLocator(issue) {
  const anchor = issue?.elementAnchor || {};
  const parts = [];
  const selector = deliverySelector(issue);
  if (selector) parts.push(`选择器：${selector}`);
  if (anchor.tag) parts.push(`标签：<${anchor.tag}>`);
  if (anchor.testId) parts.push(`测试标识：${anchor.testId}`);
  else if (anchor.id) parts.push(`元素 ID：#${anchor.id}`);
  if (anchor.text) parts.push(`文本：${String(anchor.text).replace(/\s+/g, " ").slice(0, 80)}`);
  if (anchor.parentFingerprint) parts.push(`父级：${anchor.parentFingerprint}`);
  return parts.join("；") || (issue?.region ? "自由框选区域" : "未记录元素定位");
}

function deliveryMeasurementSummary(issue) {
  const segments = Array.isArray(issue?.measurement?.segments) ? issue.measurement.segments : [];
  const values = segments
    .map((segment) => {
      const value = deliveryPixel(segment?.value ?? segment?.length);
      if (value === null) return "";
      const axis = segment?.axis === "horizontal" ? "横向" : segment?.axis === "vertical" ? "纵向" : "间距";
      return `${axis} ${value}px`;
    })
    .filter(Boolean);
  return values.length ? values.join("；") : "";
}

function deliveryActualDetails(issue) {
  const snapshot = issue?.webSnapshot || {};
  const rect = deliveryRect(issue);
  const spacing = snapshot.spacing || {};
  const typography = snapshot.typography || {};
  const appearance = snapshot.appearance || {};
  const measurement = deliveryMeasurementSummary(issue);
  const size = rect.width !== null && rect.height !== null ? `${rect.width} × ${rect.height}px` : "未记录";
  const position = rect.x !== null && rect.y !== null ? `X ${rect.x} / Y ${rect.y}` : "未记录";
  const spacingText = snapshot.spacing
    ? `内边距 ${formatBoxSnapshot(spacing.padding)}；外边距 ${formatBoxSnapshot(spacing.margin)}；间距 ${spacing.gap || "-"}`
    : "未记录";
  const typographyText = snapshot.typography
    ? `${typography.fontFamily || "-"} · ${typography.fontSize || "-"} / ${typography.lineHeight || "-"} · ${typography.fontWeight || "-"}`
    : "未记录";
  const summary = [
    `实测 ${size}`,
    `坐标 ${position}`,
    measurement ? `测距 ${measurement}` : "",
    snapshot.layout?.display ? `布局 ${snapshot.layout.display}` : "",
    snapshot.typography?.fontSize ? `字体 ${typography.fontSize}/${typography.lineHeight || "-"}` : ""
  ].filter(Boolean).join("；");
  return {
    rect,
    measurement,
    layout: snapshot.layout?.display || "未记录",
    spacing: spacingText,
    typography: typographyText,
    color: typography.color || "未记录",
    background: appearance.backgroundColor || "未记录",
    borderRadius: appearance.borderRadius || "未记录",
    summary
  };
}

function buildDeveloperFields(issue) {
  const anchor = issue?.elementAnchor || {};
  const actual = deliveryActualDetails(issue);
  return {
    captureMode: deliveryCaptureModeLabel(issue),
    issueSource: issue?.source || "manual",
    elementLocator: {
      selector: deliverySelector(issue) || null,
      fallbackSelector: nonEmptyString(anchor.fallbackSelector) || null,
      tag: nonEmptyString(anchor.tag) || null,
      id: nonEmptyString(anchor.id) || null,
      testId: nonEmptyString(anchor.testId) || null,
      accessibleName: nonEmptyString(anchor.accessibleName) || null,
      text: nonEmptyString(anchor.text) || null,
      parentFingerprint: nonEmptyString(anchor.parentFingerprint) || null
    },
    actual: {
      widthPx: actual.rect.width,
      heightPx: actual.rect.height,
      xPx: actual.rect.x,
      yPx: actual.rect.y,
      layout: actual.layout,
      spacing: actual.spacing,
      typography: actual.typography,
      textColor: actual.color,
      backgroundColor: actual.background,
      borderRadius: actual.borderRadius,
      summary: actual.summary
    },
    measurement: issue?.measurement ? {
      summary: actual.measurement || "元素重叠或没有可测间距",
      fromSelector: issue.measurement.from?.preferredSelector || null,
      toSelector: issue.measurement.to?.preferredSelector || null,
      segments: Array.isArray(issue.measurement.segments) ? issue.measurement.segments : []
    } : null,
    freeSelection: issue?.region ? { ...actual.rect } : null
  };
}

async function buildXlsxReport(session, issues, assets, exportedAt) {
  // Style 0 is deliberately Normal. Use explicit nonzero styles for every
  // populated cell; some spreadsheet viewers special-case the default style.
  const headers = [
    "编号", "类型", "问题描述", "优先级", "影响程度", "负责人", "处理状态", "修复版本",
    "元素定位", "实测 / 说明", "实测宽(px)", "实测高(px)", "坐标 X(px)", "坐标 Y(px)", "测距(px)",
    "布局", "间距", "字体", "文字颜色", "背景色", "圆角", "DOM 选择器", "页面路径", "页面地址",
    "记录模式", "全景预览", "细节预览", "全景截图文件", "细节截图文件", "结果参考", "问题附图数", "结果参考图数"
  ];
  const widths = [12, 10, 42, 15, 15, 14, 15, 16, 42, 44, 14, 14, 14, 14, 24, 16, 34, 40, 26, 26, 16, 48, 34, 44, 18, 16, 16, 32, 32, 42, 14, 16];
  const evidenceHeaders = ["编号", "问题描述", "细节截图", "全景截图", "分类 / 进展", "元素定位", "实测 / 说明", "补充说明", "补充图片"];
  const evidenceWidths = [12, 38, 34, 34, 17, 28, 28, 36, 48];
  const rows = [], evidenceRows = [], links = [];
  const imageEntries = [], drawingAnchors = [], drawingRelations = [];
  const lastRow = Math.max(5, issues.length + 4);
  const assetsByIssue = new Map();
  for (const asset of assets) {
    if (!assetsByIssue.has(asset.issueId)) assetsByIssue.set(asset.issueId, []);
    assetsByIssue.get(asset.issueId).push(asset);
  }
  let imageIndex = 0;
  for (const [index, issue] of issues.entries()) {
    const row = index + 5;
    const striped = index % 2;
    const bodyStyle = 1 + striped;
    const issueAssets = assetsByIssue.get(issue.id) || [];
    const findEvidence = (kind) => issue.attachments?.[kind]
      ? issueAssets.find((asset) => asset.id === issue.attachments[kind] && asset.kind === kind)
      : issueAssets.find((asset) => asset.kind === kind);
    const context = findEvidence("context"), detail = findEvidence("detail");
    const references = issueAssets.filter((asset) => asset.kind === "reference" && issue.attachments?.references?.includes(asset.id));
    const descriptionImages = references.filter((asset) => issue.attachments?.descriptionImages?.includes(asset.id));
    const id = issue.displayId || `UI-${String(index + 1).padStart(3, "0")}`;
    const actual = deliveryActualDetails(issue);
    const developer = buildDeveloperFields(issue);
    const description = xlsxIssueDescription(issue);
    const locator = deliveryElementLocator(issue).replace(/；/g, "\n");
    const summary = actual.summary.replace(/；/g, "\n");
    const status = ["待处理", "处理中", "待验收", "已解决", "暂不处理"].includes(issue.resolutionStatus) ? issue.resolutionStatus : "待处理";
    const values = [
      id, deliveryTypeLabel(issue.type), description, deliveryPriorityLabel(issue.priority), deliverySeverityLabel(issue.severity),
      typeof issue.assignee === "string" ? issue.assignee : "", status, typeof issue.fixVersion === "string" ? issue.fixVersion : "",
      locator, summary, actual.rect.width, actual.rect.height, actual.rect.x, actual.rect.y, actual.measurement || "未记录",
      actual.layout, actual.spacing.replace(/；/g, "\n"), actual.typography, actual.color, actual.background, actual.borderRadius,
      developer.elementLocator.selector || "未记录", issue.pageSnapshot?.route || "未记录", issue.pageSnapshot?.url || "未记录",
      developer.captureMode, context ? "查看全景 ↗" : "无截图", detail ? "查看细节 ↗" : "无截图", context?.exportPath || "", detail?.exportPath || "",
      issue.resultReference || "", descriptionImages.length, references.length - descriptionImages.length
    ];
    const cells = values.map((value, column) => {
      const style = column === 2 ? 13 + striped : column === 0 ? 6 + striped : column >= 10 && column <= 13 ? 8 + striped
        : [23, 25, 26].includes(column) ? 10 + striped : column >= 5 && column <= 7 ? 12 : bodyStyle;
      return xlsxInlineCell(xlsxCellRef(column + 1, row), value, style);
    }).join("");
    // The list no longer needs screenshot-sized rows; screenshots live in the
    // first sheet. Long technical text wraps without spilling into neighbours.
    const rowHeight = Math.min(409, Math.max(xlsxRowHeight(values, widths, 48), xlsxRowHeight([description], [widths[2] * 11 / 14], 48) * 14 / 11));
    rows.push(`<row r="${row}" ht="${rowHeight}" customHeight="1">${cells}</row>`);
    links.push({ ref:`A${row}`, location:`'证据预览'!A${row}` });
    if (context) links.push({ ref:`Z${row}`, location:`'证据预览'!D${row}` });
    if (detail) links.push({ ref:`AA${row}`, location:`'证据预览'!C${row}` });
    if (/^https?:\/\//i.test(issue.pageSnapshot?.url || "")) links.push({ ref:`X${row}`, target:issue.pageSnapshot.url });

    const classification = [values[1], values[3], values[4], status].join("\n");
    const evidenceValues = [id, description, detail ? "" : "未记录细节截图", context ? "" : "未记录全景截图", classification, locator, summary, issue.resultReference || "", ""];
    const imageColumns = references.length > 3 ? 2 : 1;
    const imageRows = Math.ceil(references.length / imageColumns);
    const evidenceHeight = Math.min(409, Math.max(xlsxRowHeight(evidenceValues, evidenceWidths, 126),
      xlsxRowHeight([description], [evidenceWidths[1] * 11 / 14], 126) * 14 / 11,
      imageRows * 105 + 12));
    // Lookup by stable issue id, not row number: sorting the follow-up sheet
    // must not silently associate another problem with these screenshots.
    const match = `MATCH($A${row},'问题清单'!$A$5:$A$${lastRow},0)`;
    const lookup = (col) => `INDEX('问题清单'!$${col}$5:$${col}$${lastRow},${match})`;
    const evidenceCells = evidenceValues.map((value, column) => {
      const ref = xlsxCellRef(column + 1, row);
      if (column === 1) return xlsxFormulaCell(ref, `IFERROR(${lookup("C")},"未找到对应问题")`, value, 13 + striped);
      if (column === 7) return xlsxFormulaCell(ref, `IFERROR(${lookup("AD")}&"","未找到对应问题")`, value, bodyStyle);
      if (column === 4) return xlsxFormulaCell(ref, `IFERROR(${["B", "D", "E", "G"].map(lookup).join('&CHAR(10)&')},"未找到对应问题")`, value, bodyStyle);
      return xlsxInlineCell(ref, value, column === 0 ? 6 + striped : bodyStyle);
    }).join("");
    evidenceRows.push(`<row r="${row}" ht="${evidenceHeight}" customHeight="1">${evidenceCells}</row>`);
    for (const [asset, label, column] of [[detail, "细节", 2], [context, "全景", 3]]) {
      if (!asset) continue;
      imageIndex += 1;
      const relId = `rId${imageIndex}`;
      const mediaTarget = `../media/image${imageIndex}.png`;
      imageEntries.push({ name:`xl/media/image${imageIndex}.png`, data:await assetToBlob(asset) });
      drawingRelations.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaTarget}"/>`);
      drawingAnchors.push(xlsxImageAnchor(relId, imageIndex, column, row - 1, `${id} ${label}`, {
        sourceWidth:asset.width, sourceHeight:asset.height,
        width:Math.floor(evidenceWidths[column] * 7 + 5 - 16), height:Math.min(152, evidenceHeight * 4 / 3 - 16)
      }));
    }
    for (const [referenceIndex, asset] of references.entries()) {
      const role = issue.attachments?.descriptionImages?.includes(asset.id) ? "问题附图" : "结果参考";
      imageIndex += 1;
      const relId = `rId${imageIndex}`;
      imageEntries.push({name:`xl/media/image${imageIndex}.png`,data:await assetToBlob(asset)});
      drawingRelations.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${imageIndex}.png"/>`);
      const gap = 8;
      const tileWidth = (evidenceWidths[8] * 7 + 5 - 16 - gap * (imageColumns - 1)) / imageColumns;
      const tileHeight = (evidenceHeight * 4 / 3 - 16 - gap * (imageRows - 1)) / imageRows;
      drawingAnchors.push(xlsxImageAnchor(relId,imageIndex,8,row-1,`${id} ${role} ${referenceIndex+1}`,{
        sourceWidth:asset.width,sourceHeight:asset.height,width:tileWidth,height:tileHeight,
        offsetX:(referenceIndex % imageColumns) * (tileWidth + gap),
        offsetY:Math.floor(referenceIndex / imageColumns) * (tileHeight + gap)
      }));
    }
    if (descriptionImages.length) links.push({ref:`AE${row}`,location:`'证据预览'!I${row}`});
    if (references.length > descriptionImages.length) links.push({ref:`AF${row}`,location:`'证据预览'!I${row}`});
  }
  if (!issues.length) {
    rows.push(`<row r="5" ht="40" customHeight="1">${headers.map((_, col) => xlsxInlineCell(xlsxCellRef(col + 1, 5), col === 2 ? "本次没有可导出的问题" : "", 1)).join("")}</row>`);
    evidenceRows.push(`<row r="5" ht="40" customHeight="1">${evidenceHeaders.map((_, col) => xlsxInlineCell(xlsxCellRef(col + 1, 5), col === 1 ? "本次没有可导出的问题" : "", 1)).join("")}</row>`);
  }
  const meta = `${session.name || session.title || "未命名项目"} · ${String(exportedAt || "").slice(0, 10)} · `;
  const countFormula = `${xlsxFormulaString(meta)}&COUNTA('问题清单'!$A$5:$A$${lastRow})&" 个问题"`;
  const countText = meta + issues.length + " 个问题";
  const listRelations = [], linkXml = [];
  for (const link of links) {
    if (link.location) linkXml.push(`<hyperlink ref="${link.ref}" location="${xmlAttribute(link.location)}"/>`);
    else {
      const relId = `rId${listRelations.length + 1}`;
      listRelations.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlAttribute(link.target)}" TargetMode="External"/>`);
      linkXml.push(`<hyperlink ref="${link.ref}" r:id="${relId}"/>`);
    }
  }
  const validations = issues.length ? `<dataValidations count="3">${[
    ["D", ["立刻处理", "尽快处理", "待排期", "暂不处理"]],
    ["E", ["崩溃", "阻塞", "体验较差", "轻微瑕疵"]],
    ["G", ["待处理", "处理中", "待验收", "已解决", "暂不处理"]]
  ].map(([col, choices]) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop" errorTitle="请选择列表中的值" error="请使用下拉列表，保持交付口径一致。" sqref="${col}5:${col}${lastRow}"><formula1>${xmlText(xlsxFormulaString(choices.join(",")))}</formula1></dataValidation>`).join("")}</dataValidations>` : "";
  const conditional = issues.length ? [
    ["D", "立刻处理", 0], ["D", "尽快处理", 1], ["E", "崩溃", 0], ["E", "阻塞", 0], ["G", "已解决", 2], ["G", "处理中", 1]
  ].map(([col, value, dxf], index) => `<conditionalFormatting sqref="${col}5:${col}${lastRow}"><cfRule type="cellIs" dxfId="${dxf}" priority="${index + 1}" operator="equal"><formula>${xmlText(xlsxFormulaString(value))}</formula></cfRule></conditionalFormatting>`).join("") : "";
  const common = { lastRow, countFormula, countText };
  const sheetXml = xlsxWorksheetXml({ ...common, title:"问题清单 · 排期与跟进", headers, widths, rows,
    hint:"橙底列可填写 · 在此筛选、排序和更新进展 · 点击编号查看证据", selected:false,
    afterData:(issues.length ? `<autoFilter ref="A4:AF${lastRow}"/>` : ""),
    afterMerge:conditional + validations + (linkXml.length ? `<hyperlinks>${linkXml.join("")}</hyperlinks>` : "") });
  const evidenceSheetXml = xlsxWorksheetXml({ ...common, title:"证据预览 · 先看问题，再看截图", headers:evidenceHeaders, widths:evidenceWidths, rows:evidenceRows,
    hint:"截图与编号一一对应 · 在「问题清单」筛选和维护进展", selected:true,
    drawing:drawingAnchors.length ? '<drawing r:id="rId1"/>' : "" });
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const rels = (body) => `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const contentTypes = `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${drawingAnchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>`;
  const entries = [
    { name:"[Content_Types].xml", data:contentTypes },
    { name:"_rels/.rels", data:rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>') },
    { name:"xl/workbook.xml", data:`${xmlHeader}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews><sheets><sheet name="证据预览" sheetId="1" r:id="rId1"/><sheet name="问题清单" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'证据预览'!$1:$4</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'问题清单'!$1:$4</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name:"xl/_rels/workbook.xml.rels", data:rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>') },
    { name:"xl/styles.xml", data:xlsxReportStyles() },
    { name:"xl/worksheets/sheet1.xml", data:evidenceSheetXml },
    { name:"xl/worksheets/sheet2.xml", data:sheetXml },
    { name:"xl/worksheets/_rels/sheet2.xml.rels", data:rels(listRelations.join("")) }
  ];
  if (drawingAnchors.length) entries.push(
    { name:"xl/worksheets/_rels/sheet1.xml.rels", data:rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>') },
    { name:"xl/drawings/drawing1.xml", data:`${xmlHeader}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${drawingAnchors.join("")}</xdr:wsDr>` },
    { name:"xl/drawings/_rels/drawing1.xml.rels", data:rels(drawingRelations.join("")) }
  );
  return [...entries, ...imageEntries];
}

function xlsxIssueDescription(issue) {
  const title = String(issue.title || "").trim();
  const description = String(issue.description || "").trim();
  if (!description) return title || "待补充描述";
  if (!title || title === description || title === firstLine(description) || title === "待补充描述" || title.replace(/^【[^】]+】\s*/, "") === firstLine(description)) return description;
  return title + "\n" + description;
}

function xlsxRowHeight(values, widths, minimum) {
  const lines = values.map((value, index) => String(value ?? "").split(/\r?\n/).reduce((count, line) => {
    const units = Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
    return count + Math.max(1, Math.ceil(units / Math.max(6, widths[index] - 3)));
  }, 0));
  return Math.min(409, Math.max(minimum, Math.max(...lines) * 15 + 12));
}

function xlsxWorksheetXml({ title, headers, widths, rows, lastRow, countFormula, countText, hint, selected, afterData = "", afterMerge = "", drawing = "" }) {
  const lastColumn = xlsxCellRef(headers.length, 1).replace(/1$/, "");
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const heading = headers.map((value, index) => xlsxInlineCell(xlsxCellRef(index + 1, 4), value, 3)).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor rgb="${selected ? 'FFF2603D' : 'FF64745C'}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="${selected ? 1 : 0}" zoomScale="90"><pane xSplit="${selected ? 1 : 3}" ySplit="4" topLeftCell="${selected ? 'B' : 'D'}5" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${selected ? 'B' : 'D'}5" sqref="${selected ? 'B' : 'D'}5"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${columns}</cols><sheetData><row r="1" ht="32" customHeight="1">${xlsxInlineCell('A1', title, 4)}</row><row r="2" ht="26" customHeight="1">${xlsxFormulaCell('A2', countFormula, countText, 5)}</row><row r="3" ht="24" customHeight="1">${xlsxInlineCell('A3', hint, 5)}</row><row r="4" ht="28" customHeight="1">${heading}</row>${rows.join("")}</sheetData>${afterData}<mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A3:${lastColumn}3"/></mergeCells>${afterMerge}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${drawing}</worksheet>`;
}

function xlsxReportStyles() {
  const font = (size, color, extra = "") => `<font>${extra}<sz val="${size}"/><color rgb="FF${color}"/><name val="Microsoft YaHei"/><family val="2"/></font>`;
  const fonts = [font(11, '28322B'), font(11, 'FFFFFF', '<b/>'), font(16, 'FFFFFF', '<b/>'), font(10, '63705F'), font(11, '984526', '<b/>'), font(11, '315E91', '<u/>')];
  fonts.push(font(14, '28322B', '<b/>'));
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', ...['FFFFFF', 'F3F6F1', '303A32', '253229', 'EAF0E5', 'FFF3E8'].map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const border = `<border>${['left', 'right', 'top', 'bottom'].map((edge) => `<${edge} style="thin"><color rgb="FFBEC8B8"/></${edge}>`).join('')}<diagonal/></border>`;
  const xf = (fontId, fillId, horizontal = 'left', numFmtId = 0, borderId = 1, vertical = 'top') => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${horizontal}" vertical="${vertical}" wrapText="1" indent="1"/></xf>`;
  const styles = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', xf(0, 2), xf(0, 3), xf(1, 4, 'center', 0, 1, 'center'), xf(2, 5, 'left', 0, 0, 'center'), xf(3, 6, 'left', 0, 0, 'center'), xf(4, 2), xf(4, 3), xf(0, 2, 'right', 164), xf(0, 3, 'right', 164), xf(5, 2), xf(5, 3), xf(0, 7)];
  styles.push(xf(6, 2), xf(6, 3));
  const dxfs = [['9D3030', 'FCE9E6'], ['915324', 'FFF1D6'], ['286345', 'E4F2E8']].map(([color, fill]) => `<dxf>${font(11, color, '<b/>')}<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill></dxf>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${styles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`;
}

function xlsxImageAnchor(relId, index, column, row, label, size = {}) {
  const boxWidth = size.width || 224, boxHeight = size.height || 152;
  const sourceWidth = Number(size.sourceWidth) > 0 ? Number(size.sourceWidth) : boxWidth;
  const sourceHeight = Number(size.sourceHeight) > 0 ? Number(size.sourceHeight) : boxHeight;
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale * 9525), height = Math.round(sourceHeight * scale * 9525);
  const offsetX = Math.round((8 + (size.offsetX || 0) + (boxWidth - sourceWidth * scale) / 2) * 9525);
  const offsetY = Math.round((8 + (size.offsetY || 0) + (boxHeight - sourceHeight * scale) / 2) * 9525);
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>${offsetX}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${offsetY}</xdr:rowOff></xdr:from><xdr:ext cx="${width}" cy="${height}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index}" name="${xmlAttribute(label)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

function xlsxFormulaString(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function xlsxFormulaCell(reference, formula, cachedValue, style) {
  return `<c r="${reference}" s="${style}" t="str"><f>${xmlText(xlsxSafeText(formula))}</f><v>${xmlText(xlsxSafeText(cachedValue))}</v></c>`;
}

function xlsxCellRef(column, row) {
  let value = column;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label + row;
}

function xlsxInlineCell(reference, value, style = 1) {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${style}" t="n"><v>${value}</v></c>`;
  const text = xlsxSafeText(value);
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function xlsxSafeText(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function xmlText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlAttribute(value) {
  return htmlAttribute(value);
}

function htmlText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function htmlAttribute(value) {
  return htmlText(value).replace(/`/g, "&#96;");
}

function formatBoxSnapshot(box) {
  if (!isRecord(box)) return "-";
  return [box.top, box.right, box.bottom, box.left].map((value) => value || "0px").join(" ");
}

function makeExportFilename(session, exportedAt) {
  const project = sanitizePathSegment(session.name || session.title || session.origin || "Review", "Review");
  return `UIDelta-${project}-${exportedAt.slice(0, 10)}.zip`;
}

function makeDeliverableFilename(session, exportedAt, extension) {
  const project = sanitizePathSegment(session.name || session.title || session.origin || "Review", "Review");
  return `UIDelta-${project}-${exportedAt.slice(0, 10)}-交付.${extension}`;
}

function publicAsset(asset) {
  const { blob: _blob, thumbnailBlob: _thumbnailBlob, dataUrl: _dataUrl, ...metadata } = asset;
  return metadata;
}

async function assetToBlob(asset) {
  if (asset.blob instanceof Blob) return asset.blob;
  if (typeof asset.dataUrl === "string") return (await fetch(asset.dataUrl)).blob();
  throw new Error(`截图资源损坏：${asset.id || "unknown"}`);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function estimateStoredZipBytes(entries) {
  const encoder = new TextEncoder();
  let total = 22;
  for (const entry of entries) {
    const nameLength = encoder.encode(entry.name).byteLength;
    let dataLength = 0;
    if (typeof entry.data === "string") dataLength = encoder.encode(entry.data).byteLength;
    else if (entry.data instanceof Blob) dataLength = entry.data.size;
    else if (entry.data instanceof ArrayBuffer) dataLength = entry.data.byteLength;
    else if (ArrayBuffer.isView(entry.data)) dataLength = entry.data.byteLength;
    total += 76 + (nameLength * 2) + dataLength;
  }
  return total;
}

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || "").normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || fallback;
}

function markdownText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
}

function markdownInlineCode(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + padding + text + padding + fence;
}

function firstLine(value) {
  return typeof value === "string" ? value.trim().split(/\r?\n/, 1)[0].slice(0, 100) : "";
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveSafeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function makeId(prefix) {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function issueTypePrefix(type) {
  if (type === "functional") return "FN";
  if (type === "content") return "CT";
  return "UI";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isInspectableUrl(url) {
  return typeof url === "string" && /^(https?|file):/i.test(url);
}

function toFailure(error, fallback = "UIDelta 操作失败。") {
  return { ok: false, error: error instanceof Error && error.message ? error.message : fallback };
}
