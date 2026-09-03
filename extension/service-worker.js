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
  "UIDELTA_CAPTURE_EVIDENCE",
  "UIDELTA_PUT_REFERENCE_ASSET",
  "UIDELTA_GET_ASSET",
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
    case "UIDELTA_CAPTURE_EVIDENCE":
      return captureEvidence(message, sender);
    case "UIDELTA_PUT_REFERENCE_ASSET":
      return putReferenceAsset(message, sender);
    case "UIDELTA_GET_ASSET":
      return getAsset(message.assetId, sender, Boolean(message.thumbnail));
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

    await writeTabState(tabId, enabled, normalizeOrigin(tab.url), context);
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
      : requestedSequence > 0 && !usedSequences.has(requestedSequence)
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
  const db = await openDatabase();
  const transaction = db.transaction([STORE_ISSUES, STORE_SESSIONS, STORE_ASSETS], "readwrite");
  const done = transactionDone(transaction);
  try {
    const issueStore = transaction.objectStore(STORE_ISSUES);
    const sessionStore = transaction.objectStore(STORE_SESSIONS);
    const assetStore = transaction.objectStore(STORE_ASSETS);
    const existing = await requestResult(issueStore.get(issueId));
    if (!existing) {
      await done;
      return { ok: true, issueId, deleted: false, deletedAssetIds: [] };
    }
    const [storedSession, linkedAssets] = await Promise.all([
      requestResult(sessionStore.get(existing.sessionId)),
      requestResult(assetStore.index("issueId").getAll(issueId))
    ]);
    if (!storedSession) throw new Error("Issue 对应的 Review Session 已不存在。");
    let session = storedSession;
    assertSessionOwnership(session, sender);
    session = restoreExpiredFinalizationInStore(session, sessionStore);
    if (session.finalizingToken) throw new Error("Review Session 正在生成最终证据包，请稍候。");
    if (session.status === "completed" || session.status === "ended") {
      throw new Error("已结束的 Review Session 不能删除 Issue。");
    }
    const assetIds = linkedAssets.map((asset) => asset.id);
    issueStore.delete(issueId);
    for (const assetId of assetIds) assetStore.delete(assetId);
    await done;
    return { ok: true, issueId, deleted: true, deletedAssetIds: assetIds };
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
      references: (Array.isArray(issue.attachments?.references) ? issue.attachments.references : []).map((assetId) => exportPathsByAssetId.get(assetId)).filter(Boolean)
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
      const attachments = { references: [] };
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
      const title = asset.kind === "detail" ? "Detail" : asset.kind === "reference" ? "Reference" : "Context";
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
  const title = htmlText(session.name || session.title || "UIDelta 走查问题单");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{color-scheme:light;--ink:#17181d;--muted:#69707d;--line:#e5e7ec;--surface:#fff;--soft:#f6f7fa;--primary:#5268d8;--primary-soft:#edf0ff;--danger:#b83d53}*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:var(--ink);font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1180px,calc(100% - 32px));margin:0 auto}.top{padding:40px 0 24px}.eyebrow{margin:0;color:#6575d5;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.title-row{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.title-row h1{margin:7px 0 0;font-size:31px;line-height:1.15;letter-spacing:-.035em}.meta{margin:10px 0 0;color:var(--muted);font-size:13px}.toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:18px;padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.92);box-shadow:0 10px 25px rgba(16,24,40,.06);backdrop-filter:blur(16px)}.toolbar input,.toolbar select{min-height:38px;border:1px solid #d9dde5;border-radius:10px;background:#fff;padding:0 11px;color:var(--ink);font:inherit}.toolbar input{min-width:230px;flex:1}.toolbar button{min-height:38px;border:0;border-radius:10px;background:var(--primary);padding:0 13px;color:#fff;cursor:pointer;font:700 13px/1 inherit}.summary{margin-left:auto;color:var(--muted);font-size:13px}.cards{display:grid;gap:14px;padding-bottom:42px}.issue{overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 12px 30px rgba(16,24,40,.05)}.issue[hidden]{display:none}.issue-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:19px 20px 15px;border-bottom:1px solid var(--line)}.issue-id{display:inline-flex;align-items:center;min-height:25px;border-radius:7px;background:var(--primary-soft);padding:0 8px;color:#4156c6;font:800 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.issue h2{margin:7px 0 0;font-size:18px;line-height:1.35;letter-spacing:-.018em}.chips{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.chip{display:inline-flex;min-height:25px;align-items:center;border:1px solid #e2e5ed;border-radius:999px;background:#fafbfc;padding:0 8px;color:#5a6271;font-size:11px;font-weight:700}.chip.major{border-color:#ffd4da;background:#fff4f5;color:#a83d4b}.body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:20px;padding:20px}.body h3{margin:0 0 7px;font-size:12px;color:#596170;letter-spacing:.06em;text-transform:uppercase}.description{margin:0;white-space:pre-wrap}.spec{display:grid;gap:7px;margin-top:16px;padding:12px;border-radius:12px;background:var(--soft);font-size:13px}.spec strong{color:#343944}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:9px}.evidence figure{margin:0;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#f6f7fa}.evidence img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#e8ebf0;cursor:zoom-in}.evidence figcaption{padding:7px 8px;color:var(--muted);font-size:11px;font-weight:700}.issue-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;border-top:1px solid var(--line);background:#fbfcfe}.page-link{overflow:hidden;color:#4d63d0;font-size:12px;font-weight:700;text-decoration:none;text-overflow:ellipsis;white-space:nowrap}.done{display:flex;align-items:center;gap:7px;white-space:nowrap;color:#4d5563;font-size:12px;font-weight:700}.empty-image{display:grid;min-height:120px;place-items:center;color:#8a93a1;font-size:12px}@media(max-width:720px){.shell{width:min(100% - 20px,1180px)}.top{padding-top:25px}.title-row{align-items:flex-start;flex-direction:column}.toolbar input{min-width:100%}.summary{margin-left:0}.body{grid-template-columns:1fr}.issue-head{flex-direction:column}.chips{justify-content:flex-start}}
</style></head><body><main class="shell"><header class="top"><p class="eyebrow">UIDelta · 走查交付</p><div class="title-row"><div><h1>${title}</h1><p class="meta">${issues.length} 个问题 · 导出于 ${htmlText(exportedAt)} · 本报告可离线查看</p></div></div></header><section class="toolbar" aria-label="问题筛选"><input id="search" type="search" placeholder="搜索编号、问题、页面或元素"><select id="type"><option value="">全部类型</option><option value="ui">UI</option><option value="functional">功能</option><option value="content">文案</option></select><select id="severity"><option value="">全部影响程度</option><option value="crash">崩了</option><option value="blocked">瘫了</option><option value="degraded">差了</option><option value="cosmetic">小瑕</option></select><button id="export-status" type="button">导出处理状态 JSON</button><span class="summary" id="summary"></span></section><section class="cards" id="cards">${cards}</section></main><script>
const key='uidelta-report-status:'+location.pathname;const saved=JSON.parse(localStorage.getItem(key)||'{}');const cards=[...document.querySelectorAll('.issue')];const search=document.querySelector('#search'),type=document.querySelector('#type'),severity=document.querySelector('#severity'),summary=document.querySelector('#summary');for(const input of document.querySelectorAll('[data-status]')){input.checked=Boolean(saved[input.dataset.status]);input.addEventListener('change',()=>{saved[input.dataset.status]=input.checked;localStorage.setItem(key,JSON.stringify(saved));update()})}function update(){const q=search.value.trim().toLowerCase();let shown=0;for(const card of cards){const ok=(!q||card.dataset.search.includes(q))&&(!type.value||card.dataset.type===type.value)&&(!severity.value||card.dataset.severity===severity.value);card.hidden=!ok;if(ok)shown++}summary.textContent='显示 '+shown+' / '+cards.length+' 个问题'}[search,type,severity].forEach(node=>node.addEventListener('input',update));document.querySelector('#export-status').addEventListener('click',()=>{const data={schemaVersion:1,source:'UIDelta HTML report',exportedAt:new Date().toISOString(),status:saved};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='uidelta-report-status.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0)});update();
</script></body></html>`;
}

function buildHtmlIssueCard(issue, assets, index) {
  const context = assets.find((asset) => asset.kind === "context");
  const detail = assets.find((asset) => asset.kind === "detail");
  const evidence = [
    htmlEvidenceFigure(context, "全景证据"),
    htmlEvidenceFigure(detail, "局部证据")
  ].join("");
  const change = Array.isArray(issue.changeProposal?.changes) && issue.changeProposal.changes.length
    ? issue.changeProposal.changes.map((item) => `${htmlText(deliveryPropertyLabel(item.property))}：${htmlText(item.before)} → ${htmlText(item.after)}`).join("<br>")
    : "未提供本地试改建议";
  const expected = Array.isArray(issue.diffs) && issue.diffs.length
    ? issue.diffs.slice(0, 4).map((diff) => `${htmlText(deliveryPropertyLabel(diff.property))}：${htmlText(diff.expected)} → ${htmlText(diff.actual)}`).join("<br>")
    : "无设计差异数据";
  const developer = buildDeveloperFields(issue);
  const actual = deliveryActualDetails(issue);
  const source = [issue.displayId, issue.title, issue.description, issue.pageSnapshot?.route, deliveryElementLocator(issue), actual.summary].filter(Boolean).join(" ").toLowerCase();
  const page = nonEmptyString(issue.pageSnapshot?.url);
  const developerMetrics = [
    `宽 ${actual.rect.width ?? "-"}px`, `高 ${actual.rect.height ?? "-"}px`,
    `X ${actual.rect.x ?? "-"}`, `Y ${actual.rect.y ?? "-"}`
  ].join(" · ");
  return `<article class="issue" data-type="${htmlAttribute(issue.type || "ui")}" data-severity="${htmlAttribute(issue.severity || "cosmetic")}" data-search="${htmlAttribute(source)}"><header class="issue-head"><div><span class="issue-id">${htmlText(issue.displayId || `UI-${String(index + 1).padStart(3, "0")}`)}</span><h2>${htmlText(issue.title || firstLine(issue.description) || "未命名问题")}</h2></div><div class="chips"><span class="chip">${htmlText(deliveryTypeLabel(issue.type))}</span><span class="chip">${htmlText(deliveryPriorityLabel(issue.priority))}</span><span class="chip ${htmlAttribute(["crash", "blocked", "degraded"].includes(issue.severity) ? "major" : "")}">${htmlText(deliverySeverityLabel(issue.severity))}</span></div></header><div class="body"><div><h3>问题说明</h3><p class="description">${htmlText(issue.description || "未填写描述")}</p><div class="spec"><div><strong>记录模式：</strong>${htmlText(developer.captureMode)}</div><div><strong>元素定位：</strong>${htmlText(deliveryElementLocator(issue))}</div><div><strong>实测 / 说明：</strong>${htmlText(actual.summary)}</div><div><strong>实测尺寸与坐标：</strong>${htmlText(developerMetrics)}</div><div><strong>布局 / 间距：</strong>${htmlText(actual.layout)} · ${htmlText(actual.spacing)}</div><div><strong>字体 / 颜色：</strong>${htmlText(actual.typography)} · 文字色 ${htmlText(actual.color)} · 背景色 ${htmlText(actual.background)} · 圆角 ${htmlText(actual.borderRadius)}</div><div><strong>拟议修改：</strong>${change}</div><div><strong>设计差异：</strong>${expected}</div></div></div><div class="evidence">${evidence}</div></div><footer class="issue-foot">${page ? `<a class="page-link" href="${htmlAttribute(page)}" target="_blank" rel="noreferrer">打开原页面 ↗</a>` : "<span class=\"page-link\">未记录页面链接</span>"}<label class="done"><input type="checkbox" data-status="${htmlAttribute(issue.id || String(index))}"> 已处理</label></footer></article>`;
}

function htmlEvidenceFigure(asset, label) {
  if (!asset?.dataUrl) return `<figure><div class="empty-image">缺少${htmlText(label)}</div><figcaption>${htmlText(label)}</figcaption></figure>`;
  return `<figure><img src="${htmlAttribute(asset.dataUrl)}" alt="${htmlAttribute(label)}" onclick="this.requestFullscreen&&this.requestFullscreen()"><figcaption>${htmlText(label)}</figcaption></figure>`;
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
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
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
  const headers = [
    "编号", "类型", "走查问题", "元素定位", "实测 / 说明",
    "实测宽(px)", "实测高(px)", "坐标 X(px)", "坐标 Y(px)", "测距(px)",
    "布局", "间距", "字体", "文字颜色", "背景色", "圆角", "DOM 选择器",
    "页面路径", "页面地址", "记录模式", "优先级", "影响程度",
    "全景预览", "细节预览", "全景截图文件", "细节截图文件", "负责人", "处理状态", "修复版本"
  ];
  const assetsByIssue = new Map();
  for (const asset of assets) {
    if (!assetsByIssue.has(asset.issueId)) assetsByIssue.set(asset.issueId, []);
    assetsByIssue.get(asset.issueId).push(asset);
  }
  const rows = [];
  const links = [];
  const imageEntries = [];
  const drawingAnchors = [];
  const drawingRelations = [];
  const assetMediaTargets = new Map();
  let imageIndex = 0;
  for (const [index, issue] of issues.entries()) {
    const rowNumber = index + 5;
    const issueAssets = assetsByIssue.get(issue.id) || [];
    const context = issueAssets.find((asset) => asset.kind === "context");
    const detail = issueAssets.find((asset) => asset.kind === "detail");
    const developer = buildDeveloperFields(issue);
    const actual = deliveryActualDetails(issue);
    const change = Array.isArray(issue.changeProposal?.changes) ? issue.changeProposal.changes.map((item) => `${deliveryPropertyLabel(item.property)}：${item.before} → ${item.after}`).join("；") : "";
    const diff = Array.isArray(issue.diffs) ? issue.diffs.slice(0, 4).map((item) => `${deliveryPropertyLabel(item.property)}：期望 ${item.expected} → 实际 ${item.actual}`).join("；") : "";
    const values = [
      issue.displayId || `UI-${String(index + 1).padStart(3, "0")}`,
      deliveryTypeLabel(issue.type),
      issue.title || firstLine(issue.description) || "未命名问题",
      deliveryElementLocator(issue),
      actual.summary,
      actual.rect.width ?? "未记录", actual.rect.height ?? "未记录", actual.rect.x ?? "未记录", actual.rect.y ?? "未记录", actual.measurement || "未记录",
      actual.layout, actual.spacing, actual.typography, actual.color, actual.background, actual.borderRadius,
      developer.elementLocator.selector || "未记录",
      issue.pageSnapshot?.route || "未记录", issue.pageSnapshot?.url || "未记录", developer.captureMode,
      deliveryPriorityLabel(issue.priority), deliverySeverityLabel(issue.severity),
      context ? "已嵌入" : "无", detail ? "已嵌入" : "无", context?.exportPath || "", detail?.exportPath || "", "", "", ""
    ];
    const cells = values.map((value, cellIndex) => xlsxInlineCell(xlsxCellRef(cellIndex + 1, rowNumber), value)).join("");
    rows.push(`<row r="${rowNumber}" ht="108" customHeight="1">${cells}</row>`);
    if (nonEmptyString(issue.pageSnapshot?.url)) links.push({ ref: xlsxCellRef(19, rowNumber), target: issue.pageSnapshot.url });
    for (const [asset, label, column] of [[context, "全景", 22], [detail, "细节", 23]]) {
      if (!asset) continue;
      imageIndex += 1;
      const relId = `rId${imageIndex}`;
      const mediaTarget = `../media/image${imageIndex}.png`;
      imageEntries.push({ name: `xl/media/image${imageIndex}.png`, data: await assetToBlob(asset) });
      assetMediaTargets.set(asset, mediaTarget);
      drawingRelations.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaTarget}"/>`);
      drawingAnchors.push(xlsxImageAnchor(relId, imageIndex, column, rowNumber - 1, label));
    }
  }
  const lastColumn = xlsxCellRef(headers.length, 1).replace("1", "");
  const title = "UIDelta UI 走查问题";
  const titleCells = headers.map((_, index) => xlsxInlineCell(xlsxCellRef(index + 1, 1), index === 0 ? title : "", 2)).join("");
  const metaValues = ["走查日期", String(exportedAt || "").slice(0, 10) || "未记录", "", "问题数", String(issues.length), "项目", session.name || session.title || "未命名项目"];
  const metaCells = metaValues.map((value, index) => xlsxInlineCell(xlsxCellRef(index + 1, 2), value, 3)).join("");
  const headerCells = headers.map((header, index) => xlsxInlineCell(xlsxCellRef(index + 1, 4), header, 1)).join("");
  const widths = [14, 12, 42, 52, 68, 13, 13, 14, 14, 18, 14, 36, 36, 23, 23, 16, 52, 28, 42, 16, 14, 14, 32, 32, 30, 30, 16, 16, 16];
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const hyperlinkRelations = links.map((link, index) => `<Relationship Id="rId${imageIndex + index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlAttribute(link.target)}" TargetMode="External"/>`).join("");
  const hyperlinks = links.length ? `<hyperlinks>${links.map((link, index) => `<hyperlink ref="${link.ref}" r:id="rId${imageIndex + index + 2}"/>`).join("")}</hyperlinks>` : "";
  const drawing = drawingAnchors.length ? `<drawing r:id="rId1"/>` : "";
  const sheetRelations = drawingAnchors.length
    ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>${hyperlinkRelations}</Relationships>`
    : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinkRelations}</Relationships>`;
  const drawingXml = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${drawingAnchors.join("")}</xdr:wsDr>`;
  const evidenceHeaders = ["编号", "类型", "走查问题", "元素定位", "实测 / 说明", "全景截图（可直接查看）", "细节截图（可直接查看）"];
  const evidenceRows = [];
  const evidenceDrawingAnchors = [];
  const evidenceDrawingRelations = [];
  let evidenceImageIndex = 0;
  for (const [index, issue] of issues.entries()) {
    const rowNumber = index + 2;
    const issueAssets = assetsByIssue.get(issue.id) || [];
    const context = issueAssets.find((asset) => asset.kind === "context");
    const detail = issueAssets.find((asset) => asset.kind === "detail");
    const actual = deliveryActualDetails(issue);
    const values = [issue.displayId || `UI-${String(index + 1).padStart(3, "0")}`, deliveryTypeLabel(issue.type), issue.title || firstLine(issue.description) || "未命名问题", deliveryElementLocator(issue), actual.summary, context ? "已嵌入" : "无", detail ? "已嵌入" : "无"];
    evidenceRows.push(`<row r="${rowNumber}" ht="170" customHeight="1">${values.map((value, cellIndex) => xlsxInlineCell(xlsxCellRef(cellIndex + 1, rowNumber), value)).join("")}</row>`);
    for (const [asset, label, column] of [[context, "全景", 5], [detail, "细节", 6]]) {
      const mediaTarget = assetMediaTargets.get(asset);
      if (!mediaTarget) continue;
      evidenceImageIndex += 1;
      const relId = `rId${evidenceImageIndex}`;
      evidenceDrawingRelations.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaTarget}"/>`);
      evidenceDrawingAnchors.push(xlsxImageAnchor(relId, evidenceImageIndex, column, rowNumber - 1, label, { width: 3048000, height: 1714500 }));
    }
  }
  const evidenceHeaderCells = evidenceHeaders.map((header, index) => xlsxInlineCell(xlsxCellRef(index + 1, 1), header, 1)).join("");
  const evidenceWidths = [14, 12, 40, 52, 60, 46, 46];
  const evidenceColumns = evidenceWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const evidenceDrawing = evidenceDrawingAnchors.length ? `<drawing r:id="rId1"/>` : "";
  const evidenceSheetRelations = evidenceDrawingAnchors.length
    ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/></Relationships>`
    : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  const evidenceDrawingXml = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${evidenceDrawingAnchors.join("")}</xdr:wsDr>`;
  const evidenceAutoFilter = issues.length ? `<autoFilter ref="A1:${xlsxCellRef(evidenceHeaders.length, issues.length + 1)}"/>` : "";
  const evidenceSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${evidenceColumns}</cols><sheetData><row r="1" ht="32" customHeight="1">${evidenceHeaderCells}</row>${evidenceRows.join("")}</sheetData>${evidenceAutoFilter}${evidenceDrawing}</worksheet>`;
  const workbookTitle = "问题清单";
  const autoFilter = issues.length ? `<autoFilter ref="A4:${xlsxCellRef(headers.length, issues.length + 4)}"/>` : "";
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData><row r="1" ht="28" customHeight="1">${titleCells}</row><row r="2" ht="24" customHeight="1">${metaCells}</row><row r="3" ht="8" customHeight="1"/><row r="4" ht="32" customHeight="1">${headerCells}</row>${rows.join("")}</sheetData><mergeCells count="1"><mergeCell ref="A1:${lastColumn}1"/></mergeCells>${autoFilter}${hyperlinks}${drawing}</worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${drawingAnchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}${evidenceDrawingAnchors.length ? '<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="10"/><color rgb="FF172033"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FF17395F"/><name val="Microsoft YaHei"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17395F"/><bgColor rgb="FF17395F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B4E8A"/><bgColor rgb="FF0B4E8A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor rgb="FFEAF1F8"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E0F1"/></left><right style="thin"><color rgb="FFD9E0F1"/></right><top style="thin"><color rgb="FFD9E0F1"/></top><bottom style="thin"><color rgb="FFD9E0F1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${workbookTitle}" sheetId="1" r:id="rId1"/><sheet name="证据预览" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: sheetRelations },
    { name: "xl/worksheets/sheet2.xml", data: evidenceSheetXml },
    { name: "xl/worksheets/_rels/sheet2.xml.rels", data: evidenceSheetRelations }
  ];
  if (drawingAnchors.length) {
    entries.push({ name: "xl/drawings/drawing1.xml", data: drawingXml });
    entries.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRelations.join("")}</Relationships>` });
  }
  if (evidenceDrawingAnchors.length) {
    entries.push({ name: "xl/drawings/drawing2.xml", data: evidenceDrawingXml });
    entries.push({ name: "xl/drawings/_rels/drawing2.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${evidenceDrawingRelations.join("")}</Relationships>` });
  }
  entries.push(...imageEntries);
  return entries;
}

function xlsxImageAnchor(relId, index, column, row, label, size = {}) {
  const width = size.width || 1714500;
  const height = size.height || 962025;
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="${width}" cy="${height}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index}" name="${xmlAttribute(label)}预览 ${index}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
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

function xlsxInlineCell(reference, value, style = 0) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value ?? "")}</t></is></c>`;
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
