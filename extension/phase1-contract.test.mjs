import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const here = new URL("./", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, here), "utf8");
}

function zipEntryNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const names = [];
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    names.push(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

async function testZipContract() {
  const zipSource = await read("zip-store.js");
  const zipModule = await import("data:text/javascript;base64," + Buffer.from(zipSource).toString("base64"));
  const { createStoredZip } = zipModule;
  const zip = await createStoredZip([
    { name: "report.md", data: "# 走查报告\n" },
    { name: "issues.json", data: JSON.stringify({ issues: [{ id: "UI-001" }] }) },
    { name: "assets/UI-001-detail.png", data: new Uint8Array([137, 80, 78, 71]) }
  ], new Date("2026-08-28T10:00:00+08:00"));
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  assert.deepEqual(zipEntryNames(zip), ["report.md", "issues.json", "assets/UI-001-detail.png"]);
  assert.equal(new DataView(zip.buffer).getUint32(zip.byteLength - 22, true), 0x06054b50);
}

async function testManifestContract() {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.9.4");
  assert.equal(manifest.background.type, "module");
  for (const permission of ["activeTab", "scripting", "storage", "tabs", "downloads", "unlimitedStorage"]) {
    assert.ok(manifest.permissions.includes(permission), `缺少权限 ${permission}`);
  }
  assert.ok(manifest.content_scripts[0].matches.includes("https://*/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("file:///*"));
  assert.ok(!manifest.content_scripts[0].matches.includes("file://*/*"));
  assert.equal(manifest.commands["toggle-inspector"].suggested_key.mac, "Alt+Shift+I");
}

async function testMessageAndUiContracts() {
  const [worker, content, compare] = await Promise.all([read("service-worker.js"), read("content.js"), read("compare-engine.js")]);
  for (const message of [
    "UIDELTA_GET_STATE",
    "UIDELTA_PUT_SESSION",
    "UIDELTA_PUT_DESIGN",
    "UIDELTA_SET_SESSION_STATUS",
    "UIDELTA_FINALIZE_SESSION",
    "UIDELTA_TOUCH_PAGE",
    "UIDELTA_RESERVE_ISSUE",
    "UIDELTA_PUT_ISSUE",
    "UIDELTA_CAPTURE_EVIDENCE",
    "UIDELTA_PUT_REFERENCE_ASSET",
    "UIDELTA_GET_ASSET",
    "UIDELTA_DELETE_ISSUE",
    "UIDELTA_DELETE_ISSUES",
    "UIDELTA_DELETE_ASSETS",
    "UIDELTA_EXPORT_SESSION",
    "UIDELTA_EXPORT_DELIVERABLE",
    "UIDELTA_IMPORT_DELIVERABLE"
  ]) {
    assert.ok(worker.includes(`\"${message}\"`), `worker 缺少消息 ${message}`);
    assert.ok(content.includes(`\"${message}\"`), `content 缺少消息 ${message}`);
  }
  assert.ok(!content.includes("data-action='pause-session'"));
  assert.ok(content.includes("data-action='resume-session'"));
  assert.ok(content.includes('event.code === "KeyR"'));
  assert.ok(content.includes("this.openComposer(undefined, measurement ? structuredClone(measurement) : null)"));
  assert.ok(content.indexOf("const isRecordShortcut") < content.indexOf("if (typing) {"), "记录快捷键必须先于网页输入框拦截");
  assert.ok(content.includes("this.measurementTarget = to"));
  assert.ok(content.includes("const effectiveMeasurement = regionOverride ? null : measurementOverride"));
  assert.ok(content.includes('this.currentView !== "inspect"'));
  assert.ok(content.includes('this.pinsLayer.style.display = isInspectView ? "" : "none"'));
  assert.ok(content.includes("position:fixed;z-index:10"));
  assert.ok(content.includes('event.key === "ArrowLeft" || event.key === "ArrowRight"'));
  assert.ok(content.includes("switchPreview(direction)"));
  assert.ok(content.includes("全景截图"));
  assert.ok(content.includes("局部截图"));
  assert.ok(content.includes("data-action='preview-previous'"));
  assert.ok(content.includes("data-action='preview-next'"));
  assert.ok(content.includes("issue-search-input"));
  assert.ok(content.includes("data-filter='page'"));
  assert.ok(content.includes("data-action='retry-capture'"));
  assert.ok(content.includes("data-mode='region'"));
  assert.ok(content.includes("data-mode='annotation'"));
  assert.ok(content.includes("startRegionSelection"));
  assert.ok(content.includes("UI properties are only shown for a clicked target"));
  assert.ok(content.includes("click selects and locks it"));
  assert.ok(content.includes('window.addEventListener("click", this.onDocumentClick, true)'));
  assert.ok(!content.includes('window.addEventListener("mousedown", this.onDocumentMouseDown, true)'));
  assert.ok(content.includes("selectPageTarget(target, { x: event.clientX, y: event.clientY });"));
  assert.ok(content.includes("this.selectionLocked = true"));
  assert.ok(content.includes("const lockedSelection = this.selectionLocked && this.selected?.isConnected"));
  assert.ok(content.includes("else this.renderComparison(this.selected, target);"));
  assert.ok(content.includes("event.stopImmediatePropagation();"));
  assert.ok(!content.includes("测距已锁定"));
  assert.ok(content.includes("buildSelectedMeasurementSnapshot"));
  assert.ok(content.includes("focusComposerDescription"));
  assert.ok(content.includes("本地试改"));
  assert.ok(content.includes("applyPreviewProperty"));
  assert.ok(content.includes("input.dataset.previewProp"));
  assert.ok(content.includes('captureMode: isRegion ? "region" : this.inspectMode || "annotation"'));
  assert.ok(content.includes("createUiNumericField"));
  assert.ok(content.includes("handleUiNumericKeydown"));
  assert.ok(content.includes("canPreviewPosition"));
  assert.ok(content.includes("input.dataset.lastValid"));
  assert.ok(content.includes("ui-opacity-range"));
  assert.ok(content.includes("is-invalid"));
  assert.ok(content.includes("left: this.previewPositionValue"));
  assert.ok(content.includes("this.previewStates = new Map()"));
  assert.ok(content.includes("const cached = this.previewStates.get(element)"));
  assert.ok(!content.includes("this.resetPreview(false);\n        const style = getComputedStyle(element);"), "切换元素不能重置已有本地试改");
  assert.ok(content.includes("captureUiEditorFocus"));
  assert.ok(content.includes("restoreUiEditorFocus(focusSnapshot)"));
  assert.ok(content.includes("const activeControl = this.shadow?.activeElement || document.activeElement"));
  assert.ok(content.includes("if (control === activeControl) continue;"));
  assert.ok(content.includes("width:min(250px,calc(100vw - 24px))"));
  assert.ok(content.includes("height:min(560px,calc(100vh - 24px))"));
  assert.ok(content.includes("height:28px!important"));
  assert.ok(content.includes("--ud-canvas:#18191d"));
  assert.ok(content.includes("data-ui-section='fill'"));
  assert.ok(content.includes("class='ui-editor'"));
  assert.ok(content.includes('this.uiEditorName = this.shadow.querySelector(".ui-editor-title")'));
  assert.ok(!content.includes('this.uiEditorName = this.shadow.querySelector(".ui-editor-name")'));
  assert.ok(content.includes("renderUiEditor"));
  assert.ok(content.includes("const isSelected = Boolean(element?.isConnected)"));
  assert.ok(!content.includes("element?.isConnected && this.selected === element"));
  assert.ok(content.includes("this.selected = element;\n        this.renderUiEditor"));
  assert.ok(content.includes('this.uiEditorName.textContent = this.textContent(element) ? "文本" : "元素"'));
  assert.ok(content.includes("onModeToolbarPointerMove"));
  assert.ok(content.includes("onModeButtonClick"));
  assert.ok(content.includes('button.addEventListener("click", this.onModeButtonClick)'));
  assert.ok(content.includes('window.addEventListener("pointerdown", this.onDocumentPointerDown, true)'));
  assert.ok(content.includes("data-ui-section='dimensions'"));
  assert.ok(content.includes("ui-editor-color-control"));
  assert.ok(content.includes("toggle-preview-properties"));
  assert.ok(content.includes("后续改动会实时同步"));
  assert.ok(content.includes("input.type = isColor ? \"color\" : \"text\""));
  assert.ok(content.includes("fontFamily: style.fontFamily"));
  assert.ok(content.includes("justifyContent: style.justifyContent"));
  assert.ok(content.includes("class='mode-toolbar'"));
  assert.ok(content.includes("data-mode='ui'"));
  assert.ok(content.includes("交付本次走查"));
  assert.ok(content.includes("安全导入 UIDelta 交付包"));
  assert.ok(content.includes("copy-agent"));
  assert.ok(content.includes("getPreviewProposal"));
  assert.ok(content.includes("buildSurroundingMeasurementSnapshot"));
  assert.ok(content.includes("buildParentMeasurementSnapshot"));
  assert.ok(content.includes("resolveIssueMeasurement"));
  assert.ok(content.includes("标注间距"));
  assert.ok(content.includes("class='record-prompt'"));
  assert.ok(content.includes("const protectedRects = [target]"));
  assert.ok(content.includes("悬停测距"));
  assert.ok(content.includes("record-region"));
  assert.ok(content.includes("beginRegionEdit"));
  assert.ok(content.includes("persistCapturedDraft"));
  assert.ok(!content.includes("composerQueue"));
  assert.ok(worker.includes("最多添加 10 张参考图片"));
  assert.ok(content.includes("animateRecordTransition"));
  assert.ok(content.includes("setCaptureOverlayVisible"));
  assert.ok(content.includes("data-${key}='${value}' role='radio'"), "记录属性直接展开为可键盘操作的单选按钮");
  assert.ok(content.includes('["priority", "优先级", PRIORITIES]'));
  assert.ok(content.includes('["severity", "影响程度",'));
  assert.ok(content.includes("reference-image-input"));
  assert.ok(content.includes('label: "#" + String(issue.sequence)'));
  assert.ok(content.includes("captureTargetState(message.captureToken)"));
  assert.ok(content.includes("const accessibleName = this.accessibleName(element)"));
  assert.ok(content.includes('!this.isUiEvent(event) && event.code === "Space"'));
  assert.ok(content.includes("event.metaKey || event.ctrlKey"));
  assert.ok(content.includes("PIERCE_CLASS"));
  assert.ok(content.includes('this.pinsLayer.style.display = "none"'));
  assert.ok(content.includes("!this.isSessionActive() || this.interactionDown"));
  assert.ok(content.includes("本次走查已结束"));
  assert.ok(content.includes("response.downloadPath || \"Chrome 默认下载文件夹\""));
  assert.ok(content.includes("data-action='bind-design'"));
  assert.ok(content.includes("compareSelected(element)"));
  assert.ok(content.includes("期望 "));
  assert.ok(content.includes("实测 "));
  assert.ok(content.includes("差异 "));
  assert.ok(worker.includes("sanitizeDesignSource"));
  assert.ok(worker.includes("designSnapshotVersion"));
  assert.ok(worker.includes('["compare-engine.js", "content.js"]'));
  assert.ok(compare.includes("normalizeDesignSnapshot"));
  assert.ok(compare.includes("findCandidates"));
  assert.ok(compare.includes("diffSnapshots"));
  assert.ok(!/fetch\s*\(/i.test(compare), "Compare 快照规范化不应请求外部网络");
  assert.ok(content.includes("data-tooltip='UI 模式'"));
  assert.ok(content.includes("data-tooltip='标注模式'"));
  assert.ok(content.includes("data-tooltip='框选模式'"));
  assert.ok(!/fetch\s*\(\s*[`'\"]https?:/i.test(worker + content), "不应请求外部网络");
}

async function testWorkerReliabilityGuards() {
  const worker = await read("service-worker.js");
  const executable = worker.replace(/^import[^\n]+\n/, "") + `\n;globalThis.__workerTest = { normalizeCaptureState, assertStableCaptureState, issueTypePrefix, positiveSafeInteger, restoreExpiredFinalizationInStore };`;
  const event = { addListener() {} };
  const context = {
    chrome: {
      runtime: { onInstalled: event, onMessage: event },
      commands: { onCommand: event },
      action: { onClicked: event },
      tabs: { onRemoved: event, onUpdated: event }
    },
    URL,
    Date,
    Math,
    Number,
    Promise,
    Error,
    Map,
    Set,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Blob,
    structuredClone,
    crypto: webcrypto,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(executable, context);
  const api = context.__workerTest;
  const state = {
    pageUrl: "https://example.com/review",
    documentToken: "doc-1",
    rect: { left: 10, top: 20, width: 100, height: 40 },
    viewport: {
      width: 1280,
      height: 720,
      scrollX: 0,
      scrollY: 120,
      visualViewport: { width: 1280, height: 720, offsetLeft: 0, offsetTop: 0, scale: 1 }
    }
  };
  const before = api.normalizeCaptureState(state, state.pageUrl);
  api.assertStableCaptureState(before, api.normalizeCaptureState(structuredClone(state), state.pageUrl));
  const moved = structuredClone(state);
  moved.rect.left += 3;
  assert.throws(
    () => api.assertStableCaptureState(before, api.normalizeCaptureState(moved, state.pageUrl)),
    /发生移动/
  );
  assert.equal(api.issueTypePrefix("functional"), "FN");
  assert.equal(api.issueTypePrefix("content"), "CT");
  assert.equal(api.positiveSafeInteger(-1, 7), 7);
  const restoredRecords = [];
  const expiredFinalization = {
    id: "session-1",
    status: "paused",
    finalizingToken: "old-token",
    finalizingPreviousStatus: "paused",
    finalizingExpiresAtMs: 1_000,
    revision: 7
  };
  const restored = api.restoreExpiredFinalizationInStore(
    expiredFinalization,
    { put(record) { restoredRecords.push(record); } },
    2_000
  );
  assert.equal(restored.status, "paused");
  assert.equal(restored.revision, 8);
  assert.equal("finalizingToken" in restored, false);
  assert.equal(restoredRecords.length, 1);
  const liveFinalization = { ...expiredFinalization, finalizingExpiresAtMs: 3_000 };
  assert.equal(
    api.restoreExpiredFinalizationInStore(liveFinalization, { put() { throw new Error("未过期锁不应被写回"); } }, 2_000),
    liveFinalization
  );
  assert.ok(worker.includes("const DB_VERSION = 3"));
  assert.ok(worker.includes("putReferenceAsset"));
  assert.ok(worker.includes("chrome.action.onClicked"));
  assert.ok(worker.includes('ensureIndex(assets, "expiresAtMs", "expiresAtMs")'));
  assert.ok(worker.includes("每条 Issue 都需要完整的 Context 与 Detail 截图"));
  assert.ok(worker.includes("lockSessionForFinalization"));
  assert.ok(worker.includes("recoverStaleFinalizations"));
  assert.ok(worker.includes("restoreExpiredFinalizationInStore"));
  assert.ok(worker.includes("downloadPath: nonEmptyString(downloadItem?.filename)"));
  assert.ok(worker.includes("### 设计比对"));
  assert.ok(worker.includes("| 属性 | 期望值 | 实测值 | 差异 |"));
  assert.ok(worker.includes("buildHtmlReport"));
  assert.ok(worker.includes("buildXlsxReport"));
  assert.ok(worker.includes("schemaVersion: 4"));
  assert.ok(worker.includes("developerFields: buildDeveloperFields(issue)"));
  assert.ok(worker.includes("function buildDeveloperFields(issue)"));
  assert.ok(worker.includes("实测宽(px)"));
  assert.ok(worker.includes("元素定位"));
  assert.ok(worker.includes("负责人"));
  assert.ok(worker.includes("修复版本"));
}

async function testBookmarkBridge() {
  const source = await read(new URL("../ui-lens-bookmarklet/bookmarklet.js", here));
  const listeners = new Map();
  const posted = [];
  const fakeWindow = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    setTimeout,
    clearTimeout,
    postMessage(message) {
      posted.push(message);
      if (message.source === "uidelta-bookmark") {
        queueMicrotask(() => listeners.get("message")?.({
          source: fakeWindow,
          data: {
            source: "uidelta-extension",
            type: "UIDELTA_TOGGLE_ACK",
            requestId: message.requestId,
            enabled: true,
            ok: true
          }
        }));
      }
    }
  };
  const fakeDocument = {
    querySelector() { return null; },
    createElement() { throw new Error("收到 ACK 后不应创建安装提示"); },
    documentElement: { appendChild() {} },
    body: { appendChild() {} }
  };
  vm.runInNewContext(source, {
    window: fakeWindow,
    document: fakeDocument,
    crypto: webcrypto,
    Date,
    Math,
    queueMicrotask,
    setTimeout,
    clearTimeout
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "UIDELTA_TOGGLE");
  assert.equal(posted[0].version, 1);
  assert.equal(listeners.has("message"), false, "收到 ACK 后应清理监听器");
}

async function testCompareEngine() {
  const source = await read("compare-engine.js");
  const context = { globalThis: {}, structuredClone, URL, Date, Math };
  vm.runInNewContext(source, context);
  const engine = context.globalThis.__uideltaCompareEngine;
  const snapshot = engine.normalizeDesignSnapshot({
    name: "Review Frame",
    type: "FRAME",
    children: [{ id: "1:2", name: "Primary action", type: "TEXT", characters: "保存", absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 24 }, style: { fontSize: 14, fontFamily: "Inter", fontWeight: 600, lineHeightPx: 20 } }]
  }, { fileKey: "abc", nodeId: "1:1" });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.nodes.length, 2);
  const candidates = engine.findCandidates({ text: "保存", tag: "span", role: "text" }, { dimensions: { width: 80, height: 24 }, typography: { fontSize: "14px" } }, snapshot);
  assert.equal(candidates[0].node.id, "1:2");
  assert.ok(["high", "possible"].includes(candidates[0].confidence));
  assert.ok(engine.diffSnapshots({ dimensions: { width: 72, height: 24 }, spacing: {}, typography: {}, appearance: {}, layout: {} }, candidates[0].node).some((item) => item.property === "dimensions.width"));
}

await testZipContract();
await testManifestContract();
await testMessageAndUiContracts();
await testWorkerReliabilityGuards();
await testBookmarkBridge();
await testCompareEngine();

console.log("UIDelta contract tests: 6/6 passed");
