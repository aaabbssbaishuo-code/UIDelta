(() => {
  if (globalThis.__uideltaReview) return;

  const ROOT_ATTRIBUTE = "data-uidelta-root";
  const BOOKMARK_SOURCE = "uidelta-bookmark";
  const BOOKMARK_ACK_SOURCE = "uidelta-extension";
  const ACTIVE_CLASS = "uidelta-is-inspecting";
  const MEASURE_CLASS = "uidelta-is-measuring";
  const PIERCE_CLASS = "uidelta-is-piercing";
  const CURSOR_STYLE_ID = "uidelta-cursor-style";
  const PENDING_JUMP_KEY = "__uideltaPendingIssue";
  const ISSUE_TYPES = {
    ui: { label: "UI", prefix: "UI" },
    functional: { label: "功能", prefix: "FN" },
    content: { label: "文案", prefix: "CT" }
  };
  const SEVERITIES = {
    crash: "崩溃",
    blocked: "功能阻断",
    degraded: "体验下降",
    cosmetic: "视觉瑕疵",
    minor: "视觉瑕疵",
    major: "体验下降"
  };
  const PRIORITIES = { immediate: "立即", soon: "尽快", queued: "排期", later: "稍后" };

  class UIDeltaReview {
    constructor() {
      this.enabled = false;
      this.browseMode = false;
      this.persistedTabState = null;
      this.tabConfigured = false;
      this.selected = null;
      this.hovered = null;
      this.modifierDown = false;
      this.pierceDown = false;
      this.interactionDown = false;
      this.currentView = "start";
      this.session = null;
      this.issues = [];
      this.issueFilter = "all";
      this.issueSearchQuery = "";
      this.issueDeletions = new Set();
      this.deliverySelection = new Set();
      this.deliverySelectionTouched = false;
      this.importCandidate = null;
      this.designFile = null;
      this.currentCompare = null;
      this.currentMeasurement = null;
      this.measurementTarget = null;
      this.previewState = null;
      this.previewStates = new Map();
      this.previewHistory = new Map();
      this.previewTargets = new Set();
      this.previewCandidateList = [];
      this.uiEditorAdvanced = false;
      this.modeToolbarDrag = null;
      this.modeToolbarSuppressClickUntil = 0;
      this.lastMeasurement = null;
      this.lastMeasurementSource = null;
      this.lastMeasurementTarget = null;
      this.lastSelectionAt = 0;
      this.lastSelectionTarget = null;
      this.selectionLocked = false;
      this.composer = null;
      this.composerOpening = false;
      this.captureEpoch = 0;
      this.captureTargets = new Map();
      this.toggleEpoch = 0;
      this.sessionAction = null;
      this.panelDrag = null;
      this.uiEditorDrag = null;
      this.toastTimer = null;
      this.routeWatchTimer = null;
      this.lastRoute = this.currentRoute();
      this.pendingJumpInProgress = false;
      this.captureOverlayRestoreTimer = null;
      this.previewItems = [];
      this.previewIndex = -1;
      this.previewRequestEpoch = 0;
      this.inspectMode = "annotation";
      this.regionSelection = null;
      this.pendingRegionRect = null;
      this.regionEdit = null;
      // Hover is the default inspection path. Keeping the last element avoids
      // recomputing computed styles and Figma candidates for every pixel moved.
      this.lastHoverTarget = null;
      this.lastHoverIssue = null;
      this.lastHoverPin = null;
      this.annotationTargets = new WeakMap();

      this.installCursorStyle();
      this.host = this.createOverlay();
      this.shadow = this.host.shadowRoot;
      this.cacheElements();
      this.bindEvents();
      this.initialize();
    }

    cacheElements() {
      this.selectedBox = this.shadow.querySelector(".selected-box");
      this.hoverBox = this.shadow.querySelector(".hover-box");
      this.tooltip = this.shadow.querySelector(".tooltip");
      this.measurements = this.shadow.querySelector(".measurements");
      this.pinsLayer = this.shadow.querySelector(".pins-layer");
      this.regionBox = this.shadow.querySelector(".region-box");
      this.regionConfirm = this.shadow.querySelector(".region-confirm");
      this.recordPrompt = this.shadow.querySelector(".record-prompt");
      this.captureFeedback = this.shadow.querySelector(".capture-feedback");
      this.panel = this.shadow.querySelector(".panel");
      this.panelTitle = this.shadow.querySelector(".panel-mode");
      this.dock = this.shadow.querySelector(".review-dock");
      this.dockCount = this.shadow.querySelector(".dock-count");
      this.toast = this.shadow.querySelector(".toast");
      this.identityKind = this.shadow.querySelector(".element-kind");
      this.identityName = this.shadow.querySelector(".element-name");
      this.identityPath = this.shadow.querySelector(".element-path");
      this.identityLocation = this.shadow.querySelector(".element-location");
      this.recordButton = this.shadow.querySelector(".inspect-actions [data-action='record']");
      this.startButton = this.shadow.querySelector("[data-action='start-session']");
      this.cancelComposerButton = this.shadow.querySelector("[data-action='cancel-composer']");
      this.issueList = this.shadow.querySelector(".issue-list");
      this.clearIssuesButton = this.shadow.querySelector("[data-action='clear-issues']");
      this.issueDeletionStatus = this.shadow.querySelector(".issue-deletion-status");
      this.issueEmpty = this.shadow.querySelector(".issue-empty");
      this.issueCount = this.shadow.querySelector(".issue-count");
      this.issueSearch = this.shadow.querySelector(".issue-search-input");
      this.issueSearchClear = this.shadow.querySelector("[data-action='clear-issue-search']");
      this.deliveryCount = this.shadow.querySelector(".delivery-count");
      this.deliveryError = this.shadow.querySelector(".delivery-error");
      this.importInput = this.shadow.querySelector(".delivery-import-input");
      this.importPreview = this.shadow.querySelector(".delivery-import-preview");
      this.captureState = this.shadow.querySelector(".capture-state");
      this.compareSource = this.shadow.querySelector(".compare-source");
      this.compareBindButton = this.shadow.querySelector("[data-action='bind-design']");
      this.compareResult = this.shadow.querySelector(".compare-result");
      this.compareMatch = this.shadow.querySelector(".compare-match");
      this.compareCandidates = this.shadow.querySelector(".compare-candidates");
      this.compareDiffs = this.shadow.querySelector(".compare-diffs");
      this.previewTools = this.shadow.querySelector(".preview-tools");
      this.previewFields = this.shadow.querySelector(".preview-fields");
      this.previewStatus = this.shadow.querySelector(".preview-status");
      this.previewDelta = this.shadow.querySelector(".preview-delta");
      this.previewCandidates = this.shadow.querySelector(".preview-candidates");
      this.modeToolbar = this.shadow.querySelector(".mode-toolbar");
      this.modeIssueCount = this.shadow.querySelector(".mode-issue-count");
      this.browseState = this.shadow.querySelector("[data-role='browse-state']");
      this.uiEditor = this.shadow.querySelector(".ui-editor");
      this.uiEditorHeader = this.shadow.querySelector(".ui-editor-header");
      this.uiEditorEmpty = this.shadow.querySelector(".ui-editor-empty");
      this.uiEditorContent = this.shadow.querySelector(".ui-editor-content");
      this.uiEditorFooter = this.shadow.querySelector(".ui-editor-footer");
      // The editor heading is rendered as `.ui-editor-title`. Keeping this
      // cache selector aligned is essential: a null heading used to throw
      // before any editable field could be generated.
      this.uiEditorName = this.shadow.querySelector(".ui-editor-title");
      this.uiEditorMeta = this.shadow.querySelector(".ui-editor-meta");
      this.uiEditorMetaLabel = this.shadow.querySelector(".ui-editor-meta-label");
      this.uiEditorSections = new Map(
        Array.from(this.shadow.querySelectorAll("[data-ui-section]")).map((node) => [node.dataset.uiSection, node])
      );
      this.uiEditorTextSection = this.shadow.querySelector(".ui-editor-text-section");
      this.uiEditorAdvancedSection = this.shadow.querySelector(".ui-editor-advanced-section");
      this.uiEditorStatus = this.shadow.querySelector(".ui-editor-status");
      this.uiEditorDelta = this.shadow.querySelector(".ui-editor-delta");
      this.uiEditorCandidates = this.shadow.querySelector(".ui-editor-candidates");
      this.designBinding = this.shadow.querySelector(".design-binding");
      this.figmaUrlInput = this.shadow.querySelector(".figma-url-input");
      this.designFileInput = this.shadow.querySelector(".design-file-input");
      this.designFileName = this.shadow.querySelector(".design-file-name");
      this.designError = this.shadow.querySelector(".design-error");
      this.designSaveButton = this.shadow.querySelector("[data-action='save-design']");
      this.composerId = this.shadow.querySelector(".composer-id");
      this.composerElement = this.shadow.querySelector(".composer-element");
      this.composerCompare = this.shadow.querySelector(".composer-compare");
      this.composerDiffs = this.shadow.querySelector(".composer-diffs");
      this.preview = this.shadow.querySelector(".image-preview");
      this.previewImage = this.shadow.querySelector(".image-preview-image");
      this.previewCaption = this.shadow.querySelector(".image-preview-caption");
      this.deliveryHover = this.shadow.querySelector(".delivery-example-preview");
      this.deliveryHoverImage = this.shadow.querySelector(".delivery-example-image");
      this.deliveryHoverCaption = this.shadow.querySelector(".delivery-example-caption");
      this.previewPreviousButton = this.shadow.querySelector("[data-action='preview-previous']");
      this.previewNextButton = this.shadow.querySelector("[data-action='preview-next']");
      this.descriptionInput = this.shadow.querySelector(".description-input");
      this.resultInput = this.shadow.querySelector(".result-input");
      this.descriptionImages = this.shadow.querySelector(".description-images");
      this.descriptionImageInput = this.shadow.querySelector(".description-image-input");
      this.evidenceStrip = this.shadow.querySelector(".evidence-strip");
      this.referenceInput = this.shadow.querySelector(".reference-image-input");
      this.referenceList = this.shadow.querySelector(".result-images");
      this.composerError = this.shadow.querySelector(".composer-error");
      this.saveButton = this.shadow.querySelector("[data-action='save-issue']");
      this.views = new Map(
        Array.from(this.shadow.querySelectorAll("[data-view]")).map((node) => [node.dataset.view, node])
      );
    }

    bindEvents() {
      this.onInspectionFocusLeave = this.onInspectionFocusLeave.bind(this);
      window.addEventListener("blur", this.onInspectionFocusLeave, true);
      window.addEventListener("focusout", this.onInspectionFocusLeave, true);
      this.onToolbarPageEvent = this.onToolbarPageEvent.bind(this);
      // Intercept before document-level outside-click handlers. Re-dispatch
      // only inside our shadow root so toolbar and form handlers stay local.
      for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "focus", "focusin", "blur", "focusout", "keydown", "keypress", "keyup"]) {
        window.addEventListener(type, this.onToolbarPageEvent, { capture:true, passive:false });
      }
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
      this.onDocumentPointerUp = this.onDocumentPointerUp.bind(this);
      this.onDocumentClick = this.onDocumentClick.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onLayoutChange = this.onLayoutChange.bind(this);
      this.onWindowBlur = this.onWindowBlur.bind(this);
      this.onUiClick = this.onUiClick.bind(this);
      this.onShadowKeyDown = this.onShadowKeyDown.bind(this);
      this.onPanelPointerDown = this.onPanelPointerDown.bind(this);
      this.onPanelPointerMove = this.onPanelPointerMove.bind(this);
      this.onPanelPointerUp = this.onPanelPointerUp.bind(this);
      this.onUiEditorPointerDown = this.onUiEditorPointerDown.bind(this);
      this.onUiEditorPointerMove = this.onUiEditorPointerMove.bind(this);
      this.onUiEditorPointerUp = this.onUiEditorPointerUp.bind(this);
      this.onModeToolbarPointerDown = this.onModeToolbarPointerDown.bind(this);
      this.onModeToolbarPointerMove = this.onModeToolbarPointerMove.bind(this);
      this.onModeToolbarPointerUp = this.onModeToolbarPointerUp.bind(this);
      this.onModeButtonClick = this.onModeButtonClick.bind(this);
      this.onBookmarkMessage = this.onBookmarkMessage.bind(this);

      // Hover locates a candidate; a page click selects and locks it. Capture
      // the click so review mode never triggers the host page underneath.
      window.addEventListener("pointermove", this.onPointerMove, true);
      window.addEventListener("pointerdown", this.onDocumentPointerDown, true);
      window.addEventListener("pointerup", this.onDocumentPointerUp, true);
      window.addEventListener("pointercancel", () => this.cancelRegionGesture(), true);
      window.addEventListener("click", this.onDocumentClick, true);
      window.addEventListener("keydown", this.onKeyDown, true);
      document.addEventListener("keyup", this.onKeyUp, true);
      window.addEventListener("scroll", this.onLayoutChange, true);
      document.addEventListener("pointerout", (event) => { if (!event.relatedTarget) this.hidePinTooltip(); }, true);
      window.addEventListener("resize", this.onLayoutChange, true);
      window.addEventListener("blur", this.onWindowBlur);
      window.addEventListener("message", this.onBookmarkMessage);

      this.shadow.addEventListener("click", this.onUiClick);
      this.bindDeliveryExampleEvents();
      this.shadow.addEventListener("keydown", this.onShadowKeyDown);
      this.shadow.addEventListener("keyup", (event) => event.stopPropagation());
      this.shadow.querySelector(".panel-header").addEventListener("pointerdown", this.onPanelPointerDown);
      this.uiEditorHeader?.addEventListener("pointerdown", this.onUiEditorPointerDown);
      this.modeToolbar?.addEventListener("pointerdown", this.onModeToolbarPointerDown);
      this.modeToolbar?.addEventListener("pointermove", this.onModeToolbarPointerMove);
      this.modeToolbar?.addEventListener("pointerup", this.onModeToolbarPointerUp);
      this.modeToolbar?.addEventListener("pointercancel", this.onModeToolbarPointerUp);
      const toolbarHandle = this.modeToolbar?.querySelector(".mode-drag-handle");
      toolbarHandle?.addEventListener("dblclick", () => this.resetModeToolbarPosition());
      toolbarHandle?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "Home") {
          event.preventDefault();
          this.resetModeToolbarPosition();
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const rect = this.modeToolbar.getBoundingClientRect();
          const step = event.shiftKey ? 10 : 1;
          this.positionModeToolbar(rect.left + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), rect.top + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
        }
      });
      for (const button of this.modeToolbar?.querySelectorAll("[data-mode]") || []) {
        button.addEventListener("click", this.onModeButtonClick);
      }
      this.regionBox.addEventListener("pointerdown", (event) => this.beginRegionEdit(event));
      this.descriptionInput.addEventListener("input", () => {
        this.composerError.textContent = "";
        this.persistTabContext();
      });
      this.resultInput?.addEventListener("input", () => this.persistTabContext());
      this.descriptionInput.addEventListener("paste", (event) => this.pasteComposerImages(event, "description"));
      this.resultInput?.addEventListener("paste", (event) => this.pasteComposerImages(event, "result"));
      this.descriptionImageInput?.addEventListener("change", () => this.addReferenceImages(this.descriptionImageInput.files, "description"));
      window.addEventListener("pagehide", () => this.persistTabContext());
      this.issueSearch.addEventListener("input", () => {
        this.applyIssueSearch();
      });
      this.importInput?.addEventListener("change", () => this.prepareImport(this.importInput.files?.[0] || null));
      this.designFileInput.addEventListener("change", () => {
        this.designFile = this.designFileInput.files?.[0] || null;
        this.designFileName.textContent = this.designFile ? this.designFile.name : "未选择快照文件";
        this.designError.textContent = "";
      });
      this.referenceInput?.addEventListener("change", () => this.addReferenceImages(this.referenceInput.files));
      for (const fields of [this.previewFields, this.uiEditor]) {
        fields?.addEventListener("input", (event) => {
          if (event.isComposing) return;
          const input = event.target.closest?.("[data-preview-prop]");
          if (!input) return;
          if (input.dataset.uiNumeric) this.handleUiNumericInput(input);
          else this.applyPreviewField(input, false);
        });
        fields?.addEventListener("change", (event) => {
          const input = event.target.closest?.("[data-preview-prop]");
          if (!input) return;
          if (input.dataset.uiNumeric) this.commitUiNumericInput(input);
          else this.applyPreviewField(input, true);
        });
      }
    }

    async initialize() {
      const response = await this.sendMessage({ type: "UIDELTA_GET_STATE", origin: location.origin });
      if (response && response.ok) {
        this.session = response.activeSession || response.session || null;
        this.issues = Array.isArray(response.issues) ? response.issues : [];
        this.persistedTabState = response.tabState || null;
      }
      this.renderSessionState();
    }

    createOverlay() {
      const host = document.createElement("uidelta-review");
      host.setAttribute(ROOT_ATTRIBUTE, "true");
      host.setAttribute("translate", "no");
      host.setAttribute("lang", "zh-CN");
      host.classList.add("notranslate");
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = [
        "<style>",
        ":host{all:initial;--bg:rgba(14,15,20,.82);--bg-strong:rgba(12,13,18,.94);--surface:rgba(255,255,255,.055);--surface-hover:rgba(255,255,255,.09);--line:rgba(255,255,255,.11);--line-strong:rgba(255,255,255,.18);--text:#f4f5f8;--muted:#9da3b0;--subtle:#737a89;--primary:#7890ff;--primary-soft:rgba(120,144,255,.16);--success:#57d890;--danger:#ff7588;--warning:#ffc56a}",
        "*,*:before,*:after{box-sizing:border-box}",
        "button,input,textarea{font:inherit}",
        "button{margin:0}",
        ".box{position:fixed;display:none;pointer-events:none}",
        ".selected-box{border:1.5px solid #249cff;background:rgba(36,156,255,.08);box-shadow:0 0 0 1px rgba(255,255,255,.5) inset}",
        ".hover-box{border:1px dashed rgba(36,156,255,.95);background:rgba(36,156,255,.035)}",
        ".tooltip{position:fixed;z-index:5;display:none;max-width:min(320px,calc(100vw - 16px));padding:6px 8px;border:1px solid rgba(255,255,255,.72);border-radius:7px;background:#168cf0;box-shadow:0 5px 16px rgba(0,89,175,.3);color:#fff;font:700 12px/1.15 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}",
        ".measurements,.pins-layer{position:fixed;inset:0;pointer-events:none}.region-box{position:fixed;z-index:6;display:none;pointer-events:auto;border:1.5px solid #8d9eff;background:rgba(120,144,255,.12);box-shadow:0 0 0 1px rgba(255,255,255,.65) inset;cursor:move}.region-box.editable{display:block}.region-box:not(.editable) .region-handle,.region-box:not(.editable) .region-confirm{display:none}.region-handle{position:absolute;width:12px;height:12px;border:2px solid #fff;border-radius:50%;background:#7890ff;box-shadow:0 1px 5px rgba(0,0,0,.28)}.region-handle[data-region-handle='nw']{left:-7px;top:-7px;cursor:nwse-resize}.region-handle[data-region-handle='ne']{right:-7px;top:-7px;cursor:nesw-resize}.region-handle[data-region-handle='sw']{bottom:-7px;left:-7px;cursor:nesw-resize}.region-handle[data-region-handle='se']{right:-7px;bottom:-7px;cursor:nwse-resize}.region-confirm{position:absolute;right:0;top:calc(100% + 12px);display:inline-flex;min-height:38px;align-items:center;gap:7px;padding:0 12px;border:1px solid rgba(255,255,255,.42);border-radius:10px;background:rgba(21,23,31,.9);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.28);color:#fff;cursor:pointer;font-size:14px;font-weight:650;white-space:nowrap}.region-confirm kbd,.record-prompt kbd{padding:3px 5px;border-radius:5px;background:rgba(255,255,255,.12);color:#dce2ff;font:650 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.record-prompt{position:fixed;z-index:7;display:none;min-height:38px;align-items:center;gap:7px;padding:0 12px;border:1px solid rgba(255,255,255,.42);border-radius:10px;background:rgba(21,23,31,.9);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.28);color:#fff;cursor:pointer;font-size:14px;font-weight:650;white-space:nowrap}.record-prompt.visible{display:inline-flex}.capture-feedback{position:fixed;inset:0;z-index:8;display:none;pointer-events:none}.capture-feedback.visible{display:block}.capture-feedback-context,.capture-feedback-detail{position:fixed;border:8px solid rgba(255,255,255,.96);box-shadow:0 0 0 1px rgba(255,255,255,.48) inset,0 12px 30px rgba(0,0,0,.26)}.capture-feedback-detail{border-width:4px;border-color:rgba(149,169,255,.98);box-shadow:0 0 0 1px rgba(255,255,255,.54) inset,0 8px 22px rgba(0,0,0,.24)}",
        ".measurements{z-index:3}.pins-layer{z-index:4}",
        ".line{position:fixed;background:#ff667d;box-shadow:0 0 0 1px rgba(255,255,255,.58)}.line.ui-measurement{background:#39d8a2}.line.ui-measurement .cap{background:#39d8a2}.badge.ui-measurement{background:#263240;color:#bfffe8}",
        ".line.horizontal{height:1px}.line.vertical{width:1px}",
        ".cap{position:absolute;background:#ff667d}.horizontal .cap{top:-3px;width:1px;height:7px}.vertical .cap{left:-3px;width:7px;height:1px}.cap.end{right:0;bottom:0}",
        ".badge{position:absolute;transform:translate(-50%,-50%);padding:3px 5px;border-radius:5px;background:#ff667d;color:#3b1018;box-shadow:0 1px 3px rgba(0,0,0,.25);font:750 10px/1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}",
        ".pin{position:fixed;display:grid;width:22px;height:22px;place-items:center;border:2px solid rgba(255,255,255,.92);border-radius:50%;background:#168cf0;color:#fff;box-shadow:0 3px 10px rgba(0,83,165,.4);cursor:pointer;font:750 10px/1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;transition:transform .16s ease,box-shadow .16s ease}",
        ".pin.major{background:#e35b70;box-shadow:0 3px 10px rgba(173,37,59,.42)}.pin:hover,.pin:focus-visible{transform:scale(1.12);box-shadow:0 5px 14px rgba(0,83,165,.48);outline:none}",
        ".panel{position:fixed;z-index:10;right:16px;bottom:16px;display:none;width:min(360px,calc(100vw - 16px));max-height:min(640px,calc(100vh - 16px));overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:linear-gradient(145deg,rgba(37,39,47,.86),rgba(14,15,20,.91));-webkit-backdrop-filter:blur(32px) saturate(160%);backdrop-filter:blur(32px) saturate(160%);box-shadow:0 1px 0 rgba(255,255,255,.12) inset,0 18px 48px rgba(0,0,0,.42);color:var(--text);font:500 14px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;font-optical-sizing:auto;pointer-events:auto}",
        ".panel:before{position:absolute;inset:0;z-index:0;border-radius:inherit;background:linear-gradient(125deg,rgba(255,255,255,.05),transparent 34%);content:'';pointer-events:none}",
        ".panel.dragging{cursor:grabbing;user-select:none}",
        ".panel-header,.panel-body{position:relative;z-index:1}",
        ".panel-header{display:flex;min-height:48px;align-items:center;padding:0 8px 0 12px;border-bottom:1px solid var(--line);background:rgba(17,18,24,.58);cursor:grab;touch-action:none}",
        ".drag-grip{margin-right:8px;color:#7c8391;font-size:14px;letter-spacing:-2px}",
        ".status-dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px rgba(87,216,144,.12)}",
        ".panel.is-paused .status-dot,.review-dock.is-paused .status-dot{background:var(--warning);box-shadow:0 0 0 3px rgba(255,197,106,.12)}",
        ".brand{margin-left:8px;font-size:15px;font-weight:680;letter-spacing:-.01em}.panel-mode{margin-left:8px;color:#9097a5;font-size:12px;font-weight:560}",
        ".header-spacer{flex:1}",
        ".icon-button{display:grid;width:40px;height:40px;place-items:center;border:0;border-radius:11px;background:transparent;color:#bac0cb;cursor:pointer;font-size:17px;line-height:1;transition:transform .12s,background .16s,color .16s}",
        ".icon-button:hover,.icon-button:focus-visible{background:var(--surface-hover);color:#fff;outline:none}.icon-button.close{font-size:20px;font-weight:400}",
        ".panel-body{max-height:calc(min(640px,100vh - 16px) - 48px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}",
        ".view{display:none;padding:12px}.view.active{display:block}",
        ".start-view{padding:20px 16px 16px}",
        ".eyebrow{margin:0 0 5px;color:#9aa8ff;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
        ".start-title{margin:0;color:#fff;font-size:18px;line-height:1.25;font-weight:650;letter-spacing:-.02em}",
        ".start-copy{margin:8px 0 17px;max-width:30ch;color:var(--muted);font-size:12px;line-height:1.6}",
        ".paused-view{padding:20px 16px 16px}.paused-mark{display:grid;width:38px;height:38px;margin-bottom:14px;place-items:center;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:rgba(255,255,255,.055);color:#b8c2ff;font-size:15px}.paused-actions{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:18px}.paused-actions button{padding:0 13px}",
        ".feature-line{display:flex;align-items:center;gap:7px;margin:7px 0;color:#b7bdc8;font-size:11px}.feature-line i{width:5px;height:5px;border-radius:50%;background:#6f85ff}",
        ".primary-button,.secondary-button,.ghost-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:8px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:650;transition:transform .12s,background .16s,border-color .16s,color .16s}",
        ".primary-button{border:1px solid rgba(153,169,255,.55);background:#7187f5;color:#fff;box-shadow:0 5px 14px rgba(62,82,186,.26)}",
        ".primary-button:hover,.primary-button:focus-visible{background:#8498ff;outline:none}.primary-button:active,.secondary-button:active,.ghost-button:active{transform:scale(.97)}.primary-button.has-measurement{border-color:rgba(255,202,116,.7);background:#c58b39;box-shadow:0 5px 14px rgba(197,139,57,.28)}.primary-button.has-measurement:hover,.primary-button.has-measurement:focus-visible{background:#d19a45}",
        ".primary-button:disabled{cursor:wait;opacity:.62}.primary-button.full{width:100%;margin-top:18px}",
        ".secondary-button{border:1px solid var(--line-strong);background:var(--surface);color:#e8eaf0}.secondary-button:hover,.secondary-button:focus-visible{background:var(--surface-hover);outline:none}",
        ".ghost-button{border:0;background:transparent;color:#aeb4c0}.ghost-button:hover,.ghost-button:focus-visible{background:var(--surface);color:#fff;outline:none}.ghost-button:disabled{cursor:wait;opacity:.46}",
        ".identity{padding:1px 0 8px;border-bottom:1px solid var(--line)}",
        ".identity-row{display:flex;min-width:0;align-items:center;gap:7px}",
        ".element-kind{flex:none;color:#aebaff;font:700 12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}",
        ".element-name{min-width:0;overflow:hidden;color:#f7f8fb;font-size:15px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}",
        ".element-path{margin:7px 0 0;overflow:hidden;color:#a8aeba;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}",
        ".element-location{margin:5px 0 0;color:#8a919e;font-size:12px}",
        ".metrics{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}",
        ".metric{min-width:0;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}.metric:nth-child(odd){padding-right:10px}.metric:nth-child(even){padding-left:10px;border-left:1px solid rgba(255,255,255,.07)}.metric.wide{grid-column:1/-1;padding-left:0;padding-right:0;border-left:0}",
        ".metric-label{display:block;margin-bottom:4px;color:#9299a6;font-size:12px}.metric-value{display:block;overflow:hidden;color:#f0f2f6;font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}",
        ".metric-value.with-swatch{display:flex;align-items:center;gap:5px}.swatch{width:9px;height:9px;flex:none;border:1px solid rgba(255,255,255,.25);border-radius:3px;background:var(--swatch)}",
        ".compare-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.compare-copy{min-width:0;display:grid;gap:4px}.compare-kicker{color:#a3afff;font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.compare-source{overflow:hidden;color:#e4e7ed;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.compare-bind{flex:none;min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;font-size:13px}.compare-result{padding:13px 0;border-bottom:1px solid var(--line)}.compare-result[hidden],.design-binding[hidden]{display:none!important}.compare-match{color:#e5e8ff;font-size:14px;font-weight:650}.compare-match.is-none{color:#ffbdc8}.compare-candidates{display:grid;gap:5px;margin-top:9px}.compare-candidate{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:40px;padding:0 11px;border:0;border-radius:10px;background:transparent;color:#b0b7c3;text-align:left;cursor:pointer;font-size:13px}.compare-candidate:hover,.compare-candidate:focus-visible{background:var(--surface);color:#fff;outline:none}.compare-candidate.active{background:var(--primary-soft);color:#e2e6ff}.compare-candidate-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.compare-candidate-meta{flex:none;color:#8c93a0;font-size:11px}.compare-diffs{display:grid;gap:7px;margin-top:10px}.compare-diff{display:grid;grid-template-columns:88px 1fr;gap:9px;align-items:start;color:#bec4ce;font-size:12px;line-height:1.45}.compare-diff strong{color:#9fa6b3;font-weight:600}.compare-diff em{grid-column:2;font-style:normal;color:#ffc0ca;font-variant-numeric:tabular-nums}.compare-diff em span{color:#9ea5b2}.design-binding{padding:14px 0;border-bottom:1px solid var(--line)}.binding-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.binding-head strong{display:block;margin-top:4px;color:#f0f1f5;font-size:15px}.design-binding .field{padding:12px 0}.figma-url-input{display:block;width:100%;height:44px;border:1px solid rgba(255,255,255,.14);border-radius:11px;outline:0;background:rgba(0,0,0,.17);padding:0 12px;color:#f7f8fa;font-size:14px}.figma-url-input:focus{border-color:rgba(120,144,255,.75);box-shadow:0 0 0 3px rgba(120,144,255,.16)}.design-file-input{display:block;width:100%;color:#bdc3cd;font-size:13px}.design-file-name{display:block;margin-top:6px;overflow:hidden;color:#999faa;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.binding-hint{margin:12px 0;color:#979eaa;font-size:12px;line-height:1.55}.design-error{min-height:18px;margin:6px 0;color:#ff9cab;font-size:12px}",
        ".inspect-actions{display:grid;grid-template-columns:1fr auto;gap:8px;padding-top:10px}.inspect-actions button{padding:0 13px}",
        ".help-row{display:flex;align-items:center;justify-content:space-between;margin-top:9px;color:#9da4b0;font-size:12px}.help-row kbd{margin-right:4px;padding:3px 6px;border:1px solid rgba(255,255,255,.17);border-radius:6px;background:rgba(255,255,255,.075);color:#edf0f5;font:650 12px/1 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif}.compare-strip{gap:10px;padding:9px 0}.compare-copy{gap:2px}.compare-bind{min-height:34px;padding:0 10px}.mode-switch{gap:4px;margin-bottom:9px;padding:3px;border-radius:11px}.mode-button{min-height:34px}.mode-hint{margin:-3px 0 7px}.metric-label{margin-bottom:2px}.element-path{margin-top:4px}.element-location{margin-top:3px}.inspect-view .primary-button,.inspect-view .secondary-button{min-height:40px}.preview-tools{display:none;padding:10px 0;border-bottom:1px solid var(--line)}.preview-tools.visible{display:block}.preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.preview-title{color:#f0f2f6;font-size:14px;font-weight:650}.preview-status{color:#8f98aa;font-size:12px}.preview-fields{display:grid;grid-template-columns:1fr 1fr;gap:7px}.preview-field{display:grid;gap:4px;color:#9da4b0;font-size:11px}.preview-field input{width:100%;height:34px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(0,0,0,.18);color:#f2f4f8;padding:0 8px;font-size:13px}.preview-field input[type=color]{padding:3px}.preview-field input:focus{border-color:rgba(120,144,255,.8);outline:2px solid rgba(120,144,255,.18)}.preview-delta{display:grid;gap:3px;margin-top:8px;color:#aeb6c4;font-size:11px;line-height:1.35}.preview-delta:empty{display:none}.preview-delta strong{color:#f1b7c1;font-weight:600}.preview-actions{display:flex;gap:7px;margin-top:9px}.preview-actions button{min-height:34px;padding:0 10px;border-radius:8px;font-size:12px}.preview-candidates{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}.preview-candidates.visible{display:grid;gap:5px}.preview-candidate-list{display:grid;gap:5px;max-height:160px;overflow:auto}.preview-candidate{display:flex;align-items:center;justify-content:space-between;min-height:32px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:transparent;color:#c7ccd6;cursor:pointer;font-size:12px;text-align:left}.preview-candidate:hover{background:var(--surface-hover);color:#fff}.preview-candidate.active{border-color:rgba(120,144,255,.7);background:var(--primary-soft)}.mode-toolbar{position:fixed;z-index:12;top:16px;right:16px;display:flex;align-items:center;gap:3px;padding:4px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(20,22,29,.78);-webkit-backdrop-filter:blur(22px) saturate(150%);backdrop-filter:blur(22px) saturate(150%);box-shadow:0 10px 28px rgba(0,0,0,.2);pointer-events:auto}.mode-toolbar button{display:grid;width:38px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:#aeb5c2;cursor:pointer;font-size:16px;font-weight:700}.mode-toolbar button:hover,.mode-toolbar button:focus-visible{background:rgba(255,255,255,.1);color:#fff;outline:none}.mode-toolbar button.active{background:#7187f5;color:#fff;box-shadow:0 2px 8px rgba(75,92,190,.35)}",
        ".selected-box.ui-selected{border-color:#2fd7a0;background:rgba(47,215,160,.075);box-shadow:0 0 0 1px rgba(255,255,255,.7) inset}.mode-toolbar{z-index:14;gap:4px;padding:9px 5px 5px;cursor:grab;touch-action:none;transition:box-shadow .16s ease,transform .16s ease}.mode-toolbar:before{position:absolute;top:3px;left:50%;width:30px;height:3px;border-radius:4px;background:rgba(255,255,255,.22);content:'';transform:translateX(-50%)}.mode-toolbar:active,.mode-toolbar.dragging{cursor:grabbing;box-shadow:0 16px 34px rgba(0,0,0,.32)}.mode-toolbar button{position:relative;width:42px;height:38px;cursor:pointer}.mode-toolbar button:active{transform:scale(.95)}.mode-toolbar button.active:after{position:absolute;right:6px;bottom:5px;width:4px;height:4px;border-radius:50%;background:#fff;content:''}.ui-editor{position:fixed;z-index:11;top:76px;right:16px;display:none;width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 92px);overflow:hidden;border:1px solid rgba(255,255,255,.19);border-radius:18px;background:linear-gradient(155deg,rgba(42,44,52,.94),rgba(23,24,30,.96));-webkit-backdrop-filter:blur(30px) saturate(150%);backdrop-filter:blur(30px) saturate(150%);box-shadow:0 20px 54px rgba(0,0,0,.38);color:#f4f5f8;font:500 14px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;pointer-events:auto}.ui-editor.visible{display:block;animation:ui-editor-in .18s ease-out}.ui-editor:before{position:absolute;top:12px;left:50%;width:38px;height:4px;border-radius:8px;background:rgba(255,255,255,.21);content:'';transform:translateX(-50%)}.ui-editor-header{position:relative;display:flex;min-height:60px;align-items:center;justify-content:space-between;gap:10px;padding:19px 14px 9px;border-bottom:1px solid rgba(255,255,255,.1)}.ui-editor-heading{min-width:0}.ui-editor-title{margin:0;overflow:hidden;color:#fff;font-size:17px;font-weight:700;letter-spacing:-.015em;text-overflow:ellipsis;white-space:nowrap}.ui-editor-meta{margin:2px 0 0;overflow:hidden;color:#aab0bc;font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.ui-editor-header-actions{display:flex;align-items:center;gap:6px}.ui-editor-toggle{display:inline-flex;min-height:32px;align-items:center;gap:6px;padding:0 9px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(255,255,255,.06);color:#d9dde5;cursor:pointer;font-size:11px;font-weight:650}.ui-editor-toggle:hover,.ui-editor-toggle:focus-visible,.ui-editor-toggle.active{border-color:rgba(121,143,255,.7);background:rgba(113,135,245,.23);color:#fff;outline:none}.ui-editor-reset{display:grid;width:32px;height:32px;place-items:center;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:transparent;color:#afb6c3;cursor:pointer;font-size:16px}.ui-editor-reset:hover,.ui-editor-reset:focus-visible{background:rgba(255,255,255,.09);color:#fff;outline:none}.ui-editor-body{max-height:calc(100vh - 152px);overflow:auto;overscroll-behavior:contain;padding:12px 14px 16px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}.ui-editor-empty{padding:34px 14px 42px;color:#a8afbb;font-size:13px;line-height:1.6;text-align:center}.ui-editor-empty strong{display:block;margin-bottom:6px;color:#f3f5f8;font-size:15px}.ui-editor-content[hidden]{display:none}.ui-editor-section{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.09)}.ui-editor-section:first-child{padding-top:2px}.ui-editor-section-title{display:block;margin-bottom:8px;color:#c8ced9;font-size:13px;font-weight:700}.ui-editor-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ui-editor-field{display:grid;gap:4px;min-width:0;color:#aeb5c1;font-size:11px;font-weight:600}.ui-editor-field.wide{grid-column:1/-1}.ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea{width:100%;min-height:38px;border:1px solid rgba(255,255,255,.12);border-radius:9px;outline:0;background:rgba(255,255,255,.075);padding:0 9px;color:#f4f6f9;font-size:13px}.ui-editor-field textarea{min-height:72px;padding:9px;resize:vertical;line-height:1.45}.ui-editor-color-control{display:grid;grid-template-columns:40px minmax(0,1fr);gap:7px}.ui-editor-field input[type=color]{width:40px;padding:4px;cursor:pointer}.ui-editor-field input:focus,.ui-editor-field select:focus,.ui-editor-field textarea:focus{border-color:rgba(126,148,255,.86);box-shadow:0 0 0 3px rgba(113,135,245,.18)}.ui-editor-delta{display:grid;gap:4px;margin:10px 0 0;color:#abb3c1;font-size:11px;line-height:1.4}.ui-editor-delta:empty{display:none}.ui-editor-delta strong{color:#e6b1ba;font-weight:700}.ui-editor-candidates{display:none;gap:6px;margin-top:10px}.ui-editor-candidates.visible{display:grid}.ui-editor-candidates .preview-candidate-list{max-height:148px}.ui-editor-footer{display:grid;grid-template-columns:1fr auto;gap:8px;padding-top:12px}.ui-editor-footer .primary-button,.ui-editor-footer .secondary-button{min-height:40px}.ui-editor-footer .primary-button{padding:0 13px}.ui-editor-footer .secondary-button{padding:0 10px;font-size:12px}@keyframes ui-editor-in{from{opacity:0;transform:translate3d(10px,0,0) scale(.985)}to{opacity:1;transform:none}}",
        ".ui-editor-advanced-action{display:flex;width:100%;min-height:38px;align-items:center;justify-content:center;margin-top:12px;border:1px dashed rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.035);color:#c9d1e8;cursor:pointer;font-size:12px;font-weight:700}.ui-editor-advanced-action:hover,.ui-editor-advanced-action:focus-visible{border-color:rgba(126,148,255,.82);background:rgba(113,135,245,.14);color:#fff;outline:none}.ui-editor-advanced-section{margin-top:10px;border-top:1px solid rgba(255,255,255,.09)}.ui-editor-advanced-section[hidden]{display:none!important}",
        ".ui-editor{top:92px;right:20px;width:min(440px,calc(100vw - 40px));max-height:calc(100vh - 112px);border-color:rgba(255,255,255,.12);border-radius:19px;background:#2d2d30;-webkit-backdrop-filter:blur(20px) saturate(120%);backdrop-filter:blur(20px) saturate(120%);box-shadow:0 20px 56px rgba(0,0,0,.34);font:500 14px/1.4 -apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;pointer-events:auto}.ui-editor:before{top:10px;width:40px;background:rgba(255,255,255,.25)}.ui-editor-header{min-height:67px;padding:24px 18px 11px;border-bottom-color:rgba(255,255,255,.1)}.ui-editor-title{font-size:19px;font-weight:750;letter-spacing:-.025em}.ui-editor-meta{margin-top:3px;color:#a9abb1;font:650 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.ui-editor-header-actions{gap:7px}.ui-editor-toggle{min-height:34px;padding:0 11px;border-radius:10px;color:#ececf0;font-size:12px;font-weight:700}.ui-editor-reset{width:34px;height:34px;border-radius:10px}.ui-editor-body{max-height:calc(100vh - 190px);padding:0 18px 17px}.ui-editor-empty{padding:38px 12px 50px;color:#aeb0b7;font-size:14px}.ui-editor-empty strong{font-size:16px}.ui-editor-section{padding:16px 0;border-bottom-color:rgba(255,255,255,.105)}.ui-editor-section:first-child{padding-top:16px}.ui-editor-section-title{margin-bottom:10px;color:#f0f0f2;font-size:15px;font-weight:740;letter-spacing:-.01em}.ui-editor-fields{gap:10px}.ui-editor-field{gap:5px;color:#bcbec6;font-size:12px;font-weight:700}.ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea{min-height:42px;border:1px solid transparent;border-radius:9px;background:#444447;padding:0 11px;color:#f4f4f5;font-size:14px;font-weight:560;transition:border-color .12s ease,background .12s ease,box-shadow .12s ease}.ui-editor-field textarea{min-height:74px;padding:10px 11px}.ui-editor-field input:hover,.ui-editor-field select:hover,.ui-editor-field textarea:hover{background:#4a4a4e}.ui-editor-field input:focus,.ui-editor-field select:focus,.ui-editor-field textarea:focus{border-color:#7187ee;background:#49494d;box-shadow:0 0 0 3px rgba(113,135,238,.2)}.ui-editor-color-control{grid-template-columns:44px minmax(0,1fr);gap:8px}.ui-editor-field input[type=color]{width:44px;min-height:42px;padding:5px}.ui-editor-delta{margin:12px 0 0;padding:9px 10px;border-radius:9px;background:rgba(113,135,238,.1);color:#c6cbda;font-size:12px}.ui-editor-candidates .preview-candidate-list{max-height:130px}.ui-editor-advanced-action{min-height:42px;margin-top:16px;border-radius:10px;color:#d9ddef;font-size:13px}.ui-editor-advanced-section{margin-top:0}.ui-editor-footer{position:sticky;bottom:-17px;grid-template-columns:1fr auto;margin:0 -18px;padding:13px 18px 17px;background:linear-gradient(180deg,rgba(45,45,48,.88),#2d2d30 30%)}.ui-editor-footer .primary-button,.ui-editor-footer .secondary-button{min-height:44px;border-radius:10px;font-size:14px}.ui-editor-footer .primary-button{background:linear-gradient(135deg,#6e83ec,#586ed1);box-shadow:none}.ui-editor-footer .secondary-button{border-color:rgba(255,255,255,.17);background:#38383b;color:#eeeeef}",
        ".composer-head{padding-bottom:11px;border-bottom:1px solid var(--line)}",
        ".composer-topline{display:flex;align-items:center;justify-content:space-between;gap:10px}.composer-id{color:#b4c0ff;font:700 13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.capture-state{display:flex;min-height:36px;align-items:center;gap:6px;margin:0;padding:0 8px;border:0;border-radius:9px;background:transparent;color:#a7aeba;cursor:default;font-size:12px}.capture-state:before{width:7px;height:7px;border-radius:50%;background:var(--warning);content:''}.capture-state.ready:before{background:var(--success)}.capture-state.error{color:#ff9aa8;cursor:pointer}.capture-state.error:before{background:var(--danger)}.capture-state:focus-visible{outline:2px solid rgba(255,255,255,.36);outline-offset:2px}",
        ".composer-element{margin:7px 0 0;overflow:hidden;color:#f3f4f7;font-size:14px;font-weight:620;text-overflow:ellipsis;white-space:nowrap}.composer-compare{margin:5px 0 0;color:#9ba3b1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.composer-diffs{display:grid;gap:7px;margin-top:11px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}.composer-diffs[hidden]{display:none!important}.composer-diff{display:grid;grid-template-columns:72px 1fr;gap:7px;color:#bbc1cc;font-size:12px;line-height:1.45}.composer-diff strong{color:#9ba3b0;font-size:12px;font-weight:650}.composer-diff span{color:#ffc0ca;font-variant-numeric:tabular-nums}.composer-diff span em{color:#9da4b0;font-style:normal}",
        ".field{display:block;padding:15px 0;border-bottom:1px solid var(--line)}.field-label{display:block;margin-bottom:9px;color:#abb2be;font-size:13px;font-weight:620}",
        ".description-input{display:block;width:100%;min-height:124px;resize:vertical;border:0;border-radius:13px;outline:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.2);padding:14px;color:#fafbfc;font-size:14px;line-height:1.6}.description-input::placeholder{color:#858c98}.description-input:focus{outline:3px solid rgba(120,144,255,.3);box-shadow:0 0 0 1px rgba(134,151,255,.8) inset;background:rgba(0,0,0,.27)}",
        ".mode-switch{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:13px;padding:4px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.14)}.mode-button{min-height:38px;border:0;border-radius:8px;background:transparent;color:#aeb5c0;cursor:pointer;font-size:13px;font-weight:650}.mode-button:hover,.mode-button:focus-visible{background:var(--surface);color:#fff;outline:none}.mode-button.active{background:rgba(120,144,255,.25);color:#edf0ff;box-shadow:0 1px 2px rgba(0,0,0,.22)}.mode-hint{min-height:18px;margin:-5px 0 10px;color:#959dab;font-size:12px}.segments{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.segments[data-segments='severity'],.segments[data-segments='priority']{grid-template-columns:repeat(2,minmax(0,1fr))}.segment{min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.045);color:#c2c7d0;cursor:pointer;font-size:14px;font-weight:620}.segment:hover,.segment:focus-visible{background:var(--surface-hover);color:#fff;outline:2px solid rgba(255,255,255,.12);outline-offset:1px}.segment.active{border-color:rgba(135,153,255,.64);background:rgba(120,144,255,.2);color:#e7eaff}.segment[data-severity='crash']{color:#ff9aa9}.segment[data-severity='blocked']{color:#ffbb7b}.segment[data-severity='degraded']{color:#ffd578}.segment[data-severity='cosmetic']{color:#aeb9cc}.segment[data-severity='crash'].active{border-color:#ff7187;background:rgba(255,80,106,.18)}.segment[data-severity='blocked'].active{border-color:#ffad68;background:rgba(255,142,77,.17)}.segment[data-severity='degraded'].active{border-color:#ffd06c;background:rgba(255,194,66,.16)}",
        ".evidence-strip,.reference-list{display:flex;gap:8px;overflow:auto;padding:11px 0 1px}.evidence-strip:empty,.reference-list:empty{display:none}.evidence-thumb{position:relative;display:block;width:78px;height:52px;flex:none;overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(0,0,0,.24);padding:0;cursor:zoom-in}.evidence-thumb img{display:block;width:100%;height:100%;object-fit:cover}.evidence-thumb span{position:absolute;right:3px;bottom:3px;padding:2px 4px;border-radius:4px;background:rgba(10,12,18,.8);color:#e6ebff;font-size:10px}.description-upload{display:inline-flex;min-height:38px;align-items:center;justify-content:center;gap:7px;margin-top:10px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.055);color:#d5dced;cursor:pointer;font-size:13px;font-weight:650}.description-upload input{position:absolute;width:1px;height:1px;opacity:0}.reference-chip{position:relative;display:block;width:72px;height:52px;flex:none;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:#171922}.reference-chip img{display:block;width:100%;height:100%;object-fit:cover}.reference-chip button{position:absolute;top:2px;right:2px;display:grid;width:20px;height:20px;place-items:center;border:0;border-radius:50%;background:rgba(13,15,20,.82);color:#fff;cursor:pointer;font-size:15px;line-height:1}",
        ".composer-error{min-height:20px;margin:9px 0 0;color:#ff9cac;font-size:12px}",
        ".composer-actions{position:sticky;bottom:-16px;z-index:2;display:grid;grid-template-columns:auto 1fr;gap:10px;margin:0 -16px;padding:14px 16px 16px;background:linear-gradient(180deg,rgba(22,24,31,0),rgba(22,24,31,.98) 26%)}.composer-actions button{padding:0 18px}",
        ".inbox-toolbar{padding-bottom:14px;border-bottom:1px solid var(--line)}.inbox-title{margin:0;color:#fafbfc;font-size:20px;line-height:1.25;font-weight:680;letter-spacing:-.02em}.inbox-meta{margin:5px 0 0;color:#9ca3af;font-size:13px}.issue-count{color:#fff}",
        ".inbox-search{display:flex;height:44px;align-items:center;gap:9px;margin-top:12px;padding:0 12px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(0,0,0,.12);color:#939aa7}.issue-search:focus-within{border-color:rgba(120,144,255,.62);box-shadow:0 0 0 3px rgba(120,144,255,.12)}.issue-search-input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#f3f4f7;font-size:14px}.issue-search-input::placeholder{color:#858c98}.filter-row{display:flex;gap:6px;padding:10px 0;border-bottom:1px solid var(--line);overflow:auto}.filter{flex:none;min-height:38px;padding:0 13px;border:0;border-radius:10px;background:transparent;color:#a7aeba;cursor:pointer;font-size:13px;font-weight:600}.filter:hover,.filter:focus-visible{background:var(--surface);color:#fff;outline:none}.filter.active{background:var(--primary-soft);color:#e1e5ff}",
        ".issue-list{display:grid}.issue-row{position:relative;display:grid;grid-template-columns:70px 1fr auto;gap:8px;align-items:start;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.075);cursor:pointer}.issue-row:hover{background:linear-gradient(90deg,transparent,rgba(255,255,255,.025),transparent)}",
        ".issue-visual{position:relative;display:grid;width:68px;height:34px;grid-template-columns:1fr 1fr;gap:2px;overflow:visible;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.035);padding:2px}.issue-thumb{min-width:0;width:100%;height:28px;border-radius:5px;object-fit:cover;cursor:zoom-in;transition:filter .15s,transform .15s}.issue-thumb:hover,.issue-thumb:focus-visible{filter:brightness(1.14);transform:scale(1.04);outline:1px solid rgba(150,170,255,.85);outline-offset:1px}.issue-thumb.context{order:0}.issue-thumb.detail{order:1}.issue-index{position:absolute;right:-3px;bottom:-4px;display:grid;min-width:23px;height:15px;padding:0 3px;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:5px;background:#20232d;color:#b8c2ff;font:700 7px/1 ui-monospace,SFMono-Regular,Menlo,monospace}",
        ".issue-copy{min-width:0}.issue-title{margin:0;overflow:hidden;color:#f2f3f6;font-size:14px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.issue-meta{margin:5px 0 0;color:#9299a6;font-size:12px}.severity-major{color:#ff9eaa}.severity-minor{color:#bec3cc}",
        ".row-actions{display:flex;gap:3px}.row-action{display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:10px;background:transparent;color:#9ca3af;cursor:pointer;font-size:14px}.row-action:hover,.row-action:focus-visible{background:var(--surface-hover);color:#fff;outline:none}.row-action:active{transform:scale(.94)}.row-action.delete:hover{color:#ff9aaa}",
        ".issue-empty{display:none;padding:32px 12px;text-align:center}.issue-empty.visible{display:block}.empty-mark{display:grid;width:34px;height:34px;margin:0 auto 9px;place-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:#8997eb;font-size:16px}.issue-empty strong{display:block;color:#e8eaf0;font-size:12px}.issue-empty span{display:block;margin-top:4px;color:#7f8794;font-size:10px}",
        ".inbox-actions{position:sticky;bottom:-16px;display:grid;grid-template-columns:auto auto 1fr;gap:8px;margin:0 -16px;padding:14px 16px 16px;background:linear-gradient(180deg,rgba(18,20,27,0),rgba(18,20,27,.97) 26%)}.inbox-actions button{padding:0 14px}",
        ".issue-row{grid-template-columns:28px 70px minmax(0,1fr) auto}.issue-select{display:grid;width:18px;height:18px;align-self:center;appearance:none;border:1px solid rgba(255,255,255,.28);border-radius:6px;background:rgba(255,255,255,.04);cursor:pointer}.issue-select:checked{border-color:#8295ff;background:#7187f5;box-shadow:inset 0 0 0 4px #7187f5}.issue-select:checked:after{content:'✓';color:#fff;font-size:12px;font-weight:800;line-height:16px;text-align:center}.issue-select:focus-visible{outline:3px solid rgba(120,144,255,.3);outline-offset:2px}.delivery-intro{padding:0 0 14px;border-bottom:1px solid var(--line)}.delivery-title{margin:0;color:#f7f7f9;font-size:20px;line-height:1.25;font-weight:720;letter-spacing:-.025em}.delivery-copy{margin:6px 0 0;color:#a6abb4;font-size:13px;line-height:1.5}.delivery-selection{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:13px 0 9px}.delivery-count{color:#f0f2f7;font-size:13px;font-weight:700}.delivery-select-label{display:flex;min-height:32px;align-items:center;gap:7px;color:#b7bdc8;font-size:12px;cursor:pointer}.delivery-delete-button:not(:disabled){color:#ffbac5!important}.delivery-selection-list{display:grid;max-height:130px;gap:5px;overflow:auto;padding:2px 0 13px}.delivery-selection-item{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.035);color:#dfe2e9;font-size:12px}.delivery-selection-item strong{min-width:0;overflow:hidden;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.delivery-selection-item span{flex:none;color:#8d95a2;font:650 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.delivery-card-grid{display:grid;gap:9px;padding:5px 0 14px}.delivery-card{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:13px;border:1px solid rgba(255,255,255,.12);border-radius:13px;background:linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.025));transition:transform .16s ease,border-color .16s ease,background .16s ease}.delivery-card:hover{border-color:rgba(133,151,255,.5);background:rgba(113,135,245,.105);transform:translateY(-1px)}.delivery-card-icon{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:rgba(125,145,255,.18);color:#cbd3ff;font-size:16px}.delivery-card-copy{min-width:0}.delivery-card-copy strong{display:block;color:#f6f7fb;font-size:14px;font-weight:700}.delivery-card-copy span{display:block;margin-top:3px;color:#a1a8b5;font-size:11px;line-height:1.4}.delivery-card button{min-height:34px;padding:0 10px;border-radius:9px;font-size:12px;white-space:nowrap}.delivery-agent-actions{display:flex;gap:6px;justify-content:flex-end}.delivery-import{padding:15px 0 0;border-top:1px solid var(--line)}.delivery-section-title{margin:0;color:#ebeef4;font-size:14px;font-weight:700}.delivery-section-copy{margin:4px 0 9px;color:#979fac;font-size:12px;line-height:1.5}.delivery-import-label{display:flex;min-height:42px;align-items:center;justify-content:center;gap:8px;border:1px dashed rgba(255,255,255,.23);border-radius:11px;background:rgba(255,255,255,.03);color:#d6dbec;cursor:pointer;font-size:13px;font-weight:700}.delivery-import-label:hover,.delivery-import-label:focus-within{border-color:rgba(123,144,255,.8);background:rgba(113,135,245,.13);color:#fff}.delivery-import-input{position:absolute;width:1px;height:1px;opacity:0}.delivery-import-preview{display:grid;gap:8px;margin-top:10px;padding:11px;border:1px solid rgba(113,135,245,.38);border-radius:11px;background:rgba(113,135,245,.09)}.delivery-import-preview[hidden]{display:none!important}.delivery-import-preview strong{color:#edf0ff;font-size:13px}.delivery-import-preview span{color:#aeb7d7;font-size:12px;line-height:1.45}.delivery-import-preview .primary-button{min-height:38px}.delivery-error{min-height:18px;margin:8px 0 0;color:#ffadb9;font-size:12px;line-height:1.45}.delivery-actions{position:sticky;bottom:-16px;display:grid;grid-template-columns:auto 1fr;gap:8px;margin:0 -16px;padding:14px 16px 16px;background:linear-gradient(180deg,rgba(18,20,27,0),rgba(18,20,27,.97) 26%)}.delivery-actions button{min-height:42px}.delivery-empty{padding:16px 0;color:#9098a6;font-size:12px;text-align:center}",
        ".review-dock{position:fixed;z-index:10;right:16px;bottom:16px;display:none;min-height:40px;align-items:center;gap:7px;padding:0 11px;border:1px solid rgba(255,255,255,.17);border-radius:12px;background:linear-gradient(145deg,rgba(34,36,44,.78),rgba(9,10,14,.88));-webkit-backdrop-filter:blur(24px) saturate(135%);backdrop-filter:blur(24px) saturate(135%);box-shadow:0 1px 0 rgba(255,255,255,.1) inset,0 12px 32px rgba(0,0,0,.36);color:#eff1f5;cursor:pointer;font:650 11px/1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto}.review-dock:hover,.review-dock:focus-visible{border-color:rgba(255,255,255,.27);outline:none}.review-dock .status-dot{width:6px;height:6px}.dock-count{display:grid;min-width:20px;height:20px;place-items:center;border-radius:7px;background:var(--primary-soft);color:#bdc8ff;font-size:10px}.dock-candidates{padding-left:7px;border-left:1px solid var(--line);color:#727a89;font-size:9px;font-weight:600}",
        ".image-preview{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;pointer-events:auto}.image-preview[hidden]{display:none}.image-preview-backdrop{position:absolute;inset:0;background:rgba(3,4,8,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}.image-preview-dialog{position:relative;z-index:1;display:grid;max-width:min(92vw,980px);max-height:90vh;margin:0;padding:10px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(25,27,34,.92);box-shadow:0 24px 80px rgba(0,0,0,.55)}.image-preview-image{display:block;max-width:calc(min(92vw,980px) - 20px);max-height:calc(84vh - 20px);object-fit:contain;border-radius:8px;background:#0c0d11}.image-preview-close{position:absolute;top:-12px;right:-12px;display:grid;width:32px;height:32px;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:50%;background:#30333d;color:#fff;cursor:pointer;font-size:20px;line-height:1}.image-preview-close:hover,.image-preview-close:focus-visible{background:#4a4f5e;outline:none}.image-preview-nav{position:absolute;top:50%;z-index:2;display:grid;width:44px;height:52px;place-items:center;transform:translateY(-50%);border:1px solid rgba(255,255,255,.2);border-radius:13px;background:rgba(18,20,27,.72);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 8px 26px rgba(0,0,0,.34);color:#fff;cursor:pointer;font:400 34px/1 -apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif}.image-preview-nav.previous{left:20px}.image-preview-nav.next{right:20px}.image-preview-nav:hover,.image-preview-nav:focus-visible{background:rgba(64,69,82,.9);outline:3px solid rgba(120,144,255,.3)}.image-preview-nav[hidden]{display:none}.image-preview-caption{padding:10px 48px 2px;color:#c5cad3;font-size:13px;font-weight:600;text-align:center}.image-preview-caption kbd{margin-left:8px;color:#8f97a6;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}",
        ".toast{position:fixed;left:50%;bottom:24px;z-index:8;display:none;max-width:calc(100vw - 24px);overflow-wrap:anywhere;text-align:center;transform:translateX(-50%);padding:9px 12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(14,15,20,.92);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.34);color:#f0f2f5;font:600 11px/1.35 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none}.toast.visible{display:block;animation:toast-in .18s ease-out}",
        "@keyframes toast-in{from{opacity:0;transform:translate(-50%,5px)}to{opacity:1;transform:translate(-50%,0)}}",
        "@media(max-width:420px){.panel{left:8px!important;right:8px!important;top:auto;bottom:8px;width:auto;max-height:calc(100vh - 16px)}.review-dock{right:8px;bottom:8px}.ui-editor{top:62px;right:8px;width:calc(100vw - 16px);max-height:calc(100vh - 70px)}.mode-toolbar{top:8px;right:8px}.metrics{grid-template-columns:1fr}.metric,.metric:nth-child(odd),.metric:nth-child(even){grid-column:1;padding-left:0;padding-right:0;border-left:0}}",
        ".ui-editor-section[data-ui-section]{display:grid;gap:0}.ui-editor-field.ui-numeric-field{gap:6px}.ui-number-control{display:flex;min-height:42px;align-items:center;border:1px solid transparent;border-radius:9px;background:#444447;color:#f5f5f6;transition:border-color .14s ease,background .14s ease,box-shadow .14s ease}.ui-number-control:focus-within{border-color:#7187ee;background:#49494d;box-shadow:0 0 0 3px rgba(113,135,238,.2)}.ui-number-control input{min-width:0;flex:1;min-height:40px!important;border:0!important;outline:0!important;background:transparent!important;padding:0 4px 0 11px!important;color:#f5f5f6!important;font-variant-numeric:tabular-nums}.ui-number-control .ui-number-unit{flex:none;padding:0 11px 0 4px;color:#aeb1b8;font-size:12px;font-weight:700}.ui-opacity-control{display:grid;grid-template-columns:minmax(108px,.72fr) minmax(118px,1.28fr);align-items:center;gap:10px}.ui-opacity-range{width:100%;height:6px;appearance:none;-webkit-appearance:none;border:0!important;border-radius:999px;background:linear-gradient(90deg,#7187ee 0 var(--uidelta-range-progress,100%),#5a5a5e var(--uidelta-range-progress,100%) 100%);cursor:pointer}.ui-opacity-range::-webkit-slider-thumb{width:16px;height:16px;appearance:none;-webkit-appearance:none;border:2px solid #dfe4ff;border-radius:50%;background:#7187ee;box-shadow:0 2px 8px rgba(0,0,0,.3)}.ui-opacity-range:focus-visible{outline:3px solid rgba(113,135,238,.28);outline-offset:4px}.ui-editor-field input.is-updated{animation:ui-number-pulse .42s ease}.ui-editor-field input.is-invalid{animation:ui-number-shake .28s ease;border-color:#f08a9b!important;background:#573d44!important}.ui-number-control:has(input.is-invalid){border-color:#f08a9b;background:#573d44}@keyframes ui-number-pulse{0%{box-shadow:0 0 0 0 rgba(133,153,255,0)}45%{box-shadow:0 0 0 4px rgba(133,153,255,.28)}100%{box-shadow:0 0 0 0 rgba(133,153,255,0)}}@keyframes ui-number-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}@media(max-width:420px){.ui-opacity-control{grid-template-columns:1fr}.ui-opacity-range{margin:5px 2px}}",
        ".ui-editor{top:0!important;right:0!important;width:min(250px,calc(100vw - 12px))!important;max-height:100vh!important;border:0!important;border-left:1px solid #4a4a4d!important;border-radius:0!important;background:#2d2d2f!important;box-shadow:-14px 0 34px rgba(0,0,0,.3)!important}.ui-editor:before{display:none!important}.ui-editor-header{min-height:52px!important;padding:10px 12px!important;border-bottom-color:#4a4a4d!important}.ui-editor-title{font-size:14px!important;font-weight:700!important}.ui-editor-meta{display:none!important}.ui-editor-header-actions{gap:4px!important}.ui-editor-toggle{min-height:30px!important;max-width:60px;padding:0 7px!important;border-radius:7px!important;font-size:10px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ui-editor-reset{width:30px!important;height:30px!important;border-radius:7px!important;font-size:15px!important}.ui-editor-body{max-height:calc(100vh - 52px)!important;padding:0 12px 12px!important}.ui-editor-section{padding:22px 0!important;border-bottom-color:#4a4a4d!important}.ui-editor-section:first-child{padding-top:20px!important}.ui-editor-section-title{margin-bottom:14px!important;color:#fafafa!important;font-size:18px!important;font-weight:700!important;letter-spacing:-.015em!important}.ui-editor-group-label{display:block;margin:0 0 10px;color:#c2c2c5;font-size:12px;font-weight:650}.ui-editor-group-label.after-fields{margin-top:20px}.ui-editor-fields{gap:8px!important}.ui-editor-field{gap:6px!important;color:#c2c2c5!important;font-size:11px!important;font-weight:650!important}.ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea{min-height:40px!important;border-radius:8px!important;background:#444447!important;color:#f5f5f6!important;font-size:13px!important}.ui-editor-field textarea{min-height:66px!important}.ui-number-control{min-height:40px!important;border-radius:8px!important;background:#444447!important}.ui-number-control input{min-height:38px!important;padding-left:10px!important;font-size:13px!important}.ui-number-control .ui-number-unit{padding-right:9px!important;font-size:11px!important}.ui-opacity-control{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:8px!important}.ui-opacity-range{height:5px!important}.ui-opacity-range::-webkit-slider-thumb{width:14px!important;height:14px!important}.ui-editor-color-control{grid-template-columns:38px minmax(0,1fr)!important;gap:7px!important}.ui-editor-field input[type=color]{width:38px!important;min-height:40px!important}.ui-editor-advanced-action{min-height:38px!important;margin-top:12px!important;border-radius:8px!important;font-size:11px!important}.ui-editor-footer{bottom:-12px!important;margin:0 -12px!important;padding:12px!important;background:linear-gradient(180deg,rgba(45,45,47,.88),#2d2d2f 30%)!important}.ui-editor-footer .primary-button,.ui-editor-footer .secondary-button{min-height:38px!important;border-radius:8px!important;font-size:12px!important}.ui-editor-delta{margin:10px 0 0!important;padding:8px!important;font-size:10px!important}.ui-editor-candidates .preview-candidate-list{max-height:96px!important}.ui-editor-empty{padding:30px 4px 36px!important;font-size:12px!important}.ui-editor-empty strong{font-size:14px!important}",
        ".ui-editor{top:80px!important;right:24px!important;bottom:auto!important;left:auto!important;width:min(250px,calc(100vw - 16px))!important;height:560px!important;max-height:calc(100vh - 16px)!important;border:1px solid #4a4a4d!important;border-radius:12px!important;background:#2d2d2f!important;box-shadow:0 18px 42px rgba(0,0,0,.34)!important}.ui-editor.dragging{cursor:grabbing!important;user-select:none}.ui-editor:before{top:7px!important;display:block!important;width:32px!important;background:rgba(255,255,255,.28)!important}.ui-editor-header{min-height:52px!important;padding:10px 12px!important;border-bottom-color:#4a4a4d!important;cursor:grab!important;touch-action:none}.ui-editor-header button{cursor:pointer!important}.ui-editor-body{height:calc(560px - 52px)!important;max-height:calc(100vh - 68px)!important;padding:0 12px 12px!important}",
        ".ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea{height:28px!important;min-height:28px!important;padding:0 8px!important;font-size:12px!important}.ui-editor-field textarea{padding:5px 8px!important;resize:vertical!important}.ui-number-control{height:28px!important;min-height:28px!important}.ui-number-control input{height:26px!important;min-height:26px!important;padding-left:8px!important}.ui-number-control .ui-number-unit{padding-right:8px!important}.ui-editor-field input[type=color]{width:28px!important;height:28px!important;min-height:28px!important;padding:3px!important}.ui-editor-color-control{grid-template-columns:28px minmax(0,1fr)!important}.panel.compact-annotation{width:min(250px,calc(100vw - 16px))!important}.mode-toolbar .mode-issue-count{display:none;width:30px;height:30px;min-width:30px;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:8px;background:rgba(255,255,255,.08);color:#eef1ff;font-size:11px;font-variant-numeric:tabular-nums}.mode-toolbar.annotation-active .mode-issue-count{display:grid}.mode-toolbar .mode-issue-count:hover,.mode-toolbar .mode-issue-count:focus-visible{border-color:rgba(128,148,255,.78);background:rgba(113,135,245,.26);color:#fff}.mode-toolbar .mode-icon{display:block;width:20px;height:20px;filter:invert(1);opacity:.78;pointer-events:none}.mode-toolbar button[data-mode]:hover .mode-icon,.mode-toolbar button[data-mode]:focus-visible .mode-icon,.mode-toolbar button[data-mode].active .mode-icon{opacity:1}.mode-toolbar button[data-tooltip]::before{position:absolute;top:calc(100% + 9px);left:50%;z-index:1;visibility:hidden;min-width:max-content;padding:5px 7px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:rgba(25,27,34,.96);box-shadow:0 7px 18px rgba(0,0,0,.24);color:#f4f6fb;content:attr(data-tooltip);font-size:11px;font-weight:650;line-height:1;opacity:0;pointer-events:none;transform:translate(-50%,-3px);transition:opacity .13s ease,transform .13s ease,visibility .13s}.mode-toolbar button[data-tooltip]:hover::before,.mode-toolbar button[data-tooltip]:focus-visible::before{visibility:visible;opacity:1;transform:translate(-50%,0)}",
        ":host{--ud-canvas:#18191d;--ud-surface:#202126;--ud-elevated:#292b31;--ud-inset:#15161a;--ud-border:#3b3d45;--ud-border-strong:#52555e;--ud-text:#f4f5f7;--ud-text-secondary:#b5b8c1;--ud-text-muted:#898d98;--ud-accent:#7187f5;--ud-accent-hover:#8094ff;--ud-accent-soft:rgba(113,135,245,.18);--ud-success:#56cb8d;--ud-warning:#e6b45c;--ud-danger:#e86f81;--bg:var(--ud-canvas);--bg-strong:var(--ud-inset);--surface:var(--ud-elevated);--surface-hover:#33353d;--line:var(--ud-border);--line-strong:var(--ud-border-strong);--text:var(--ud-text);--muted:var(--ud-text-secondary);--subtle:var(--ud-text-muted);--primary:var(--ud-accent);--primary-soft:var(--ud-accent-soft);--success:var(--ud-success);--danger:var(--ud-danger);--warning:var(--ud-warning);color:var(--ud-text);font-family:Inter,'PingFang SC','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
        ".panel,.ui-editor{border:1px solid var(--ud-border)!important;background:var(--ud-surface)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 18px 44px rgba(0,0,0,.3)!important;color:var(--ud-text)!important;font-family:Inter,'PingFang SC','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important}.panel{right:24px;bottom:24px;width:min(250px,calc(100vw - 24px));height:min(560px,calc(100vh - 24px));max-height:none;border-radius:12px}.panel:before{display:none}.panel-header,.ui-editor-header{border-bottom:1px solid var(--ud-border)!important;background:var(--ud-surface)!important}.panel-header{min-height:48px;padding:0 8px 0 12px}.panel-body{height:calc(100% - 48px);max-height:none;background:var(--ud-surface);scrollbar-color:var(--ud-border-strong) transparent}.view{padding:14px}.start-view,.paused-view{padding:18px 14px}.drag-grip{color:var(--ud-text-muted)}.brand{font-size:15px;font-weight:700}.panel-mode{color:var(--ud-text-muted);font-size:11px;font-weight:600}.eyebrow,.compare-kicker{color:#aeb9ff;font-size:10px;font-weight:700;letter-spacing:.07em}.start-title,.delivery-title{font-size:18px;font-weight:700;letter-spacing:-.018em}.start-copy,.delivery-copy,.binding-hint,.delivery-section-copy{color:var(--ud-text-secondary);font-size:12px;line-height:1.55}",
        ".primary-button,.secondary-button,.ghost-button{min-height:34px;border-radius:8px;font-size:13px;font-weight:600;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .12s ease}.primary-button{border-color:rgba(150,164,255,.58);background:var(--ud-accent);box-shadow:0 4px 10px rgba(64,81,181,.24)}.primary-button:hover,.primary-button:focus-visible{background:var(--ud-accent-hover)}.secondary-button{border-color:var(--ud-border-strong);background:var(--ud-elevated);color:var(--ud-text)}.secondary-button:hover,.secondary-button:focus-visible,.ghost-button:hover,.ghost-button:focus-visible{border-color:#626672;background:#33353d;color:#fff}.ghost-button{color:var(--ud-text-secondary)}.icon-button{width:32px;height:32px;border-radius:8px;color:var(--ud-text-secondary);font-size:16px}.icon-button:hover,.icon-button:focus-visible{background:#33353d;color:#fff}.field-label,.ui-editor-field,.preview-field{color:var(--ud-text-secondary);font-size:11px;font-weight:600}.figma-url-input,.ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea,.preview-field input,.inbox-search{border-color:var(--ud-border)!important;border-radius:8px!important;background:var(--ud-elevated)!important;color:var(--ud-text)!important}.figma-url-input:focus,.ui-editor-field input:focus,.ui-editor-field select:focus,.ui-editor-field textarea:focus,.preview-field input:focus,.inbox-search:focus-within{border-color:var(--ud-accent)!important;box-shadow:0 0 0 3px rgba(113,135,245,.22)!important}.segments,.filter-row{gap:4px}.segment,.filter{min-height:28px;border-radius:7px;font-size:12px;font-weight:600}.segment.active,.filter.active{background:var(--ud-accent-soft);color:#dfe4ff}",
        ".ui-editor{top:80px!important;right:24px!important;bottom:auto!important;left:auto!important;width:min(250px,calc(100vw - 24px))!important;height:min(560px,calc(100vh - 24px))!important;max-height:none!important;border-radius:12px!important}.ui-editor-header{min-height:52px!important;padding:10px 12px!important}.ui-editor-title{font-size:15px!important;font-weight:700!important}.ui-editor-meta{display:block!important;color:var(--ud-text-muted)!important;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace!important}.ui-editor-header-actions{gap:5px!important}.ui-editor-toggle,.ui-editor-reset{min-height:28px!important;height:28px!important;border-color:var(--ud-border)!important;border-radius:7px!important;background:var(--ud-elevated)!important;color:var(--ud-text-secondary)!important}.ui-editor-toggle{padding:0 8px!important;font-size:10px!important}.ui-editor-reset{width:28px!important;font-size:14px!important}.ui-editor-body{height:calc(100% - 52px)!important;max-height:none!important;padding:0 12px 12px!important;background:var(--ud-surface)}.ui-editor-section{padding:16px 0!important;border-bottom-color:var(--ud-border)!important}.ui-editor-section:first-child{padding-top:16px!important}.ui-editor-section-title{margin-bottom:10px!important;color:var(--ud-text)!important;font-size:16px!important;font-weight:700!important}.ui-editor-group-label{margin-bottom:8px!important;color:var(--ud-text-secondary)!important;font-size:11px!important}.ui-editor-group-label.after-fields{margin-top:16px!important}.ui-editor-fields{gap:8px!important}.ui-editor-field{gap:5px!important}.ui-editor-field input,.ui-editor-field select{height:28px!important;min-height:28px!important;font-size:13px!important}.ui-editor-field textarea{min-height:72px!important;padding:7px 8px!important;font-size:13px!important;line-height:1.45!important}.ui-number-control{height:28px!important;min-height:28px!important;border-color:var(--ud-border)!important;border-radius:8px!important;background:var(--ud-elevated)!important}.ui-number-control input{height:26px!important;min-height:26px!important;color:var(--ud-text)!important;font-size:13px!important}.ui-number-control .ui-number-unit{color:var(--ud-text-muted)!important;font-size:11px!important}.ui-opacity-range{background:linear-gradient(90deg,var(--ud-accent) 0 var(--uidelta-range-progress,100%),#4a4d55 var(--uidelta-range-progress,100%) 100%)!important}.ui-opacity-range::-webkit-slider-thumb{border-color:#e6e9ff!important;background:var(--ud-accent)!important}.ui-editor-footer{margin:0 -12px!important;padding:12px!important;border-top:1px solid var(--ud-border);background:var(--ud-surface)!important}.ui-editor-footer .primary-button,.ui-editor-footer .secondary-button{min-height:34px!important;font-size:12px!important}.ui-editor-delta{border:1px solid var(--ud-border);border-radius:8px;background:var(--ud-inset);color:var(--ud-text-secondary)}.ui-editor-advanced-action{min-height:32px!important;border-color:var(--ud-border)!important;border-radius:8px!important;background:transparent!important;color:var(--ud-text-secondary)!important;font-size:12px!important}",
        ".identity{padding-bottom:12px;border-bottom-color:var(--ud-border)}.element-name{font-size:14px;font-weight:700}.element-path,.element-location{color:var(--ud-text-muted);font-size:11px}.metrics{border-bottom-color:var(--ud-border)}.metric{padding:10px 0;border-bottom-color:rgba(255,255,255,.06)}.metric-label{color:var(--ud-text-muted);font-size:11px}.metric-value{color:var(--ud-text);font-size:12px;font-weight:600}.compare-strip,.delivery-intro,.delivery-import{border-bottom-color:var(--ud-border)}.compare-source,.compare-match{color:var(--ud-text);font-size:12px}.compare-bind{min-height:30px;padding:0 9px;border-color:var(--ud-border);border-radius:7px;font-size:12px}.inspect-actions{grid-template-columns:1fr;gap:6px;padding-top:12px}.inspect-actions button{min-height:34px}.help-row{gap:8px;align-items:flex-start;color:var(--ud-text-muted);font-size:11px;line-height:1.45}.help-row kbd,.region-confirm kbd,.record-prompt kbd{border-color:var(--ud-border);background:var(--ud-elevated);color:var(--ud-text-secondary);font-size:10px}.composer-head,.evidence-strip{border-bottom-color:var(--ud-border)}.inbox-toolbar{padding:0 0 10px}.inbox-title{font-size:17px;font-weight:700}.inbox-meta,.issue-meta{color:var(--ud-text-muted);font-size:11px}.inbox-search{height:32px;padding:0 10px}.issue-row{gap:8px;padding:10px 0}.issue-title{font-size:13px;font-weight:650}.inbox-actions,.delivery-actions{grid-template-columns:1fr 1fr;gap:6px;margin:0 -14px;padding:12px 14px;background:var(--ud-surface)}.inbox-actions .primary-button,.delivery-actions .primary-button{grid-column:1/-1}.delivery-selection{gap:8px;padding:12px 0}.delivery-card-grid{gap:8px}.delivery-card{grid-template-columns:30px minmax(0,1fr);gap:9px;padding:10px;border-color:var(--ud-border);border-radius:10px;background:var(--ud-elevated)}.delivery-card:hover{border-color:#5d6bc1;background:#2d303a;transform:none}.delivery-card-icon{width:30px;height:30px;border-radius:8px;background:var(--ud-accent-soft);color:#d8dfff}.delivery-card-copy strong{font-size:13px}.delivery-card-copy span{font-size:11px;line-height:1.45}.delivery-card>button,.delivery-agent-actions{grid-column:1/-1}.delivery-card>button,.delivery-agent-actions button{width:100%;min-height:32px}.delivery-agent-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.delivery-import-label{min-height:34px;border-color:var(--ud-border);border-radius:8px;background:var(--ud-elevated);font-size:12px}.delivery-selection-list{max-height:118px}.delivery-selection-item{border-color:var(--ud-border);border-radius:8px;background:var(--ud-elevated);font-size:11px}.review-dock{right:24px;bottom:24px;min-height:34px;border-color:var(--ud-border);border-radius:9px;background:var(--ud-surface);box-shadow:0 10px 24px rgba(0,0,0,.24);font-size:11px}",
        ".mode-toolbar{top:16px;right:16px;gap:4px;padding:8px 5px 5px;border-color:var(--ud-border);border-radius:12px;background:var(--ud-surface);box-shadow:0 10px 24px rgba(0,0,0,.22)}.mode-toolbar button{width:34px;height:34px;border-radius:8px}.mode-toolbar .mode-icon{width:18px;height:18px}.mode-toolbar .mode-issue-count{width:26px;min-width:26px;height:26px;border-color:var(--ud-border);border-radius:7px;background:var(--ud-elevated);font-size:10px}.mode-toolbar button.active{background:var(--ud-accent);box-shadow:none}.mode-toolbar button[data-tooltip]::before{border-color:var(--ud-border);border-radius:7px;background:var(--ud-elevated);box-shadow:0 8px 18px rgba(0,0,0,.26);font-size:11px}.tooltip{border-color:#9aaaff;border-radius:7px;background:var(--ud-accent);box-shadow:0 6px 16px rgba(64,81,181,.25);font-size:11px}.region-confirm,.record-prompt{min-height:34px;border-color:var(--ud-border);border-radius:8px;background:var(--ud-elevated);box-shadow:0 8px 18px rgba(0,0,0,.22);font-size:12px}.toast{bottom:18px;border-color:var(--ud-border);border-radius:8px;background:var(--ud-elevated);box-shadow:0 10px 24px rgba(0,0,0,.24);font-size:12px}.image-preview-dialog{border-color:var(--ud-border);border-radius:12px;background:var(--ud-surface)}",
        "@media(max-width:480px){.panel,.ui-editor{left:12px!important;right:12px!important;width:auto!important;height:calc(100vh - 24px)!important;max-height:none!important}.panel{top:12px!important;bottom:auto!important}.ui-editor{top:12px!important;bottom:auto!important}.mode-toolbar{top:8px;right:8px}.ui-editor-fields{grid-template-columns:1fr!important}.ui-editor-field.wide{grid-column:1!important}.ui-opacity-control{grid-template-columns:1fr!important}.paused-actions,.delivery-actions,.inbox-actions{grid-template-columns:1fr}.delivery-agent-actions{grid-template-columns:1fr}.delivery-card>button,.delivery-agent-actions,.inbox-actions .primary-button,.delivery-actions .primary-button{grid-column:1!important}}",
        "@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}",
        this.editorPolishStyles(),
        this.inboxCardStyles(),
        this.layerPropertiesStyles(),
        this.reviewWorkflowStyles(),
        this.compactSurfaceStyles(),
        this.brandThemeStyles(),
        "</style>",
        this.modeToolbarMarkup(),
        "<div class='box selected-box'></div>",
        "<div class='box hover-box'></div>",
        "<div class='tooltip'></div>",
        "<div class='measurements'></div>",
        "<div class='pins-layer'></div>",
        "<div class='region-box'><i class='region-handle' data-region-handle='nw'></i><i class='region-handle' data-region-handle='ne'></i><i class='region-handle' data-region-handle='sw'></i><i class='region-handle' data-region-handle='se'></i><button class='region-confirm' data-action='record-region'>记录 <kbd>R</kbd></button></div><button class='record-prompt' data-action='record'>＋ 记录 <kbd>R</kbd></button><div class='capture-feedback'><i class='capture-feedback-context'></i><i class='capture-feedback-detail'></i></div>",
        "<aside class='ui-editor' aria-label='UIDelta UI 本地试改'><header class='ui-editor-header'><div class='ui-editor-heading'><h2 class='ui-editor-title'>选择页面元素</h2><p class='ui-editor-meta'><span class='ui-editor-meta-label'>UI 模式</span> · <span class='ui-editor-status'>本地预览</span></p></div><div class='ui-editor-header-actions'><button class='ui-editor-toggle' data-action='preview-same-type' aria-pressed='false'>同类元素</button><button class='ui-editor-reset' data-action='reset-preview' aria-label='撤销本地试改' title='撤销本地试改'>↶</button></div></header><div class='ui-editor-body'><div class='ui-editor-empty'><strong>悬停页面元素</strong>右侧会显示可编辑属性；所有修改仅在当前页面预览，可随时撤销。</div><div class='ui-editor-content' hidden><section class='ui-editor-section ui-editor-layout-section'><span class='ui-editor-section-title'>布局</span><span class='ui-editor-group-label'>尺寸</span><div class='ui-editor-fields' data-ui-section='dimensions'></div><span class='ui-editor-group-label after-fields'>对齐与间距</span><div class='ui-editor-fields' data-ui-section='layout'></div></section><section class='ui-editor-section ui-editor-spacing-section' aria-label='间距与内边距'><span class='ui-editor-section-title'>间距与内边距</span><div class='ui-editor-fields' data-ui-section='spacing'></div></section><section class='ui-editor-section'><span class='ui-editor-section-title'>外观</span><div class='ui-editor-fields' data-ui-section='appearance'></div></section><section class='ui-editor-section'><span class='ui-editor-section-title'>文字</span><div class='ui-editor-fields' data-ui-section='typography'></div></section><section class='ui-editor-section'><span class='ui-editor-section-title'>填充</span><div class='ui-editor-fields' data-ui-section='fill'></div></section><section class='ui-editor-section'><span class='ui-editor-section-title'>边框</span><div class='ui-editor-fields' data-ui-section='stroke'></div></section><section class='ui-editor-section ui-editor-text-section' hidden><span class='ui-editor-section-title'>文本内容</span><div class='ui-editor-fields' data-ui-section='text'></div></section><button class='ui-editor-advanced-action' data-action='toggle-preview-properties'>＋ 显示高级属性</button><section class='ui-editor-section ui-editor-advanced-section' hidden><span class='ui-editor-section-title'>高级属性</span><div class='ui-editor-fields' data-ui-section='advanced'></div></section><div class='ui-editor-delta'></div><div class='ui-editor-candidates'></div><div class='ui-editor-footer'><button class='secondary-button' data-action='reset-preview'>撤销预览</button><button class='primary-button' data-action='record' disabled>加入走查</button></div></div></div></aside>",
        "<aside class='panel' aria-label='UIDelta 走查工具'>",
        "  <header class='panel-header'>",
        "    <span class='drag-grip' aria-hidden='true'>⋮⋮</span><span class='status-dot'></span><strong class='brand'>UIDelta</strong><span class='panel-mode'>Record</span><span class='header-spacer'></span>",
        "    <button class='icon-button' data-action='copy' aria-label='复制当前元素信息' title='复制当前元素信息'>⧉</button>",
        "    <button class='icon-button close' data-action='close' aria-label='收起面板，浏览页面' title='收起，浏览页面'>×</button>",
        "  </header>",
        "  <div class='panel-body'>",
        "    <section class='view start-view' data-view='start'>",
        "      <p class='eyebrow'>走查会话</p><h2 class='start-title'>在页面中记录问题</h2>",
        "      <p class='start-copy'>UIDelta 会自动保存当前页面、元素位置、样式与两张截图。你只需要写一句问题描述。</p>",
        "      <div class='feature-line'><i></i><span>页面上下文与元素定位</span></div><div class='feature-line'><i></i><span>全局图与局部细节图</span></div><div class='feature-line'><i></i><span>结束后统一导出证据包</span></div>",
        "      <button class='primary-button full' data-action='start-session'>开始本次走查</button>",
        "    </section>",
        "    <section class='view paused-view' data-view='paused'>",
        "      <span class='paused-mark' aria-hidden='true'>Ⅱ</span><p class='eyebrow'>走查已暂停</p><h2 class='start-title'>本次走查已暂停。</h2>",
        "      <p class='start-copy'>已记录的问题与截图都保存在本地。继续后即可恢复元素选择、测距与快速记录。</p>",
        "      <div class='paused-actions'><button class='primary-button' data-action='resume-session'>继续走查</button><button class='secondary-button' data-action='open-inbox'>查看问题</button></div>",
        "    </section>",
        "    <section class='view inspect-view' data-view='inspect'>",
        "      <div class='inspect-scroll'>",
        "      <p class='mode-hint'>点击元素后固定，按 R 记录。</p>",
        "      <section class='identity'><div class='identity-row'><span class='element-kind'>—</span><span class='element-name'>点击选择元素</span></div><p class='element-path'>未选择元素</p><p class='element-location'>页面位置 —</p></section>",
        this.layerPropertiesMarkup(),
        "      <section class='compare-strip' aria-label='Figma Compare'><div class='compare-copy'><span class='compare-kicker'>COMPARE</span><span class='compare-source'>未绑定设计</span></div><button class='ghost-button compare-bind' data-action='bind-design'>绑定设计</button></section>",
        "      <section class='compare-result' hidden><div class='compare-match'></div><div class='compare-candidates'></div><div class='compare-diffs'></div></section>",
        "      <section class='design-binding' hidden><div class='binding-head'><div><span class='compare-kicker'>DESIGN SOURCE</span><strong>绑定 Figma Frame</strong></div><button class='icon-button' data-action='close-design-binding' aria-label='关闭设计绑定'>×</button></div><label class='field'><span class='field-label'>Figma Frame URL</span><input class='figma-url-input' type='url' placeholder='https://www.figma.com/design/...'></label><label class='field file-field'><span class='field-label'>Design Snapshot JSON</span><input class='design-file-input' type='file' accept='.json,application/json'><span class='design-file-name'>未选择快照文件</span></label><p class='binding-hint'>从 Figma 导出的 JSON 会在本地规范化并缓存；只绑定链接也可以稍后补充快照。</p><p class='design-error' role='alert'></p><div class='composer-actions'><button class='ghost-button' data-action='clear-design'>解除绑定</button><button class='primary-button' data-action='save-design'>保存设计源</button></div></section>",
        "      </div><footer class='inspect-footer'><div class='inspect-actions'><button class='primary-button' data-action='record' disabled><svg class='record-plus' viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' aria-hidden='true' focusable='false'><path d='M12 5v14M5 12h14'/></svg><span class='record-label'>记录问题</span></button><button class='secondary-button' data-action='open-inbox' aria-label='打开问题列表'>问题 <span class='inline-count'>0</span></button></div>",
        "      <div class='help-row'><span><kbd>R</kbd>记录</span><span><kbd>Esc</kbd>收起</span></div>",
        "      </footer>",
        "    </section>",
        "    <section class='view composer-view' data-view='composer'>",
        "      <div class='composer-scroll'>",
        "      <div class='composer-head'><div class='composer-topline'><span class='composer-id'>UI-001</span><button class='capture-state' data-action='retry-capture' type='button' disabled>正在保存证据</button></div><p class='composer-element'>未选择元素</p><p class='composer-compare'>未绑定设计</p><div class='composer-diffs' hidden></div></div>",
        "      <div class='evidence-strip' aria-label='已截取证据'></div><div class='field'><span class='field-label' id='uidelta-description-label'>问题描述</span><div class='rich-input'><textarea class='description-input' aria-labelledby='uidelta-description-label' aria-describedby='uidelta-composer-error' placeholder='描述发现的问题，也可粘贴图片'></textarea><div class='reference-list description-images'></div><label class='description-upload'>添加图片<input class='description-image-input' type='file' accept='image/*' multiple></label></div></div>",
        "      <div class='field'><span class='field-label' id='uidelta-result-label'>结果参考</span><div class='rich-input'><textarea class='description-input result-input' aria-labelledby='uidelta-result-label' placeholder='描述期望效果，也可粘贴参考图'></textarea><div class='reference-list result-images'></div><label class='description-upload'>添加图片<input class='reference-image-input' type='file' accept='image/*' multiple></label></div></div>",
        this.composerChoicesMarkup(),
        "      <p class='composer-error' id='uidelta-composer-error' role='alert'></p></div><div class='composer-actions'><button class='ghost-button' data-action='cancel-composer'>返回走查</button><button class='primary-button' data-action='save-issue'>保存并继续</button></div>",
        "    </section>",
        "    <section class='view inbox-view' data-view='inbox'>",
        "      <div class='inbox-head'>",
        "      <div class='inbox-toolbar'><div class='inbox-heading'><h2 class='inbox-title'>本次走查</h2><button type='button' class='ghost-button clear-issues' data-action='clear-issues' title='清空本次走查的全部问题与截图，不受筛选影响' aria-label='清空本次走查的全部问题与截图'>清空</button></div><p class='inbox-meta'><span class='issue-count'>0</span> 个已记录问题</p></div>",
        "      <p class='issue-deletion-status' role='status' aria-live='polite' aria-atomic='true'></p>",
        "      <div class='inbox-search' role='search'><svg class='search-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' aria-hidden='true'><circle cx='10.75' cy='10.75' r='6.75'/><path d='m16 16 4.5 4.5'/></svg><input class='issue-search-input' type='search' placeholder='搜索问题' aria-label='搜索描述、编号、页面或元素' autocomplete='off' spellcheck='false'><button type='button' class='search-clear' data-action='clear-issue-search' aria-label='清除搜索' title='清除搜索' hidden><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' aria-hidden='true'><path d='m7 7 10 10M17 7 7 17'/></svg></button></div>",
        "      <div class='filter-row' aria-label='筛选问题'><button class='filter active' data-filter='all' aria-pressed='true'>全部</button><button class='filter' data-filter='page' aria-pressed='false'>本页</button><button class='filter' data-filter='ui' aria-pressed='false'>UI</button><button class='filter' data-filter='functional' aria-pressed='false'>功能</button><button class='filter' data-filter='content' aria-pressed='false'>文案</button></div>",
        "      </div><div class='inbox-scroll'><div class='issue-list'></div><div class='issue-empty'><span class='empty-mark' aria-hidden='true'>◎</span><strong>还没有问题</strong><span class='empty-hint'>选中元素后按 R 记录。</span></div></div>",
        "      <div class='inbox-actions'><button class='secondary-button' data-action='back-inspect'>返回检查</button><button class='ghost-button' data-action='end-session'>结束走查</button><button class='primary-button' data-action='open-deliver'>交付…</button></div>",
        "    </section>",
        "    <section class='view deliver-view' data-view='deliver'>",
        "      <div class='delivery-scroll'>",
        "      <div class='delivery-intro'><h2 class='delivery-title'>交付本次走查</h2><p class='delivery-copy'>同一份证据按接收者交付：协作报告、排期表或可直接交给 Codex 的证据包。</p></div>",
        "      <p class='delivery-count' role='status'>导出本次全部问题</p>",
        this.deliveryCardsMarkup(),
        "      <section class='delivery-import'><h3 class='delivery-section-title'>安全导入 UIDelta 交付包</h3><p class='delivery-section-copy'>只接受 UIDelta JSON 或未压缩的 UIDelta ZIP；先预览、去重，再确认导入。HTML 和 XLSX 为单向交付文件。</p><label class='delivery-import-label'>＋ 选择 UIDelta JSON / ZIP<input class='delivery-import-input' type='file' accept='.json,.zip,application/json,application/zip'></label><p class='delivery-error' role='alert'></p><div class='delivery-import-preview' hidden></div></section>",
        "      </div><footer class='delivery-actions'><button class='secondary-button' data-action='back-inbox'>返回清单</button><button class='primary-button' data-action='deliver-zip'>导出 ZIP</button></footer>",
        "    </section>",
        "  </div>",
        "</aside>",
        "<button class='review-dock' data-action='restore-panel' aria-label='打开本次走查'><span class='status-dot'></span><span>已记录</span><span class='dock-count'>0</span><span class='dock-candidates'>候选 0</span></button>",
        "<div class='toast' role='status' aria-live='polite'></div>",
        "<div class='delivery-example-preview' id='uidelta-delivery-example' role='tooltip' hidden><img class='delivery-example-image' alt='' hidden><span class='delivery-example-caption'></span></div>",
        "<div class='image-preview' hidden><div class='image-preview-backdrop' data-action='close-preview'></div><figure class='image-preview-dialog' role='dialog' aria-modal='true' aria-label='截图预览'><button class='image-preview-close' data-action='close-preview' aria-label='关闭预览'>×</button><button class='image-preview-nav previous' data-action='preview-previous' aria-label='查看上一张截图'>‹</button><img class='image-preview-image' alt='截图预览'><button class='image-preview-nav next' data-action='preview-next' aria-label='查看下一张截图'>›</button><figcaption class='image-preview-caption'></figcaption></figure></div>"
      ].join("");
      this.localizeOverlay(shadow);
      document.documentElement.appendChild(host);
      return host;
    }

    compactSurfaceStyles() {
      return `
        :host { --ud-button-height:28px; --ud-button-font:12px; }
        :is(.panel,.ui-editor) button:is(.primary-button,.secondary-button,.ghost-button,.compare-bind),
        .panel .row-action,.panel .description-upload,.panel .delivery-import-label,.record-prompt,.region-confirm {
          height:var(--ud-button-height)!important; min-height:var(--ud-button-height)!important;
          padding:0 8px!important; gap:5px; font-size:var(--ud-button-font)!important; line-height:1.2; font-weight:500;
        }
        .panel .icon-button,.ui-editor .icon-button { width:28px; height:28px; min-height:28px; padding:5px; }
        .panel button:is(.segment,.filter) { min-height:28px!important; height:28px!important; padding:0 6px!important; font-size:11px!important; }
        .panel-header { height:48px; min-height:48px; }
        .panel:has(:is(.inspect-view,.deliver-view).active) .panel-body { height:calc(100% - 48px); max-height:none; overflow:hidden; }
        :is(.inspect-view,.deliver-view).active { display:flex; flex-direction:column; height:100%; min-height:0; padding:0; }
        .inspect-scroll,.delivery-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:12px 14px; scrollbar-width:thin; }
        .inspect-footer,.deliver-view>.delivery-actions { flex:none; position:static; margin:0; padding:10px 14px; border-top:1px solid var(--ud-border); background:var(--ud-surface); }
        .inspect-footer .inspect-actions { padding:0; grid-template-columns:minmax(0,1fr) auto; gap:6px; }
        .inspect-actions [data-action='record'] { display:inline-flex; align-items:center; justify-content:center; gap:6px; }
        .record-plus { display:block; width:14px; height:14px; flex:none; pointer-events:none; }
        .inspect-footer .help-row { margin:7px 0 0; padding:0; font-size:10px; }
        .inspect-footer kbd { font-size:9px; padding:1px 3px; }
        .deliver-view>.delivery-actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
        .deliver-view>.delivery-actions>.primary-button { grid-column:auto; }
        .delivery-card .delivery-card-actions { display:grid; grid-template-columns:1fr 1fr; grid-column:1/-1; gap:6px; }
        .delivery-card .delivery-agent-actions { grid-column:1/-1; }
        .delivery-card .delivery-example { grid-column:1/-1; justify-self:start; color:var(--ud-accent-text); }
        .delivery-card-actions .delivery-example { grid-column:auto; justify-self:stretch; }
        .delivery-example-preview { position:fixed; z-index:19; width:min(300px,calc(100vw - 24px)); max-height:calc(100vh - 24px); margin:0; padding:6px; border:1px solid var(--ud-border-strong); border-radius:var(--ud-panel-radius); background:var(--ud-surface); color:var(--ud-text-secondary); box-shadow:var(--ud-shadow); pointer-events:auto; }
        .delivery-example-preview[hidden],.delivery-example-image[hidden] { display:none!important; }
        .delivery-example-image { display:block; width:100%; max-height:min(60vh,220px); object-fit:contain; border-radius:4px; }
        .delivery-example-caption { display:block; padding:6px 2px 0; font:400 11px/1.4 var(--ud-font); }
        .delivery-card-grid { padding-bottom:12px; }
      `;
    }

    brandThemeStyles() {
      // Reference palette: orange mark + charcoal/olive editor. Keep this last
      // so all existing views share one theme without changing their behavior.
      // Measured page colors and success/warning/error semantics stay intact.
      return `
        :host {
          color-scheme:dark;
          --ud-canvas:#1b1d1c; --ud-surface:#222423; --ud-elevated:#2e312c; --ud-inset:#1b1d1c;
          --ud-hover:#393c35; --ud-selected:#3d4237; --ud-border:#3a3e35; --ud-border-strong:#606958;
          --ud-text:#f2f3ed; --ud-text-secondary:#c1c6b8; --ud-text-muted:#adb5a2;
          --ud-accent:#f2603d; --ud-accent-hover:#ff7957; --ud-accent-soft:rgba(242,96,61,.14);
          --ud-on-accent:#1b1d1c; --ud-accent-text:#ff9b80; --ud-focus:#ff9b80;
          --ud-focus-soft:rgba(242,96,61,.24); --ud-radius:4px; --ud-panel-radius:8px;
          --ud-shadow:0 6px 22px rgba(0,0,0,.22); --surface-hover:var(--ud-hover);
        }
        .panel,.ui-editor,.image-preview-dialog { border-radius:var(--ud-panel-radius)!important; box-shadow:var(--ud-shadow)!important; -webkit-backdrop-filter:none; backdrop-filter:none; }
        .panel-header,.ui-editor-header { background:var(--ud-surface)!important; }
        .panel-mode,.ui-editor-title,.start-title,.delivery-title,.inbox-title { font-weight:600!important; letter-spacing:0; }
        .start-title,.delivery-title,.inbox-title { font-size:16px; }
        .ui-editor-section-title,.layer-properties-title { font-size:12px!important; font-weight:500!important; color:var(--ud-text-secondary)!important; }
        .ui-editor-section,.ui-editor-section:first-child { padding:10px 0!important; }
        .eyebrow,.compare-kicker,.element-kind,.composer-id,.preview-status,.delivery-card-icon,.paused-mark { color:var(--ud-accent-text); }
        .element-name,.composer-element,.preview-title,.binding-head strong,.composer-diff,.preview-candidate,.compare-candidate { color:var(--ud-text); }
        .element-path,.element-location,.composer-compare,.compare-candidate-meta,.capture-state,.ui-editor-empty,.ui-editor-empty strong,.design-file-name,.design-file-input { color:var(--ud-text-muted); }
        .primary-button,.ui-editor-footer .primary-button,.primary-button.has-measurement { background:var(--ud-accent)!important; border-color:var(--ud-accent)!important; color:var(--ud-on-accent)!important; box-shadow:none!important; }
        .primary-button:hover,.primary-button:focus-visible,.ui-editor-footer .primary-button:hover,.ui-editor-footer .primary-button:focus-visible { background:var(--ud-accent-hover)!important; border-color:var(--ud-accent-hover)!important; }
        .primary-button,.secondary-button,.ghost-button,.compare-bind,.region-confirm,.record-prompt,.composer-view>.composer-actions button,.ui-editor-footer button { border-radius:var(--ud-radius)!important; }
        .primary-button,.secondary-button,.ghost-button { font-size:12px; font-weight:500; }
        .secondary-button,.compare-bind,.description-upload,.delivery-import-label { border-color:var(--ud-border); background:var(--ud-elevated); color:var(--ud-text-secondary); box-shadow:none; }
        .secondary-button:hover,.ghost-button:hover,.icon-button:hover,.compare-bind:hover,.description-upload:hover,.row-action:hover { background:var(--ud-hover); border-color:var(--ud-border-strong); color:var(--ud-text); }
        button:focus-visible,.description-upload:focus-within,.issue-select:focus-visible { outline:2px solid var(--ud-focus)!important; outline-offset:2px; }
        .icon-button,.ui-editor-toggle,.ui-editor-reset,.ui-editor-advanced-action { border-radius:var(--ud-radius)!important; }
        .figma-url-input,.description-input,.ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea,.preview-field input,.inbox-search,.ui-number-control { border-color:var(--ud-border)!important; border-radius:var(--ud-radius)!important; background:var(--ud-elevated)!important; color:var(--ud-text)!important; box-shadow:none; }
        .description-input:focus,.figma-url-input:focus,.ui-editor-field input:focus,.ui-editor-field select:focus,.ui-editor-field textarea:focus,.preview-field input:focus,.inbox-search:focus-within { border-color:var(--ud-focus)!important; outline:0; box-shadow:0 0 0 2px var(--ud-focus-soft)!important; }
        .ui-number-control:focus-within { border-color:var(--ud-focus)!important; outline-color:var(--ud-focus); }
        .ui-editor-field .ui-number-control input,.ui-editor-field .ui-number-control input:focus { background:transparent!important; box-shadow:none!important; }
        .description-input::placeholder,.ui-editor-field input::placeholder { color:var(--ud-text-muted); }
        .ui-color-swatch,.ui-editor-delta { border-radius:var(--ud-radius)!important; }
        .ui-color-swatch { background:repeating-conic-gradient(var(--ud-border-strong) 0% 25%,var(--ud-elevated) 0% 50%) 50%/8px 8px; }
        .ui-editor-field input[type='range'].ui-opacity-range { background:transparent!important; border-radius:0!important; box-shadow:none!important; }
        .ui-opacity-range::-webkit-slider-runnable-track { background:linear-gradient(90deg,var(--ud-accent) 0 var(--uidelta-range-progress,100%),var(--ud-border-strong) var(--uidelta-range-progress,100%) 100%); }
        .ui-opacity-range::-webkit-slider-thumb { border-color:var(--ud-text)!important; background:var(--ud-accent)!important; }
        .mode-toolbar { border-color:var(--ud-border); border-radius:var(--ud-panel-radius); background:var(--ud-inset); box-shadow:var(--ud-shadow); -webkit-backdrop-filter:none; backdrop-filter:none; }
        .mode-toolbar button,.mode-toolbar .mode-issue-count { border-radius:var(--ud-radius); color:var(--ud-text-secondary); }
        .mode-toolbar button:hover,.mode-toolbar button:focus-visible,.mode-toolbar .mode-issue-count:hover,.mode-toolbar .mode-issue-count:focus-visible { background:var(--ud-hover); color:var(--ud-text); border-color:var(--ud-border-strong); }
        .mode-toolbar button.active { background:var(--ud-selected); color:var(--ud-text); box-shadow:inset 0 -2px var(--ud-accent); }
        .mode-toolbar .mode-drag-handle::after { background:var(--ud-border-strong); }
        .mode-toolbar button[data-tooltip]::before { border-color:var(--ud-border-strong); border-radius:var(--ud-radius); background:var(--ud-inset); color:var(--ud-text); box-shadow:var(--ud-shadow); }
        .mode-switch,.filter-row { border-radius:var(--ud-radius); background:var(--ud-inset); }
        .segment,.filter,.composer-choice .segment { border-color:var(--ud-border); border-radius:var(--ud-radius); background:var(--ud-elevated); color:var(--ud-text-secondary); }
        .segment.active,.filter.active,.composer-choice .segment.active,.preview-candidate.active,.compare-candidate.active,.ui-editor-toggle.active { border-color:var(--ud-accent)!important; background:var(--ud-accent-soft)!important; color:var(--ud-text)!important; }
        .segment:hover,.filter:hover,.composer-choice .segment:hover { background:var(--ud-hover); color:var(--ud-text); }
        .issue-select { border-color:var(--ud-border-strong); background:var(--ud-inset); }
        .issue-select:checked { border-color:var(--ud-accent); background:var(--ud-accent); color:var(--ud-on-accent); box-shadow:none; }
        .issue-select:checked:after { color:var(--ud-on-accent); }
        .delivery-selection-item input,.delivery-select-all input { accent-color:var(--ud-accent); }
        .inbox-view .issue-row,.delivery-card,.delivery-selection-item,.delivery-import-label { border-radius:var(--ud-radius); box-shadow:none; }
        .delivery-card:hover { background:var(--ud-hover); border-color:var(--ud-border-strong); }
        .delivery-card-icon { border-radius:var(--ud-radius); background:var(--ud-accent-soft); }
        .evidence-thumb,.composer-view .evidence-thumb,.inbox-view .issue-shot,.review-dock,.toast { border-radius:var(--ud-radius); }
        .toast,.review-dock { background:var(--ud-surface); color:var(--ud-text); box-shadow:var(--ud-shadow); }
        .record-prompt,.region-confirm { background:var(--ud-elevated); color:var(--ud-text); box-shadow:var(--ud-shadow); -webkit-backdrop-filter:none; backdrop-filter:none; }
        .selected-box,.selected-box.ui-selected,.region-box { border-color:var(--ud-accent); background:rgba(242,96,61,.06); }
        .hover-box { border-color:var(--ud-accent); background:rgba(242,96,61,.03); }
        .region-handle,.pin:not(.major) { background:var(--ud-accent); color:var(--ud-on-accent); }
        .pin,.pin:hover { box-shadow:0 2px 6px rgba(0,0,0,.24); }
        .tooltip { border-color:#e4ac96; border-radius:var(--ud-radius); background:#fff0e8; color:#5c2a1e; box-shadow:0 3px 10px rgba(92,42,30,.14); }
        .capture-feedback-detail { border-color:var(--ud-accent); }
        .record-flight { border-color:var(--ud-accent); background:var(--ud-elevated); color:var(--ud-text); box-shadow:var(--ud-shadow); }
        .help-row kbd,.record-prompt kbd,.region-confirm kbd { border-radius:3px; }
        @keyframes ui-number-pulse { 0% { box-shadow:0 0 0 2px var(--ud-focus-soft); } 100% { box-shadow:none; } }
      `;
    }

    editorPolishStyles() {
      // Final component rules. Geometry and input states live together so
      // legacy generic input styles cannot turn a range track into a textbox.
      return `
        :host { --ud-font:Inter,'PingFang SC','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        .primary-button { background:var(--ud-accent); color:var(--ud-on-accent); box-shadow:none; }
        .primary-button:hover,.primary-button:focus-visible { background:var(--ud-accent-hover); }
        .ui-editor-footer .primary-button { background:var(--ud-accent)!important; }
        .ui-editor-footer .primary-button:hover,.ui-editor-footer .primary-button:focus-visible { background:var(--ud-accent-hover)!important; }
        .panel { top:24px; bottom:auto; }
        .panel-header .brand,.panel-header .header-spacer { display:none; }
        .panel-header .panel-mode { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color:var(--ud-text); }
        .panel-header .icon-button { width:28px; height:28px; flex:none; }
        .icon-button svg { display:block; width:18px; height:18px; flex:none; overflow:visible; }
        .delivery-card-icon svg { display:block; width:20px; height:20px; flex:none; }
        .delivery-count { margin:12px 0; line-height:1.5; }
        .issue-row { grid-template-columns:18px 68px minmax(0,1fr); }
        .issue-row .row-actions { grid-column:2/-1; justify-content:flex-end; gap:6px; }
        .issue-row .row-action { width:28px; height:28px; border-radius:6px; }
        .row-action svg { display:block; width:16px; height:16px; overflow:visible; }
        .issue-title { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; white-space:normal; overflow-wrap:anywhere; line-height:1.45; }
        .issue-meta { overflow-wrap:anywhere; }
        .issue-empty span { color:var(--ud-text-secondary); font-size:11px; }
        .ui-editor { top:24px!important; color-scheme:dark; }
        .ui-editor.visible { display:flex; flex-direction:column; animation:none; }
        .ui-editor-header { flex:none; min-height:60px!important; padding:13px 12px 9px!important; }
        .ui-editor-title { font-size:14px!important; }
        .ui-editor-heading { flex:1; }
        .ui-editor-header-actions { flex:none; }
        .ui-editor-meta { font:400 11px/1.4 var(--ud-font)!important; }
        .ui-editor-toggle { font-size:11px!important; }
        .ui-editor-body { flex:1; height:auto!important; min-height:0; overflow:auto; padding:0 12px 12px!important; }
        .ui-editor-section,.ui-editor-section:first-child { padding:12px 0!important; }
        .ui-editor-section-title { font-size:13px!important; font-weight:600!important; margin-bottom:10px!important; }
        .ui-editor-layout-section [data-ui-section='layout'] { margin-top:12px; }
        .ui-editor-field,.ui-editor-field.ui-numeric-field { gap:4px!important; font-weight:500!important; }
        .ui-editor-field input,.ui-editor-field select,.ui-editor-field textarea { font-size:12px!important; font-weight:400!important; }
        .ui-editor-field select { padding-right:20px!important; text-overflow:ellipsis; cursor:pointer; }
        .ui-editor-field textarea { height:76px!important; line-height:1.6!important; }
        .ui-editor-field .ui-number-control input { background:transparent!important; border:0!important; box-shadow:none!important; }
        .ui-number-control:focus-within { outline:2px solid var(--ud-accent); outline-offset:1px; }
        .ui-editor-field input[type='range'].ui-opacity-range {
          appearance:none; -webkit-appearance:none; height:28px!important; min-height:28px!important;
          margin:0!important; padding:0!important; border:0!important; border-radius:0!important;
          background:transparent!important; box-shadow:none!important; cursor:pointer;
        }
        .ui-opacity-range::-webkit-slider-runnable-track { height:4px; border-radius:999px; background:linear-gradient(90deg,var(--ud-accent) 0 var(--uidelta-range-progress,100%),#505460 var(--uidelta-range-progress,100%) 100%); }
        .ui-opacity-range::-webkit-slider-thumb { width:14px!important; height:14px!important; margin-top:-5px; border:2px solid #e8ebff; box-shadow:none; }
        .ui-editor-field input[type='range']:focus-visible { outline:2px solid var(--ud-accent); outline-offset:2px; }
        .ui-editor-color-control { align-items:center; }
        .ui-color-swatch { position:relative; width:28px; height:28px; border:1px solid var(--ud-border); border-radius:6px; overflow:hidden; background:repeating-conic-gradient(#747780 0% 25%,#353840 0% 50%) 50%/8px 8px; }
        .ui-color-swatch>span { position:absolute; inset:0; }
        .ui-color-swatch input[type='color'] { position:absolute; inset:0; opacity:0; cursor:pointer; }
        .ui-color-swatch:focus-within { outline:2px solid var(--ud-accent); outline-offset:2px; }
        .ui-editor-footer { position:static!important; flex:none; bottom:auto!important; margin:0!important; padding:10px 12px!important; grid-template-columns:1fr 1fr; }
        .ui-editor-footer .primary-button,.ui-editor-footer .secondary-button { height:32px; min-height:32px!important; padding:0 8px!important; font-weight:600; }
        .ui-editor-delta { overflow-wrap:anywhere; max-height:112px; overflow:auto; }
        .ui-editor-delta strong { color:var(--ud-text-secondary); }
        .ui-editor-advanced-action { width:100%; height:28px; min-height:28px!important; margin-top:10px!important; text-align:left; }
        .ui-editor :is(input,textarea,select).is-invalid { animation:ui-number-shake .28s ease; border-color:#f08a9b!important; }
        .ui-editor :is(select,textarea).is-updated,.ui-number-control:has(input.is-updated) { animation:ui-number-pulse .42s ease; }
        .ui-editor [hidden] { display:none!important; }
        .mode-toolbar { left:50%; top:auto; right:auto; bottom:max(16px,env(safe-area-inset-bottom)); transform:translateX(-50%); padding:14px 6px 6px; gap:4px; overflow:visible; transition:box-shadow .16s ease; }
        .mode-toolbar::before,.mode-toolbar button.active::after { display:none; }
        .mode-toolbar .mode-drag-handle { position:absolute; top:2px; left:calc(50% - 24px); width:48px; height:10px; min-height:0; padding:0; cursor:grab; background:transparent; }
        .mode-toolbar .mode-drag-handle::after { content:''; display:block; width:28px; height:3px; border-radius:4px; background:#7d808b; }
        .mode-toolbar .mode-drag-handle:active { cursor:grabbing; transform:none; }
        .mode-toolbar .mode-icon { display:block; width:20px; height:20px; flex:none; overflow:visible; filter:none; opacity:1; }
        .mode-toolbar .mode-issue-count { display:grid; width:30px; height:30px; min-width:30px; font-size:11px; }
        .mode-count-value,.mode-count-previous { grid-area:1/1; pointer-events:none; font-variant-numeric:tabular-nums; }
        .mode-count-previous { position:absolute; inset:0; display:grid; place-items:center; }
        .mode-count-halo { position:absolute; inset:-3px; border:2px solid var(--ud-accent); border-radius:6px; pointer-events:none; }
        .mode-count-increment { position:absolute; bottom:calc(100% + 7px); left:50%; margin-left:-14px; width:28px; padding:3px 0; border-radius:4px; background:var(--ud-accent); color:var(--ud-on-accent); font:600 11px/1 var(--ud-font); pointer-events:none; }
        .mode-toolbar .mode-issue-count.is-count-increasing { color:var(--ud-accent-text); }
        .mode-toolbar .mode-issue-count.is-count-increasing::before { visibility:hidden; }
        .mode-save-status { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; pointer-events:none; }
        .mode-toolbar button[data-tooltip]::before { top:auto; bottom:calc(100% + 12px); max-width:140px; line-height:1.3; }
        .mode-toolbar.tooltips-below button[data-tooltip]::before { top:calc(100% + 10px); bottom:auto; }
        .mode-toolbar button[data-mode='ui']::before { left:0; transform:none!important; }
        .mode-toolbar button[data-mode='region']::before { right:0; left:auto; transform:none!important; }
        .mode-toolbar button:focus-visible { outline:2px solid var(--ud-focus); outline-offset:2px; }
        .toast { bottom:84px; }
        @media(max-width:480px) {
          .panel,.ui-editor { top:12px!important; left:auto!important; right:12px!important; width:min(250px,calc(100vw - 24px))!important; height:min(560px,calc(100vh - 96px))!important; }
          .ui-editor-fields { grid-template-columns:repeat(2,minmax(0,1fr))!important; }
          .ui-editor-field.wide { grid-column:1/-1!important; }
          .ui-opacity-control { grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important; }
        }
        @media(prefers-reduced-motion:reduce) { .ui-editor *, .mode-toolbar * { animation:none!important; transition:none!important; } }
      `;
    }

    reviewWorkflowStyles() {
      return `
        .tooltip[data-pin-issue-id] { max-width:min(340px,calc(100vw - 16px)); max-height:calc(100vh - 32px); overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; text-overflow:unset; font:500 12px/1.6 var(--ud-font); padding:10px 12px; pointer-events:auto; }
        .pin { box-sizing:border-box; display:grid; place-items:center; min-width:0; min-height:0; padding:0; border:2px solid #fff; border-radius:50%; font:650 11px/1 var(--ud-font); font-variant-numeric:tabular-nums; letter-spacing:0; text-align:center; box-shadow:0 1px 2px rgba(22,27,20,.16),0 3px 8px rgba(22,27,20,.2); transition:transform 140ms cubic-bezier(.23,1,.32,1); }
        .pin:focus-visible { outline:2px solid var(--ud-accent); outline-offset:2px; }
        .pin:active { transform:scale(.97); }
        @media (prefers-reduced-motion:reduce) { .pin { transition:none; } }
        .panel:has(.composer-view.active,.inbox-view.active) .panel-body { height:calc(100% - 48px); max-height:none; overflow:hidden; }
        .composer-view.active { display:flex; flex-direction:column; height:100%; min-height:0; padding:0; }
        .composer-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:12px 14px; scrollbar-width:thin; }
        .composer-view .composer-head { padding-bottom:8px; border:0; }
        .composer-view .capture-state { min-height:22px; padding:0; font-size:10px; gap:5px; }
        .composer-view .composer-id { font-size:11px; }
        .composer-view .composer-element { margin-top:4px; font-size:12px; }
        .composer-view .composer-compare { margin-top:4px; font-size:10px; }
        .composer-view .composer-diff { grid-template-columns:56px minmax(0,1fr); min-width:0; font-size:11px; }
        .composer-view .composer-diff>* { min-width:0; overflow-wrap:anywhere; }
        .composer-view [hidden] { display:none!important; }
        .composer-view .evidence-strip { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding:4px 0 8px; overflow:visible; border:0; }
        .composer-view .evidence-thumb { width:100%; height:62px; border-color:var(--ud-border); border-radius:6px; background:var(--ud-elevated); }
        .composer-view .evidence-thumb img { object-fit:contain; }
        .composer-view .evidence-placeholder { display:flex; align-items:center; justify-content:center; color:var(--ud-text-muted); font-size:10px; cursor:default; }
        .composer-view .evidence-placeholder span { position:static; background:none; }
        .composer-view .evidence-thumb:focus-visible { outline:2px solid var(--ud-focus); outline-offset:2px; }
        .composer-view .field { padding:8px 0 10px; border:0; }
        .composer-view .field-label { margin-bottom:6px; font-size:11px; color:var(--ud-text-secondary); }
        .composer-view .description-input { min-height:86px; height:86px; padding:8px; border-radius:7px; font:12px/1.55 var(--ud-font); }
        .composer-view .description-input::placeholder { color:var(--ud-text-muted); }
        .composer-view .rich-input { border:1px solid var(--ud-border); border-radius:7px; background:var(--ud-elevated); padding-bottom:6px; overflow:hidden; }
        .composer-view .rich-input:focus-within { border-color:var(--ud-focus); box-shadow:0 0 0 2px var(--ud-focus-soft); }
        .composer-view .rich-input textarea { border:0!important; box-shadow:none!important; outline:0!important; resize:vertical; }
        .composer-view .result-input { min-height:64px; height:64px; }
        .composer-view .rich-input .reference-list { padding:0 6px 6px; }
        .composer-view .rich-input .description-upload { margin:0 6px; min-height:22px; height:22px; padding:0 4px; border:0; background:transparent; font-weight:400; }
        .composer-view .description-upload { min-height:28px; height:28px; margin-top:8px; padding:0 8px; border-radius:6px; font-size:11px; }
        .composer-view .description-upload:focus-within { outline:2px solid var(--ud-focus); outline-offset:2px; }
        .composer-choices { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; padding:8px 0 0; }
        .composer-choice { min-width:0; }
        .composer-choice-label { margin-bottom:6px; font-size:11px; font-weight:600; color:var(--ud-text-secondary); }
        .composer-choice .segments { gap:4px; }
        .composer-choice .segments[data-segments='priority'] { grid-template-columns:repeat(4,minmax(0,1fr)); }
        .composer-choice .segment { min-width:0; min-height:28px; padding:5px 4px; border:1px solid var(--ud-border); border-radius:6px; background:var(--ud-elevated); color:var(--ud-text-secondary); font:500 12px/16px var(--ud-font); overflow-wrap:anywhere; cursor:pointer; }
        .composer-choice .segment:hover { border-color:var(--ud-border-strong); color:var(--ud-text); }
        .composer-choice .segment.active { border-color:var(--ud-accent); background:var(--ud-accent-soft); color:var(--ud-text); }
        .composer-choice .segment:focus-visible { outline:2px solid var(--ud-focus); outline-offset:2px; }
        .composer-choice .segment:disabled { opacity:.6; cursor:wait; }
        .composer-view .composer-error { min-height:0; margin:8px 0 0; font-size:11px; }
        .composer-view .composer-error:empty { display:none; }
        .composer-view>.composer-actions { position:static; flex:none; bottom:auto; grid-template-columns:1fr 1.2fr; gap:8px; margin:0; padding:10px 14px; border-top:1px solid var(--ud-border); background:var(--ud-surface); }
        .composer-view>.composer-actions button { min-height:32px; padding:0 8px; border-radius:7px; font-size:12px; }
        .inbox-view.active { display:flex; flex-direction:column; height:100%; min-height:0; padding:0; }
        .inbox-head { flex:none; padding:12px 14px 0; }
        .inbox-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 14px; scrollbar-width:thin; }
        .inbox-view .inbox-toolbar { padding-bottom:8px; border:0; }
        .inbox-view .inbox-title { font-size:13px; }
        .inbox-view .inbox-meta { font-size:11px; margin-top:3px; }
        .inbox-view .filter-row { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:3px; margin-top:8px; padding:0; overflow:visible; }
        .inbox-view .filter { min-width:0; min-height:28px; height:28px; padding:0 3px; font-size:11px; white-space:nowrap; }
        .inbox-view>.inbox-actions { position:static; flex:none; bottom:auto; margin:0; padding:10px 14px; border-top:1px solid var(--ud-border); background:var(--ud-surface); }
        .inbox-view>.inbox-actions button { min-height:30px; font-size:11px; border-radius:6px; }
        .record-flight { position:fixed; z-index:18; display:flex; align-items:center; justify-content:center; overflow:hidden; pointer-events:none; transform-origin:0 0; border:1px solid #a5b1ff; border-radius:6px; background:rgba(45,55,96,.9); box-shadow:0 6px 22px rgba(0,0,0,.18); color:#f4f6ff; font:600 12px/1.3 var(--ud-font); }
        .record-flight span { display:block; padding:8px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        :host([data-uidelta-capturing]) * { pointer-events:none!important; }
        .mode-toolbar .mode-browse { width:32px; height:32px; margin-left:3px; border-left:1px solid var(--ud-border); border-radius:0 6px 6px 0; }
        .mode-toolbar [data-role='browse-state'] { max-width:72px; overflow:hidden; white-space:nowrap; font-size:11px; color:var(--ud-text-secondary); }
        .mode-toolbar [data-role='browse-state'][hidden] { display:none!important; }
        .mode-toolbar .mode-browse::before { left:auto; right:0; transform:none!important; }
        .ui-editor-header-actions .icon-button { flex:none; width:28px; height:28px; border-radius:6px; }
        .inspect-view .mode-hint { font-size:10px; line-height:1.5; margin:0 0 10px; color:var(--ud-text-muted); }
        .inspect-view .identity { padding:0 0 12px; border-bottom:1px solid var(--ud-border); }
        .inspect-view .identity-row { align-items:baseline; gap:6px; }
        .inspect-view .element-kind { max-width:56px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:500; }
        .inspect-view .element-name { font-size:13px; font-weight:600; }
        .inspect-view .element-path { margin:5px 0 0; font-size:10px; }
        .inspect-view .element-location { margin:3px 0 0; font-size:10px; }
        @media(prefers-reduced-motion:reduce) { .record-flight { display:none; } }
      `;
    }

    composerChoicesMarkup() {
      const rows = [
        ["type", "问题类型", Object.fromEntries(Object.entries(ISSUE_TYPES).map(([key, info]) => [key, info.label]))],
        ["priority", "优先级", PRIORITIES],
        ["severity", "影响程度", Object.fromEntries(Object.entries(SEVERITIES).filter(([key]) => !["minor", "major"].includes(key))) ]
      ];
      return "<div class='composer-choices'>" + rows.map(([key, label, options]) =>
        `<div class='composer-choice'><div class='composer-choice-label' id='composer-${key}-label'>${label}</div><div class='segments' data-segments='${key}' role='radiogroup' aria-labelledby='composer-${key}-label'>` +
        Object.entries(options).map(([value, text], index) => `<button type='button' class='segment' data-${key}='${value}' role='radio' aria-checked='false' tabindex='${index === 0 ? 0 : -1}'>${text}</button>`).join("") +
        "</div></div>"
      ).join("") + "</div>";
    }

    setComposerChoice(key, value) {
      const options = { type: ISSUE_TYPES, priority: PRIORITIES, severity: SEVERITIES };
      if (!this.composer || this.composer.controlsLocked || !Object.hasOwn(options, key) || !Object.hasOwn(options[key], value)) return false;
      this.composer[key] = key === "severity" ? this.normalizeSeverity(value) : value;
      this.updateComposerControls();
      this.persistTabContext();
      return true;
    }

    deliveryCardsMarkup() {
      const icon = (paths) => `<span class='delivery-card-icon' aria-hidden='true'><svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' focusable='false'>${paths}</svg></span>`;
      return "<div class='delivery-card-grid'>"
        + "<article class='delivery-card'>" + icon("<rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 7h8M8 11h8M8 15h5'/>")
        + "<div class='delivery-card-copy'><strong>协作问题单</strong><span>查看与跟进</span></div><div class='delivery-card-actions'><button class='ghost-button delivery-example' data-action='preview-delivery' data-format='html' aria-label='查看 HTML 问题单示例'>示例</button><button class='secondary-button' data-action='deliver-html'>导出 HTML</button></div></article>"
        + "<article class='delivery-card'>" + icon("<rect x='3' y='3' width='18' height='18' rx='2'/><path d='M3 9h18M3 15h18M9 9v12'/>")
        + "<div class='delivery-card-copy'><strong>排期问题表</strong><span>表格与预览</span></div><div class='delivery-card-actions'><button class='ghost-button delivery-example' data-action='preview-delivery' data-format='xlsx' aria-label='查看 XLSX 问题表示例'>示例</button><button class='secondary-button' data-action='deliver-xlsx'>导出 XLSX</button></div></article>"
        + "<article class='delivery-card'>" + icon("<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z'/><path d='M14 2v6h6M9 12l-3 3 3 3M15 12l3 3-3 3'/>")
        + "<div class='delivery-card-copy'><strong>给 Agent / 前端</strong><span>截图与开发信息</span></div><button class='ghost-button delivery-example' data-action='preview-delivery' data-format='zip' aria-label='查看 ZIP 开发交付包示例'>示例</button><div class='delivery-agent-actions'><button class='ghost-button' data-action='copy-agent'>复制给 Codex</button><button class='primary-button' data-action='deliver-zip'>导出 ZIP</button></div></article></div>";
    }

    cancelToolbarTransition() {
      this.cancelCaptureSurfaceTransition();
      this.hideDeliveryExampleHover();
      this.cancelIssueCountTransition();
      const animations = this.toolbarAnimations || [];
      this.toolbarAnimations = [];
      for (const animation of animations) animation.cancel();
    }

    animateToolbarAction(button, event) {
      this.cancelToolbarTransition();
      // Keep keyboard switching immediate. Never move focused fields or wait
      // for motion before accepting input; reduced-motion users get no travel.
      if (!button || button.disabled || !event?.detail || !this.enabled
        || this.captureOverlayStyles || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const animations = [];
      this.toolbarAnimations = animations;
      const play = (node, frames, duration) => {
        if (node?.animate) animations.push(node.animate(frames, { duration, easing:"cubic-bezier(0.23, 1, 0.32, 1)" }));
      };
      play(button.querySelector(".mode-icon") || button,
        [{ transform:"scale(.84)" }, { transform:"scale(1)" }], 150);
      const surface = this.uiEditor?.classList.contains("visible") ? this.uiEditor
        : this.panel?.style.display !== "none" ? this.panel : null;
      if (!this.browseMode && !this.panelDrag && !this.uiEditorDrag) {
        play(surface, [{ opacity:.5, transform:"translateY(6px) scale(.985)" }, { opacity:1, transform:"none" }], 200);
      }
      Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (this.toolbarAnimations === animations) this.toolbarAnimations = [];
      });
    }

    modeToolbarMarkup() {
      const icon = (paths) => `<svg class='mode-icon' viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'>${paths}</svg>`;
      return [
        "<div class='mode-toolbar' role='toolbar' aria-label='走查模式'>",
        "<button class='mode-drag-handle' aria-label='移动模式栏，方向键移动，Enter 回到底部居中' title='拖动移动 · 双击居中'></button>",
        "<button data-mode='ui' data-tooltip='UI 模式' aria-label='UI 模式' aria-pressed='false'>",
        icon("<path d='M12 2H8.5a3.5 3.5 0 0 0 0 7H12V2Zm0 0h3.5a3.5 3.5 0 0 1 0 7H12M12 9H8.5a3.5 3.5 0 0 0 0 7H12V9Zm0 7H8.5a3.5 3.5 0 1 0 3.5 3.5V16Z'/><circle cx='15.5' cy='12.5' r='3.5'/>"),
        "</button><button data-mode='annotation' data-tooltip='标注模式' aria-label='标注模式' aria-pressed='false'>",
        icon("<path d='M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13M8 6l2-2M18 16l2-2M17 11l4.3 4.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L11 17'/><path d='M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83L2.02 21.35a.5.5 0 0 0 .63.63L7 20.66a2 2 0 0 0 .83-.5ZM15 5l4 4'/>"),
        "</button><button class='mode-issue-count' data-action='open-inbox' data-tooltip='问题列表' aria-label='打开问题列表，已记录 0 个问题'><span class='mode-count-value' aria-hidden='true'>0</span></button><span class='mode-save-status' role='status' aria-live='polite' aria-atomic='true'></span>",
        "<button data-mode='region' data-tooltip='框选模式' aria-label='框选模式' aria-pressed='false'>",
        icon("<path d='M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3'/><rect x='7' y='7' width='7' height='7' rx='1'/><rect x='11' y='11' width='7' height='7' rx='1'/>"),
        "</button><button class='mode-browse' data-action='browse' data-tooltip='浏览页面' aria-label='收起面板，浏览页面' aria-pressed='false'>",
        icon("<path d='m4 3 7 18 3-7 7-3L4 3Z'/><path d='m14 14 5 5'/>"),
        "</button><span data-role='browse-state' hidden>浏览中</span></div>"
      ].join("");
    }

    localizeOverlay(shadow) {
      // Browsers and translation extensions can cross the shadow boundary.
      // Protect the tool's labels/shortcuts, never change the inspected page.
      for (const node of Array.from(shadow.children || [])) {
        if (node.tagName === "STYLE") continue;
        node.setAttribute("translate", "no");
        node.setAttribute("lang", "zh-CN");
        node.classList.add("notranslate");
      }
      const setText = (selector, value) => {
        const node = shadow.querySelector(selector);
        if (node) node.textContent = value;
      };
      setText(".ui-editor-title", "选择页面元素");
      setText(".ui-editor-meta-label", "UI 模式");
      setText(".ui-editor-status", "本地预览");
      // Keep actions outside the scroll area; no sticky overlay can obscure
      // the last editable field, and there is one clear place to undo.
      const editor = shadow.querySelector(".ui-editor");
      const footer = editor?.querySelector(".ui-editor-footer");
      if (footer) { footer.hidden = true; editor.append(footer); }
      editor?.querySelector(".ui-editor-reset")?.remove();
      const collapse = document.createElement("button");
      collapse.className = "icon-button";
      collapse.dataset.action = "minimize";
      collapse.setAttribute("aria-label", "收起面板，浏览页面");
      collapse.title = "收起，浏览页面";
      editor?.querySelector(".ui-editor-header-actions")?.append(collapse);
      setText(".ui-editor-toggle", "同类");
      editor?.querySelector(".ui-editor-toggle")?.setAttribute("title", "选择同类元素，同步修改样式");
      setText(".ui-editor-footer [data-action='reset-preview']", "撤销全部");
      editor?.querySelector("[data-action='reset-preview']")?.setAttribute("title", "撤销本页全部预览修改");
      setText(".ui-editor-footer [data-action='record']", "记录问题");
      const empty = shadow.querySelector(".ui-editor-empty");
      if (empty) {
        const title = document.createElement("strong");
        title.textContent = "点击选择元素";
        empty.replaceChildren(title);
      }
      setText(".ui-editor-layout-section .ui-editor-section-title", "布局");
      setText(".ui-editor-layout-section .ui-editor-group-label", "尺寸");
      setText(".ui-editor-layout-section .ui-editor-group-label.after-fields", "对齐与间距");
      shadow.querySelectorAll(".ui-editor-layout-section .ui-editor-group-label").forEach((node) => node.remove());
      for (const [section, title] of [["spacing", "间距与内边距"], ["appearance", "外观"], ["typography", "文字"], ["fill", "填充"]]) {
        const heading = shadow.querySelector(`[data-ui-section='${section}']`)?.closest(".ui-editor-section")?.querySelector(".ui-editor-section-title");
        if (heading) heading.textContent = title;
      }
      setText(".ui-editor-text-section .ui-editor-section-title", "文本内容");
      setText(".ui-editor-advanced-section .ui-editor-section-title", "高级属性");
      setText(".ui-editor-advanced-action", "高级属性");
      setText(".panel-mode", "走查");
      const actionIcons = {
        copy: "<rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'/>",
        minimize: "<path d='M5 12h14'/>",
        close: "<path d='m6 6 12 12M6 18 18 6'/>",
        "close-design-binding": "<path d='m6 6 12 12M6 18 18 6'/>"
      };
      for (const [action, paths] of Object.entries(actionIcons)) {
        for (const button of shadow.querySelectorAll(`.icon-button[data-action='${action}']`)) {
          button.innerHTML = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'>${paths}</svg>`;
        }
      }
      setText(".start-view .eyebrow", "走查会话");
      setText(".start-view .start-title", "开始走查");
      setText(".start-view .start-copy", "元素、截图与问题保存在本地。");
      shadow.querySelectorAll(".start-view .feature-line").forEach((node) => node.remove());
      setText(".paused-view .eyebrow", "走查已暂停");
      setText(".paused-view .start-copy", "已保存，可继续走查。");
      setText(".mode-hint", "点击元素后固定，按 R 记录。");
      const kickers = shadow.querySelectorAll(".compare-kicker");
      if (kickers[0]) kickers[0].textContent = "设计比对";
      if (kickers[1]) kickers[1].textContent = "设计源";
      setText(".binding-head strong", "绑定 Figma");
      const bindingLabels = shadow.querySelectorAll(".design-binding .field-label");
      if (bindingLabels[0]) bindingLabels[0].textContent = "Figma Frame 链接";
      if (bindingLabels[1]) bindingLabels[1].textContent = "设计快照 JSON";
      shadow.querySelector(".binding-hint")?.remove();
      setText(".issue-empty span:last-child", "点击元素后记录。");
      setText(".delivery-copy", "导出 HTML、XLSX 或 ZIP。");
      const deliveryCopies = shadow.querySelectorAll(".delivery-card-copy span");
      ["查看与跟进", "表格与预览", "交给 Agent"].forEach((value, index) => {
        if (deliveryCopies[index]) deliveryCopies[index].textContent = value;
      });
      setText(".delivery-section-title", "导入交付包");
      setText(".delivery-section-copy", "导入 JSON 或 ZIP。");
      setText(".delivery-actions .primary-button", "导出 ZIP");
      shadow.querySelector(".compare-strip")?.setAttribute("aria-label", "设计比对");
    }

    installCursorStyle() {
      if (document.getElementById(CURSOR_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = CURSOR_STYLE_ID;
      style.textContent = [
        "html." + ACTIVE_CLASS + "." + PIERCE_CLASS + ",html." + ACTIVE_CLASS + "." + PIERCE_CLASS + " body,html." + ACTIVE_CLASS + "." + PIERCE_CLASS + " body *{cursor:crosshair!important}",
        "html." + ACTIVE_CLASS + "." + MEASURE_CLASS + ",html." + ACTIVE_CLASS + "." + MEASURE_CLASS + " body,html." + ACTIVE_CLASS + "." + MEASURE_CLASS + " body *{cursor:cell!important}",
        "html." + ACTIVE_CLASS + " [" + ROOT_ATTRIBUTE + "],html." + ACTIVE_CLASS + " [" + ROOT_ATTRIBUTE + "] *{cursor:auto!important}"
      ].join("");
      (document.head || document.documentElement).appendChild(style);
    }

    async sendMessage(message) {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "UIDelta 扩展连接失败" };
      }
    }

    async onBookmarkMessage(event) {
      if (event.source !== window || !event.data || event.data.source !== BOOKMARK_SOURCE || event.data.type !== "UIDELTA_TOGGLE") return;
      const nextEnabled = !this.enabled;
      try {
        await this.setEnabled(nextEnabled);
        window.postMessage({
          source: BOOKMARK_ACK_SOURCE,
          type: "UIDELTA_TOGGLE_ACK",
          requestId: event.data.requestId || null,
          enabled: nextEnabled,
          ok: true
        }, "*");
      } catch (error) {
        window.postMessage({
          source: BOOKMARK_ACK_SOURCE,
          type: "UIDELTA_TOGGLE_ACK",
          requestId: event.data.requestId || null,
          enabled: this.enabled,
          ok: false
        }, "*");
      }
    }

    async setEnabled(enabled, context = {}) {
      const toggleEpoch = ++this.toggleEpoch;
      this.tabConfigured = true;
      this.enabled = Boolean(enabled);
      this.host.style.display = this.enabled ? "block" : "none";
      this.syncCursorState();

      if (!this.enabled) {
        this.cancelPendingIssueDeletions();
        this.cancelToolbarTransition();
        this.cancelRecordTransition?.();
        this.setCaptureOverlayVisible?.(true);
        this.persistTabContext();
        this.stopRouteWatch();
        this.resetInspection();
        this.modifierDown = false;
        this.pierceDown = false;
        this.setInteractionMode(false);
        this.panel.style.display = "none";
        this.uiEditor?.classList.remove("visible");
        this.dock.style.display = "none";
        this.clearVisuals();
        return;
      }

      await this.refreshState();
      if (toggleEpoch !== this.toggleEpoch || !this.enabled) return;
      if (!this.session) await this.startSession();
      if (toggleEpoch !== this.toggleEpoch || !this.enabled) return;
      const restored = { ...(this.persistedTabState || {}), ...context };
      this.browseMode = context.browseMode === true;
      if (["ui", "annotation", "region"].includes(restored.inspectMode)) this.inspectMode = restored.inspectMode;
      if (!this.composer && restored.composerDraft) this.restoreTabComposer(restored.composerDraft);
      if (this.composer) this.currentView = "composer";
      if (this.session) await this.touchCurrentPage();
      this.dock.style.display = "none";
      this.renderSessionState();
      this.startRouteWatch();
      if (!this.browseMode) this.consumePendingJump();
      this.persistTabContext();
      if (!this.browseMode) this.showToast("走查已开启");
    }

    composerTabSnapshot() {
      const composer = this.composer;
      if (!composer?.issue) return null;
      if (composer.formReady) composer.issue.description = this.descriptionInput?.value ?? composer.issue.description ?? "";
      if (composer.formReady) composer.issue.resultReference = this.resultInput?.value ?? composer.issue.resultReference ?? "";
      return {
        issue: structuredClone(composer.issue),
        mode: composer.mode, returnView: composer.returnView,
        type: composer.type, severity: composer.severity, priority: composer.priority,
        originalAttachments: { ...(composer.originalAttachments || {}) },
        captureStatus: composer.captureStatus, captureError: composer.captureError || ""
      };
    }

    persistTabContext() {
      // Draft text belongs to this tab, including edits to an accepted issue.
      // It is not committed to the issue database until the user saves it.
      if (!this.tabConfigured) return Promise.resolve({ ok: true });
      return this.sendMessage({
        type: "SYNC_TAB_STATE", enabled: this.enabled, browseMode: this.browseMode,
        inspectMode: this.inspectMode, view: this.currentView, composerDraft: this.composerTabSnapshot()
      });
    }

    restoreTabComposer(snapshot) {
      if (!snapshot?.issue || snapshot.issue.sessionId !== this.session?.id) return;
      let samePage = false;
      try {
        const page = new URL(snapshot.issue.pageSnapshot?.url || "");
        if (page.origin !== location.origin) return;
        samePage = page.pathname + page.search + page.hash === this.currentRoute();
      } catch (_) { return; }
      const issue = structuredClone(snapshot.issue);
      const ready = Boolean(issue.attachments?.context && issue.attachments?.detail);
      this.composer = {
        ...snapshot, issue, saving: false,
        targetElement: samePage ? this.resolveAnchor(issue.elementAnchor) : null,
        captureStatus: ready ? "ready" : "error",
        captureError: ready ? "" : snapshot.captureError || "取证未完成，请返回原页面重新截图。",
        capturePromise: Promise.resolve(null)
      };
      this.renderComposer();
    }

    setBrowseMode(active) {
      if (!this.enabled) return;
      this.browseMode = Boolean(active);
      if (this.browseMode) {
        this.cancelPendingIssueDeletions();
        this.cancelToolbarTransition();
        this.cancelRecordTransition?.();
        this.modifierDown = false;
        this.pierceDown = false;
        this.interactionDown = false;
        this.regionSelection = null;
        this.regionEdit = null;
        this.pendingRegionRect = null;
        this.closeImagePreview();
        this.clearVisuals();
      }
      this.syncCursorState();
      this.syncModeSurfaces();
      this.updateModeControls();
      this.persistTabContext();
    }

    resumeReview(mode = this.inspectMode) {
      this.restorePanel();
      this.setInspectMode(mode);
      if (this.composer) {
        this.renderComposer();
        this.showView("composer");
      } else this.showView(this.session?.status === "paused" ? "paused" : "inspect");
      this.persistTabContext();
    }

    async refreshState() {
      const response = await this.sendMessage({ type: "UIDELTA_GET_STATE", origin: location.origin });
      if (!response || !response.ok) return;
      this.session = response.activeSession || response.session || null;
      this.issues = Array.isArray(response.issues) ? response.issues : [];
      this.persistedTabState = response.tabState || null;
      this.pruneDeliverySelection();
    }

    renderSessionState() {
      this.syncCursorState();
      this.updateCounts();
      if (!this.session) {
        this.showView("inspect");
      } else if (this.session.status === "paused") {
        this.showView("paused");
      } else {
        this.showView(this.currentView === "start" || this.currentView === "paused" ? "inspect" : this.currentView);
      }
      this.renderPins();
      this.renderCompareState();
    }

    showView(name) {
      if (name !== "inbox") this.cancelPendingIssueDeletions();
      this.cancelToolbarTransition();
      if (name !== "composer") this.cancelRecordTransition?.();
      this.currentView = name;
      const isInspectView = name === "inspect" && !this.browseMode;
      const preserveComposerMeasurement = name === "composer" && !this.browseMode && Boolean(this.composer);
      this.renderPins();
      this.recordPrompt?.classList.remove("visible");
      if (!isInspectView) this.regionBox.style.display = "none";
      if (!isInspectView) {
        this.tooltip.style.display = "none";
        if (!preserveComposerMeasurement) {
          this.selectedBox.style.display = "none";
          this.hoverBox.style.display = "none";
          this.measurements.replaceChildren();
          this.currentMeasurement = null;
        } else {
          this.renderComposerOverlay();
        }
      }
      const paused = this.session?.status === "paused";
      this.panel.classList.toggle("is-paused", paused);
      this.dock.classList.toggle("is-paused", paused);
      for (const [viewName, node] of this.views) node.classList.toggle("active", viewName === name);
      const labels = { start: "开始走查", paused: "走查已暂停", inspect: "检查元素", composer: "记录问题", inbox: "问题清单", deliver: "交付" };
      this.panelTitle.textContent = labels[name] || "走查";
      this.shadow.querySelector("[data-action='copy']").style.display = name === "inspect" ? "grid" : "none";
      if (name === "composer" && !this.browseMode) this.focusComposerDescription();
      if (name === "inbox") this.renderIssueList();
      if (name === "deliver") this.renderDeliveryWorkspace();
      if (isInspectView) {
        if (this.selected) {
          this.renderSelected(this.selected);
          this.updateInspector(this.selected);
        }
        this.renderPins();
        this.updateModeControls();
      }
      this.syncModeSurfaces();
      this.persistTabContext();
      window.requestAnimationFrame(() => this.clampPanelToViewport());
    }

    syncModeSurfaces() {
      this.renderPins();
      const inspecting = this.enabled && !this.browseMode && this.isSessionActive() && this.currentView === "inspect";
      const uiEditing = inspecting && this.inspectMode === "ui";
      const annotationInspecting = inspecting && this.inspectMode === "annotation";
      const regionSelecting = inspecting && this.inspectMode === "region";
      this.uiEditor?.classList.toggle("visible", uiEditing);
      this.panel?.classList.toggle("compact-annotation", annotationInspecting);
      this.modeToolbar?.classList.toggle("is-browsing", this.browseMode);
      if (this.browseState) {
        this.browseState.hidden = !this.browseMode;
        this.browseState.textContent = "浏览中";
      }
      const browseButton = this.modeToolbar?.querySelector("[data-action='browse']");
      browseButton?.setAttribute("aria-pressed", String(this.browseMode));
      if (!this.enabled) return;
      if (this.modeToolbar) this.modeToolbar.style.display = "flex";
      if (this.browseMode) {
        this.panel.style.display = "none";
        this.dock.style.display = "none";
        this.uiEditor?.classList.remove("visible");
        this.clearVisuals();
        return;
      }
      if (uiEditing || regionSelecting) {
        this.panel.style.display = "none";
        this.dock.style.display = "none";
        return;
      }
      if (this.dock.style.display !== "flex") this.panel.style.display = "block";
    }

    async startSession() {
      if (this.sessionAction) return;
      this.sessionAction = "starting";
      this.startButton.disabled = true;
      this.startButton.textContent = "正在开始…";
      const now = new Date().toISOString();
      const startPage = this.pageSnapshot();
      const draftSession = {
        id: this.createId("review"),
        name: (document.title || location.hostname || "Untitled review").slice(0, 120),
        origin: location.origin,
        status: "active",
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        nextIssueNumber: 1,
        pages: [startPage.url],
        startedPage: startPage,
        pageVisits: [startPage]
      };
      try {
        const response = await this.sendMessage({ type: "UIDELTA_PUT_SESSION", session: draftSession });
        if (!response || !response.ok) {
          this.showToast((response && response.error) || "无法开始走查");
          return;
        }
        this.session = response.session || draftSession;
        this.issues = Array.isArray(response.issues) ? response.issues : [];
        this.issueFilter = "all";
        this.issueSearchQuery = "";
        this.deliverySelection = new Set(this.issues.map((issue) => issue.id));
        this.deliverySelectionTouched = false;
        this.importCandidate = null;
        this.issueSearch.value = "";
        this.syncCursorState();
        if (response.resumed) {
          this.renderSessionState();
          this.showToast("已恢复这个站点未结束的走查");
        } else {
          this.showView("inspect");
          this.updateCounts();
          this.showToast("走查已开始 · 点击元素后记录问题");
        }
      } finally {
        this.sessionAction = null;
        this.startButton.disabled = false;
        this.startButton.textContent = "开始本次走查";
      }
    }

    async pauseSession() {
      if (this.sessionAction || !this.session || this.session.status !== "active") return;
      this.sessionAction = "pausing";
      try {
        const response = await this.sendMessage({ type: "UIDELTA_SET_SESSION_STATUS", sessionId: this.session.id, status: "paused" });
        if (!response || !response.ok) {
          this.showToast((response && response.error) || "无法暂停本次走查");
          await this.refreshState();
          this.renderSessionState();
          return;
        }
        this.session = response.session;
        this.setInteractionMode(false);
        this.resetInspection();
        this.syncCursorState();
        this.showView("paused");
        this.renderPins();
        this.showToast("本次走查已暂停");
      } finally {
        this.sessionAction = null;
      }
    }

    async resumeSession() {
      if (this.sessionAction || !this.session || this.session.status !== "paused") return;
      this.sessionAction = "resuming";
      try {
        const response = await this.sendMessage({ type: "UIDELTA_SET_SESSION_STATUS", sessionId: this.session.id, status: "active" });
        if (!response || !response.ok) {
          this.showToast((response && response.error) || "无法继续本次走查");
          await this.refreshState();
          this.renderSessionState();
          return;
        }
        this.session = response.session;
        this.syncCursorState();
        this.showView("inspect");
        this.showToast("走查已继续 · 点击元素开始检查");
      } finally {
        this.sessionAction = null;
      }
    }

    async endSession() {
      if (this.sessionAction || !this.session) return;
      if (!window.confirm("结束本次走查并下载最终证据包？")) return;
      this.sessionAction = "ending";
      try {
        const response = await this.sendMessage({ type: "UIDELTA_FINALIZE_SESSION", sessionId: this.session.id });
        if (!response || !response.ok) {
          this.showToast((response && response.error) || "证据包导出失败，本次走查尚未结束");
          await this.refreshState();
          this.renderSessionState();
          return;
        }
        this.session = null;
        this.issues = [];
        this.issueFilter = "all";
        this.issueSearchQuery = "";
        this.deliverySelection = new Set();
        this.deliverySelectionTouched = false;
        this.importCandidate = null;
        this.issueSearch.value = "";
        this.resetInspection();
        this.clearVisuals();
        this.updateCounts();
        this.syncCursorState();
        this.showView("start");
        const location = response.downloadPath || "Chrome 默认下载文件夹";
        this.showToast("证据包已下载：" + (response.filename || "UIDelta.zip") + " · " + location + " · 本次走查已结束");
      } finally {
        this.sessionAction = null;
      }
    }

    onPointerMove(event) {
      // Finish canvas gestures before hover/UI hit testing: the growing box
      // itself (or a pin/toolbar) may now be underneath the pointer.
      if (this.regionSelection || this.regionEdit) {
        if (event.buttons === 0) { this.cancelRegionGesture(); return; }
        if (this.regionSelection) this.updateRegionSelection(event.clientX, event.clientY);
        else this.updateRegionEdit(event.clientX, event.clientY);
        return;
      }
      if (this.updatePinHover(event)) return;
      if (this.browseMode) return;
      if (this.regionEdit) {
        this.updateRegionEdit(event.clientX, event.clientY);
        return;
      }
      if (!this.enabled || !this.isSessionActive() || this.interactionDown || this.panelDrag || this.uiEditorDrag || !this.isCanvasInteractionView()) return;
      if (this.isUiEvent(event)) {
        const pin = event.composedPath().find((node) => node?.dataset?.action === "open-pin");
        if (pin && pin !== this.lastHoverPin) {
          const issue = this.issues.find((item) => item.id === pin.dataset.issueId);
          if (issue) this.showPinTooltip(pin, issue);
          this.lastHoverPin = pin;
          this.lastHoverTarget = null;
        }
        return;
      }
      if (this.inspectMode === "region") {
        if (this.regionSelection) this.updateRegionSelection(event.clientX, event.clientY);
        return;
      }
      // Command/Control is the explicit "pierce through selected container"
      // gesture. Plain hover stays predictable; held Command reaches nested UI.
      const pierceNow = Boolean(event.metaKey || event.ctrlKey);
      const target = this.getTarget(event, pierceNow);
      const modifierNow = false;
      if (modifierNow !== this.modifierDown) this.setModifier(modifierNow);
      if (pierceNow !== this.pierceDown) this.setPierce(pierceNow);
      if (!target) return;
      if (target === this.lastHoverTarget) return;
      const issue = this.issueForHover(target, event.clientX, event.clientY);
      this.lastHoverTarget = target;
      this.lastHoverIssue = issue;
      this.lastHoverPin = null;
      this.hovered = target;
      // A locked selection remains the A point. Hovering other elements keeps
      // the selected target intact and only updates the A/B measurements.
      const lockedSelection = this.selectionLocked && this.selected?.isConnected;
      if (lockedSelection) {
        if (target === this.selected) this.renderSelected(this.selected, { x: event.clientX, y: event.clientY });
        else this.renderComparison(this.selected, target);
        return;
      }
      // UI properties are only shown for a clicked target.
      if (this.inspectMode === "ui") {
        this.renderHover(target, false, issue);
        return;
      }
      if (this.inspectMode === "annotation") {
        this.renderHover(target, false, issue);
      } else if (this.selected?.isConnected && target !== this.selected) {
        this.renderComparison(this.selected, target);
      } else {
        this.renderHover(target, false, issue);
      }
      // Hover is only a candidate. A click below confirms and locks it.
      const state = this.selected?.isConnected && target !== this.selected
        ? (pierceNow ? "穿透测距" : "悬停测距")
        : (issue ? "已标注 " + issue.displayId : "悬停");
      this.updateInspector(target, state, { compare: false });
    }

    onDocumentPointerDown(event) {
      if (this.browseMode) return;
      if (!this.enabled || !this.isSessionActive() || this.interactionDown || event.button !== 0 || this.isUiEvent(event)) return;
      if (this.currentView !== "inspect") return;
      if (this.inspectMode === "region") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.startRegionSelection(event.clientX, event.clientY);
        return;
      }
      const target = this.getTarget(event, Boolean(event.metaKey || event.ctrlKey));
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.selectPageTarget(target, { x: event.clientX, y: event.clientY });
    }

    onDocumentClick(event) {
      if (this.browseMode) return;
      if (!this.enabled || !this.isSessionActive() || this.interactionDown || event.button !== 0 || this.isUiEvent(event)) return;
      if (this.currentView !== "inspect" || this.inspectMode === "region") return;
      // Prevent links, buttons and other host controls from receiving the click
      // that is reserved for selecting the review target.
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    selectPageTarget(target, pointer = {}) {
      if (!target?.isConnected) return;
      const now = performance.now();
      if (target === this.lastSelectionTarget && now - this.lastSelectionAt < 160) return;
      this.lastSelectionTarget = target;
      this.lastSelectionAt = now;
      this.selected = target;
      this.hovered = target;
      this.selectionLocked = true;
      this.lastHoverTarget = target;
      this.lastHoverIssue = this.issueForHover(target, pointer.x, pointer.y);
      this.lastHoverPin = null;
      this.renderSelected(target, pointer);
      this.updateInspector(target, "已选中", { compare: false });
    }

    onDocumentPointerUp(event) {
      if (this.browseMode) return;
      if (this.regionEdit && event.button === 0) {
        this.endRegionEdit();
        return;
      }
      if (this.regionSelection && event.button === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.finishRegionSelection(event.clientX, event.clientY);
        return;
      }
      // Non-region pointer ups stay with the host page for the same reason as
      // clicks: reviewing must not disrupt application behaviour.
    }

    onKeyDown(event) {
      // In inspection mode the page input keeps focus for its focus ring,
      // but physical R belongs to the inspector, including an IME's 229 event.
      const pageRecordKey = event.code === "KeyR" && !this.isUiEvent(event)
        && this.currentView === "inspect" && !this.interactionDown
        && Boolean(this.pendingRegionRect || this.selected?.isConnected || this.hovered?.isConnected);
      if (!this.enabled || this.browseMode || ((event.isComposing || event.keyCode === 229) && !pageRecordKey)) return;
      if (event.key === "Escape" && (this.deliveryHoverState || this.deliveryHoverOpenTimer)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.hideDeliveryExampleHover();
        return;
      }
      const typing = this.isTypingTarget(event);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.preview && !this.preview.hidden) {
          this.closeImagePreview();
        } else this.minimizePanel();
        return;
      }
      if (this.isSessionActive() && (event.altKey || event.key === "Alt")) this.setModifier(false);
      if (this.isSessionActive() && (event.metaKey || event.ctrlKey || event.key === "Meta" || event.key === "Control")) this.setPierce(true);
      if (this.preview && !this.preview.hidden && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.switchPreview(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (!typing && !this.isUiEvent(event) && event.code === "Space" && this.currentView === "inspect" && this.isSessionActive()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setInteractionMode(true);
        return;
      }
      const dockOpen = this.dock && this.dock.style.display === "flex";
      const canRecordFromCurrentState = this.isCanvasInteractionView() || dockOpen;
      const isRecordShortcut = event.code === "KeyR"
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !event.shiftKey
        && !event.repeat
        && (!event.isComposing || pageRecordKey)
        && (!typing || pageRecordKey)
        && !this.interactionDown
        && canRecordFromCurrentState
        && this.isSessionActive();
      if (isRecordShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const measurement = this.currentMeasurement
          || (this.lastMeasurementSource === this.selected ? this.lastMeasurement : null);
        if (this.pendingRegionRect) this.confirmRegionSelection();
        else this.openComposer(undefined, measurement ? structuredClone(measurement) : null);
        return;
      }
      if (typing) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && this.currentView === "composer") {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.saveComposer();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.key.toLowerCase() === "i" && this.session && this.currentView !== "composer") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.restorePanel();
        this.showView("inbox");
      }
    }

    onKeyUp(event) {
      if (this.browseMode) return;
      if (this.enabled && this.interactionDown && event.code === "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setInteractionMode(false);
        return;
      }
      if (!this.enabled) return;
      const typing = this.isTypingTarget(event);
      if (!event.altKey || event.key === "Alt") this.setModifier(false);
      if ((!event.metaKey && !event.ctrlKey) || event.key === "Meta" || event.key === "Control") this.setPierce(false);
      // A keyup bubbles from the editor input after every character. Refreshing
      // the inspector here replaces the whole field tree and consequently
      // drops focus. Let focused form controls own their complete key cycle.
      if (typing) return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (this.currentView === "composer") {
        this.renderComposerOverlay();
        return;
      }
      if (this.isCanvasInteractionView() && this.selected) {
        this.renderSelected(this.selected);
        this.updateInspector(this.selected);
      }
    }

    onWindowBlur() {
      this.cancelRegionGesture();
      this.hidePinTooltip();
      this.hideDeliveryExampleHover();
      if (!this.enabled || this.browseMode) return;
      if (this.interactionDown) this.setInteractionMode(false);
      if (this.modifierDown) this.setModifier(false);
      if (this.pierceDown) this.setPierce(false);
      if (this.currentView === "composer") {
        this.renderComposerOverlay();
        return;
      }
      if (this.isCanvasInteractionView() && this.selected) {
        if (this.selectionLocked && this.hovered?.isConnected && this.hovered !== this.selected) this.renderComparison(this.selected, this.hovered);
        else this.renderSelected(this.selected);
        // Losing window focus is not a selection change. Keep incomplete
        // drafts and the native color/select control tree intact.
      }
    }

    onLayoutChange(event) {
      if (event?.target === this.tooltip && this.tooltip?.dataset?.pinIssueId) return;
      this.hidePinTooltip();
      this.hideDeliveryExampleHover();
      if (!this.enabled) return;
      if (this.currentView === "composer") {
        this.renderComposerOverlay();
      } else if (this.isCanvasInteractionView() && !this.interactionDown) {
        if (this.selected && !this.selected.isConnected) {
          this.selected = null;
          this.selectionLocked = false;
          this.lastHoverTarget = null;
          this.clearVisuals();
          this.renderUiEditor(null);
        }
        if (this.selectionLocked && this.selected?.isConnected && this.hovered?.isConnected && this.hovered !== this.selected) {
          this.renderComparison(this.selected, this.hovered);
        } else if (this.selected) {
          this.renderSelected(this.selected);
        } else if (this.hovered?.isConnected) {
          this.renderHover(this.hovered);
        }
      }
      this.renderPins();
      this.clampPanelToViewport();
    }

    setModifier(active) {
      this.modifierDown = active;
      this.syncCursorState();
    }

    setPierce(active) {
      this.pierceDown = Boolean(active);
      this.syncCursorState();
    }

    setInteractionMode(active) {
      this.interactionDown = Boolean(active);
      this.syncCursorState();
      if (this.interactionDown) {
        this.hoverBox.style.display = "none";
        this.selectedBox.style.display = "none";
        this.tooltip.style.display = "none";
        this.measurements.replaceChildren();
        this.renderPins();
      } else if (this.selected) {
        this.pinsLayer.style.display = "";
        this.renderPins();
        this.renderSelected(this.selected);
        this.updateInspector(this.selected);
      } else {
        this.pinsLayer.style.display = "";
        this.renderPins();
      }
    }

    syncCursorState() {
      const inspecting = this.enabled && !this.browseMode && this.session?.status !== "paused" && this.currentView === "inspect" && !this.interactionDown;
      document.documentElement.classList.toggle(ACTIVE_CLASS, inspecting);
      document.documentElement.classList.toggle(MEASURE_CLASS, inspecting && this.modifierDown);
      document.documentElement.classList.toggle(PIERCE_CLASS, inspecting && this.pierceDown);
    }

    isUiEvent(event) {
      return event.composedPath().includes(this.host);
    }

    onToolbarPageEvent(event) {
      if (!this.enabled) return;
      const path = event.composedPath();
      if (!path.includes(this.host)) return;
      const target = path[0];
      if (!target?.dispatchEvent) return;
      // The isolation listener runs before the document gesture listener.
      // A release over our box must still terminate the active canvas drag.
      if (event.type === "pointerup" && (this.regionSelection || this.regionEdit)) {
        this.onDocumentPointerUp(event);
      }
      if (event.type === "pointercancel") this.cancelRegionGesture();
      const keyboard = event.type.startsWith("key");
      if (keyboard) {
        // Keep host modal Tab/Escape traps out, while retaining our shortcuts
        // and the original trusted event's typing / native focus default.
        event.stopImmediatePropagation();
        if (event.type === "keydown") this.onKeyDown(event);
        if (event.type === "keyup") this.onKeyUp(event);
        if (event.defaultPrevented) return;
      }
      const toolbar = path.some((node) => node === this.modeToolbar || node?.dataset?.mode);
      // Native inputs retain their trusted click/default action (caret,
      // checkbox pre-activation, file picker). Never activate them twice.
      if (event.type === "click" && target.matches?.("input,textarea,select,label")) {
        event.stopImmediatePropagation();
        if (target.matches(".issue-select")) this.toggleDeliveryIssue(target.dataset.deliveryIssueId, target.checked);
        return;
      }
      // Prevent the pointer default from blurring the page's date input.
      // Stopping only the shadow-root bubble is too late for document capture.
      // Cancelling touchstart suppresses its compatibility click entirely.
      // Pointerdown already protects focus; keep the native touch activation.
      if (toolbar && !keyboard && !event.type.startsWith("touch") && !event.type.includes("focus") && event.type !== "blur") event.preventDefault();
      event.stopImmediatePropagation();
      const init = { bubbles:true, cancelable:true, composed:false, view:window };
      for (const key of ["key", "code", "keyCode", "which", "location", "repeat", "isComposing", "detail", "screenX", "screenY", "clientX", "clientY", "button", "buttons", "ctrlKey", "shiftKey", "altKey", "metaKey", "relatedTarget", "pointerId", "pointerType", "isPrimary", "width", "height", "pressure", "tiltX", "tiltY", "touches", "targetTouches", "changedTouches"]) {
        if (event[key] !== undefined) init[key] = event[key];
      }
      if (!target.dispatchEvent(new event.constructor(event.type, init))) event.preventDefault();
    }

    onInspectionFocusLeave(event) {
      if (!this.enabled || this.browseMode || this.isUiEvent(event)) return;
      // Typing in the issue form is an inspector action, not a dismissal of
      // the page's focused popup. Do not suppress page-to-page focus changes.
      if (event.relatedTarget === this.host || (event.relatedTarget && this.shadow.contains(event.relatedTarget))) {
        event.stopImmediatePropagation();
      }
    }

    isTypingTarget(event) {
      const target = event.composedPath()[0];
      return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    }

    isCanvasInteractionView() {
      // The composer owns a frozen target, not whichever element is under
      // the pointer after scrolling. Resume hover inspection on return only.
      return !this.browseMode && this.currentView === "inspect";
    }

    getTarget(event, pierce) {
      if (this.isUiEvent(event)) return null;
      const target = event.composedPath().find((node) => node instanceof Element && node !== this.host) || null;
      if (!target || target === document.documentElement || target === document.body) return null;
      if (target.closest("[" + ROOT_ATTRIBUTE + "]")) return null;

      if (pierce && this.selected && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const layers = this.deepElementsFromPoint(event.clientX, event.clientY).filter((element) => !element.closest("[" + ROOT_ATTRIBUTE + "]"));
        const selectedIndex = layers.indexOf(this.selected);
        if (selectedIndex >= 0) {
          const nested = layers.slice(0, selectedIndex).find((element) => this.selected.contains(element));
          if (nested) return nested;
          if (layers[selectedIndex + 1]) return layers[selectedIndex + 1];
        }
      }
      if (this.isTransparentViewportShell(target) && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        return this.targetBelowViewportShell(target, event.clientX, event.clientY) || target;
      }
      return target;
    }

    isTransparentViewportShell(element) {
      if (!element || element === this.host || !/^(DIV|SECTION|ASIDE)$/i.test(element.tagName || "")) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < window.innerWidth * .9 || rect.height < window.innerHeight * .9) return false;
      const style = window.getComputedStyle(element);
      if (!/^(fixed|absolute)$/.test(style.position)) return false;
      if (style.backgroundImage !== "none" || style.backdropFilter && style.backdropFilter !== "none") return false;
      const color = style.backgroundColor.replace(/\s+/g, "");
      if (color !== "transparent" && color !== "rgba(0,0,0,0)" && !/\/0%?\)$/.test(color)) return false;
      if (this.visibleBoxShadows(style.boxShadow)) return false;
      if (["Top","Right","Bottom","Left"].some(side => parseFloat(style[`border${side}Width`]) > 0)) return false;
      // A portal may contain a small search box. Its empty full-screen shell
      // is not the search box; actual child hits still use the regular path.
      return !Array.from(element.childNodes).some(node => node.nodeType === 3 && node.textContent.trim());
    }

    targetBelowViewportShell(shell, x, y) {
      const restores = [];
      const skipped = new Set();
      const override = (node, value) => {
        const before = node.style.getPropertyValue("pointer-events"), priority = node.style.getPropertyPriority("pointer-events");
        node.style.setProperty("pointer-events", value, "important");
        restores.push(() => { if (before) node.style.setProperty("pointer-events", before, priority); else node.style.removeProperty("pointer-events"); });
      };
      try {
        // Some modal libraries set body pointer-events:none. Restore hit
        // testing only synchronously; no page click is dispatched underneath.
        for (const root of [document.documentElement, document.body]) {
          if (root && window.getComputedStyle(root).pointerEvents === "none") override(root, "auto");
        }
        let current = shell;
        for (let depth = 0; current && depth < 8; depth++) {
          skipped.add(current);
          override(current, "none");
          const next = this.deepElementsFromPoint(x,y).find(node => node !== this.host
            && node !== document.body && node !== document.documentElement
            && !node.closest("[" + ROOT_ATTRIBUTE + "]") && !skipped.has(node));
          if (!next) return null;
          if (!this.isTransparentViewportShell(next)) return next;
          if (next === current) return null;
          current = next;
        }
        return null;
      } finally {
        for (const restore of restores.reverse()) restore();
      }
    }

    deepElementsFromPoint(x, y) {
      const result = [];
      const visitedRoots = new Set();
      const visit = (root) => {
        if (!root || visitedRoots.has(root) || typeof root.elementsFromPoint !== "function") return;
        visitedRoots.add(root);
        for (const element of root.elementsFromPoint(x, y)) {
          if (!result.includes(element)) result.push(element);
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(document);
      return result;
    }

    renderHover(element, keepSelection = false, issue = null) {
      if (this.browseMode) return;
      this.currentMeasurement = null;
      this.measurementTarget = null;
      this.lastMeasurement = null;
      this.lastMeasurementSource = null;
      this.lastMeasurementTarget = null;
      this.showBox(this.hoverBox, element);
      if (keepSelection && this.selected?.isConnected) this.showBox(this.selectedBox, this.selected);
      else this.selectedBox.style.display = "none";
      this.measurements.replaceChildren();
      // Browsing feedback: show the nearest neighbouring distances immediately,
      // without treating an unclicked hover as evidence to be recorded.
      // A recorded measurement has priority over exploratory spacing. Its
      // anchors are resolved again at the current scroll position so a saved
      // annotation follows the page instead of replaying stale screen pixels.
      const recordedMeasurement = issue ? this.resolveIssueMeasurement(issue, element) : null;
      const surroundings = recordedMeasurement || this.buildSurroundingMeasurementSnapshot(element);
      if (surroundings) this.renderMeasurementSnapshot(surroundings);
      this.showTooltip(element, issue ? "已标注 " + issue.displayId + (recordedMeasurement ? " · 标注间距" : "") : "悬停");
      // The visible distances belong to the hovered target, not the previously
      // clicked A point. Hide its record affordance until the user confirms a
      // target with a click, avoiding a misleading A/B mismatch.
      if (keepSelection) this.recordPrompt?.classList.remove("visible");
    }

    renderSelected(element, pointer = {}) {
      if (this.browseMode) return;
      this.currentMeasurement = null;
      this.selectedBox.classList.toggle("ui-selected", this.inspectMode === "ui");
      this.showBox(this.selectedBox, element);
      this.hoverBox.style.display = "none";
      // A click chooses a reference only. Containers compare to their nearest
      // direct child; leaf elements compare to their direct parent.
      const selectedMeasurement = this.buildSelectedMeasurementSnapshot(element, pointer.x, pointer.y);
      this.currentMeasurement = selectedMeasurement;
      this.measurementTarget = selectedMeasurement?.to ? this.resolveAnchor(selectedMeasurement.to) || element : element;
      if (selectedMeasurement) this.renderMeasurementSnapshot(selectedMeasurement);
      else this.measurements.replaceChildren();
      const childMeasurement = selectedMeasurement?.kind === "child";
      this.showTooltip(element, selectedMeasurement ? (childMeasurement ? "已选中 · 子级间距" : "已选中 · 父级间距") : "已选中");
      this.showRecordPrompt(this.measurementTarget || element, Boolean(selectedMeasurement));
    }

    renderComparison(from, to) {
      if (this.browseMode) return;
      this.showBox(this.selectedBox, from);
      this.showBox(this.hoverBox, to);
      this.showTooltip(to, this.pierceDown ? "穿透测距" : "悬停测距");
      this.measurements.replaceChildren();
      const first = from.getBoundingClientRect();
      const second = to.getBoundingClientRect();
      const snapshot = this.buildMeasurementSnapshot(from, to, first, second);
      this.currentMeasurement = snapshot;
      this.measurementTarget = to;
      this.lastMeasurement = null;
      this.lastMeasurementSource = null;
      this.lastMeasurementTarget = null;
      this.renderMeasurementSnapshot(snapshot);
      this.showTooltip(to, this.pierceDown ? "穿透测距" : "悬停测距");
      this.updateRecordButton(true);
      this.showRecordPrompt(to, true);
    }

    updateModeControls() {
      const labels = {
        ui: "UI 模式：点击元素后试改。",
        annotation: "点击固定 · 悬停测距 · R 记录",
        region: "框选模式：拖拽区域后记录。"
      };
      for (const button of this.shadow.querySelectorAll("[data-mode]")) {
        const active = !this.browseMode && button.dataset.mode === this.inspectMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        if (button.closest(".mode-toolbar")) {
          button.removeAttribute("aria-selected");
          button.setAttribute("aria-pressed", String(active));
        }
      }
      this.modeToolbar?.classList.toggle("annotation-active", this.inspectMode === "annotation");
      const hint = this.shadow.querySelector(".mode-hint");
      if (hint) hint.textContent = labels[this.inspectMode] || labels.annotation;
    }

    setInspectMode(mode) {
      if (!['ui', 'annotation', 'region'].includes(mode)) return;
      this.cancelToolbarTransition();
      this.inspectMode = mode;
      this.lastHoverTarget = null;
      this.regionSelection = null;
      this.pendingRegionRect = null;
      this.regionBox.style.display = "none";
      this.regionBox.classList.remove("editable");
      this.recordPrompt?.classList.remove("visible");
      if (mode === "region") this.showToast("自由框选已开启 · 拖拽区域后松开即可记录");
      else if (this.selected) this.renderSelected(this.selected);
      if (this.previewTools && mode !== "ui") this.previewTools.classList.remove("visible");
      this.updateModeControls();
      this.syncModeSurfaces();
      if (mode === "ui") {
        if (this.selected) this.updateInspector(this.selected);
        else this.renderUiEditor(null);
      } else if (this.selected) {
        this.updateInspector(this.selected);
      }
    }

    showRecordPrompt(element) {
      if (!this.recordPrompt || this.inspectMode !== "annotation" || !element?.isConnected || !this.isCanvasInteractionView()) {
        this.recordPrompt?.classList.remove("visible");
        return;
      }
      const target = element.getBoundingClientRect();
      if (!this.isVisible(target)) {
        this.recordPrompt.classList.remove("visible");
        return;
      }
      // Make it measurable first, then choose a placement that does not cover
      // the selected element, its blue label, or the active measurement marks.
      this.recordPrompt.style.visibility = "hidden";
      this.recordPrompt.classList.add("visible");
      const width = this.recordPrompt.offsetWidth;
      const height = this.recordPrompt.offsetHeight;
      const gap = 12;
      const candidates = [
        { left: target.right + gap, top: target.top + (target.height - height) / 2 },
        { left: target.left - width - gap, top: target.top + (target.height - height) / 2 },
        { left: target.right - width, top: target.top - height - gap },
        { left: target.left, top: target.bottom + gap }
      ].map((candidate) => ({
        left: this.clamp(candidate.left, 8, Math.max(8, window.innerWidth - width - 8)),
        top: this.clamp(candidate.top, 8, Math.max(8, window.innerHeight - height - 8))
      }));
      const protectedRects = [target];
      if (this.tooltip.style.display !== "none") protectedRects.push(this.tooltip.getBoundingClientRect());
      for (const marker of [...this.measurements.children, ...Array.from(this.measurements.querySelectorAll?.(".badge") || [])]) {
        const rect = marker.getBoundingClientRect();
        if (rect.width || rect.height) protectedRects.push(rect);
      }
      const overlaps = (candidate, rect) => {
        const padding = 6;
        return candidate.left < rect.right + padding && candidate.left + width > rect.left - padding
          && candidate.top < rect.bottom + padding && candidate.top + height > rect.top - padding;
      };
      let placement = candidates.find((candidate) => !protectedRects.some((rect) => overlaps(candidate, rect))) || candidates[0];
      if (target.width <= 80 || target.height <= 80) {
        const expanded = [...candidates];
        for (const distance of [36,64,96,132,176]) expanded.push(
          {left:target.right+distance,top:target.top},
          {left:target.left-width-distance,top:target.top},
          {left:target.left,top:target.bottom+distance},
          {left:target.left,top:target.top-height-distance});
        placement = this.placeMeasurementOverlay(width,height,expanded,protectedRects);
      }
      this.recordPrompt.style.left = placement.left + "px";
      this.recordPrompt.style.top = placement.top + "px";
      this.recordPrompt.style.visibility = "";
    }

    startRegionSelection(x, y) {
      this.regionEdit = null;
      this.pendingRegionRect = null;
      this.regionBox.classList.remove("editable");
      this.regionSelection = { startX: x, startY: y, endX: x, endY: y };
      this.updateRegionSelection(x, y);
    }

    updateRegionSelection(x, y) {
      if (!this.regionSelection) return;
      this.regionSelection.endX = x;
      this.regionSelection.endY = y;
      const rect = this.regionRectFromSelection(this.regionSelection);
      this.regionBox.style.display = "block";
      this.regionBox.style.left = rect.left + "px";
      this.regionBox.style.top = rect.top + "px";
      this.regionBox.style.width = rect.width + "px";
      this.regionBox.style.height = rect.height + "px";
    }

    finishRegionSelection(x, y) {
      if (!this.regionSelection) return;
      this.updateRegionSelection(x, y);
      const rect = this.regionRectFromSelection(this.regionSelection);
      this.regionSelection = null;
      if (rect.width < 12 || rect.height < 12) {
        this.regionBox.style.display = "none";
        this.showToast("框选区域太小，请拖拽一个需要取证的范围");
        return;
      }
      this.pendingRegionRect = rect;
      this.renderPendingRegion();
    }

    renderPendingRegion() {
      const rect = this.pendingRegionRect;
      if (!rect) return;
      this.regionBox.classList.add("editable");
      this.regionBox.style.display = "block";
      this.regionBox.style.left = rect.left + "px";
      this.regionBox.style.top = rect.top + "px";
      this.regionBox.style.width = rect.width + "px";
      this.regionBox.style.height = rect.height + "px";
    }

    beginRegionEdit(event) {
      if (!this.pendingRegionRect || event.button !== 0) return;
      if (event.target.closest?.("[data-action='record-region']")) return;
      event.preventDefault();
      event.stopPropagation();
      this.regionEdit = {
        mode: event.target.dataset.regionHandle || "move",
        startX: event.clientX,
        startY: event.clientY,
        rect: { ...this.pendingRegionRect }
      };
    }

    updateRegionEdit(x, y) {
      if (!this.regionEdit) return;
      const source = this.regionEdit.rect;
      const dx = x - this.regionEdit.startX;
      const dy = y - this.regionEdit.startY;
      const mode = this.regionEdit.mode;
      let left = source.left;
      let top = source.top;
      let right = source.right;
      let bottom = source.bottom;
      if (mode === "move") { left += dx; right += dx; top += dy; bottom += dy; }
      if (mode.includes("w")) left += dx;
      if (mode.includes("e")) right += dx;
      if (mode.includes("n")) top += dy;
      if (mode.includes("s")) bottom += dy;
      const width = Math.max(24, right - left);
      const height = Math.max(24, bottom - top);
      if (mode === "move") {
        left = this.clamp(left, 0, Math.max(0, window.innerWidth - width));
        top = this.clamp(top, 0, Math.max(0, window.innerHeight - height));
      }
      this.pendingRegionRect = { left, top, right: left + width, bottom: top + height, width, height };
      this.renderPendingRegion();
    }

    endRegionEdit() {
      this.regionEdit = null;
    }

    cancelRegionGesture() {
      if (this.regionSelection) {
        this.regionSelection = null;
        this.regionBox.classList.remove("editable");
        this.regionBox.style.display = "none";
      }
      this.regionEdit = null;
    }

    confirmRegionSelection() {
      if (!this.pendingRegionRect) return;
      const region = { ...this.pendingRegionRect };
      this.pendingRegionRect = null;
      this.regionBox.classList.remove("editable");
      this.regionBox.style.display = "none";
      this.openComposer(undefined, null, region);
    }

    regionRectFromSelection(selection) {
      const left = this.clamp(Math.min(selection.startX, selection.endX), 0, window.innerWidth);
      const top = this.clamp(Math.min(selection.startY, selection.endY), 0, window.innerHeight);
      const right = this.clamp(Math.max(selection.startX, selection.endX), 0, window.innerWidth);
      const bottom = this.clamp(Math.max(selection.startY, selection.endY), 0, window.innerHeight);
      return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }

    buildMeasurementSnapshot(from, to, first = from.getBoundingClientRect(), second = to.getBoundingClientRect()) {
      const fromContainsTo = this.composedContains(from, to);
      const toContainsFrom = this.composedContains(to, from);
      if (fromContainsTo || toContainsFrom) {
        const outer = fromContainsTo ? first : second;
        const inner = fromContainsTo ? second : first;
        const gaps = {
          left: Math.max(0, inner.left - outer.left),
          right: Math.max(0, outer.right - inner.right),
          top: Math.max(0, inner.top - outer.top),
          bottom: Math.max(0, outer.bottom - inner.bottom)
        };
        const middleY = this.clamp((Math.max(outer.top, inner.top) + Math.min(outer.bottom, inner.bottom)) / 2, 9, window.innerHeight - 9);
        const middleX = this.clamp((Math.max(outer.left, inner.left) + Math.min(outer.right, inner.right)) / 2, 9, window.innerWidth - 9);
        const segments = [];
        if (gaps.left > 0.5) segments.push({ axis: "horizontal", x: outer.left, y: middleY, length: gaps.left, value: Math.round(gaps.left) });
        if (gaps.right > 0.5) segments.push({ axis: "horizontal", x: inner.right, y: middleY, length: gaps.right, value: Math.round(gaps.right) });
        if (gaps.top > 0.5) segments.push({ axis: "vertical", x: middleX, y: outer.top, length: gaps.top, value: Math.round(gaps.top) });
        if (gaps.bottom > 0.5) segments.push({ axis: "vertical", x: middleX, y: inner.bottom, length: gaps.bottom, value: Math.round(gaps.bottom) });
        return {
          from: this.elementAnchor(from),
          to: this.elementAnchor(to),
          fromRect: this.rectSnapshot(first),
          toRect: this.rectSnapshot(second),
          segments,
          overlap: !segments.length
        };
      }
      const horizontal = this.getGap(first.left, first.right, second.left, second.right);
      const vertical = this.getGap(first.top, first.bottom, second.top, second.bottom);
      const segments = [];
      if (horizontal) {
        const overlapStart = Math.max(first.top, second.top);
        const overlapEnd = Math.min(first.bottom, second.bottom);
        const y = overlapStart <= overlapEnd ? (overlapStart + overlapEnd) / 2 : this.clamp((first.top + first.bottom + second.top + second.bottom) / 4, 9, window.innerHeight - 9);
        segments.push({ axis: "horizontal", x: horizontal.start, y, length: horizontal.end - horizontal.start, value: horizontal.value });
      }
      if (vertical) {
        const overlapStart = Math.max(first.left, second.left);
        const overlapEnd = Math.min(first.right, second.right);
        const x = overlapStart <= overlapEnd ? (overlapStart + overlapEnd) / 2 : this.clamp((first.left + first.right + second.left + second.right) / 4, 9, window.innerWidth - 9);
        segments.push({ axis: "vertical", x, y: vertical.start, length: vertical.end - vertical.start, value: vertical.value });
      }
      return {
        from: this.elementAnchor(from),
        to: this.elementAnchor(to),
        fromRect: this.rectSnapshot(first),
        toRect: this.rectSnapshot(second),
        segments,
        overlap: !horizontal && !vertical
      };
    }

    buildParentMeasurementSnapshot(element) {
      const parent = element?.parentElement;
      if (!parent || !element.isConnected || !parent.isConnected) return null;
      const outer = parent.getBoundingClientRect();
      const inner = element.getBoundingClientRect();
      if (!this.isVisible(outer) || !this.isVisible(inner)) return null;
      const left = Math.max(0, inner.left - outer.left);
      const right = Math.max(0, outer.right - inner.right);
      const top = Math.max(0, inner.top - outer.top);
      const bottom = Math.max(0, outer.bottom - inner.bottom);
      const middleY = this.clamp((Math.max(outer.top, inner.top) + Math.min(outer.bottom, inner.bottom)) / 2, 9, window.innerHeight - 9);
      const middleX = this.clamp((Math.max(outer.left, inner.left) + Math.min(outer.right, inner.right)) / 2, 9, window.innerWidth - 9);
      const segments = [];
      if (left > 0.5) segments.push({ axis: "horizontal", x: outer.left, y: middleY, length: left, value: this.round(left) });
      if (right > 0.5) segments.push({ axis: "horizontal", x: inner.right, y: middleY, length: right, value: this.round(right) });
      if (top > 0.5) segments.push({ axis: "vertical", x: middleX, y: outer.top, length: top, value: this.round(top) });
      if (bottom > 0.5) segments.push({ axis: "vertical", x: middleX, y: inner.bottom, length: bottom, value: this.round(bottom) });
      return {
        kind: "parent",
        from: this.elementAnchor(parent),
        to: this.elementAnchor(element),
        fromRect: this.rectSnapshot(outer),
        toRect: this.rectSnapshot(inner),
        segments,
        overlap: false,
        flush: !segments.length
      };
    }

    buildSelectedMeasurementSnapshot(element, pointerX, pointerY) {
      const parentRect = element?.getBoundingClientRect();
      if (!element || !parentRect || !this.isVisible(parentRect)) return null;
      const candidates = Array.from(element.children || [])
        .map((child) => ({ child, rect: child.getBoundingClientRect() }))
        .filter(({ rect }) => this.isVisible(rect) && rect.width > 2 && rect.height > 2)
        .filter(({ rect }) => Math.abs(rect.width - parentRect.width) > 1 || Math.abs(rect.height - parentRect.height) > 1);
      if (candidates.length) {
        const x = Number.isFinite(pointerX) ? pointerX : parentRect.left + parentRect.width / 2;
        const y = Number.isFinite(pointerY) ? pointerY : parentRect.top + parentRect.height / 2;
        const distance = ({ rect }) => {
          const dx = Math.max(rect.left - x, 0, x - rect.right);
          const dy = Math.max(rect.top - y, 0, y - rect.bottom);
          return dx * dx + dy * dy;
        };
        const closest = candidates.reduce((best, item) => distance(item) < distance(best) ? item : best);
        const snapshot = this.buildMeasurementSnapshot(element, closest.child, parentRect, closest.rect);
        snapshot.kind = "child";
        return snapshot;
      }
      return this.buildParentMeasurementSnapshot(element);
    }

    createRegionTracker(rect) {
      const element = this.deepElementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        .find((node) => node !== document.body && node !== document.documentElement && !node.closest("[" + ROOT_ATTRIBUTE + "]"));
      return { rect:{ ...rect }, element, elementRect:element ? this.rectSnapshot(element.getBoundingClientRect()) : null,
        scroll:{ x:window.scrollX, y:window.scrollY } };
    }

    lockComposerOverlay(composer = this.composer) {
      if (!composer || composer.overlayAnchor) return composer?.overlayAnchor || null;
      const issue = composer.issue;
      // Keep DOM references on the in-memory composer, never in its saved
      // issue. Resolve once: a recycled table row must not become a new target.
      const samePage = !issue.pageSnapshot?.url || issue.pageSnapshot.url === location.href;
      const measurement = issue.measurement;
      composer.overlayAnchor = {
        pageUrl:issue.pageSnapshot?.url || location.href,
        target:samePage ? composer.targetElement : null,
        from:samePage && measurement ? this.resolveAnchor(measurement.from) : null,
        to:samePage && measurement ? this.resolveAnchor(measurement.to) : null,
        region:issue.region ? composer.regionTracker || { rect:{ ...issue.region }, scroll:issue.pageSnapshot?.scroll || { x:0, y:0 } } : null
      };
      return composer.overlayAnchor;
    }

    isComposerElementCurrent(element, anchor) {
      if (!element?.isConnected) return false;
      // Virtualized tables can reuse a connected node for a different record.
      return !anchor?.text || this.textContent(element).slice(0, 160) === anchor.text;
    }

    visibleComposerRect(element, rect) {
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
      for (let parent = element?.parentElement || element?.getRootNode?.().host; parent; parent = parent.parentElement || parent.getRootNode?.().host) {
        const style = window.getComputedStyle?.(parent);
        if (!style) continue;
        const bounds = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      return right > left && bottom > top ? { left, top, right, bottom, width:right - left, height:bottom - top } : null;
    }

    composerGeometry(composer = this.composer) {
      const locked = this.lockComposerOverlay(composer);
      if (!locked || locked.pageUrl !== location.href) return null;
      if (locked.region) {
        const { rect, element, elementRect, scroll } = locked.region;
        if (element && !element.isConnected) return null;
        const current = element?.getBoundingClientRect();
        const dx = current ? current.left - elementRect.left : (scroll.x || 0) - window.scrollX;
        const dy = current ? current.top - elementRect.top : (scroll.y || 0) - window.scrollY;
        const region = { ...rect, left:rect.left + dx, right:rect.right + dx, top:rect.top + dy, bottom:rect.bottom + dy };
        const visible = this.visibleComposerRect(element, region);
        return visible ? { rect:region, visible, region:true } : null;
      }
      if (!this.isComposerElementCurrent(locked.target, composer.issue.elementAnchor)) return null;
      const rect = this.rectSnapshot(locked.target.getBoundingClientRect());
      const visible = this.visibleComposerRect(locked.target, rect);
      if (!visible) return null;
      const original = composer.issue.measurement;
      let measurement = null;
      if (original && this.isComposerElementCurrent(locked.from, original.from) && this.isComposerElementCurrent(locked.to, original.to)) {
        const fromRect = locked.from.getBoundingClientRect(), toRect = locked.to.getBoundingClientRect();
        if (this.visibleComposerRect(locked.from, fromRect) && this.visibleComposerRect(locked.to, toRect)) {
          measurement = this.buildMeasurementSnapshot(locked.from, locked.to, fromRect, toRect);
          measurement.kind = original.kind;
          if (original.kind === "parent") { measurement.flush = !measurement.segments.length; measurement.overlap = false; }
        }
      }
      return { rect, visible, target:locked.target, from:locked.from, to:locked.to, measurement };
    }

    renderComposerOverlay() {
      this.recordPrompt?.classList.remove("visible");
      this.tooltip.style.display = "none";
      this.selectedBox.style.display = "none";
      this.hoverBox.style.display = "none";
      this.regionBox.style.display = "none";
      this.measurements.replaceChildren();
      if (this.currentView !== "composer" || this.browseMode) return;
      const geometry = this.composerGeometry();
      if (!geometry) return;
      const paint = (box, rect) => Object.assign(box.style, { display:"block", left:rect.left + "px", top:rect.top + "px", width:rect.width + "px", height:rect.height + "px" });
      if (geometry.region) {
        this.regionBox.classList.remove("editable");
        paint(this.regionBox, geometry.visible);
      } else if (geometry.measurement) {
        paint(this.selectedBox, this.visibleComposerRect(geometry.from, geometry.measurement.fromRect));
        paint(this.hoverBox, this.visibleComposerRect(geometry.to, geometry.measurement.toRect));
        this.renderMeasurementSnapshot(geometry.measurement);
      } else paint(this.selectedBox, geometry.visible);
      // Do not change issue.measurement, currentMeasurement, the form tree,
      // or input focus: only the viewport projection follows the page.
    }

    resolveIssueMeasurement(issue, fallbackElement) {
      const measurement = issue?.measurement;
      if (!measurement) return null;
      const from = this.resolveAnchor(measurement.from);
      const to = this.resolveAnchor(measurement.to);
      if (measurement.kind === "parent") {
        return this.buildParentMeasurementSnapshot(to || fallbackElement);
      }
      if (from?.isConnected && to?.isConnected) return this.buildMeasurementSnapshot(from, to);
      // Old parent-gap evidence predates the explicit kind field. When both
      // anchors still resolve, the generic containment calculation recreates
      // the same four labelled distances.
      if (measurement.fromRect && measurement.toRect && from?.isConnected && (to || fallbackElement)?.isConnected) {
        return this.buildMeasurementSnapshot(from, to || fallbackElement);
      }
      return null;
    }

    buildSurroundingMeasurementSnapshot(element) {
      const parent = element?.parentElement;
      if (!parent || !element.isConnected) return null;
      const source = element.getBoundingClientRect();
      if (!this.isVisible(source)) return null;
      const siblings = Array.from(parent.children).filter((candidate) => candidate !== element && this.isVisible(candidate.getBoundingClientRect()));
      const nearest = { left: null, right: null, top: null, bottom: null };
      const overlaps = (startA, endA, startB, endB) => Math.min(endA, endB) - Math.max(startA, startB) > 0.5;
      const pick = (side, candidate, distance) => {
        if (distance <= 0.5 || (nearest[side] && nearest[side].distance <= distance)) return;
        nearest[side] = { candidate, distance };
      };
      for (const sibling of siblings) {
        const rect = sibling.getBoundingClientRect();
        if (rect.right <= source.left && overlaps(rect.top, rect.bottom, source.top, source.bottom)) pick("left", rect, source.left - rect.right);
        if (rect.left >= source.right && overlaps(rect.top, rect.bottom, source.top, source.bottom)) pick("right", rect, rect.left - source.right);
        if (rect.bottom <= source.top && overlaps(rect.left, rect.right, source.left, source.right)) pick("top", rect, source.top - rect.bottom);
        if (rect.top >= source.bottom && overlaps(rect.left, rect.right, source.left, source.right)) pick("bottom", rect, rect.top - source.bottom);
      }
      const segments = [];
      if (nearest.left) {
        const rect = nearest.left.candidate;
        segments.push({ axis: "horizontal", x: rect.right, y: (Math.max(rect.top, source.top) + Math.min(rect.bottom, source.bottom)) / 2, length: nearest.left.distance, value: this.round(nearest.left.distance) });
      }
      if (nearest.right) {
        const rect = nearest.right.candidate;
        segments.push({ axis: "horizontal", x: source.right, y: (Math.max(rect.top, source.top) + Math.min(rect.bottom, source.bottom)) / 2, length: nearest.right.distance, value: this.round(nearest.right.distance) });
      }
      if (nearest.top) {
        const rect = nearest.top.candidate;
        segments.push({ axis: "vertical", x: (Math.max(rect.left, source.left) + Math.min(rect.right, source.right)) / 2, y: rect.bottom, length: nearest.top.distance, value: this.round(nearest.top.distance) });
      }
      if (nearest.bottom) {
        const rect = nearest.bottom.candidate;
        segments.push({ axis: "vertical", x: (Math.max(rect.left, source.left) + Math.min(rect.right, source.right)) / 2, y: source.bottom, length: nearest.bottom.distance, value: this.round(nearest.bottom.distance) });
      }
      if (segments.length) {
        return {
          kind: "surroundings",
          from: this.elementAnchor(element),
          to: this.elementAnchor(parent),
          fromRect: this.rectSnapshot(source),
          toRect: this.rectSnapshot(parent.getBoundingClientRect()),
          segments,
          overlap: false
        };
      }
      // A lone item still has a useful surrounding: its containing parent.
      return this.buildParentMeasurementSnapshot(element);
    }

    rectSnapshot(rect) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }

    renderMeasurementSnapshot(snapshot) {
      if (!snapshot) return;
      this.measurements.replaceChildren();
      for (const segment of snapshot.segments || []) {
        this.drawMeasurement(segment.axis, segment.x, segment.y, segment.length, segment.value);
      }
      if (snapshot.flush && snapshot.toRect) {
        const badge = document.createElement("b");
        badge.className = "badge" + (this.inspectMode === "ui" ? " ui-measurement" : "");
        badge.textContent = "父级内距 0px";
        badge.style.position = "fixed";
        badge.style.left = (snapshot.toRect.left + snapshot.toRect.width / 2) + "px";
        badge.style.top = this.clamp(snapshot.toRect.top - 10, 12, window.innerHeight - 12) + "px";
        this.measurements.appendChild(badge);
      }
      if (snapshot.overlap && snapshot.fromRect && snapshot.toRect) this.drawOverlapBadge(snapshot.fromRect, snapshot.toRect);
      this.layoutSmallMeasurementLabels(snapshot);
    }

    placeMeasurementOverlay(width, height, candidates, obstacles) {
      const area = (box, other) => Math.max(0, Math.min(box.right, other.right + 5) - Math.max(box.left, other.left - 5))
        * Math.max(0, Math.min(box.bottom, other.bottom + 5) - Math.max(box.top, other.top - 5));
      let best, score = Infinity;
      for (const candidate of candidates) {
        const left = this.clamp(candidate.left, 4, Math.max(4, window.innerWidth - width - 4));
        const top = this.clamp(candidate.top, 4, Math.max(4, window.innerHeight - height - 4));
        const box = { left, top, right:left + width, bottom:top + height, width, height };
        const overlap = obstacles.reduce((sum, other) => sum + area(box, other), 0);
        if (overlap < score) { best = box; score = overlap; }
        if (!overlap) break;
      }
      return best;
    }

    layoutSmallMeasurementLabels(snapshot) {
      const target = snapshot.toRect;
      if (!target || (target.width > 80 && target.height > 80)) return;
      const badges = Array.from(this.measurements.querySelectorAll?.(".badge") || []);
      const obstacles = [target];
      if (snapshot.fromRect && snapshot.fromRect.width <= 80 && snapshot.fromRect.height <= 80) obstacles.push(snapshot.fromRect);
      for (const badge of badges) {
        const original = badge.getBoundingClientRect();
        const x = original.left + original.width / 2, y = original.top + original.height / 2;
        const width = original.width, height = original.height;
        const sides = (gap) => [
          {left:x - width / 2, top:target.top - height - gap},
          {left:x - width / 2, top:target.bottom + gap},
          {left:target.left - width - gap, top:y - height / 2},
          {left:target.right + gap, top:y - height / 2}
        ].sort((a,b) => Math.hypot(a.left + width/2-x,a.top + height/2-y) - Math.hypot(b.left + width/2-x,b.top + height/2-y));
        const placement = this.placeMeasurementOverlay(width,height,[...sides(10),...sides(36),...sides(64)],obstacles);
        badge.style.position = "fixed";
        badge.style.transform = "none";
        badge.style.left = placement.left + "px";
        badge.style.top = placement.top + "px";
        obstacles.push(placement);
        // Keep the measurement endpoints untouched; only its label moves.
        const endX = this.clamp(x, placement.left, placement.right), endY = this.clamp(y, placement.top, placement.bottom);
        const leader = document.createElement("i");
        leader.className = "measurement-leader";
        leader.style.cssText = `position:fixed;pointer-events:none;left:${x}px;top:${y}px;width:${Math.hypot(endX-x,endY-y)}px;height:0;border-top:1px dotted ${this.inspectMode === "ui" ? "#39d8a2" : "#ff667d"};transform-origin:0 0;transform:rotate(${Math.atan2(endY-y,endX-x)}rad)`;
        this.measurements.prepend(leader);
      }
    }

    drawContainmentMeasurements(outer, inner) {
      const gaps = {
        left: Math.max(0, inner.left - outer.left),
        right: Math.max(0, outer.right - inner.right),
        top: Math.max(0, inner.top - outer.top),
        bottom: Math.max(0, outer.bottom - inner.bottom)
      };
      const middleY = this.clamp((Math.max(outer.top, inner.top) + Math.min(outer.bottom, inner.bottom)) / 2, 9, window.innerHeight - 9);
      const middleX = this.clamp((Math.max(outer.left, inner.left) + Math.min(outer.right, inner.right)) / 2, 9, window.innerWidth - 9);
      let drawn = false;
      if (gaps.left > 0.5) {
        this.drawMeasurement("horizontal", outer.left, middleY, gaps.left, Math.round(gaps.left));
        drawn = true;
      }
      if (gaps.right > 0.5) {
        this.drawMeasurement("horizontal", inner.right, middleY, gaps.right, Math.round(gaps.right));
        drawn = true;
      }
      if (gaps.top > 0.5) {
        this.drawMeasurement("vertical", middleX, outer.top, gaps.top, Math.round(gaps.top));
        drawn = true;
      }
      if (gaps.bottom > 0.5) {
        this.drawMeasurement("vertical", middleX, inner.bottom, gaps.bottom, Math.round(gaps.bottom));
        drawn = true;
      }
      if (!drawn) this.drawOverlapBadge(outer, inner);
    }

    composedContains(outer, inner) {
      let current = inner;
      while (current) {
        if (current === outer) return true;
        if (current.parentElement) current = current.parentElement;
        else {
          const root = current.getRootNode?.();
          current = typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root.host : null;
        }
      }
      return false;
    }

    getGap(firstStart, firstEnd, secondStart, secondEnd) {
      if (firstEnd <= secondStart) return { start: firstEnd, end: secondStart, value: Math.round(secondStart - firstEnd) };
      if (secondEnd <= firstStart) return { start: secondEnd, end: firstStart, value: Math.round(firstStart - secondEnd) };
      return null;
    }

    drawMeasurement(axis, x, y, length, value) {
      const line = document.createElement("div");
      line.className = "line " + axis + (this.inspectMode === "ui" ? " ui-measurement" : "");
      if (axis === "horizontal") {
        line.style.left = x + "px";
        line.style.top = y + "px";
        line.style.width = length + "px";
      } else {
        line.style.left = x + "px";
        line.style.top = y + "px";
        line.style.height = length + "px";
      }
      const firstCap = document.createElement("i");
      firstCap.className = "cap";
      const secondCap = document.createElement("i");
      secondCap.className = "cap end";
      const badge = document.createElement("b");
      badge.className = "badge" + (this.inspectMode === "ui" ? " ui-measurement" : "");
      badge.textContent = value + "px";
      if (axis === "horizontal") {
        badge.style.left = length / 2 + "px";
        badge.style.top = "0";
      } else {
        badge.style.left = "0";
        badge.style.top = length / 2 + "px";
      }
      line.append(firstCap, secondCap, badge);
      this.measurements.appendChild(line);
    }

    drawOverlapBadge(first, second) {
      const badge = document.createElement("b");
      badge.className = "badge" + (this.inspectMode === "ui" ? " ui-measurement" : "");
      badge.textContent = "元素重叠";
      badge.style.position = "fixed";
      badge.style.left = (Math.max(first.left, second.left) + Math.min(first.right, second.right)) / 2 + "px";
      badge.style.top = (Math.max(first.top, second.top) + Math.min(first.bottom, second.bottom)) / 2 + "px";
      this.measurements.appendChild(badge);
    }

    showBox(box, element) {
      if (!element || !element.isConnected) {
        box.style.display = "none";
        return;
      }
      const rect = element.getBoundingClientRect();
      if (!this.isVisible(rect)) {
        box.style.display = "none";
        return;
      }
      box.style.display = "block";
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";
    }

    showTooltip(element, state) {
      const rect = element.getBoundingClientRect();
      if (!this.isVisible(rect)) {
        this.tooltip.style.display = "none";
        return;
      }
      this.tooltip.replaceChildren(document.createTextNode(state + " · " + this.round(rect.width) + " × " + this.round(rect.height)));
      this.tooltip.style.display = "block";
      const left = this.clamp(rect.left, 8, Math.max(8, window.innerWidth - this.tooltip.offsetWidth - 8));
      const top = rect.bottom + 8 + this.tooltip.offsetHeight > window.innerHeight
        ? Math.max(8, rect.top - this.tooltip.offsetHeight - 8)
        : rect.bottom + 8;
      this.tooltip.style.left = left + "px";
      this.tooltip.style.top = top + "px";
      if (rect.width <= 80 || rect.height <= 80) {
        const width = this.tooltip.offsetWidth, height = this.tooltip.offsetHeight;
        const obstacles = [rect, ...Array.from(this.measurements.querySelectorAll?.(".badge") || []).map(node => node.getBoundingClientRect())];
        const candidates = [{left,top}];
        for (const gap of [12,36,64,96]) candidates.push(
          {left:rect.left,top:rect.bottom+gap}, {left:rect.left,top:rect.top-height-gap},
          {left:rect.right+gap,top:rect.top}, {left:rect.left-width-gap,top:rect.top});
        const placement = this.placeMeasurementOverlay(width,height,candidates,obstacles);
        this.tooltip.style.left = placement.left + "px";
        this.tooltip.style.top = placement.top + "px";
      }
    }

    showPinTooltip(pin, issue) {
      const rect = pin.getBoundingClientRect();
      this.tooltip.dataset.pinIssueId = issue.id;
      this.tooltip.replaceChildren(document.createTextNode(issue.displayId + "\n" + (issue.description || issue.title || "已记录问题")));
      this.tooltip.style.display = "block";
      const left = this.clamp(rect.left, 8, Math.max(8, window.innerWidth - this.tooltip.offsetWidth - 8));
      const top = rect.bottom + 8 + this.tooltip.offsetHeight > window.innerHeight
        ? Math.max(8, rect.top - this.tooltip.offsetHeight - 8)
        : rect.bottom + 8;
      this.tooltip.style.left = left + "px";
      this.tooltip.style.top = top + "px";
    }

    hidePinTooltip() {
      if (!this.tooltip?.dataset?.pinIssueId) return;
      delete this.tooltip.dataset.pinIssueId;
      this.tooltip.style.display = "none";
    }

    updatePinHover(event) {
      if (!this.enabled || this.captureOverlayStyles || event.pointerType === "touch") { this.hidePinTooltip(); return false; }
      if (!this.pinsLayer?.children?.length || this.pinsLayer.style.display === "none") { this.hidePinTooltip(); return false; }
      const path = event.composedPath();
      if (this.tooltip?.dataset?.pinIssueId && path.includes(this.tooltip)) return true;
      const activePin = this.tooltip?.dataset?.pinIssueId && Array.from(this.pinsLayer.children).find((node) => node.dataset.issueId === this.tooltip.dataset.pinIssueId);
      if (activePin) {
        const anchor = activePin.getBoundingClientRect(), tip = this.tooltip.getBoundingClientRect();
        const inGap = tip.top >= anchor.bottom ? event.clientY >= anchor.bottom && event.clientY <= tip.top : event.clientY >= tip.bottom && event.clientY <= anchor.top;
        if (inGap && event.clientX >= anchor.left && event.clientX <= anchor.right) return true;
      }
      const otherSurface = path.includes(this.host) && !path.some((node) => node?.dataset?.action === "open-pin");
      const pin = !otherSurface && Array.from(this.pinsLayer?.children || []).find((node) => {
        const rect = node.getBoundingClientRect();
        return Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2)) <= rect.width / 2;
      });
      const issue = pin && this.issues.find((item) => item.id === pin.dataset.issueId);
      if (!issue) { this.hidePinTooltip(); return false; }
      this.showPinTooltip(pin, issue);
      return true;
    }

    renderCompareState() {
      if (!this.compareSource || !this.compareResult) return;
      const binding = this.session?.figmaBinding;
      const snapshot = this.session?.designSnapshot;
      if (binding || snapshot) {
        const label = binding?.frameName || binding?.fileKey || "已绑定设计";
        this.compareSource.textContent = snapshot
          ? "Figma · " + label + " · " + (snapshot.nodes?.length || 0) + " 个节点"
          : "Figma · " + label + " · 待导入快照";
        this.compareBindButton.textContent = "更新设计";
      } else {
        this.compareSource.textContent = "未绑定设计";
        this.compareBindButton.textContent = "绑定设计";
      }
      const result = this.currentCompare;
      if (!result || !snapshot) {
        this.compareResult.hidden = true;
        return;
      }
      this.compareResult.hidden = false;
      this.compareCandidates.replaceChildren();
      this.compareDiffs.replaceChildren();
      const selected = result.selectedNode;
      if (selected) {
        this.compareMatch.className = "compare-match";
        this.compareMatch.textContent = (result.selectedConfidence === "high" ? "高置信匹配" : "可能匹配") + " · " + (selected.name || selected.id) + " · " + (result.diffs?.length || 0) + " 项差异";
      } else {
        this.compareMatch.className = "compare-match is-none";
        this.compareMatch.textContent = "未找到可靠匹配 · 可继续手工记录";
      }
      for (const candidate of (result.candidates || []).filter((item) => item.score >= 0.45)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "compare-candidate" + (selected?.id === candidate.node.id ? " active" : "");
        button.dataset.action = "use-design-node";
        button.dataset.nodeId = candidate.node.id;
        const name = document.createElement("span");
        name.className = "compare-candidate-name";
        name.textContent = candidate.node.name || candidate.node.id;
        const meta = document.createElement("span");
        meta.className = "compare-candidate-meta";
        meta.textContent = (candidate.confidence === "high" ? "高" : candidate.confidence === "possible" ? "可能" : "低") + " · " + Math.round(candidate.score * 100) + "%";
        button.append(name, meta);
        this.compareCandidates.appendChild(button);
      }
      const labels = {
        "dimensions.width": "宽度", "dimensions.height": "高度", "spacing.padding": "内边距", "spacing.gap": "元素间距",
        "typography.fontFamily": "字体", "typography.fontSize": "字号", "typography.fontWeight": "字重", "typography.lineHeight": "行高",
        "typography.letterSpacing": "字间距", "typography.textAlign": "对齐", "typography.color": "文字色", "appearance.backgroundColor": "背景色",
        "appearance.borderRadius": "圆角", "appearance.boxShadow": "阴影", "layout.justifyContent": "主轴对齐", "layout.alignItems": "交叉轴对齐"
      };
      for (const diff of (result.diffs || []).slice(0, 8)) {
        const row = document.createElement("div");
        row.className = "compare-diff";
        const label = document.createElement("strong");
        label.textContent = labels[diff.property] || diff.property;
        const values = document.createElement("em");
        const expected = document.createElement("span");
        expected.textContent = "期望 " + diff.expected;
        values.append(expected, document.createTextNode(" → 实际 " + diff.actual + " · " + diff.delta));
        row.append(label, values);
        this.compareDiffs.appendChild(row);
      }
      if (!result.diffs?.length && selected) {
        const clean = document.createElement("div");
        clean.className = "compare-diff";
        clean.textContent = "已匹配 · 未发现明显差异";
        this.compareDiffs.appendChild(clean);
      }
    }

    comparePropertyLabel(property) {
      return ({
        "dimensions.width": "宽度", "dimensions.height": "高度", "spacing.padding": "内边距", "spacing.gap": "元素间距",
        "typography.fontFamily": "字体", "typography.fontSize": "字号", "typography.fontWeight": "字重", "typography.lineHeight": "行高",
        "typography.letterSpacing": "字间距", "typography.textAlign": "对齐", "typography.color": "文字色", "appearance.backgroundColor": "背景色",
        "appearance.borderRadius": "圆角", "appearance.boxShadow": "阴影", "layout.justifyContent": "主轴对齐", "layout.alignItems": "交叉轴对齐"
      })[property] || property;
    }

    compareSelected(element) {
      const engine = globalThis.__uideltaCompareEngine;
      const snapshot = this.session?.designSnapshot;
      if (!engine || !snapshot?.nodes?.length || !element || !element.isConnected) {
        this.currentCompare = null;
        this.renderCompareState();
        return;
      }
      const anchor = this.elementAnchor(element);
      const webSnapshot = this.styleSnapshot(element);
      const candidates = engine.findCandidates(anchor, webSnapshot, snapshot);
      const previousId = this.currentCompare?.element === element ? this.currentCompare.selectedNode?.id : "";
      const selectedCandidate = candidates.find((item) => item.node.id === previousId) || candidates.find((item) => item.confidence === "high") || null;
      this.currentCompare = {
        element,
        candidates,
        selectedNode: selectedCandidate?.node || null,
        selectedConfidence: selectedCandidate?.confidence || "none",
        diffs: selectedCandidate ? engine.diffSnapshots(webSnapshot, selectedCandidate.node, selectedCandidate.confidence) : [],
        webSnapshot
      };
      if (this.currentInspection?.element?.identityKey === anchor.identityKey) {
        this.currentInspection.compare = {
          confidence: this.currentCompare.selectedConfidence,
          designNode: this.currentCompare.selectedNode ? structuredClone(this.currentCompare.selectedNode) : null,
          diffs: structuredClone(this.currentCompare.diffs)
        };
      }
      this.renderCompareState();
    }

    useDesignNode(nodeId) {
      if (!this.currentCompare || !nodeId) return;
      const candidate = this.currentCompare.candidates.find((item) => item.node.id === nodeId);
      if (!candidate) return;
      this.currentCompare.selectedNode = candidate.node;
      this.currentCompare.selectedConfidence = candidate.confidence;
      this.currentCompare.diffs = globalThis.__uideltaCompareEngine.diffSnapshots(this.currentCompare.webSnapshot, candidate.node, candidate.confidence);
      this.renderCompareState();
      this.showToast("已选择设计节点 · " + (candidate.node.name || candidate.node.id));
    }

    openDesignBinding() {
      if (!this.session) {
        this.showToast("请先开始本次走查");
        return;
      }
      this.designBinding.hidden = false;
      this.figmaUrlInput.value = this.session.figmaBinding?.url || "";
      this.designFile = null;
      this.designFileInput.value = "";
      this.designFileName.textContent = this.session.designSnapshot ? "已缓存当前快照 · 选择新文件可替换" : "未选择快照文件";
      this.designError.textContent = "";
      window.setTimeout(() => this.figmaUrlInput.focus(), 20);
    }

    closeDesignBinding() {
      this.designBinding.hidden = true;
      this.designError.textContent = "";
    }

    async saveDesignSource() {
      if (!this.session || this.designSaveButton.disabled) return;
      const rawUrl = this.figmaUrlInput.value.trim();
      if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
        this.designError.textContent = "请输入有效的 Figma Frame URL。";
        return;
      }
      this.designSaveButton.disabled = true;
      this.designError.textContent = "";
      try {
        const engine = globalThis.__uideltaCompareEngine;
        const binding = engine.parseFigmaUrl(rawUrl);
        let snapshot = this.session.designSnapshot || null;
        if (this.designFile) {
          let parsed;
          try {
            parsed = JSON.parse(await this.designFile.text());
          } catch (_) {
            throw new Error("快照文件不是有效 JSON。 ");
          }
          snapshot = engine.normalizeDesignSnapshot(parsed, binding);
          if (!snapshot.nodes.length) throw new Error("快照中没有可用节点，请导出当前 Frame 的 JSON。 ");
        }
        const response = await this.sendMessage({
          type: "UIDELTA_PUT_DESIGN",
          sessionId: this.session.id,
          design: { binding: Object.values(binding).some(Boolean) ? binding : null, snapshot }
        });
        if (!response?.ok) throw new Error(response?.error || "设计源保存失败。 ");
        this.session = response.session || this.session;
        this.currentCompare = null;
        this.closeDesignBinding();
        this.renderSessionState();
        if (this.selected) this.updateInspector(this.selected);
        this.showToast("设计源已保存 · " + (snapshot?.nodes?.length || 0) + " 个节点");
      } catch (error) {
        this.designError.textContent = error?.message || "设计源保存失败。 ";
      } finally {
        this.designSaveButton.disabled = false;
      }
    }

    async clearDesignSource() {
      if (!this.session) return;
      const response = await this.sendMessage({ type: "UIDELTA_PUT_DESIGN", sessionId: this.session.id, design: { binding: null, snapshot: null } });
      if (!response?.ok) {
        this.designError.textContent = response?.error || "解除绑定失败。 ";
        return;
      }
      this.session = response.session || this.session;
      this.currentCompare = null;
      this.closeDesignBinding();
      this.renderSessionState();
      this.showToast("设计源已解除");
    }

    layerPropertiesMarkup() {
      const sides = (kind) => ["top", "right", "bottom", "left"].map((side) =>
        `<span class="layer-box-side ${side}" data-layer-box="${kind}-${side}"></span>`
      ).join("");
      const row = (key, label, className = "") => `<div class="layer-property-row ${className}" data-layer-row="${key}" hidden><dt>${label}</dt><dd data-layer-value="${key}"></dd></div>`;
      return `<section class="layer-properties" aria-label="元素属性" hidden>
        <dl class="layer-size-grid">${row("width", "宽 W")}${row("height", "高 H")}</dl>
        <dl class="layer-property-list">
          ${row("layout", "布局")}${row("direction", "方向")}${row("alignment", "对齐")}${row("gap", "间距")}
          ${row("font", "字体")}${row("font-size", "字号")}${row("line-height", "行高")}${row("font-weight", "字重")}
          ${row("text-color", "文字色")}${row("placeholder-color", "占位色")}${row("background", "背景")}${row("background-image", "背景图")}
          ${row("opacity", "透明度")}${row("radius", "圆角")}${row("border", "边框")}${row("shadow", "阴影")}
        </dl>
        <div class="layer-box-model" role="group" aria-labelledby="uidelta-layer-properties-title" aria-label="盒模型：外边距、边框、内边距与内容尺寸，单位为 CSS 像素">
          <h2 id="uidelta-layer-properties-title" class="layer-properties-title">Layer properties</h2>
          <div class="layer-box-band layer-box-margin">
            <span class="layer-box-caption">外边距</span>${sides("margin")}
            <div class="layer-box-band layer-box-border">
              <span class="layer-box-caption">边框</span>${sides("border")}
              <div class="layer-box-band layer-box-padding">
                <span class="layer-box-caption">内边距</span>${sides("padding")}
                <div class="layer-box-content"><strong data-layer-box="content-size" aria-label="内容尺寸"></strong></div>
              </div>
            </div>
          </div>
          <p class="layer-box-note" data-layer-box="note" hidden></p>
        </div>
      </section>`;
    }

    layerPropertiesStyles() {
      return `
        .layer-properties { min-width:0; padding:12px 0; }
        .layer-properties [hidden],.layer-properties[hidden] { display:none!important; }
        .layer-properties-title { margin:0 0 12px; color:var(--ud-text); font-size:13px; font-weight:600; line-height:1.4; }
        .layer-box-model { min-width:0; margin-top:14px; padding-top:12px; border-top:1px solid var(--ud-border); }
        .layer-box-band { position:relative; display:grid; grid-template-columns:19px minmax(0,1fr) 19px; grid-template-rows:minmax(26px,auto) auto minmax(24px,auto); align-items:center; min-width:0; border:1px solid #414637; border-radius:0; }
        .layer-box-margin { background:#f7cca5; border-style:dashed; }
        .layer-box-border { grid-area:2/2; background:#f9dfa1; }
        .layer-box-padding { grid-area:2/2; background:#c6d292; border-style:dashed; }
        .layer-box-caption { position:absolute; top:4px; left:4px; color:#283026; font-size:10px; line-height:1.4; pointer-events:none; }
        .layer-box-side { display:block; min-width:0; padding:3px 1px; color:#283026; font-size:10px; line-height:1.4; text-align:center; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
        .layer-box-side.top { grid-area:1/2; padding-left:24px; }.layer-box-side.right { grid-area:2/3; }.layer-box-side.bottom { grid-area:3/2; }.layer-box-side.left { grid-area:2/1; }
        .layer-box-content { grid-area:2/2; display:grid; place-items:center; min-width:0; min-height:30px; padding:4px 2px; border:1px solid #414637; border-radius:0; background:#90b6c1; text-align:center; }
        .layer-box-content strong { min-width:0; color:#283026; font-size:10px; font-weight:500; line-height:1.45; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
        .layer-box-note { margin:5px 0 0; color:var(--ud-text-muted); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
        .layer-size-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:0 0 10px; }
        .layer-property-list { display:grid; gap:5px; margin:0; }
        .layer-property-row { display:grid; grid-template-columns:48px minmax(0,1fr); gap:8px; align-items:start; min-width:0; padding:0; border:0; }
        .layer-property-row dt { margin:0; color:var(--ud-text-muted); font-size:11px; font-weight:400; line-height:1.55; }
        .layer-property-row dd { display:flex; align-items:flex-start; gap:6px; min-width:0; max-width:100%; margin:0; color:var(--ud-text); font-size:12px; font-weight:400; line-height:1.5; white-space:normal; overflow-wrap:anywhere; }
        .layer-value-text { min-width:0; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
        .layer-font-stack { min-width:0; width:100%; }
        .layer-font-stack summary { cursor:pointer; overflow-wrap:anywhere; }
        .layer-font-stack summary:focus-visible { outline:2px solid var(--ud-focus); outline-offset:2px; border-radius:2px; }
        .layer-font-options { display:block; margin-top:4px; padding:6px; background:var(--ud-inset); color:var(--ud-text-secondary); font-size:11px; white-space:pre-line; overflow-wrap:anywhere; }
        .layer-size-grid .layer-property-row { grid-template-columns:1fr; gap:2px; }
        .layer-size-grid dd { font-size:13px; font-weight:500; font-variant-numeric:tabular-nums; }
        .layer-color-swatch { display:block; width:12px; height:12px; flex:0 0 12px; margin-top:3px; border:1px solid var(--ud-border-strong); border-radius:3px; background:var(--layer-swatch); }
      `;
    }

    layerBoxMetrics(element, style) {
      const pixels = (value, signed = false) => {
        const match = String(value ?? "").trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i);
        return match && Number.isFinite(Number(match[1])) ? (signed ? Number(match[1]) : Math.max(0, Number(match[1]))) : null;
      };
      const sides = ["Top", "Right", "Bottom", "Left"];
      // Negative margins are valid. Keep unresolved auto/non-pixel values
      // instead of misreporting them as zero or deducting them from content.
      const margin = sides.map((side) => pixels(style["margin" + side], true) ?? (String(style["margin" + side] || "0").trim()));
      const padding = sides.map((side) => pixels(style["padding" + side]) ?? 0);
      const border = sides.map((side) => ["none", "hidden"].includes(style["border" + side + "Style"]) ? 0 : pixels(style["border" + side + "Width"]) ?? 0);
      const hasBox = !["none", "contents"].includes(style.display);
      const dimension = (property, start, end, offsetKey, clientKey) => {
        if (!hasBox) return null;
        const borderTotal = border[start] + border[end];
        const paddingTotal = padding[start] + padding[end];
        const cssSize = pixels(style[property]);
        const offset = typeof element?.[offsetKey] === "number" ? element[offsetKey] : null;
        const client = typeof element?.[clientKey] === "number" ? element[clientKey] : null;
        // offset/client dimensions are untransformed layout measurements. A
        // scrollbar consumes content space; ignore subpixel rounding noise.
        const gutter = offset !== null && client !== null && offset > 0 && client > 0
          ? Math.max(0, offset - client - borderTotal) : 0;
        const scrollbar = gutter > 1 ? gutter : 0;
        if (cssSize !== null) {
          return Math.max(0, cssSize - (style.boxSizing === "border-box" ? paddingTotal + borderTotal : 0) - scrollbar);
        }
        // Non-replaced inline and SVG nodes need not expose a single CSS
        // content box. Never substitute their transformed visual rectangle.
        if (style.display === "inline" || offset === null || client === null || offset <= 0) return null;
        return Math.max(0, client - paddingTotal);
      };
      return {
        margin, padding, border,
        width: dimension("width", 3, 1, "offsetWidth", "clientWidth"),
        height: dimension("height", 0, 2, "offsetHeight", "clientHeight"),
        boxSizing: style.boxSizing,
        hasBox
      };
    }

    fontFamilyNames(value) {
      // A quoted family can contain commas: do not split it into fake fonts.
      return (String(value || "").match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,"'])+/g) || [])
        .map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2")).filter(Boolean);
    }

    renderLayerProperties(element, style, rect) {
      const root = this.shadow.querySelector(".layer-properties");
      if (!root) return;
      root.hidden = !element || !style || !rect;
      if (root.hidden) return;
      const format = (value) => String(Math.round(value * 100) / 100);
      const row = (key, value, raw = value, swatch = "") => {
        const container = root.querySelector(`[data-layer-row='${key}']`);
        const output = root.querySelector(`[data-layer-value='${key}']`);
        if (!container || !output) return;
        container.hidden = value === "" || value == null;
        output.replaceChildren();
        output.title = raw == null ? "" : String(raw);
        if (container.hidden) return;
        if (swatch) {
          const color = document.createElement("i");
          color.className = "layer-color-swatch";
          color.setAttribute("aria-hidden", "true");
          color.style.setProperty("--layer-swatch", swatch);
          output.appendChild(color);
        }
        const text = document.createElement("span");
        text.className = "layer-value-text";
        text.textContent = String(value);
        output.appendChild(text);
      };
      const box = this.layerBoxMetrics(element, style);
      const sideLabels = ["上", "右", "下", "左"];
      const sides = ["top", "right", "bottom", "left"];
      for (const kind of ["margin", "border", "padding"]) {
        sides.forEach((side, index) => {
          const output = root.querySelector(`[data-layer-box='${kind}-${side}']`);
          const value = box[kind][index];
          const numeric = typeof value === "number";
          const text = numeric ? format(value) : value;
          output.textContent = box.hasBox ? text : "";
          output.title = box.hasBox ? `${kind}-${side}${kind === "border" ? "-width" : ""}: ${text}${numeric ? "px" : ""}` : "";
          output.setAttribute("aria-label", box.hasBox ? `${{ margin:"外边距", border:"边框", padding:"内边距" }[kind]}${sideLabels[index]} ${text}${numeric ? " 像素" : ""}` : "无布局盒");
        });
      }
      const content = root.querySelector("[data-layer-box='content-size']");
      const hasContentSize = box.width !== null && box.height !== null;
      content.textContent = hasContentSize ? `${format(box.width)} × ${format(box.height)}` : "";
      content.title = hasContentSize ? `CSS 内容盒：${format(box.width)}px × ${format(box.height)}px；box-sizing: ${box.boxSizing}` : "";
      const note = root.querySelector("[data-layer-box='note']");
      note.hidden = hasContentSize;
      note.textContent = hasContentSize ? "" : "此元素没有可读取的独立内容尺寸。";
      row("width", Number.isFinite(rect.width) ? `${format(rect.width)} px` : "", "页面实际显示宽度，包含变换后的边界");
      row("height", Number.isFinite(rect.height) ? `${format(rect.height)} px` : "", "页面实际显示高度，包含变换后的边界");
      const flex = /^(inline-)?flex$/.test(style.display);
      const layout = flex || /^(inline-)?grid$/.test(style.display);
      row("layout", style.display, `display: ${style.display}`);
      row("direction", flex ? style.flexDirection : "", flex ? `flex-direction: ${style.flexDirection}` : "");
      const alignment = layout ? [style.justifyContent, style.alignItems].filter(Boolean).join(" / ") : "";
      row("alignment", alignment, `justify-content: ${style.justifyContent}; align-items: ${style.alignItems}`);
      row("gap", layout && style.gap && style.gap !== "normal" ? style.gap : "", style.gap);
      const hasText = this.hasTypography(element);
      row("font", hasText ? style.fontFamily : "");
      const fonts = hasText ? this.fontFamilyNames(style.fontFamily) : [];
      if (fonts.length > 1) {
        const output = root.querySelector("[data-layer-value='font']");
        const details = document.createElement("details");
        details.className = "layer-font-stack";
        const summary = document.createElement("summary");
        summary.textContent = fonts[0] + " · +" + (fonts.length - 1);
        summary.setAttribute("aria-label", "CSS 字体列表，展开查看全部 " + fonts.length + " 项");
        const options = document.createElement("span");
        options.className = "layer-font-options";
        options.textContent = fonts.join("\n");
        details.appendChild(summary);
        details.appendChild(options);
        output.replaceChildren(details);
      }
      row("font-size", hasText ? style.fontSize : "");
      row("line-height", hasText ? style.lineHeight : "");
      row("font-weight", hasText ? style.fontWeight : "");
      row("text-color", hasText ? style.color : "", style.color, style.color);
      const placeholder = /^(INPUT|TEXTAREA)$/i.test(element.tagName || "") && element.placeholder && !element.value
        ? window.getComputedStyle(element, "::placeholder") : null;
      row("placeholder-color", placeholder?.color || "", placeholder ? `占位文字颜色：${placeholder.color}；透明度：${placeholder.opacity}` : "", placeholder?.color || "");
      row("background", style.backgroundColor, style.backgroundColor, style.backgroundColor);
      row("background-image", style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage : "");
      const opacity = Number.parseFloat(style.opacity);
      row("opacity", Number.isFinite(opacity) ? `${format(opacity * 100)}%` : "", style.opacity);
      const radius = String(style.borderRadius || "");
      const hasRadius = (radius.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g) || []).some((value) => Number(value) !== 0);
      row("radius", hasRadius ? radius : "");
      const borderValues = ["Top", "Right", "Bottom", "Left"].map((side, index) => box.border[index] > 0
        ? [style[`border${side}Width`], style[`border${side}Style`], style[`border${side}Color`]].filter(Boolean).join(" ") : "");
      const borderText = borderValues.every((value) => value === borderValues[0]) ? borderValues[0]
        : borderValues.map((value, index) => value ? `${sideLabels[index]}：${value}` : "").filter(Boolean).join("；");
      row("border", borderText);
      row("shadow", this.visibleBoxShadows(style.boxShadow));
    }

    hasTypography(element) {
      if (!element) return false;
      if (/^(TEXTAREA|SELECT)$/i.test(element.tagName || "")) return true;
      if (/^INPUT$/i.test(element.tagName || "")) return !/^(hidden|checkbox|radio|range|color|file|image)$/i.test(element.type || "text");
      return Boolean(this.textContent(element));
    }

    visibleBoxShadows(value) {
      if (!value || value === "none") return "";
      // A comma within rgba()/oklch() is not a new shadow layer.
      const layers = []; let depth = 0, start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
        else if (value[i] === "," && depth === 0) { layers.push(value.slice(start,i)); start = i+1; }
      }
      layers.push(value.slice(start));
      return layers.map(layer => layer.trim()).filter(layer => {
        if (/\btransparent\b/i.test(layer)) return false;
        const color = layer.match(/(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\([^)]*\)/i)?.[0];
        if (color) {
          const body = color.slice(color.indexOf("(")+1,-1);
          const alpha = body.includes("/") ? body.split("/").at(-1).trim()
            : body.split(",").length === 4 ? body.split(",").at(-1).trim() : null;
          if (alpha !== null && Number.parseFloat(alpha) === 0) return false;
        }
        const dimensions = layer.replace(color || /$^/, "").match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?/gi) || [];
        // Zero offset + zero blur + zero spread has no visible shadow.
        return dimensions.some(number => Number.parseFloat(number) !== 0);
      }).join(", ");
    }

    updateInspector(element, stateLabel, options = {}) {
      if (!element || !element.isConnected) return;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const name = this.elementName(element);
      this.identityKind.textContent = stateLabel || element.tagName.toLowerCase();
      this.identityName.textContent = name;
      this.identityPath.textContent = this.fallbackSelector(element);
      this.identityLocation.textContent = "页面位置 x " + Math.round(rect.left + scrollX) + " · y " + Math.round(rect.top + scrollY);
      this.renderLayerProperties(element, style, rect);
      this.recordButton.disabled = !this.isSessionActive();
      this.updateRecordButton(Boolean(this.currentMeasurement || (this.lastMeasurementSource === element && this.lastMeasurement)));
      this.currentInspection = {
        name,
        selector: this.shadowSelectorPath(element).join(" >>> "),
        page: this.pageSnapshot(),
        element: this.elementAnchor(element),
          styles: this.styleSnapshot(element)
      };
      if (this.inspectMode === "ui") {
        // The UI editor is driven by the inspection target itself. Do not
        // require event-wrapper identity: other extensions/framework rerenders
        // can replace it between pointerdown and paint.
        this.selected = element;
        this.renderUiEditor(element, Boolean(options.preservePreview));
      }
      else {
        this.renderPreviewTools(element, Boolean(options.preservePreview));
        this.renderUiEditor(null);
      }
      if (this.currentInspection) this.currentInspection.changeProposal = this.getPreviewProposal();
      if (options.compare !== false) this.compareSelected(element);
    }

    ensurePreviewState(element) {
      if (!element?.isConnected) return null;
      if (this.previewState?.element === element) return this.previewState;

      // Preview is intentionally page-scoped: switching the selected element
      // must not restore local edits made to an earlier element.
      this.previewTargets = new Set([element]);
      this.previewCandidateList = [];
      const cached = this.previewStates.get(element);
      if (cached) {
        this.previewState = cached;
        return cached;
      }

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      this.previewState = {
        element,
        before: {
          color: style.color,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          borderStyle: style.borderStyle,
          display: style.display,
          flexDirection: style.flexDirection,
          justifyContent: style.justifyContent,
          alignItems: style.alignItems,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          width: this.round(rect.width) + "px",
          height: this.round(rect.height) + "px",
          left: this.previewPositionValue(element, style, rect, "x") + "px",
          top: this.previewPositionValue(element, style, rect, "y") + "px",
          borderRadius: style.borderRadius,
          padding: style.padding,
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
          gap: style.gap,
          opacity: style.opacity,
          margin: style.margin,
          textAlign: style.textAlign,
          letterSpacing: style.letterSpacing,
          boxShadow: style.boxShadow,
          textContent: element.children.length ? "" : element.textContent || ""
        },
        inline: {
          color: element.style.color,
          backgroundColor: element.style.backgroundColor,
          backgroundImage: element.style.backgroundImage,
          borderColor: element.style.borderColor,
          borderWidth: element.style.borderWidth,
          borderStyle: element.style.borderStyle,
          display: element.style.display,
          flexDirection: element.style.flexDirection,
          justifyContent: element.style.justifyContent,
          alignItems: element.style.alignItems,
          fontFamily: element.style.fontFamily,
          fontWeight: element.style.fontWeight,
          fontSize: element.style.fontSize,
          lineHeight: element.style.lineHeight,
          width: element.style.width,
          height: element.style.height,
          left: element.style.left,
          top: element.style.top,
          borderRadius: element.style.borderRadius,
          padding: element.style.padding,
          gap: element.style.gap,
          opacity: element.style.opacity,
          margin: element.style.margin,
          textAlign: element.style.textAlign,
          letterSpacing: element.style.letterSpacing,
          boxShadow: element.style.boxShadow,
          textContent: element.children.length ? null : element.textContent || ""
        },
        changes: {}
      };
      this.previewStates.set(element, this.previewState);
      this.capturePreviewOriginal(element);
      return this.previewState;
    }

    renderPreviewTools(element, preserve = false) {
      if (!this.previewTools || !this.previewFields) return;
      const visible = this.inspectMode === "ui" && this.selected?.isConnected && element === this.selected;
      this.previewTools.classList.toggle("visible", visible);
      if (!visible) return;
      const previewState = this.ensurePreviewState(element);
      if (!previewState) return;
      if (preserve && this.previewState.element === element) {
        this.updatePreviewSummary();
        return;
      }
      const fields = [
        ["color", "文字色"], ["backgroundColor", "背景色"], ["fontFamily", "字体"], ["fontWeight", "字重"], ["fontSize", "字号"], ["lineHeight", "行高"],
        ["display", "布局"], ["flexDirection", "方向"], ["justifyContent", "主轴对齐"], ["alignItems", "交叉对齐"],
        ["width", "宽度"], ["height", "高度"], ["borderRadius", "圆角"], ["padding", "内边距"], ["gap", "间距"]
      ];
      if (!element.children.length) fields.push(["textContent", "文本"]);
      this.previewFields.replaceChildren();
      for (const [property, label] of fields) {
        const wrapper = document.createElement("label");
        wrapper.className = "preview-field";
        wrapper.textContent = label;
        const input = document.createElement("input");
        const isColor = property === "color" || property === "backgroundColor" || property === "borderColor";
        input.type = isColor ? "color" : "text";
        const currentValue = this.previewState.changes[property] ?? this.previewState.before[property] ?? "";
        input.value = isColor ? this.previewColorValue(currentValue) : currentValue;
        input.dataset.previewProp = property;
        input.setAttribute("aria-label", "预览" + label);
        wrapper.appendChild(input);
        this.previewFields.appendChild(wrapper);
      }
      this.updatePreviewSummary();
      this.renderPreviewCandidates();
    }

    renderUiEditor(element, preserve = false) {
      if (!this.uiEditor) return;
      const visible = !this.browseMode && this.inspectMode === "ui" && this.currentView === "inspect" && this.isSessionActive();
      this.uiEditor.classList.toggle("visible", visible);
      if (!visible) return;
      // A connected target is sufficient. The previous strict identity check
      // could incorrectly leave this panel empty after a valid click.
      const isSelected = Boolean(element?.isConnected);
      if (isSelected) this.selected = element;
      this.uiEditorEmpty.hidden = isSelected;
      this.uiEditorContent.hidden = !isSelected;
      if (this.uiEditorFooter) this.uiEditorFooter.hidden = !isSelected;
      if (!isSelected) {
        this.uiEditorName.textContent = "选择元素";
        if (this.uiEditorMetaLabel) this.uiEditorMetaLabel.textContent = "UI 模式";
        if (this.uiEditorStatus) this.uiEditorStatus.textContent = "本地预览";
        return;
      }
      const state = this.ensurePreviewState(element);
      if (!state) return;
      this.uiEditorName.textContent = this.hasTypography(element) ? "文本" : "元素";
      if (this.uiEditorMetaLabel) this.uiEditorMetaLabel.textContent = this.elementName(element) + " · " + this.round(element.getBoundingClientRect().width) + " × " + this.round(element.getBoundingClientRect().height);
      if (preserve && state.element === element) {
        this.updatePreviewSummary();
        return;
      }
      const positionFields = this.canPreviewPosition(element)
        ? [["left", "X", "numeric-x"], ["top", "Y", "numeric-y"]]
        : [];
      const sections = {
        dimensions: [["width", "W", "numeric-width"], ["height", "H", "numeric-height"], ...positionFields],
        layout: [["display", "布局", "select"], ["flexDirection", "方向", "select"], ["justifyContent", "主轴", "select"], ["alignItems", "交叉轴", "select"]],
        spacing: [["gap", "间距"], ["paddingTop", "上内边距"], ["paddingRight", "右内边距"], ["paddingBottom", "下内边距"], ["paddingLeft", "左内边距"]],
        appearance: [["opacity", "透明度", "opacity"], ["borderRadius", "圆角", "numeric-radius"]],
        typography: [["fontFamily", "字体", "wide"], ["fontWeight", "字重", "select"], ["fontSize", "字号"], ["lineHeight", "行高"], ["letterSpacing", "字间距"], ["textAlign", "对齐", "select"], ["color", "文字色", "color"]],
        fill: [["backgroundColor", "颜色", "color"], ["backgroundImage", "背景图 / 渐变", "wide"]],
        stroke: [["borderColor", "颜色", "color"], ["borderWidth", "宽度", "wide"], ["borderStyle", "线型", "select"]]
      };
      for (const [sectionName, fields] of Object.entries(sections)) {
        const container = this.uiEditorSections.get(sectionName);
        if (!container) continue;
        container.replaceChildren(...fields.map(([property, label, kind]) => this.createUiEditorField(property, label, kind)));
      }
      const textContainer = this.uiEditorSections.get("text");
      this.syncUiLayoutFields();
      const canEditText = !element.children.length && !/^(IMG|INPUT|TEXTAREA|SELECT|SVG|CANVAS|VIDEO|AUDIO|IFRAME|BR|HR)$/i.test(element.tagName);
      const typographySection = this.uiEditorSections.get("typography")?.closest(".ui-editor-section");
      if (typographySection) typographySection.hidden = !this.hasTypography(element);
      this.uiEditorTextSection.hidden = !canEditText;
      if (textContainer) {
        textContainer.replaceChildren();
        if (canEditText) textContainer.append(this.createUiEditorField("textContent", "内容", "textarea"));
      }
      const advancedContainer = this.uiEditorSections.get("advanced");
      if (this.uiEditorAdvancedSection) this.uiEditorAdvancedSection.hidden = !this.uiEditorAdvanced;
      const advancedAction = this.uiEditor?.querySelector("[data-action='toggle-preview-properties']");
      if (advancedAction) {
        advancedAction.textContent = this.uiEditorAdvanced ? "收起高级属性" : "高级属性";
        advancedAction.setAttribute("aria-expanded", String(this.uiEditorAdvanced));
      }
      if (advancedContainer) {
        advancedContainer.replaceChildren();
        if (this.uiEditorAdvanced) {
          const advancedFields = [["margin", "外边距", "wide"], ["boxShadow", "阴影", "wide"]];
          advancedContainer.append(...advancedFields.map(([property, label, kind]) => this.createUiEditorField(property, label, kind)));
        }
      }
      this.updatePreviewSummary();
      this.renderPreviewCandidates();
    }

    createUiEditorField(property, label, kind = "") {
      const wrapper = document.createElement("div");
      wrapper.className = "ui-editor-field" + (["wide", "textarea", "opacity", "color"].includes(kind) ? " wide" : "");
      wrapper.dataset.field = property;
      const caption = document.createElement("span");
      caption.textContent = label;
      const value = this.previewState?.changes[property] ?? this.previewState?.before[property] ?? "";
      let control;
      if (this.uiNumericSpec(property)) {
        return this.createUiNumericField(property, label, kind);
      }
      if (kind === "select") {
        control = document.createElement("select");
        const options = {
          display: ["block", "flex", "grid", "inline", "inline-flex"],
          flexDirection: ["row", "column", "row-reverse", "column-reverse"],
          justifyContent: ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
          alignItems: ["stretch", "flex-start", "center", "flex-end", "baseline"],
          fontWeight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
          textAlign: ["start", "left", "center", "right", "justify"],
          borderStyle: ["none", "solid", "dashed", "dotted", "double"]
        }[property] || [];
        if (!options.includes(value)) options.unshift(value || "initial");
        for (const optionValue of options) {
          const option = document.createElement("option");
          option.value = optionValue;
          option.textContent = this.uiOptionLabel(property, optionValue);
          control.appendChild(option);
        }
        control.value = value || "initial";
      } else if (kind === "textarea") {
        control = document.createElement("textarea");
        control.value = value;
      } else {
        control = document.createElement("input");
        const isColor = kind === "color";
        control.type = isColor ? "color" : "text";
        control.value = isColor ? this.previewColorValue(value) : value;
        if (isColor) {
          control.dataset.previewProp = property;
          control.setAttribute("aria-label", "本地试改" + label + "色块");
          const hex = document.createElement("input");
          hex.type = "text";
          hex.value = String(value);
          hex.dataset.previewProp = property;
          hex.setAttribute("aria-label", "本地试改" + label + "，支持 HEX 或 CSS 颜色");
          hex.title = String(value);
          hex.spellcheck = false;
          hex.addEventListener("blur", () => this.applyPreviewField(hex, true));
          const colorControl = document.createElement("div");
          colorControl.className = "ui-editor-color-control";
          const swatch = document.createElement("label");
          swatch.className = "ui-color-swatch";
          const paint = document.createElement("span");
          paint.style.background = value;
          paint.dataset.colorSwatch = property;
          paint.setAttribute("aria-hidden", "true");
          swatch.append(paint, control);
          colorControl.append(swatch, hex);
          wrapper.append(caption, colorControl);
          return wrapper;
        }
      }
      control.dataset.previewProp = property;
      control.setAttribute("aria-label", "本地试改" + label);
      if (kind !== "select") control.addEventListener("blur", () => this.applyPreviewField(control, true));
      wrapper.append(caption, control);
      return wrapper;
    }

    uiOptionLabel(property, value) {
      if (property === "borderStyle") return ({none:"无边框",solid:"实线",dashed:"虚线",dotted:"点线",double:"双线"})[value] || value;
      if (property === "fontWeight") return ({ "100": "极细 100", "200": "纤细 200", "300": "细体 300", "400": "常规 400", "500": "中等 500", "600": "半粗 600", "700": "粗体 700", "800": "特粗 800", "900": "黑体 900" })[value] || value;
      return ({ block: "块级", flex: "弹性", grid: "网格", inline: "行内", "inline-flex": "行内弹性", "inline-grid": "行内网格", row: "横向", column: "纵向", "row-reverse": "横向反转", "column-reverse": "纵向反转", normal: "默认", initial: "默认", stretch: "拉伸", "flex-start": "起点", "flex-end": "终点", start: "起点", end: "终点", left: "左对齐", right: "右对齐", center: "居中", justify: "两端对齐", baseline: "基线", "space-between": "两端分布", "space-around": "环绕分布", "space-evenly": "均匀分布", none: "隐藏" })[value] || value;
    }

    syncUiLayoutFields() {
      const display = this.previewState?.changes.display ?? this.previewState?.before.display;
      const flex = /flex/.test(display || "");
      const layout = flex || /grid/.test(display || "");
      for (const [property, visible] of [["flexDirection", flex], ["justifyContent", layout], ["alignItems", layout], ["gap", layout]]) {
        const field = this.uiEditor?.querySelector(`[data-field='${property}']`);
        if (field) field.hidden = !visible;
      }
      this.uiEditor?.querySelector("[data-field='display']")?.classList.toggle("wide", !flex);
      this.uiEditor?.querySelector("[data-field='gap']")?.classList.add("wide");
    }

    canPreviewPosition(element) {
      if (!element?.isConnected) return false;
      const position = window.getComputedStyle(element).position;
      return position === "absolute" || position === "fixed";
    }

    previewPositionValue(element, style, rect, axis) {
      if (style.position === "fixed") return this.round(axis === "x" ? rect.left : rect.top);
      const parent = element.offsetParent;
      const parentRect = parent?.getBoundingClientRect?.();
      if (!parentRect) return this.round(axis === "x" ? rect.left : rect.top);
      return this.round(axis === "x"
        ? rect.left - parentRect.left + (parent.scrollLeft || 0)
        : rect.top - parentRect.top + (parent.scrollTop || 0));
    }

    uiNumericSpec(property) {
      return {
        width: { minimum: 0, step: 1, shiftStep: 10, unit: "px", aria: "宽度" },
        height: { minimum: 0, step: 1, shiftStep: 10, unit: "px", aria: "高度" },
        left: { minimum: 0, step: 1, shiftStep: 10, unit: "px", aria: "X 坐标" },
        top: { minimum: 0, step: 1, shiftStep: 10, unit: "px", aria: "Y 坐标" },
        opacity: { minimum: 0, maximum: 100, step: 1, shiftStep: 5, unit: "%", aria: "透明度", integer: true },
        borderRadius: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "圆角" },
        fontSize: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "字号" },
        lineHeight: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "行高" },
        gap: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "间距" },
        paddingTop: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "上内边距" },
        paddingRight: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "右内边距" },
        paddingBottom: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "下内边距" },
        paddingLeft: { minimum: 0, step: 1, shiftStep: 4, unit: "px", aria: "左内边距" },
        letterSpacing: { minimum: -Infinity, step: 1, shiftStep: 4, unit: "px", aria: "字间距" }
      }[property] || null;
    }

    uiNumericDisplayValue(property, value) {
      const spec = this.uiNumericSpec(property);
      if (!spec) return String(value ?? "");
      const parsed = Number.parseFloat(String(value ?? "").replace(/px$/i, ""));
      const fallbackLineHeight = property === "lineHeight"
        ? Number.parseFloat(String(this.previewState?.changes.fontSize ?? this.previewState?.before.fontSize ?? "").replace(/px$/i, "")) * 1.2
        : spec.minimum;
      const number = Number.isFinite(parsed)
        ? (property === "opacity" ? parsed * 100 : parsed)
        : (Number.isFinite(fallbackLineHeight) ? fallbackLineHeight : 0);
      if (property === "borderRadius" && number > 1000000 && /^\d+(?:\.\d+)?(?:e\+?\d+)?px$/i.test(String(value))) {
        const rect = this.previewState?.element?.getBoundingClientRect();
        if (rect) return this.formatUiNumericValue(Math.min(rect.width, rect.height) / 2, spec);
      }
      return this.formatUiNumericValue(number, spec);
    }

    formatUiNumericValue(value, spec) {
      const normalized = spec.integer ? Math.round(value) : Math.round(value * 100) / 100;
      return String(normalized);
    }

    parseUiNumericValue(property, rawValue) {
      const spec = this.uiNumericSpec(property);
      const raw = String(rawValue ?? "").trim();
      if (!spec || !raw || !/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return { valid: false, spec };
      let value = Number(raw);
      if (!Number.isFinite(value)) return { valid: false, spec };
      if (property === "opacity") value = Math.min(spec.maximum, Math.max(spec.minimum, value));
      else if (property === "borderRadius") value = Math.max(spec.minimum, value);
      else if (value < spec.minimum) return { valid: false, spec };
      if (spec.integer) value = Math.round(value);
      return { valid: true, value, spec };
    }

    createUiNumericInput(property, label, value, className = "") {
      const spec = this.uiNumericSpec(property);
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = spec?.integer ? "numeric" : "decimal";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.className = className;
      input.value = value;
      input.dataset.previewProp = property;
      input.dataset.uiNumeric = property;
      input.dataset.lastValid = value;
      input.setAttribute("aria-label", "本地试改" + (spec?.aria || label));
      let selectToken = 0;
      const selectValue = () => {
        const token = ++selectToken;
        input.dataset.selectionPending = "true";
        window.requestAnimationFrame(() => {
          if (token !== selectToken || input.dataset.selectionPending !== "true" || this.shadow.activeElement !== input) return;
          input.select();
        });
      };
      const keepTyping = () => {
        input.dataset.selectionPending = "false";
        selectToken += 1;
      };
      input.addEventListener("focus", selectValue);
      input.addEventListener("click", selectValue);
      input.addEventListener("keydown", keepTyping);
      input.addEventListener("input", keepTyping);
      input.addEventListener("blur", () => this.commitUiNumericInput(input));
      input.addEventListener("keydown", (event) => this.handleUiNumericKeydown(event, input));
      return input;
    }

    createUiNumericField(property, label, kind) {
      const spec = this.uiNumericSpec(property);
      const wrapper = document.createElement("div");
      wrapper.className = "ui-editor-field ui-numeric-field" + (kind === "opacity" ? " wide ui-opacity-field" : "");
      wrapper.dataset.field = property;
      const caption = document.createElement("span");
      caption.textContent = label;
      const value = this.uiNumericDisplayValue(property, this.previewState?.changes[property] ?? this.previewState?.before[property]);
      const numberControl = document.createElement("div");
      numberControl.className = "ui-number-control";
      const input = this.createUiNumericInput(property, label, value);
      if (property === "borderRadius") input.title = "CSS 原始圆角：" + (this.previewState?.changes[property] ?? this.previewState?.before[property]);
      const unit = document.createElement("span");
      unit.className = "ui-number-unit";
      unit.textContent = spec?.unit || "";
      numberControl.append(input, unit);
      if (kind !== "opacity") {
        wrapper.append(caption, numberControl);
        return wrapper;
      }
      const range = document.createElement("input");
      range.type = "range";
      range.className = "ui-opacity-range";
      range.min = String(spec.minimum);
      range.max = String(spec.maximum);
      range.step = String(spec.step);
      range.value = value;
      range.style.setProperty("--uidelta-range-progress", value + "%");
      range.dataset.previewProp = property;
      range.dataset.uiNumeric = property;
      range.dataset.lastValid = value;
      range.setAttribute("aria-label", "本地试改透明度滑块");
      range.addEventListener("keydown", (event) => this.handleUiNumericKeydown(event, range));
      const controls = document.createElement("div");
      controls.className = "ui-opacity-control";
      controls.append(numberControl, range);
      wrapper.append(caption, controls);
      return wrapper;
    }

    handleUiNumericInput(input) {
      const parsed = this.parseUiNumericValue(input.dataset.previewProp, input.value);
      if (!parsed.valid) return;
      const display = this.formatUiNumericValue(parsed.value, parsed.spec);
      this.applyUiNumericPreview(input, parsed.value, display, input.type !== "range");
    }

    commitUiNumericInput(input) {
      const parsed = this.parseUiNumericValue(input.dataset.previewProp, input.value);
      if (!parsed.valid) {
        const fallback = input.dataset.lastValid || this.uiNumericDisplayValue(input.dataset.previewProp, this.previewState?.changes[input.dataset.previewProp] ?? this.previewState?.before[input.dataset.previewProp]);
        input.value = fallback;
        input.classList.remove("is-invalid");
        void input.offsetWidth;
        input.classList.add("is-invalid");
        return;
      }
      this.applyUiNumericPreview(input, parsed.value, this.formatUiNumericValue(parsed.value, parsed.spec));
    }

    handleUiNumericKeydown(event, input) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const spec = this.uiNumericSpec(input.dataset.previewProp);
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      const parsed = this.parseUiNumericValue(input.dataset.previewProp, input.dataset.lastValid || input.value);
      const current = parsed.valid ? parsed.value : spec.minimum;
      const step = event.shiftKey ? spec.shiftStep : spec.step;
      let next = current + (event.key === "ArrowUp" ? step : -step);
      if (typeof spec.maximum === "number") next = Math.min(spec.maximum, next);
      next = Math.max(spec.minimum, next);
      this.applyUiNumericPreview(input, next, this.formatUiNumericValue(next, spec));
    }

    applyUiNumericPreview(input, value, displayValue, preserveDraft = false) {
      const property = input.dataset.previewProp;
      const cssValue = property === "opacity" ? String(value / 100) : String(value);
      if (property === "borderRadius" && Number(this.previewState?.before.borderRadius?.replace(/px$/, "")) > 1000000
        && !Object.hasOwn(this.previewState.changes, property)
        && displayValue === this.uiNumericDisplayValue(property, this.previewState.before[property])) return;
      input.classList.remove("is-invalid");
      // Keep the live draft and caret (e.g. "0.0" while entering "0.01").
      // Normalize only on commit, stepping, or an actual range clamp.
      if (!preserveDraft || Number(input.value) !== value) input.value = displayValue;
      input.dataset.lastValid = displayValue;
      this.applyPreviewProperty(property, cssValue);
      for (const control of this.uiEditor?.querySelectorAll(`[data-ui-numeric='${property}']`) || []) {
        if (control !== input) control.value = displayValue;
        control.dataset.lastValid = displayValue;
        if (property === "opacity" && control.type === "range") control.style.setProperty("--uidelta-range-progress", displayValue + "%");
      }
      input.classList.remove("is-updated");
      void input.offsetWidth;
      input.classList.add("is-updated");
    }

    updatePreviewSummary() {
      if (!this.previewState) return;
      const changes = Object.entries(this.previewState.changes || {});
      const render = (status, delta) => {
        if (!status || !delta) return;
        status.textContent = changes.length ? changes.length + " 项已试改" : "仅本地预览";
        delta.replaceChildren();
        for (const [property, after] of changes) {
          const row = document.createElement("div");
          const label = document.createElement("strong");
          label.textContent = this.previewPropertyLabel(property) + "：";
          row.append(label, document.createTextNode((this.previewState.before[property] || "—") + " → " + after));
          delta.appendChild(row);
        }
      };
      render(this.previewStatus, this.previewDelta);
      render(this.uiEditorStatus, this.uiEditorDelta);
      const record = this.uiEditor?.querySelector("[data-action='record']");
      if (record) record.disabled = !this.isSessionActive() || !this.selected?.isConnected;
      const toggle = this.uiEditor?.querySelector(".ui-editor-toggle");
      if (toggle) {
        const shared = this.previewCandidateList.length > 1;
        toggle.classList.toggle("active", shared);
        toggle.setAttribute("aria-pressed", String(shared));
      }
    }

    previewPropertyLabel(property) {
      return ({ color: "文字色", backgroundColor: "填充", backgroundImage: "背景图 / 渐变", borderColor: "边框颜色", borderWidth: "边框宽度", borderStyle: "边框线型", display: "布局", flexDirection: "方向", justifyContent: "主轴对齐", alignItems: "交叉对齐", fontFamily: "字体", fontWeight: "字重", fontSize: "字号", lineHeight: "行高", width: "宽度", height: "高度", left: "X 坐标", top: "Y 坐标", borderRadius: "圆角", padding: "内边距", paddingTop: "上内边距", paddingRight: "右内边距", paddingBottom: "下内边距", paddingLeft: "左内边距", gap: "间距", opacity: "透明度", margin: "外边距", textAlign: "文本对齐", letterSpacing: "字间距", boxShadow: "阴影", textContent: "文本" })[property] || property;
    }

    previewColorValue(value) {
      const color = this.parseColor(value);
      if (color) return "#" + [color.red, color.green, color.blue].map((part) => Number(part).toString(16).padStart(2, "0")).join("");
      const hex = String(value || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
      // The native picker needs sRGB; keep the original CSS value in the text
      // field and swatch, including alpha and modern lab()/oklch() colors.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context && CSS.supports("color", hex)) {
        context.fillStyle = hex;
        context.fillRect(0, 0, 1, 1);
        return "#" + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("");
      }
      return "#000000";
    }

    applyPreviewField(input, commit) {
      const property = input.dataset.previewProp;
      const applied = this.applyPreviewProperty(property, input.value);
      if (applied) {
        if (property === "color" || property === "backgroundColor" || property === "borderColor") input.title = input.value;
        input.removeAttribute("aria-invalid");
        input.classList.remove("is-invalid");
        input.classList.remove("is-updated");
        void input.offsetWidth;
        input.classList.add("is-updated");
      } else if (commit) {
        input.value = this.previewState?.changes[property] ?? this.previewState?.before[property] ?? "";
        input.setAttribute("aria-invalid", "true");
        input.classList.remove("is-invalid");
        void input.offsetWidth;
        input.classList.add("is-invalid");
      }
    }

    captureUiEditorFocus() {
      const active = this.shadow?.activeElement;
      const isField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
      if (!isField || !active.dataset?.previewProp) return null;
      return {
        property: active.dataset.previewProp,
        numeric: active.dataset.uiNumeric || "",
        tagName: active.tagName,
        inputType: active instanceof HTMLInputElement ? active.type : "",
        selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
        selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
      };
    }

    restoreUiEditorFocus(snapshot) {
      if (!snapshot || !this.uiEditor?.isConnected) return;
      const target = Array.from(this.uiEditor.querySelectorAll("[data-preview-prop]")).find((field) => {
        if (field.dataset.previewProp !== snapshot.property || field.dataset.uiNumeric !== snapshot.numeric || field.tagName !== snapshot.tagName) return false;
        return !(field instanceof HTMLInputElement) || field.type === snapshot.inputType;
      });
      if (!target) return;
      // During ordinary typing the original node is still focused. Never
      // select or refocus it again: doing so races the browser's caret update
      // and was the reason a second character could require another click.
      if (this.shadow.activeElement === target) return;
      const restoreSelection = () => {
        if (this.shadow.activeElement !== target) return;
        if (typeof snapshot.selectionStart !== "number" || typeof target.setSelectionRange !== "function") return;
        const max = String(target.value || "").length;
        const start = Math.min(snapshot.selectionStart, max);
        const end = Math.min(snapshot.selectionEnd ?? start, max);
        target.setSelectionRange(start, end);
      };
      target.focus({ preventScroll: true });
      restoreSelection();
      window.requestAnimationFrame(restoreSelection);
    }

    applyPreviewProperty(property, rawValue) {
      const state = this.previewState;
      const element = state?.element;
      if (!state || !element?.isConnected || !property) return false;
      const focusSnapshot = this.captureUiEditorFocus();
      let value = property === "textContent" ? String(rawValue ?? "") : String(rawValue ?? "").trim();
      if (["color", "backgroundColor", "borderColor"].includes(property) && /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) value = "#" + value;
      if (property === "borderWidth" && /^\d+(?:\.\d+)?$/.test(value)) value += "px";
      if (["width", "height", "left", "top", "fontSize", "lineHeight", "borderRadius", "gap", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].includes(property) && /^-?\d+(?:\.\d+)?$/.test(value)) value += "px";
      const cssProperty = property.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
      // Merely tabbing through a field must not create a local override.
      if (value === String(state.changes[property] ?? state.before[property] ?? "")) return true;
      if (typeof CSS !== "undefined" && CSS.supports && property !== "textContent" && !CSS.supports(cssProperty, value)) {
        return false;
      }
      const targets = this.previewTargets.size ? Array.from(this.previewTargets) : [element];
      for (const target of targets) {
        if (!target?.isConnected) continue;
        this.capturePreviewOriginal(target);
        if (property === "textContent") {
          if (!target.children.length) target.textContent = value;
        } else {
          target.style.setProperty(cssProperty, value, "important");
        }
      }
      state.changes[property] = value;
      if (property === "display") this.syncUiLayoutFields();
      if (property === "color" || property === "backgroundColor" || property === "borderColor") {
        const swatch = this.uiEditor?.querySelector(`[data-color-swatch='${property}']`);
        if (swatch) swatch.style.background = value;
      }
      this.previewTargets.add(element);
      const activeControl = this.shadow?.activeElement || document.activeElement;
      for (const control of this.uiEditor?.querySelectorAll("[data-preview-prop='" + property + "']") || []) {
        if (control === activeControl) continue;
        const controlValue = control.dataset.uiNumeric
          ? this.uiNumericDisplayValue(property, value)
          : (property === "color" || property === "backgroundColor" || property === "borderColor") && control.type === "color"
            ? this.previewColorValue(value)
            : value;
        control.value = controlValue;
        if (control.dataset.uiNumeric) {
          control.dataset.lastValid = controlValue;
          if (property === "opacity" && control.type === "range") control.style.setProperty("--uidelta-range-progress", controlValue + "%");
        }
      }
      // A full inspector render destroys the active control tree. While a
      // field is actively edited, update the page preview and the summary only
      // so the native input retains its focus and caret for normal continuous
      // typing. The next blur/selection refresh safely reconciles metadata.
      if (this.browseMode) return true;
      if (focusSnapshot) {
        this.renderSelected(element);
        this.updatePreviewSummary();
        return true;
      }
      this.updateInspector(element, "UI 预览", { compare: false, preservePreview: true });
      this.restoreUiEditorFocus(focusSnapshot);
      return true;
    }

    capturePreviewOriginal(element) {
      if (this.previewHistory.has(element)) return;
      const keys = ["color", "backgroundColor", "backgroundImage", "borderColor", "borderWidth", "borderStyle", "display", "flexDirection", "justifyContent", "alignItems", "fontFamily", "fontWeight", "fontSize", "lineHeight", "width", "height", "left", "top", "borderRadius", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap", "opacity", "margin", "textAlign", "letterSpacing", "boxShadow"];
      const inline = {};
      const priorities = {};
      for (const key of keys) {
        inline[key] = element.style[key];
        priorities[key] = element.style.getPropertyPriority(key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()));
      }
      this.previewHistory.set(element, { inline, priorities, textContent: element.children.length ? null : element.textContent });
    }

    resetPreview(showToast = true) {
      for (const [element, original] of this.previewHistory) {
        if (!element?.isConnected) continue;
        for (const [key, value] of Object.entries(original.inline || {})) {
          const cssKey = key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
          element.style.setProperty(cssKey, value || "", original.priorities?.[key] || "");
        }
        if (original.textContent !== null) element.textContent = original.textContent;
      }
      this.previewHistory.clear();
      this.previewStates.clear();
      this.previewTargets.clear();
      this.previewCandidateList = [];
      const hadChanges = Boolean(this.previewState && Object.keys(this.previewState.changes || {}).length);
      this.previewState = null;
      for (const container of [this.previewCandidates, this.uiEditorCandidates]) {
        if (!container) continue;
        container.replaceChildren();
        container.classList.remove("visible");
      }
      if (showToast && hadChanges) this.showToast("已撤销本地预览");
    }

    renderPreviewCandidates() {
      const container = this.inspectMode === "ui" ? this.uiEditorCandidates : this.previewCandidates;
      if (!container || !this.previewState?.element) return;
      container.replaceChildren();
      container.classList.remove("visible");
      if (!this.previewTargets.size) return;
      const toggle = this.uiEditor?.querySelector(".ui-editor-toggle");
      if (toggle) {
        const shared = this.previewCandidateList.length > 1;
        toggle.classList.toggle("active", shared);
        toggle.setAttribute("aria-pressed", String(shared));
      }
      const count = this.previewTargets.size;
      const note = document.createElement("span");
      note.className = "preview-status";
      note.textContent = "已选 " + count + " 个同类型元素，后续改动会实时同步";
      const list = document.createElement("div");
      list.className = "preview-candidate-list";
      this.previewCandidateList.forEach((candidate, index) => {
        if (!candidate?.isConnected) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "preview-candidate" + (this.previewTargets.has(candidate) ? " active" : "");
        button.dataset.action = "toggle-preview-target";
        button.dataset.previewIndex = String(index);
        button.setAttribute("aria-pressed", String(this.previewTargets.has(candidate)));
        const name = document.createElement("span");
        name.textContent = this.elementLabel(candidate);
        const rect = candidate.getBoundingClientRect();
        const size = document.createElement("span");
        size.textContent = this.round(rect.width) + " × " + this.round(rect.height);
        button.append(name, size);
        list.appendChild(button);
      });
      container.append(note, list);
      container.classList.add("visible");
    }

    findSameTypeElements(element) {
      if (!element?.isConnected) return [];
      const role = element.getAttribute("role") || "";
      const classes = Array.from(element.classList).filter((name) => this.isStableClass(name)).slice(0, 2);
      return Array.from(element.ownerDocument.querySelectorAll(element.tagName.toLowerCase())).filter((candidate) => {
        if (candidate === element || candidate.closest("[" + ROOT_ATTRIBUTE + "]")) return false;
        if (role && candidate.getAttribute("role") !== role) return false;
        if (classes.length && !classes.every((name) => candidate.classList.contains(name))) return false;
        const rect = candidate.getBoundingClientRect();
        return this.isVisible(rect);
      }).slice(0, 24);
    }

    showSameTypePreview() {
      const element = this.previewState?.element || this.selected;
      if (!element?.isConnected) return;
      this.previewCandidateList = [element, ...this.findSameTypeElements(element)];
      this.previewTargets = new Set([element]);
      this.renderPreviewCandidates();
      this.showToast("选择同类元素后，属性会实时同步");
    }

    togglePreviewTarget(index) {
      const candidate = this.previewCandidateList[Number(index)];
      if (!candidate?.isConnected) return;
      if (candidate === this.previewState?.element) return;
      if (this.previewTargets.has(candidate)) this.previewTargets.delete(candidate);
      else this.previewTargets.add(candidate);
      this.renderPreviewCandidates();
    }

    applyPreviewBatch() {
      const state = this.previewState;
      if (!state?.changes || !this.previewTargets.size) return;
      for (const element of this.previewTargets) {
        if (!element?.isConnected) continue;
        this.capturePreviewOriginal(element);
        for (const [property, value] of Object.entries(state.changes)) {
          if (property === "textContent") {
            if (!element.children.length) element.textContent = value;
          } else element.style.setProperty(property.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()), value, "important");
        }
      }
      this.renderPreviewCandidates();
      this.updateInspector(state.element, "UI 预览", { compare: false });
      this.showToast("已应用到 " + this.previewTargets.size + " 个同类型元素（刷新可恢复）");
    }

    getPreviewProposal() {
      const state = this.previewState;
      if (!state || !Object.keys(state.changes || {}).length) return null;
      return {
        version: 1,
        scope: this.previewTargets.size > 1 ? "same-type" : "element",
        targetCount: Math.max(1, this.previewTargets.size),
        changes: Object.entries(state.changes).map(([property, after]) => ({ property, before: state.before[property] ?? "", after }))
      };
    }

    setMetric(name, text, swatch) {
      const node = this.shadow.querySelector("[data-value='" + name + "']");
      if (!node) return;
      node.replaceChildren();
      if (swatch) {
        const color = document.createElement("i");
        color.className = "swatch";
        color.style.setProperty("--swatch", swatch);
        node.appendChild(color);
      }
      node.appendChild(document.createTextNode(text || "—"));
    }

    updateRecordButton(measurement = false) {
      const label = this.recordButton?.querySelector(".record-label");
      if (label) label.textContent = "记录问题";
      if (this.recordButton) this.recordButton.classList.toggle("has-measurement", measurement);
    }

    async openComposer(issue, measurementOverride = null, regionOverride = null) {
      if (issue && this.issueDeletionFor(issue.id)) {
        this.showToast("该问题正在删除，请先取消删除");
        return;
      }
      if (this.composer?.saving || this.composer?.referencePromise) {
        this.showToast("正在保存或添加参考图，请稍候");
        return;
      }
      if (!issue && this.composer?.captureStatus === "capturing") {
        this.showToast("上一条正在取证，请稍候");
        return;
      }
      if (!issue && this.composer && !this.composer.saving) this.composer = null;
      if (!this.session) {
        await this.startSession();
        if (!this.session) return;
      }
      if (!issue && !this.isSessionActive()) {
        this.showToast("请先继续本次走查");
        this.showView("paused");
        return;
      }
      const regionTracker = regionOverride ? this.createRegionTracker(regionOverride) : null;
      const effectiveMeasurement = regionOverride ? null : measurementOverride
        || this.currentMeasurement
        || (this.lastMeasurementSource === this.selected ? this.lastMeasurement : null);
      const hoveredTarget = this.hovered?.isConnected ? this.hovered : null;
      const inspectionTarget = this.inspectMode === "annotation"
        ? (hoveredTarget || this.selected)
        : (this.selected || hoveredTarget);
      const selectedTarget = this.measurementTarget?.isConnected && effectiveMeasurement
        ? this.measurementTarget
        : inspectionTarget;
      const transitionRect = issue ? null : regionOverride || effectiveMeasurement?.toRect || selectedTarget?.getBoundingClientRect();
      if (!issue && !regionOverride && (!selectedTarget || !selectedTarget.isConnected)) {
        this.showToast("请先点击选择元素");
        return;
      }

      if (!issue) {
        const selectedSelector = this.shadowSelectorPath(selectedTarget).join(" >>> ");
        const duplicate = this.issues.find((item) => {
          return item.pageSnapshot && item.pageSnapshot.route === this.currentRoute()
            && item.elementAnchor
            && (item.elementAnchor.identityKey || (item.elementAnchor.shadowSelectors || [item.elementAnchor.preferredSelector]).join(" >>> ")) === selectedSelector;
        });
        if (duplicate) this.showToast("这个元素已有 " + duplicate.displayId + "，仍可继续记录");
      }

      if (issue) {
        const targetElement = this.resolveAnchor(issue.elementAnchor);
        const hasEvidence = Boolean(issue.attachments?.context && issue.attachments?.detail);
        this.composer = {
          mode: "edit",
          returnView: this.currentView,
          issue: structuredClone(issue),
          targetElement,
          originalAttachments: { ...(issue.attachments || {}) },
          type: issue.type || "ui",
          severity: this.normalizeSeverity(issue.severity),
          priority: issue.priority || "queued",
          captureStatus: hasEvidence ? "ready" : "error",
          captureError: hasEvidence ? "" : "截图证据不完整，请重新截图。",
          capturePromise: Promise.resolve(null)
        };
      } else {
        if (this.composerOpening) return;
        const element = selectedTarget;
        const frozenMeasurement = effectiveMeasurement;
        this.composerOpening = true;
        let reservation;
        try {
          reservation = await this.sendMessage({ type: "UIDELTA_RESERVE_ISSUE", sessionId: this.session.id });
        } finally {
          this.composerOpening = false;
        }
        if (!reservation || !reservation.ok) {
          this.showToast((reservation && reservation.error) || "无法分配问题编号");
          return;
        }
        if (!this.enabled || !this.isSessionActive()) return;
        if (!regionOverride && !element.isConnected) {
          this.showToast("目标元素已经变化，请重新选择");
          return;
        }
        if (reservation.session) this.session = reservation.session;
        const sequence = Number(reservation.sequence);
        const id = this.createId("issue");
        const rect = regionOverride || element.getBoundingClientRect();
        const isRegion = Boolean(regionOverride);
        const issueDraft = {
          id,
          displayId: "UI-" + String(sequence).padStart(3, "0"),
          sequence,
          numberingEpoch: reservation.session?.numberingEpoch || 0,
          sessionId: this.session.id,
          source: isRegion ? "manual_region" : "manual",
          captureMode: isRegion ? "region" : this.inspectMode || "annotation",
          reviewStatus: "accepted",
          type: "ui",
          title: "",
          description: "",
          severity: "cosmetic",
          priority: "queued",
          pageSnapshot: this.pageSnapshot(),
          elementAnchor: isRegion ? this.regionAnchor(rect) : this.elementAnchor(element),
          webSnapshot: isRegion ? null : this.styleSnapshot(element),
          region: isRegion ? { ...rect } : null,
          designSnapshot: this.currentCompare?.selectedNode ? structuredClone(this.currentCompare.selectedNode) : null,
          diffs: this.currentCompare?.diffs ? structuredClone(this.currentCompare.diffs) : [],
          changeProposal: this.getPreviewProposal(),
          measurement: frozenMeasurement ? structuredClone(frozenMeasurement) : null,
          attachments: {},
          captureMetrics: { composerOpenedAt: new Date().toISOString() },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const epoch = ++this.captureEpoch;
        this.composer = {
          mode: "create",
          returnView: "inspect",
          issue: issueDraft,
          targetElement: isRegion ? null : element,
          regionTracker,
          originalAttachments: {},
          type: "ui",
          severity: "cosmetic",
          priority: "queued",
          captureStatus: "capturing",
          captureError: "",
          captureEpoch: epoch,
          capturePromise: null
        };
        const captureToken = this.createId("capture") + ":" + epoch;
        this.composer.captureToken = captureToken;
        this.composer.releaseFocusAppearance = this.preserveFocusAppearance();
        const captureRect = this.captureRectForIssue(issueDraft, rect);
        this.lockComposerOverlay();
        this.captureTargets.set(captureToken, { element: isRegion ? null : element, rect: captureRect, region: isRegion, composer:this.composer });
        this.composer.capturePromise = this.captureEvidence(issueDraft, captureRect, epoch, captureToken);
      }

      if (this.browseMode) {
        this.persistTabContext();
        return;
      }
      this.restorePanel();
      this.renderComposer();
      this.showView("composer");
      this.focusComposerDescription();
      if (!issue) this.animateRecordTransition(transitionRect);
    }

    focusComposerDescription() {
      const composer = this.composer;
      const focus = () => {
        if (this.browseMode || this.currentView !== "composer" || this.composer !== composer || !composer || !this.descriptionInput) return;
        const active = this.shadow.activeElement;
        // Do not steal the caret after the user has started typing or tabbed
        // into another field. Screenshot capture no longer blurs this input.
        if (active === this.descriptionInput || active?.matches?.("input,textarea,select,.segment")) return;
        this.descriptionInput.focus({ preventScroll: true });
        const end = this.descriptionInput.value.length;
        this.descriptionInput.setSelectionRange(end, end);
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(focus));
    }

    preserveFocusAppearance() {
      // Copy only focus-related paint, not layout or input values. This lets
      // the composer receive real focus while evidence retains the page ring.
      let active = document.activeElement;
      if (active === this.host) return () => {};
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!active || active === document.body || active === this.host) return () => {};
      const saved = [];
      const properties = ["box-shadow", "outline", "outline-offset", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "background-color"];
      for (let node = active; node && node !== document.body; node = node.parentElement || node.getRootNode?.().host) {
        if (!node.style) continue;
        const computed = getComputedStyle(node);
        const values = properties.map(property => [property, computed.getPropertyValue(property)]);
        for (const [property, value] of values) {
          const previous = node.style.getPropertyValue(property), priority = node.style.getPropertyPriority(property);
          node.style.setProperty(property, value, "important");
          const applied = node.style.getPropertyValue(property);
          saved.push(() => {
            // Do not overwrite a host update made while capture was pending.
            if (node.style.getPropertyValue(property) !== applied || node.style.getPropertyPriority(property) !== "important") return;
            if (previous) node.style.setProperty(property, previous, priority);
            else node.style.removeProperty(property);
          });
        }
      }
      return () => { for (const restore of saved.splice(0)) restore(); };
    }

    cancelRecordTransition() {
      const transition = this.recordTransition;
      this.recordTransition = null;
      if (!transition) return;
      if (transition.frame) window.cancelAnimationFrame(transition.frame);
      window.clearTimeout(transition.timeout);
      for (const animation of transition.animations) animation.cancel();
      transition.ghost?.remove();
      transition.resolve();
    }

    animateRecordTransition(rect) {
      this.cancelRecordTransition();
      if (!this.composer || this.browseMode || !rect || rect.width <= 0 || rect.height <= 0) return;
      const transition = { composer: this.composer, animations: [], ghost: null, frame: null };
      // Keep the field interactive from the start; these timings only pace
      // visual feedback and the screenshot's clean-capture boundary.
      const motion = { flight:400, panel:220, receipt:180, receiptDelay:280, timeout:800 };
      transition.finished = new Promise((resolve) => { transition.resolve = resolve; });
      this.recordTransition = transition;
      // A suspended frame / animation must never hold up evidence capture.
      transition.timeout = window.setTimeout(() => {
        if (this.recordTransition === transition) this.cancelRecordTransition();
      }, motion.timeout);
      transition.frame = window.requestAnimationFrame(() => {
        transition.frame = null;
        if (this.recordTransition !== transition) return;
        if (this.composer !== transition.composer || this.currentView !== "composer" || this.browseMode) { this.cancelRecordTransition(); return; }
        const destination = this.evidenceStrip.querySelector(".evidence-detail") || this.evidenceStrip.querySelector(".evidence-thumb");
        if (!destination?.animate || !this.panel?.animate) { this.cancelRecordTransition(); return; }
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const panelAnimation = this.panel.animate([{ opacity:reduced ? .8 : .65 }, { opacity:1 }],
          { duration:reduced ? 100 : motion.panel, easing:"cubic-bezier(0.23, 1, 0.32, 1)" });
        transition.animations.push(panelAnimation);
        if (!reduced) {
          const target = destination.getBoundingClientRect();
          const left = Math.max(0, Math.min(window.innerWidth, rect.left));
          const top = Math.max(0, Math.min(window.innerHeight, rect.top));
          const width = Math.max(1, Math.min(window.innerWidth, rect.left + rect.width) - left);
          const height = Math.max(1, Math.min(window.innerHeight, rect.top + rect.height) - top);
          const ghost = document.createElement("div");
          ghost.className = "record-flight";
          ghost.setAttribute("aria-hidden", "true");
          Object.assign(ghost.style, { left:left + "px", top:top + "px", width:width + "px", height:height + "px" });
          const label = document.createElement("span");
          label.textContent = this.composer.issue.elementAnchor?.name || "记录区域";
          ghost.append(label);
          this.shadow.append(ghost);
          transition.ghost = ghost;
          // One scale preserves the source aspect ratio. Sample a quadratic
          // arc instead of changing direction abruptly at a middle keyframe.
          const scale = Math.min(target.width / width, target.height / height, 1);
          const dx = target.left + (target.width - width * scale) / 2 - left;
          const dy = target.top + (target.height - height * scale) / 2 - top;
          const lift = Math.min(56, Math.hypot(dx, dy) * .08);
          const frames = Array.from({ length:25 }, (_, index) => {
            const t = index / 24;
            const x = dx * t;
            const y = dy * t - 2 * (1 - t) * t * lift;
            const size = 1 + (scale - 1) * t;
            return { offset:t, transform:`translate(${x}px,${y}px) scale(${size})`, opacity:t < .8 ? .9 : .9 * (1 - t) / .2 };
          });
          // A gentler front half makes the arc legible instead of racing
          // through most of the distance in the first few frames.
          const flight = ghost.animate(frames, { duration:motion.flight, easing:"cubic-bezier(0.22, 0.61, 0.36, 1)" });
          transition.animations.push(flight);
        }
        const receipt = destination.animate(reduced
          ? [{ opacity:.65 }, { opacity:1 }]
          : [{ opacity:.65, transform:"scale(.98)", offset:0 }, { opacity:1, transform:"scale(1.025)", offset:.6 }, { opacity:1, transform:"scale(1)", offset:1 }],
        { duration:reduced ? 100 : motion.receipt, delay:reduced ? 0 : motion.receiptDelay, easing:"cubic-bezier(0.22, 0.61, 0.36, 1)" });
        transition.animations.push(receipt);
        Promise.all(transition.animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
          transition.ghost?.remove();
          window.clearTimeout(transition.timeout);
          if (this.recordTransition === transition) this.recordTransition = null;
          transition.resolve();
        });
      });
    }

    renderComposer() {
      if (!this.composer) return;
      const issue = this.composer.issue;
      this.composerId.textContent = issue.displayId;
      this.composerElement.textContent = issue.region ? "自由框选 · " + Math.round(issue.region.width) + " × " + Math.round(issue.region.height) : (issue.elementAnchor.name || issue.elementAnchor.preferredSelector || "页面元素");
      const compareSummary = issue.designSnapshot
        ? "已匹配 · " + (issue.designSnapshot.name || issue.designSnapshot.id) + " · " + (issue.diffs?.length || 0) + " 项差异"
        : this.session?.designSnapshot ? "未找到可靠匹配 · 可继续手工记录" : "未绑定设计";
      if (this.composerCompare) {
        this.composerCompare.textContent = issue.designSnapshot ? compareSummary : "";
        this.composerCompare.hidden = !issue.designSnapshot;
      }
      if (this.composerDiffs) {
        this.composerDiffs.replaceChildren();
        this.composerDiffs.hidden = !issue.diffs?.length;
        for (const diff of (issue.diffs || []).slice(0, 5)) {
          const row = document.createElement("div");
          row.className = "composer-diff";
          const property = document.createElement("strong");
          property.textContent = this.comparePropertyLabel(diff.property);
          const values = document.createElement("span");
          const expected = document.createElement("em");
          expected.textContent = "期望 " + diff.expected;
          values.append(expected, document.createTextNode(" · 实测 " + diff.actual + " · 差异 " + diff.delta));
          row.append(property, values);
          this.composerDiffs.appendChild(row);
        }
      }
      if (issue.measurement) {
        this.currentMeasurement = structuredClone(issue.measurement);
        this.renderMeasurementSnapshot(this.currentMeasurement);
      }
      this.descriptionInput.value = issue.description || "";
      if (this.resultInput) this.resultInput.value = issue.resultReference || "";
      this.composer.formReady = true;
      this.composerError.textContent = "";
      this.saveButton.disabled = Boolean(this.composer.saving);
      this.cancelComposerButton.disabled = Boolean(this.composer.saving);
      this.updateComposerControls();
      this.renderCaptureState();
      this.renderComposerEvidence();
      this.saveButton.textContent = this.composer.mode === "edit" ? "保存修改" : "保存并继续";
      this.cancelComposerButton.textContent = "返回走查";
    }

    updateComposerControls() {
      if (!this.composer) return;
      for (const button of this.shadow.querySelectorAll("[data-type]")) {
        button.disabled = Boolean(this.composer.controlsLocked);
        const active = button.dataset.type === this.composer.type;
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      for (const button of this.shadow.querySelectorAll("[data-severity]")) {
        button.disabled = Boolean(this.composer.controlsLocked);
        const active = button.dataset.severity === this.normalizeSeverity(this.composer.severity);
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      for (const button of this.shadow.querySelectorAll("[data-priority]")) {
        button.disabled = Boolean(this.composer.controlsLocked);
        const active = button.dataset.priority === (this.composer.priority || "queued");
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      const typeInfo = ISSUE_TYPES[this.composer.type] || ISSUE_TYPES.ui;
      this.composer.issue.displayId = typeInfo.prefix + "-" + String(this.composer.issue.sequence).padStart(3, "0");
      this.composerId.textContent = this.composer.issue.displayId;
    }

    renderCaptureState() {
      if (!this.composer) return;
      this.captureState.classList.remove("ready", "error");
      this.captureState.disabled = true;
      this.captureState.title = "";
      if (this.composer.captureStatus === "ready") {
        this.captureState.classList.add("ready");
        this.captureState.textContent = "证据已保存";
      } else if (this.composer.captureStatus === "error") {
        this.captureState.classList.add("error");
        this.captureState.disabled = false;
        this.captureState.textContent = "截图失败 · 点击重试";
        this.captureState.title = this.composer.captureError || "重新截取 Context 与 Detail";
      } else {
        this.captureState.textContent = "正在保存证据";
      }
    }

    async retryCaptureEvidence() {
      if (!this.composer || this.composer.captureStatus === "capturing") return;
      const isRegion = Boolean(this.composer.issue.region);
      const target = this.composer.targetElement?.isConnected
        ? this.composer.targetElement
        : this.resolveAnchor(this.composer.issue.elementAnchor);
      if (!isRegion && !target) {
        this.composer.captureError = "目标元素已经变化，请返回页面重新选择。";
        this.composerError.textContent = this.composer.captureError;
        return;
      }
      this.composer.targetElement = target || null;
      // A deliberate retry may re-resolve an equivalent node after a DOM
      // rerender. Ordinary scroll events never replace the locked references.
      delete this.composer.overlayAnchor;
      this.composer.issue.pageSnapshot = this.pageSnapshot();
      if (!isRegion) {
        this.composer.issue.elementAnchor = this.elementAnchor(target);
        this.composer.issue.webSnapshot = this.styleSnapshot(target);
      }
      this.composer.captureStatus = "capturing";
      this.composer.captureError = "";
      this.composerError.textContent = "";
      const epoch = ++this.captureEpoch;
      this.composer.captureEpoch = epoch;
      const captureToken = this.createId("capture") + ":" + epoch;
      this.composer.captureToken = captureToken;
      const captureRect = this.captureRectForIssue(this.composer.issue, isRegion ? this.composer.issue.region : target.getBoundingClientRect());
      this.captureTargets.set(captureToken, { element: target || null, rect: captureRect, region: isRegion, composer:this.composer });
      this.composer.capturePromise = this.captureEvidence(
        this.composer.issue,
        captureRect,
        epoch,
        captureToken
      );
      this.renderCaptureState();
    }

    async captureEvidence(issue, rect, epoch, captureToken) {
      const releaseFocusAppearance = this.composer?.releaseFocusAppearance;
      const serializedRect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
      let response;
      try {
        // openComposer installs its transition in this same turn. Wait for the
        // actual landing, not a timer which can cut a slow frame mid-flight.
        await Promise.resolve();
        const transition = this.recordTransition;
        if (transition?.composer?.captureToken === captureToken) await transition.finished;
        if (!this.composer || this.composer.captureEpoch !== epoch) return null;
        response = await this.sendMessage({
          type: "UIDELTA_CAPTURE_EVIDENCE",
          issueId: issue.id,
          captureToken,
          sessionId: issue.sessionId,
          rect: serializedRect,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            visualViewport: window.visualViewport ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              offsetLeft: window.visualViewport.offsetLeft,
              offsetTop: window.visualViewport.offsetTop
            } : undefined
          },
          label: "#" + String(issue.sequence).padStart(3, "0"),
          pageUrl: issue.pageSnapshot.url,
          preserveMeasurement: Boolean(issue.measurement)
        });
      } finally {
        releaseFocusAppearance?.();
        this.captureTargets.delete(captureToken);
      }

      if (!this.composer || this.composer.captureEpoch !== epoch) {
        if (response && response.ok) {
          const staleContextId = response.contextAssetId || (response.assets && response.assets.context && response.assets.context.id);
          const staleDetailId = response.detailAssetId || (response.assets && response.assets.detail && response.assets.detail.id);
          await this.sendMessage({
            type: "UIDELTA_DELETE_ASSETS",
            assetIds: [staleContextId, staleDetailId].filter(Boolean)
          });
        }
        return response;
      }

      if (response && response.ok) {
        const contextAssetId = response.contextAssetId || (response.assets && response.assets.context && response.assets.context.id);
        const detailAssetId = response.detailAssetId || (response.assets && response.assets.detail && response.assets.detail.id);
        this.composer.issue.attachments = {
          ...(this.composer.issue.attachments || {}),
          context: contextAssetId,
          detail: detailAssetId
        };
        if (response.captureState) this.composer.issue.evidenceCapture = response.captureState;
        this.composer.issue.captureMetrics = {
          ...(this.composer.issue.captureMetrics || {}),
          evidenceMs: Number(response.captureDurationMs) || null
        };
        this.composer.captureStatus = "ready";
        if (this.composer.mode === "create") await this.persistCapturedDraft();
      } else {
        this.composer.captureStatus = "error";
        this.composer.captureError = (response && response.error) || "无法截取当前页面";
      }
      this.renderCaptureState();
      this.renderComposerEvidence();
      return response;
    }

    async persistCapturedDraft() {
      if (!this.composer || (this.composer.mode !== "create" && this.composer.issue?.reviewStatus !== "draft")) return true;
      const activeComposer = this.composer;
      const description = activeComposer.formReady
        ? this.descriptionInput?.value ?? activeComposer.issue.description ?? ""
        : activeComposer.issue.description || "";
      const draft = {
        ...activeComposer.issue,
        reviewStatus: "draft",
        type: activeComposer.type,
        severity: this.normalizeSeverity(activeComposer.severity),
        priority: activeComposer.priority || "queued",
        title: description.trim() ? this.issueTitle(description, activeComposer.type) : "待补充描述",
        description,
        resultReference: activeComposer.formReady ? this.resultInput?.value ?? activeComposer.issue.resultReference ?? "" : activeComposer.issue.resultReference || "",
        updatedAt: new Date().toISOString()
      };
      const response = await this.sendMessage({ type: "UIDELTA_PUT_ISSUE", issue: draft });
      if (!response?.ok || this.composer !== activeComposer) {
        if (this.composer === activeComposer) {
          activeComposer.captureStatus = "error";
          activeComposer.captureError = response?.error || "草稿保存失败，请重试。";
        }
        return false;
      }
      this.composer.issue = response.issue || draft;
      this.composer.mode = "edit";
      this.composer.originalAttachments = { ...(this.composer.issue.attachments || {}) };
      if (response.session) this.session = response.session;
      const index = this.issues.findIndex((issue) => issue.id === this.composer.issue.id);
      if (index >= 0) this.issues.splice(index, 1, this.composer.issue);
      else this.issues.push(this.composer.issue);
      this.updateCounts();
      this.persistTabContext();
      return true;
    }

    captureRectForIssue(issue, fallback) {
      if (issue?.region) return issue.region;
      const first = issue?.measurement?.fromRect;
      const second = issue?.measurement?.toRect;
      if (!first || !second) return fallback;
      const left = Math.min(first.left, second.left);
      const top = Math.min(first.top, second.top);
      const right = Math.max(first.right, second.right);
      const bottom = Math.max(first.bottom, second.bottom);
      return { left: left - 12, top: top - 12, right: right + 12, bottom: bottom + 12, width: right - left + 24, height: bottom - top + 24 };
    }

    regionAnchor(rect) {
      return { name: "自由框选区域", preferredSelector: "[uidelta-region]", fallbackSelector: "[uidelta-region]", identityKey: "region:" + [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join(":"), rect: { ...rect } };
    }

    normalizeSeverity(value) {
      if (value === "major") return "degraded";
      if (value === "minor" || value === "auto" || !SEVERITIES[value]) return "cosmetic";
      return value;
    }

    renderComposerEvidence() {
      if (!this.composer || !this.evidenceStrip || !this.referenceList) return;
      if (this.evidenceComposer !== this.composer) {
        this.evidenceStrip.replaceChildren();
        this.evidenceComposer = this.composer;
      }
      this.evidenceStrip.setAttribute("aria-busy", String(this.composer.captureStatus === "capturing"));
      const attachments = this.composer.issue.attachments || {};
      const evidence = [
        [attachments.context, "全景"], [attachments.detail, "细节"]
      ];
      evidence.forEach(([assetId, label], index) => {
        this.renderComposerAsset(this.evidenceStrip, assetId, label, false, this.evidenceStrip.children[index]);
      });
      this.referenceList.replaceChildren();
      this.descriptionImages?.replaceChildren();
      for (const assetId of (Array.isArray(attachments.references) ? attachments.references : [])) {
        const isDescription = attachments.descriptionImages?.includes(assetId);
        this.renderComposerAsset(isDescription && this.descriptionImages ? this.descriptionImages : this.referenceList, assetId, isDescription ? "问题附图" : "结果参考", true);
      }
    }

    async renderComposerAsset(container, assetId, label, removable, existing = null) {
      const composer = this.composer;
      const wrapper = existing || document.createElement(removable ? "span" : "button");
      if (existing?.evidenceRequest?.composer === composer && existing.evidenceRequest.assetId === assetId && existing.evidenceRequest.status !== "error") return;
      const request = { composer, assetId, status:"loading" };
      wrapper.evidenceRequest = request;
      wrapper.replaceChildren();
      wrapper.className = removable ? "reference-chip" : "evidence-thumb";
      if (!removable && label === "细节") wrapper.classList.add("evidence-detail");
      if (!removable) wrapper.type = "button";
      const caption = document.createElement("span");
      caption.textContent = label;
      if (removable) { caption.textContent = label + " · 加载中"; wrapper.appendChild(caption); }
      if (!removable) {
        wrapper.classList.add("evidence-placeholder");
        wrapper.disabled = true;
        wrapper.appendChild(caption);
        wrapper.setAttribute("aria-label", label + (assetId ? " · 加载中" : " · 等待取证"));
      }
      // Reserve both destinations before requesting assets; an asynchronous
      // thumbnail must not move the form or arrive in a different issue.
      if (!existing) container.appendChild(wrapper);
      if (!assetId) return;
      const response = await this.sendMessage({ type: "UIDELTA_GET_ASSET", assetId, thumbnail: true });
      const isCurrent = () => this.composer === composer && container.isConnected && wrapper.parentNode === container && wrapper.evidenceRequest === request;
      if (!isCurrent()) return;
      if (!response?.ok || !response.dataUrl) {
        request.status = "error";
        caption.textContent = label + " · 加载失败";
        wrapper.setAttribute("aria-label", caption.textContent);
        return;
      }
      const image = document.createElement("img");
      image.src = response.dataUrl;
      image.alt = label + "图片";
      // Decode off-DOM: a completed request is not necessarily a painted image.
      // Keep the slot / caption in place until pixels are ready to crossfade.
      try { if (image.decode) await image.decode(); }
      catch (_) {
        if (!isCurrent()) return;
        request.status = "error";
        caption.textContent = label + " · 加载失败";
        wrapper.setAttribute("aria-label", caption.textContent);
        return;
      }
      if (!isCurrent()) return;
      request.status = "ready";
      if (removable) caption.remove();
      wrapper.classList.remove("evidence-placeholder");
      wrapper.appendChild(image);
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      image.animate?.([{ opacity:0 }, { opacity:1 }], { duration:reduced ? 80 : 240, easing:"ease-out" }).finished.catch(() => {});
      if (removable) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove-reference";
        remove.dataset.assetId = assetId;
        remove.setAttribute("aria-label", "移除参考图片");
        remove.textContent = "×";
        wrapper.appendChild(remove);
        image.addEventListener("click", () => this.previewAsset(assetId, "参考图片"));
      } else {
        wrapper.disabled = false;
        wrapper.setAttribute("aria-label", "放大" + label + "截图");
        wrapper.appendChild(caption);
        if (!wrapper.evidencePreviewBound) {
          wrapper.evidencePreviewBound = true;
          wrapper.addEventListener("click", () => {
            if (!wrapper.disabled) this.previewAsset(wrapper.evidenceRequest.assetId, label + "截图");
          });
        }
      }
    }

    pasteComposerImages(event, role) {
      if (!this.composer || this.composer.saving) return;
      const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
      if (!files.length) return; // Plain text keeps native paste/undo behaviour.
      event.preventDefault();
      if (this.composer.referencePromise) { this.showToast("正在添加图片，请完成后再粘贴"); return; }
      const text = event.clipboardData.getData("text/plain");
      if (text) {
        event.target.setRangeText(text, event.target.selectionStart, event.target.selectionEnd, "end");
        this.persistTabContext();
      }
      return this.addReferenceImages(files, role);
    }

    async addReferenceImages(fileList, role = "result") {
      if (!this.composer || this.composer.saving || this.composer.referencePromise || !fileList?.length) return;
      const composer = this.composer;
      const files = Array.from(fileList).filter((file) => file.type.startsWith("image/")).slice(0, 10);
      if (!files.length) { this.composerError.textContent = "请选择图片文件。"; return; }
      composer.referenceError = "";
      this.referenceInput.disabled = true;
      if (this.descriptionImageInput) this.descriptionImageInput.disabled = true;
      // Wait for capture's initial draft transaction before creating pending
      // reference assets; that transaction prunes attachments it did not see.
      const upload = (async () => {
        if (composer.capturePromise) await composer.capturePromise;
        if (this.composer !== composer) return;
        const current = [...(composer.issue.attachments?.references || [])];
        if (current.length >= 10) { this.composerError.textContent = "最多添加 10 张参考图。"; return; }
        for (const file of files.slice(0, Math.max(0, 10 - current.length))) {
          const dataUrl = await this.readFileAsDataUrl(file);
          if (this.composer !== composer) return;
          const response = await this.sendMessage({ type: "UIDELTA_PUT_REFERENCE_ASSET", issueId: composer.issue.id, sessionId: composer.issue.sessionId, name: file.name, dataUrl });
          if (this.composer !== composer) return;
          if (!response?.ok || !response.asset?.id) {
            composer.referenceError = response?.error || "参考图片添加失败。";
            this.composerError.textContent = composer.referenceError;
            break;
          }
          current.push(response.asset.id);
          composer.issue.attachments = { ...(composer.issue.attachments || {}), references: [...current] };
          if (role === "description") composer.issue.attachments.descriptionImages = [...(composer.issue.attachments.descriptionImages || []), response.asset.id];
          this.persistTabContext();
        }
      })();
      composer.referencePromise = upload;
      try { await upload; }
      catch (error) {
        composer.referenceError = error?.message || "参考图片读取失败，请重试。";
        if (this.composer === composer) this.composerError.textContent = composer.referenceError;
      } finally {
        composer.referencePromise = null;
        if (this.composer === composer) {
          this.referenceInput.disabled = Boolean(composer.controlsLocked);
          if (this.descriptionImageInput) this.descriptionImageInput.disabled = Boolean(composer.controlsLocked);
          this.referenceInput.value = "";
          if (this.descriptionImageInput) this.descriptionImageInput.value = "";
          this.renderComposerEvidence();
        }
      }
    }

    readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取图片"));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    }

    async removeReferenceAsset(assetId) {
      if (!this.composer || this.composer.saving || this.composer.referencePromise || !assetId) return;
      const references = (this.composer.issue.attachments?.references || []).filter((id) => id !== assetId);
      this.composer.issue.attachments = { ...(this.composer.issue.attachments || {}), references,
        descriptionImages:(this.composer.issue.attachments?.descriptionImages || []).filter((id) => id !== assetId) };
      // Removal is an unsaved edit. putIssue atomically prunes unused assets
      // on commit; cancelling must leave the original evidence intact.
      this.persistTabContext();
      this.renderComposerEvidence();
    }

    showCaptureFeedback(rect) {
      if (!this.captureFeedback || !rect) return;
      const context = this.captureFeedback.querySelector(".capture-feedback-context");
      const detail = this.captureFeedback.querySelector(".capture-feedback-detail");
      const full = { left: 8, top: 8, width: Math.max(0, window.innerWidth - 16), height: Math.max(0, window.innerHeight - 16) };
      for (const [node, box] of [[context, full], [detail, rect]]) {
        node.style.left = box.left + "px"; node.style.top = box.top + "px"; node.style.width = box.width + "px"; node.style.height = box.height + "px";
      }
      this.captureFeedback.classList.add("visible");
      window.setTimeout(() => this.captureFeedback.classList.remove("visible"), 360);
    }

    async saveComposer() {
      if (!this.composer || this.composer.saving || this.saveButton.disabled) return;
      const activeComposer = this.composer;
      let description = this.descriptionInput.value.trim();
      if (!description && !this.composer.issue.attachments?.descriptionImages?.length && !this.composer.referencePromise) {
        this.composerError.textContent = "请写一句问题描述。";
        this.descriptionInput.focus();
        return;
      }
      activeComposer.saving = true;
      this.saveButton.disabled = true;
      this.cancelComposerButton.disabled = true;
      this.saveButton.textContent = this.composer.captureStatus === "capturing" ? "正在完成截图…" : "正在保存…";
      if (this.composer.capturePromise) await this.composer.capturePromise;
      if (this.composer !== activeComposer) return;
      if (activeComposer.referencePromise) {
        this.saveButton.textContent = "正在添加参考图…";
        await activeComposer.referencePromise.catch(() => {});
        if (this.composer !== activeComposer) return;
        if (activeComposer.referenceError) {
          activeComposer.saving = false;
          this.saveButton.disabled = false;
          this.cancelComposerButton.disabled = false;
          this.saveButton.textContent = this.composer.mode === "edit" ? "保存修改" : "保存并继续";
          this.composerError.textContent = activeComposer.referenceError + " 可重试添加，或再次保存现有内容。";
          return;
        }
      }
      if (this.composer.captureStatus !== "ready" || !this.composer.issue.attachments?.context || !this.composer.issue.attachments?.detail) {
        activeComposer.saving = false;
        this.saveButton.disabled = false;
        this.cancelComposerButton.disabled = false;
        this.saveButton.textContent = this.composer.mode === "edit" ? "保存修改" : "保存并继续";
        this.composerError.textContent = this.composer.captureError || "需要完整的 Context 与 Detail 截图，请重试。";
        this.renderCaptureState();
        return;
      }

      // Capture may still be running when Save is pressed. Keep accepting
      // typing during that wait, then submit the final text and choices.
      description = this.descriptionInput.value.trim();
      if (!description && !this.composer.issue.attachments?.descriptionImages?.length) {
        activeComposer.saving = false;
        this.saveButton.disabled = false;
        this.cancelComposerButton.disabled = false;
        this.saveButton.textContent = this.composer.mode === "edit" ? "保存修改" : "保存并继续";
        this.composerError.textContent = "请写一句问题描述。";
        if (!this.browseMode) this.descriptionInput.focus();
        return;
      }
      let issue = {
        ...this.composer.issue,
        reviewStatus: "accepted",
        type: this.composer.type,
        severity: this.normalizeSeverity(this.composer.severity),
        severitySource: "manual",
        priority: this.composer.priority || "queued",
        changeProposal: this.getPreviewProposal() || this.composer.issue.changeProposal || null,
        description,
        resultReference: this.resultInput?.value ?? this.composer.issue.resultReference ?? "",
        title: this.issueTitle(description, this.composer.type),
        captureMetrics: this.composer.mode === "create" ? {
          ...(this.composer.issue.captureMetrics || {}),
          issueCaptureMs: Math.max(0, Date.now() - Date.parse(this.composer.issue.captureMetrics?.composerOpenedAt || Date.now()))
        } : this.composer.issue.captureMetrics,
        updatedAt: new Date().toISOString()
      };
      const choices = Array.from(this.shadow.querySelectorAll(".segment"));
      activeComposer.controlsLocked = true;
      const originalReadOnly = this.descriptionInput.readOnly;
      const resultReadOnly = this.resultInput?.readOnly;
      const disabled = choices.map((select) => select.disabled);
      const originalReferenceDisabled = this.referenceInput?.disabled;
      const originalDescriptionImageDisabled = this.descriptionImageInput?.disabled;
      this.descriptionInput.readOnly = true;
      if (this.resultInput) this.resultInput.readOnly = true;
      choices.forEach((select) => { select.disabled = true; });
      if (this.referenceInput) this.referenceInput.disabled = true;
      if (this.descriptionImageInput) this.descriptionImageInput.disabled = true;
      let response;
      try {
        response = await this.sendMessage({ type: "UIDELTA_PUT_ISSUE", issue });
      } finally {
        activeComposer.controlsLocked = false;
        this.descriptionInput.readOnly = originalReadOnly;
        if (this.resultInput) this.resultInput.readOnly = resultReadOnly;
        choices.forEach((select, index) => { select.disabled = disabled[index]; });
        if (this.referenceInput) this.referenceInput.disabled = originalReferenceDisabled;
        if (this.descriptionImageInput) this.descriptionImageInput.disabled = originalDescriptionImageDisabled;
      }
      if (this.composer !== activeComposer) return;
      if (!response || !response.ok) {
        activeComposer.saving = false;
        this.saveButton.disabled = false;
        this.cancelComposerButton.disabled = false;
        this.saveButton.textContent = this.composer.mode === "edit" ? "保存修改" : "保存并继续";
        this.composerError.textContent = (response && response.error) || "保存失败，请重试。";
        return;
      }
      issue = response.issue || issue;
      if (response.session) this.session = response.session;

      const previousRecordedCount = this.recordedIssueCount();
      const existingIndex = this.issues.findIndex((item) => item.id === issue.id);
      if (existingIndex >= 0) this.issues.splice(existingIndex, 1, issue);
      else this.issues.push(issue);

      const returnView = this.composer.returnView || (this.session?.status === "paused" ? "paused" : "inspect");

      this.composer = null;
      this.captureEpoch += 1;
      this.updateCounts();
      this.persistTabContext();
      this.renderPins();
      this.showView(returnView === "composer" ? "inspect" : returnView);
      this.animateIssueCount(previousRecordedCount, this.recordedIssueCount());
      this.showToast(issue.displayId + " 已保存");
    }

    async cancelComposer() {
      if (!this.composer) {
        this.showView("inspect");
        return;
      }
      if (this.composer.saving) {
        this.showToast("正在保存问题，请稍候");
        return;
      }
      const composer = this.composer;
      const discardDraft = composer.issue?.reviewStatus === "draft" || composer.mode === "create";
      this.composer = null;
      this.captureEpoch += 1;
      this.cancelRecordTransition?.();
      this.resetInspection({ preservePreview:true });
      if (this.inspectMode === "ui") this.renderUiEditor(null);
      this.clearVisuals();
      this.showView(this.session?.status === "paused" ? "paused" : "inspect");
      this.persistTabContext();
      if (!discardDraft) {
        this.showToast("已返回走查，原记录未修改");
        return;
      }
      // Return immediately, but wait for any in-flight draft write before
      // deleting it. Late capture responses clean up their own pending assets.
      await Promise.allSettled([composer.capturePromise, composer.referencePromise]);
      let response;
      try { response = await this.sendMessage({ type:"UIDELTA_DELETE_ISSUE", issueId:composer.issue.id }); }
      catch (error) { response = { ok:false, error:error?.message }; }
      if (!response?.ok) {
        this.showToast("已返回走查，但误选草稿清理失败，请在清单中重试删除");
        return;
      }
      if (this.session?.id !== composer.issue.sessionId) return;
      this.issues = this.issues.filter((issue) => issue.id !== composer.issue.id);
      if (response.session && Number(response.session.revision) >= Number(this.session.revision || 0)) this.session = response.session;
      this.pruneDeliverySelection();
      this.updateCounts();
      this.renderPins();
      this.persistTabContext();
      this.showToast("已返回走查，误选记录已取消");
    }

    issueDeletionFor(issueId) {
      return Array.from(this.issueDeletions || []).find((job) => job.issueIds.includes(issueId));
    }

    deleteIssue(issueId) {
      const pending = this.issueDeletionFor(issueId);
      if (pending) { this.cancelIssueDeletion(pending); return; }
      this.beginIssueDeletion([issueId]);
    }

    clearIssues() {
      const pending = Array.from(this.issueDeletions || []).find((job) => job.clearAll);
      if (pending) { this.cancelIssueDeletion(pending); return; }
      // Snapshot this session, not the current filter or issues added later.
      if (this.issueDeletions?.size) return;
      this.beginIssueDeletion(this.issues.map((issue) => issue.id), true);
    }

    beginIssueDeletion(ids, clearAll = false) {
      if (!this.session || !["active", "paused"].includes(this.session.status)) return;
      if (this.composer?.saving || this.composer?.referencePromise || this.composer?.captureStatus === "capturing") {
        this.showToast("请等待当前问题保存完成"); return;
      }
      const issueIds = Array.from(new Set(ids)).filter((id) => this.issues.some((issue) => issue.id === id) && !this.issueDeletionFor(id));
      if (!issueIds.length) return;
      this.issueDeletions ||= new Set();
      const job = { issueIds, clearAll, sessionId:this.session.id, phase:"countdown", remaining:3, deadline:Date.now() + 3000 };
      this.issueDeletions.add(job);
      this.setIssueDeletionStatus(clearAll ? `将清空本次全部 ${issueIds.length} 个问题，再次点击可取消。` : "3 秒后删除，再次点击可取消。", false);
      this.renderIssueDeletionControls();
      const tick = () => {
        if (!this.issueDeletions.has(job) || job.phase !== "countdown") return;
        if (!this.enabled || this.browseMode || this.currentView !== "inbox" || document.hidden || this.session?.id !== job.sessionId) {
          this.cancelIssueDeletion(job); return;
        }
        job.remaining = Math.max(0, Math.ceil((job.deadline - Date.now()) / 1000));
        if (job.remaining === 0) { this.commitIssueDeletion(job); return; }
        this.renderIssueDeletionControls();
        job.timer = window.setTimeout(tick, Math.min(1000, job.deadline - Date.now()));
      };
      job.timer = window.setTimeout(tick, 1000);
    }

    setIssueDeletionStatus(text, error = false, transient = false) {
      if (!this.issueDeletionStatus) return;
      window.clearTimeout(this.issueDeletionStatusTimer);
      this.issueDeletionStatus.textContent = text;
      this.issueDeletionStatus.classList.toggle("is-error", error);
      if (transient) this.issueDeletionStatusTimer = window.setTimeout(() => {
        this.issueDeletionStatus.textContent = "";
        this.issueDeletionStatusTimer = null;
      }, 3200);
    }

    cancelIssueDeletion(job, quiet = false) {
      if (job.phase !== "countdown" || !this.issueDeletions?.has(job)) return;
      window.clearTimeout(job.timer);
      this.issueDeletions.delete(job);
      this.renderIssueDeletionControls();
      if (!quiet) this.setIssueDeletionStatus("已取消删除，问题和截图已保留。", false, true);
    }

    cancelPendingIssueDeletions() {
      const count = this.issueDeletions?.size || 0;
      for (const job of this.issueDeletions || []) this.cancelIssueDeletion(job, true);
      if ((this.issueDeletions?.size || 0) < count) this.setIssueDeletionStatus("已取消删除，问题和截图已保留。", false, true);
    }

    renderIssueDeletionControls() {
      for (const row of this.issueList?.querySelectorAll?.(".issue-row") || []) {
        const job = this.issueDeletionFor(row.dataset.issueId);
        row.classList.toggle("is-delete-pending", Boolean(job));
        row.setAttribute("aria-busy", String(Boolean(job && job.phase !== "countdown")));
        for (const button of row.querySelectorAll(".row-action")) {
          if (button.dataset.action !== "delete-issue") { button.disabled = Boolean(job); continue; }
          button.disabled = Boolean(job && (job.clearAll || job.phase !== "countdown"));
          button.classList.toggle("is-counting", job?.phase === "countdown");
          button.classList.toggle("is-deleting", Boolean(job && job.phase !== "countdown"));
          const text = job ? (job.phase === "countdown" ? "删除 " + job.remaining : "删除中…") : "";
          let value = button.querySelector(".delete-countdown");
          if (text && !value) { value = document.createElement("span"); value.className = "delete-countdown"; button.appendChild(value); }
          if (value) { if (text) value.textContent = text; else value.remove(); }
          const label = job ? (job.phase === "countdown" ? `删除倒计时 ${job.remaining} 秒${job.clearAll ? "" : "，点击取消"}` : "正在删除") : "删除问题";
          button.title = label; button.setAttribute("aria-label", label);
        }
      }
      if (this.clearIssuesButton) {
        const job = Array.from(this.issueDeletions || []).find((item) => item.clearAll);
        this.clearIssuesButton.textContent = job ? (job.phase === "countdown" ? "清空 " + job.remaining : "清空中…") : "清空";
        this.clearIssuesButton.disabled = job ? job.phase !== "countdown" : !this.issues.length || Boolean(this.issueDeletions?.size);
        this.clearIssuesButton.title = job ? "清空本次走查，倒计时内再次点击可取消" : "清空本次走查的全部问题与截图，不受筛选影响";
        this.clearIssuesButton.setAttribute("aria-label", job ? this.clearIssuesButton.title + "，剩余 " + job.remaining + " 秒" : this.clearIssuesButton.title);
      }
    }

    async commitIssueDeletion(job) {
      if (!this.issueDeletions?.has(job) || job.phase !== "countdown") return;
      job.phase = "committing";
      window.clearTimeout(job.timer);
      this.renderIssueDeletionControls();
      let response;
      try {
        response = await this.sendMessage(job.clearAll
          ? { type:"UIDELTA_DELETE_ISSUES", sessionId:job.sessionId, issueIds:job.issueIds, resetSequence:true }
          : { type:"UIDELTA_DELETE_ISSUE", issueId:job.issueIds[0] });
      } catch (error) { response = { ok:false, error:error?.message }; }
      if (!response?.ok) {
        this.issueDeletions.delete(job);
        this.renderIssueDeletionControls();
        this.setIssueDeletionStatus(response?.error || "删除失败，问题已保留，请重试。", true);
        return;
      }
      job.phase = "removing";
      // Serialise visual removals so overlapping deletes never fight over layout.
      const apply = async () => {
        if (this.session?.id !== job.sessionId) return;
        const ids = new Set(job.issueIds);
        this.issues = this.issues.filter((issue) => !ids.has(issue.id));
        if (response.session && Number(response.session.revision) >= Number(this.session.revision || 0)) this.session = response.session;
        if (this.composer && ids.has(this.composer.issue?.id)) { this.composer = null; this.captureEpoch += 1; }
        this.pruneDeliverySelection();
        this.updateCounts(); this.renderPins(); this.persistTabContext();
        await this.removeDeletedIssueCards(ids);
        this.updateIssueListEmpty(this.issueList.querySelectorAll(".issue-row").length);
        this.setIssueDeletionStatus(job.clearAll ? `已清空 ${job.issueIds.length} 个问题及其截图。` : "问题及其截图已删除。", false, true);
      };
      this.issueRemovalQueue = (this.issueRemovalQueue || Promise.resolve()).catch(() => {}).then(apply);
      try { await this.issueRemovalQueue; }
      catch (_) {
        if (this.session?.id === job.sessionId) {
          this.renderIssueList();
          this.setIssueDeletionStatus("问题已删除，列表已刷新。", false, true);
        }
      }
      finally { this.issueDeletions.delete(job); this.renderIssueDeletionControls(); }
    }

    async playIssueRemovalMotion(node, frames, duration) {
      if (!node?.isConnected || !node.animate) return;
      let animation, timer;
      try {
        animation = node.animate(frames, { duration, easing:"cubic-bezier(.23,1,.32,1)", fill:"both" });
        await Promise.race([animation.finished.catch(() => {}), new Promise((resolve) => { timer = window.setTimeout(resolve, duration + 100); })]);
      } catch (_) { /* Animation failure must never undo or block a confirmed deletion. */ }
      finally { window.clearTimeout(timer); animation?.cancel(); }
    }

    async removeDeletedIssueCards(ids) {
      const rows = Array.from(this.issueList.querySelectorAll(".issue-row"));
      const removed = rows.filter((row) => ids.has(row.dataset.issueId));
      const focused = removed.some((row) => row.contains(this.shadow.activeElement));
      const index = rows.findIndex((row) => removed.includes(row));
      const motion = this.enabled && !this.browseMode && this.currentView === "inbox" && !document.hidden;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (motion) await Promise.all(removed.map((row) => this.playIssueRemovalMotion(row,
        reduced ? [{opacity:1},{opacity:0}] : [{opacity:1,transform:"translateX(0)"},{opacity:0,transform:"translateX(6px)"}], reduced ? 100 : 180)));
      // Measure immediately before removal; filtering/scrolling may have changed during the fade.
      const live = Array.from(this.issueList.querySelectorAll(".issue-row"));
      const survivors = live.filter((row) => !ids.has(row.dataset.issueId));
      const before = new Map(survivors.map((row) => [row, row.getBoundingClientRect().top]));
      for (const row of live) if (ids.has(row.dataset.issueId)) row.remove();
      if (focused && this.currentView === "inbox" && !this.browseMode) {
        const next = survivors[Math.min(Math.max(0, index), survivors.length - 1)]?.querySelector(".row-action");
        (next || this.shadow.querySelector(".issue-search-input"))?.focus({preventScroll:true});
      }
      if (motion && !reduced) await Promise.all(survivors.map((row) => {
        const dy = before.get(row) - row.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        return this.playIssueRemovalMotion(row, [{transform:`translateY(${dy}px)`},{transform:"translateY(0)"}], 240);
      }));
    }

    inboxCardStyles() {
      return `
        .inbox-view .issue-list { display:flex; flex-direction:column; min-width:0; gap:8px; padding:8px 0; overflow-anchor:none; }
        .inbox-view .inbox-search { display:flex; width:100%; min-width:0; height:32px; margin-top:6px; gap:7px; padding:0 6px 0 9px; border:1px solid var(--ud-border)!important; border-radius:6px!important; background:var(--ud-inset)!important; color:var(--ud-text-muted)!important; box-shadow:none!important; }
        .inbox-view .inbox-search:focus-within { border-color:var(--ud-focus)!important; box-shadow:0 0 0 2px var(--ud-focus-soft)!important; }
        .inbox-view .search-icon { display:block; flex:none; width:14px; height:14px; }
        .inbox-view .issue-search-input { flex:1 1 0; width:0; min-width:0; height:100%; margin:0; padding:0; border:0!important; border-radius:0; outline:0!important; background:transparent!important; color:var(--ud-text); box-shadow:none!important; font:400 12px/1.4 var(--ud-font); }
        .inbox-view .issue-search-input::placeholder { color:var(--ud-text-muted); opacity:1; font-weight:400; }
        .inbox-view .issue-search-input::-webkit-search-cancel-button { -webkit-appearance:none; }
        .inbox-view .search-clear { display:grid; flex:none; width:24px; height:24px; min-height:24px; padding:4px; place-items:center; border:0; border-radius:4px; background:transparent; color:var(--ud-text-muted); cursor:pointer; }
        .inbox-view .search-clear[hidden] { display:none; }
        .inbox-view .search-clear:hover { background:var(--ud-hover); color:var(--ud-text); }
        .inbox-view .search-clear svg { display:block; width:14px; height:14px; }
        .inbox-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .inbox-heading .clear-issues { min-height:28px; height:28px; min-width:56px; padding:0 8px; color:var(--ud-danger); font-size:11px; }
        .issue-deletion-status { margin:0; color:var(--ud-text-muted); font-size:11px; line-height:1.5; }
        .issue-deletion-status:not(:empty) { padding:0 0 8px; }
        .issue-deletion-status.is-error { color:var(--ud-danger); }
        .inbox-view .issue-row { display:flex; flex-direction:column; align-items:stretch; width:100%; min-width:0; gap:6px; padding:8px; border:1px solid var(--ud-border); border-radius:9px; background:var(--ud-elevated); }
        .inbox-view .issue-row:hover { border-color:var(--ud-border-strong); background:var(--ud-elevated); }
        .inbox-view .issue-card-head { display:flex; min-width:0; align-items:center; flex-wrap:wrap; gap:6px; }
        .inbox-view .issue-select { width:16px; height:16px; margin:0; flex:none; border-radius:4px; }
        .inbox-view .issue-select:checked:after { font-size:11px; line-height:14px; }
        .inbox-view .issue-index { position:static; display:block; min-width:0; height:auto; padding:0; border:0; border-radius:0; background:transparent; color:var(--ud-text-secondary); font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
        .inbox-view .issue-card-tags { display:flex; min-width:0; align-items:center; flex-wrap:wrap; gap:4px; margin-left:auto; }
        .inbox-view .issue-card-tag { padding:2px 4px; border-radius:4px; background:var(--ud-inset); color:var(--ud-text-secondary); font-size:10px; font-weight:500; line-height:1.4; white-space:nowrap; }
        .inbox-view .issue-card-tag.is-urgent { background:rgba(237,139,155,.12); color:#f4b3bf; }
        .inbox-view .issue-copy { display:grid; min-width:0; gap:4px; }
        .inbox-view .issue-title { display:block; max-width:100%; margin:0; overflow:visible; color:var(--ud-text); font-size:13px; font-weight:600; line-height:1.4; text-overflow:clip; white-space:pre-wrap; overflow-wrap:anywhere; -webkit-line-clamp:unset; -webkit-box-orient:unset; }
        .inbox-view .issue-description { margin:0; color:var(--ud-text-secondary); font-size:12px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
        .inbox-view .issue-visual { position:relative; display:block; flex:none; width:100%; height:76px; min-width:0; padding:0; border:0; border-radius:0; background:transparent; }
        .inbox-view .issue-visual .issue-shot { position:absolute; left:0; top:0; width:84%; height:70px; min-width:0; margin:0; overflow:hidden; border:2px solid var(--ud-inset); border-radius:10px; background:var(--ud-inset); }
        .inbox-view .issue-visual .issue-shot.detail { left:auto; top:auto; right:0; bottom:0; width:54%; height:48px; box-shadow:0 0 0 2px var(--ud-elevated); }
        .inbox-view .issue-visual[data-layout='single'] { height:70px; }
        .inbox-view .issue-visual[data-layout='single'] .issue-shot { left:0; top:0; width:100%; height:70px; box-shadow:none; }
        .inbox-view .issue-shot:focus-within { z-index:3; outline:2px solid var(--ud-focus); outline-offset:1px; }
        .inbox-view .issue-shot:not(:has(img))::before { position:absolute; inset:0; display:grid; padding:16px 4px 2px; place-items:center; color:var(--ud-text-muted); content:'加载中…'; font-size:10px; }
        .inbox-view .issue-shot[data-state='error']::before { content:'加载失败'; padding-bottom:24px; }
        .inbox-view .issue-shot.detail[data-state='error']::before { content:''; }
        .inbox-view .issue-shot .thumbnail-retry { position:absolute; left:50%; bottom:2px; transform:translateX(-50%); margin:0; min-height:24px; height:24px; padding:0 4px; font-size:10px; white-space:nowrap; }
        .inbox-view .issue-thumb { display:block; width:100%; height:100%; min-width:0; border-radius:0; background:var(--ud-inset); object-fit:contain; }
        .inbox-view .issue-thumb:hover,.inbox-view .issue-thumb:focus-visible { transform:none; filter:brightness(1.04); outline:0; }
        .inbox-view .issue-shot-caption { position:absolute; left:4px; top:4px; z-index:1; padding:2px 6px; border-radius:6px; background:var(--ud-accent); color:var(--ud-on-accent); font-size:9px; font-weight:600; line-height:1.3; text-align:center; pointer-events:none; }
        .inbox-view .issue-location { display:flex; flex-wrap:nowrap; width:100%; min-width:0; align-items:center; gap:6px; padding:0; border:0; border-radius:0; background:transparent; color:var(--ud-text-muted); text-align:left; font-size:11px; line-height:1.4; white-space:nowrap; }
        .inbox-view .issue-location>span:first-child { flex:none; }
        .inbox-view .issue-location-copy { display:block; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .inbox-view .issue-location-name { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .inbox-view .issue-location-name { color:var(--ud-text-secondary); }
        .inbox-view .issue-row .row-actions { display:flex; flex:none; align-self:stretch; width:100%; justify-content:flex-end; grid-column:auto; gap:4px; margin-left:auto; padding-top:4px; border-top:1px solid var(--ud-border); }
        .inbox-view .issue-row .row-action { position:relative; display:flex; flex:none; width:32px; height:32px; min-height:32px; align-items:center; justify-content:center; gap:4px; padding:0; border-radius:5px; color:var(--ud-text-secondary); font-size:11px; line-height:1; overflow:hidden; }
        .inbox-view .row-action svg { width:16px; height:16px; flex:none; }
        .inbox-view .issue-row.is-delete-pending { border-color:var(--ud-danger); }
        .inbox-view .issue-row .row-action:is(.is-counting,.is-deleting) { width:76px; padding:0 8px; font-variant-numeric:tabular-nums; }
        .inbox-view .row-action:is(.is-counting,.is-deleting) svg { display:none; }
        .inbox-view .row-action.is-counting::after { content:''; position:absolute; left:0; right:0; bottom:0; height:2px; background:currentColor; transform-origin:left; animation:uidelta-delete-progress 3s linear forwards; }
        @keyframes uidelta-delete-progress { from { transform:scaleX(1); } to { transform:scaleX(0); } }
        @media(prefers-reduced-motion:reduce) { .inbox-view .row-action.is-counting::after { animation:none; } }
        .inbox-view .issue-row .row-action:hover { background:rgba(255,255,255,.07); color:var(--ud-text); }
        .inbox-view .issue-row .row-action:focus-visible { outline:2px solid var(--ud-accent); outline-offset:1px; }
        .inbox-view .issue-row .row-action.delete { color:#d99da8; }
        .inbox-view .issue-row .row-action.delete:hover { background:rgba(237,139,155,.12); color:#ffc0cc; }
      `;
    }

    renderIssueList() {
      this.issueList.replaceChildren();
      if (this.issueSearchClear) this.issueSearchClear.hidden = !this.issueSearch?.value;
      for (const filter of this.shadow.querySelectorAll("[data-filter]")) {
        const active = filter.dataset.filter === this.issueFilter;
        filter.classList.toggle("active", active);
        filter.setAttribute("aria-pressed", String(active));
      }
      const filtered = this.issues
        .filter((issue) => {
          if (this.issueFilter === "page") return issue.pageSnapshot?.route === this.currentRoute();
          return this.issueFilter === "all" || issue.type === this.issueFilter;
        })
        .filter((issue) => {
          if (!this.issueSearchQuery) return true;
          const searchable = [
            issue.displayId,
            issue.title,
            issue.description,
            issue.pageSnapshot?.url,
            issue.pageSnapshot?.route,
            issue.elementAnchor?.name,
            issue.elementAnchor?.accessibleName,
            issue.elementAnchor?.preferredSelector
          ].filter(Boolean).join(" ").toLowerCase();
          return searchable.includes(this.issueSearchQuery);
        })
        .sort((a, b) => Number(a.sequence) - Number(b.sequence));
      this.pruneDeliverySelection();
      this.updateIssueListEmpty(filtered.length);

      for (const issue of filtered) {
        const row = document.createElement("article");
        row.className = "issue-row";
        row.dataset.issueId = issue.id;
        const head = document.createElement("div");
        head.className = "issue-card-head";
        const select = document.createElement("input");
        select.type = "checkbox";
        select.className = "issue-select";
        select.checked = this.deliverySelection.has(issue.id);
        select.dataset.deliveryIssueId = issue.id;
        select.setAttribute("aria-label", "选择 " + issue.displayId + " 用于交付");
        const index = document.createElement("span");
        index.className = "issue-index";
        index.textContent = issue.displayId;
        const tags = document.createElement("div");
        tags.className = "issue-card-tags";
        const type = ISSUE_TYPES[issue.type] ? ISSUE_TYPES[issue.type].label : "UI";
        const severity = SEVERITIES[issue.severity] || issue.severity || "小瑕";
        const priority = PRIORITIES[issue.priority] || "排队";
        for (const [label, value, urgent] of [
          ["类型", type, false],
          ["影响", severity, issue.severity === "crash" || issue.severity === "blocked"],
          ["优先级", priority, issue.priority === "immediate"]
        ]) {
          const tag = document.createElement("span");
          tag.className = "issue-card-tag" + (urgent ? " is-urgent" : "");
          tag.textContent = value;
          tag.title = label + "：" + value;
          tag.setAttribute("aria-label", tag.title);
          tags.appendChild(tag);
        }
        head.append(select, index, tags);
        const visual = document.createElement("div");
        visual.className = "issue-visual";
        const contextAssetId = issue.attachments && issue.attachments.context;
        const detailAssetId = issue.attachments && issue.attachments.detail;
        const previewItems = [
          contextAssetId ? { assetId: contextAssetId, kind: "context", caption: "全景截图" } : null,
          detailAssetId ? { assetId: detailAssetId, kind: "detail", caption: "局部截图" } : null
        ].filter(Boolean);
        visual.dataset.layout = previewItems.length > 1 ? "stacked" : "single";
        for (const item of previewItems) {
          const shot = document.createElement("figure");
          shot.className = "issue-shot " + item.kind;
          const caption = document.createElement("figcaption");
          caption.className = "issue-shot-caption";
          caption.textContent = item.kind === "context" ? "全景" : "细节";
          shot.appendChild(caption);
          visual.appendChild(shot);
        }
        const copy = document.createElement("div");
        copy.className = "issue-copy";
        const title = document.createElement("p");
        title.className = "issue-title";
        const description = String(issue.description || "").trim();
        const issueTitle = String(issue.title || "").trim();
        const generatedTitle = description && issueTitle === this.issueTitle(description, issue.type);
        title.textContent = generatedTitle ? description : issueTitle || description || "未命名问题";
        copy.appendChild(title);
        if (description && description !== title.textContent) {
          const body = document.createElement("p");
          body.className = "issue-description";
          body.textContent = description;
          copy.appendChild(body);
        }
        const page = issue.pageSnapshot || {};
        let pagePath = String(page.route || page.url || "/");
        try {
          const pageUrl = new URL(pagePath, page.url || location.href);
          pagePath = pageUrl.hash.startsWith("#/") ? pageUrl.hash.slice(1).split(/[?#]/)[0] : pageUrl.pathname;
          try { pagePath = decodeURIComponent(pagePath); } catch (_) {}
        } catch (_) {
          pagePath = pagePath.split(/[?#]/)[0] || "/";
        }
        const pageName = String(page.title || "").trim().replace(/\s+/g, " ");
        const pageLocation = document.createElement("div");
        pageLocation.className = "issue-location";
        pageLocation.title = "页面：" + (pageName ? pageName + " · " : "") + pagePath;
        pageLocation.setAttribute("aria-label", pageLocation.title);
        const locationLabel = document.createElement("span");
        locationLabel.textContent = "页面";
        const locationCopy = document.createElement("span");
        locationCopy.className = "issue-location-copy";
        const locationName = document.createElement("span");
        locationName.className = "issue-location-name";
        locationName.textContent = pageName || (pagePath === "/" ? "首页" : pagePath);
        locationCopy.appendChild(locationName);
        pageLocation.append(locationLabel, locationCopy);
        const actions = document.createElement("div");
        actions.className = "row-actions";
        for (const [action, label, extraClass] of [
          ["edit-issue", "编辑", ""],
          ["copy-issue", "复制", ""],
          ["delete-issue", "删除", "delete"]
        ]) {
          const button = this.rowAction(action, issue.id, label + "问题", label, extraClass);
          actions.appendChild(button);
        }
        row.append(head, copy);
        if (previewItems.length) row.appendChild(visual);
        row.append(pageLocation, actions);
        this.issueList.appendChild(row);
        // Load only after attachment: disconnected guards must not skip every thumbnail.
        Array.from(visual.children).forEach((shot, index) => {
          const item = previewItems[index];
          this.loadIssueThumbnail(item.assetId, shot, shot.querySelector("figcaption"), item.kind, previewItems);
        });
      }
      this.renderIssueDeletionControls();
    }

    applyIssueSearch(clear = false) {
      if (clear) this.issueSearch.value = "";
      this.issueSearchQuery = this.issueSearch.value.trim().toLowerCase();
      if (this.issueSearchClear) this.issueSearchClear.hidden = !this.issueSearch.value;
      this.renderIssueList();
      if (clear) this.issueSearch.focus({ preventScroll:true });
    }

    updateIssueListEmpty(visibleCount) {
      this.issueEmpty.classList.toggle("visible", visibleCount === 0);
      const emptyTitle = this.issueEmpty.querySelector("strong");
      const emptyHint = this.issueEmpty.querySelector(".empty-hint");
      if (emptyTitle) emptyTitle.textContent = this.issues.length ? "没有匹配问题" : "还没有问题";
      if (emptyHint) emptyHint.textContent = this.issues.length ? "调整搜索词或切换筛选。" : "选中元素后按 R 记录。";
    }

    pruneDeliverySelection() {
      const liveIds = new Set(this.issues.map((issue) => issue.id));
      for (const id of this.deliverySelection) {
        if (!liveIds.has(id)) this.deliverySelection.delete(id);
      }
      if (!this.deliverySelectionTouched && this.issues.length) {
        this.deliverySelection = new Set(this.issues.map((issue) => issue.id));
      }
    }

    selectedDeliveryIssues() {
      this.pruneDeliverySelection();
      return this.issues.filter((issue) => this.deliverySelection.has(issue.id)).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    }

    toggleDeliveryIssue(issueId, selected) {
      if (!this.issues.some((issue) => issue.id === issueId)) return;
      this.deliverySelectionTouched = true;
      if (selected) this.deliverySelection.add(issueId);
      else this.deliverySelection.delete(issueId);
      // Preserve the checkbox node, focus and list scroll position.
      for (const checkbox of this.shadow.querySelectorAll(".issue-select")) {
        checkbox.checked = this.deliverySelection.has(checkbox.dataset.deliveryIssueId);
      }
      if (this.currentView === "deliver") this.renderDeliveryWorkspace();
    }


    renderDeliveryWorkspace() {
      const issues = this.selectedDeliveryIssues();
      if (this.deliveryCount) {
        this.deliveryCount.textContent = !this.issues.length ? "还没有可交付的问题"
          : !issues.length ? "请返回问题清单勾选要交付的问题"
          : issues.length === this.issues.length ? "导出本次全部 " + issues.length + " 个问题"
          : "导出清单中勾选的 " + issues.length + " / " + this.issues.length + " 个问题";
      }
      for (const button of this.shadow.querySelectorAll("[data-action='deliver-html'],[data-action='deliver-xlsx'],[data-action='deliver-zip'],[data-action='copy-agent']")) {
        const format = button.dataset?.action?.replace("deliver-", "");
        button.disabled = issues.length === 0 || Boolean(this.exportingFormats?.has(format));
      }
      if (this.deliveryError) this.deliveryError.textContent = "";
    }

    async loadIssueThumbnail(assetId, visual, index, kind, previewItems) {
      if (!visual.isConnected) return;
      visual.dataset.state = "loading";
      const fail = () => {
        if (!visual.isConnected) return;
        visual.dataset.state = "error";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "ghost-button thumbnail-retry";
        retry.textContent = "重新加载";
        retry.setAttribute("aria-label", "重新加载" + (kind === "context" ? "全景截图" : "局部截图"));
        retry.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          visual.replaceChildren(index);
          this.loadIssueThumbnail(assetId, visual, index, kind, previewItems);
        });
        visual.replaceChildren(retry, index);
      };
      const response = await this.sendMessage({ type: "UIDELTA_GET_ASSET", assetId, thumbnail: true });
      if (!visual.isConnected) return;
      if (!response?.ok || !response.dataUrl) { fail(); return; }
      const image = document.createElement("img");
      image.className = "issue-thumb " + (kind || "detail");
      image.alt = "";
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", (kind === "context" ? "预览全景截图" : "预览局部截图"));
      image.dataset.previewAssetId = assetId;
      image.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.previewAsset(assetId, kind === "context" ? "全景截图" : "局部截图", previewItems);
      });
      image.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.previewAsset(assetId, kind === "context" ? "全景截图" : "局部截图", previewItems);
      });
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", fail, { once:true });
      image.addEventListener("load", () => { if (visual.isConnected) visual.dataset.state = "ready"; }, { once:true });
      image.src = response.dataUrl;
      visual.insertBefore(image, index);
    }

    openImagePreview(dataUrl, caption, focusClose = true) {
      if (!this.preview || !this.previewImage) return;
      this.previewImage.src = dataUrl;
      this.previewImage.alt = caption || "截图预览";
      const total = this.previewItems.length;
      this.previewCaption.textContent = (caption || "截图预览") + (total > 1 ? " · " + String(this.previewIndex + 1) + "/" + String(total) + " · ← → 切换" : "");
      const canSwitch = total > 1;
      if (this.previewPreviousButton) this.previewPreviousButton.hidden = !canSwitch;
      if (this.previewNextButton) this.previewNextButton.hidden = !canSwitch;
      this.preview.hidden = false;
      if (focusClose) this.shadow.querySelector(".image-preview-close")?.focus();
    }

    bindDeliveryExampleEvents() {
      for (const button of this.shadow.querySelectorAll(".delivery-example")) {
        button.addEventListener("pointerenter", (event) => {
          if (event.pointerType !== "touch") this.queueDeliveryExampleHover(button, 180);
        });
        button.addEventListener("focus", () => this.queueDeliveryExampleHover(button, 0));
        for (const eventName of ["pointerleave", "blur"]) button.addEventListener(eventName, (event) => {
          if (!this.deliveryHover?.contains(event.relatedTarget)) this.queueHideDeliveryExampleHover();
        });
      }
      this.deliveryHover?.addEventListener("pointerenter", () => {
        if (this.deliveryHoverCloseTimer) window.clearTimeout(this.deliveryHoverCloseTimer);
        this.deliveryHoverCloseTimer = null;
      });
      this.deliveryHover?.addEventListener("pointerleave", () => this.queueHideDeliveryExampleHover());
      this.deliveryHoverImage?.addEventListener("load", () => this.positionDeliveryExampleHover());
      this.shadow.querySelector(".delivery-scroll")?.addEventListener("scroll", () => this.hideDeliveryExampleHover());
    }

    queueDeliveryExampleHover(trigger, delay = 180) {
      this.hideDeliveryExampleHover();
      this.deliveryHoverOpenTimer = window.setTimeout(() => {
        this.deliveryHoverOpenTimer = null;
        this.showDeliveryExampleHover(trigger);
      }, delay);
    }

    queueHideDeliveryExampleHover() {
      if (this.deliveryHoverOpenTimer) window.clearTimeout(this.deliveryHoverOpenTimer);
      this.deliveryHoverOpenTimer = null;
      if (this.deliveryHoverCloseTimer) window.clearTimeout(this.deliveryHoverCloseTimer);
      // Let the pointer cross the small gap into the image without flicker.
      this.deliveryHoverCloseTimer = window.setTimeout(() => this.hideDeliveryExampleHover(), 160);
    }

    hideDeliveryExampleHover() {
      if (this.deliveryHoverOpenTimer) window.clearTimeout(this.deliveryHoverOpenTimer);
      if (this.deliveryHoverCloseTimer) window.clearTimeout(this.deliveryHoverCloseTimer);
      this.deliveryHoverOpenTimer = this.deliveryHoverCloseTimer = null;
      this.deliveryHoverState?.trigger.removeAttribute("aria-describedby");
      this.deliveryHoverState = null;
      if (this.deliveryHover) this.deliveryHover.hidden = true;
      this.deliveryHoverImage?.removeAttribute("src");
    }

    async showDeliveryExampleHover(trigger) {
      const format = trigger?.dataset.format;
      const captions = { html:"HTML · 协作问题单示例", xlsx:"XLSX · 排期问题表示例", zip:"ZIP · 开发交付包示例" };
      if (!Object.hasOwn(captions, format) || !trigger.isConnected || !this.deliveryHover || !this.enabled
        || this.browseMode || this.currentView !== "deliver" || this.captureOverlayStyles || (this.preview && !this.preview.hidden)) return;
      this.hideDeliveryExampleHover();
      const state = { trigger, format };
      this.deliveryHoverState = state;
      trigger.setAttribute("aria-describedby", "uidelta-delivery-example");
      this.deliveryHover.hidden = false;
      this.deliveryHoverImage.hidden = true;
      this.deliveryHoverImage.alt = captions[format];
      this.deliveryHoverCaption.textContent = "正在加载示例…";
      this.positionDeliveryExampleHover();
      this.deliveryExampleCache ||= new Map();
      let dataUrl = this.deliveryExampleCache.get(format);
      if (!dataUrl) {
        try {
          const response = await this.sendMessage({ type:"UIDELTA_GET_DELIVERY_PREVIEW", format });
          if (response?.ok && response.dataUrl) {
            dataUrl = response.dataUrl;
            this.deliveryExampleCache.set(format, dataUrl);
          }
        } catch (_) { /* Keep failures local to this non-modal preview. */ }
      }
      if (this.deliveryHoverState !== state) return;
      if (!dataUrl) {
        this.deliveryHoverCaption.textContent = "示例加载失败，移开后重试";
        return;
      }
      this.deliveryHoverImage.src = dataUrl;
      this.deliveryHoverImage.hidden = false;
      this.deliveryHoverCaption.textContent = captions[format];
      this.positionDeliveryExampleHover();
    }

    positionDeliveryExampleHover() {
      const trigger = this.deliveryHoverState?.trigger;
      if (!trigger || this.deliveryHover?.hidden) return;
      if (!trigger.isConnected) { this.hideDeliveryExampleHover(); return; }
      const anchor = trigger.getBoundingClientRect();
      const box = this.deliveryHover.getBoundingClientRect();
      const left = anchor.left >= box.width + 20 ? anchor.left - box.width - 8 : anchor.right + 8;
      const top = anchor.top + anchor.height / 2 - box.height / 2;
      this.deliveryHover.style.left = Math.max(12, Math.min(left, window.innerWidth - box.width - 12)) + "px";
      this.deliveryHover.style.top = Math.max(12, Math.min(top, window.innerHeight - box.height - 12)) + "px";
    }

    async previewDeliveryExample(format, trigger) {
      this.hideDeliveryExampleHover();
      const captions = { html: "HTML · 协作问题单示例", xlsx: "XLSX · 排期问题表示例", zip: "ZIP · 开发交付包示例" };
      if (!Object.hasOwn(captions, format)) return;
      this.previewReturnFocus = trigger || this.shadow.activeElement;
      this.previewItems = Object.entries(captions).map(([exampleFormat, caption]) => ({ exampleFormat, caption }));
      this.previewIndex = this.previewItems.findIndex((item) => item.exampleFormat === format);
      await this.loadPreviewItem(this.previewIndex, true);
    }

    async previewAsset(assetId, caption, previewItems = null) {
      this.previewReturnFocus = this.shadow.activeElement;
      const items = Array.isArray(previewItems) && previewItems.length
        ? previewItems.map((item) => ({ assetId: item.assetId, kind: item.kind, caption: item.caption }))
        : [{ assetId, kind: "detail", caption: caption || "截图预览" }];
      const selectedIndex = items.findIndex((item) => item.assetId === assetId);
      this.previewItems = items;
      this.previewIndex = selectedIndex >= 0 ? selectedIndex : 0;
      await this.loadPreviewItem(this.previewIndex, true);
    }

    async loadPreviewItem(index, focusClose = false) {
      if (!this.previewItems.length) return;
      const normalizedIndex = (index + this.previewItems.length) % this.previewItems.length;
      const item = this.previewItems[normalizedIndex];
      const requestEpoch = ++this.previewRequestEpoch;
      this.previewIndex = normalizedIndex;
      this.preview.hidden = false;
      this.previewImage.removeAttribute("src");
      this.previewImage.alt = item.caption || "截图预览";
      this.previewCaption.textContent = "正在加载" + (item.caption || "截图") + "…";
      const canSwitch = this.previewItems.length > 1;
      if (this.previewPreviousButton) this.previewPreviousButton.hidden = !canSwitch;
      if (this.previewNextButton) this.previewNextButton.hidden = !canSwitch;
      if (focusClose) this.shadow.querySelector(".image-preview-close")?.focus();
      let response;
      try {
        response = await this.sendMessage(item.exampleFormat
          ? { type: "UIDELTA_GET_DELIVERY_PREVIEW", format: item.exampleFormat }
          : { type: "UIDELTA_GET_ASSET", assetId: item.assetId, thumbnail: false });
      } catch (_) { response = null; }
      if (requestEpoch !== this.previewRequestEpoch) return;
      if (!response?.ok || !response.dataUrl) {
        this.previewCaption.textContent = item.exampleFormat ? "示例加载失败，请关闭后重试" : "截图加载失败，请关闭后重试";
        return;
      }
      // Focus once when opening, not again after an asynchronous image load.
      this.openImagePreview(response.dataUrl, item.caption, false);
    }

    switchPreview(direction) {
      if (this.previewItems.length < 2) return;
      this.loadPreviewItem(this.previewIndex + direction, false);
    }

    closeImagePreview() {
      if (!this.preview) return;
      const wasOpen = !this.preview.hidden;
      this.previewRequestEpoch += 1;
      this.preview.hidden = true;
      if (this.previewImage) this.previewImage.removeAttribute("src");
      this.previewItems = [];
      this.previewIndex = -1;
      const trigger = this.previewReturnFocus;
      this.previewReturnFocus = null;
      if (wasOpen && this.enabled && !this.browseMode && trigger?.isConnected) trigger.focus({ preventScroll:true });
    }

    rowAction(action, issueId, label, text, extraClass) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "row-action" + (extraClass ? " " + extraClass : "");
      button.dataset.action = action;
      button.dataset.issueId = issueId;
      button.setAttribute("aria-label", label);
      button.title = label;
      const paths = {
        "edit-issue": "<path d='m15 5 4 4M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15v5Z'/>",
        "copy-issue": "<rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'/>",
        "delete-issue": "<path d='M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'/>"
      }[action];
      if (paths) button.innerHTML = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'>${paths}</svg>`;
      else button.textContent = text;
      return button;
    }

    recordedIssueCount() {
      // Evidence drafts remain available in the list, but only explicit saves
      // increase the toolbar's recorded-issue counter. Older issues lack status.
      return this.issues.filter((issue) => issue.reviewStatus !== "draft").length;
    }

    cancelIssueCountTransition() {
      const transition = this.issueCountTransition;
      this.issueCountTransition = null;
      if (!transition) return;
      transition.animations.forEach((animation) => animation.cancel());
      transition.nodes.forEach((node) => node.remove());
      this.modeIssueCount?.classList.remove("is-count-increasing");
    }

    animateIssueCount(previous, count) {
      if (count <= previous) return;
      this.cancelIssueCountTransition();
      const button = this.modeIssueCount;
      const value = button?.querySelector(".mode-count-value");
      if (!value?.animate || !this.enabled || this.browseMode || this.captureOverlayStyles || this.modeToolbarDrag) return;
      const status = this.shadow.querySelector(".mode-save-status");
      if (status) status.textContent = `已新增 ${count - previous} 个问题，共 ${count} 个`;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const transition = { animations:[], nodes:[] };
      this.issueCountTransition = transition;
      button.classList.add("is-count-increasing");
      const add = (className, text = "") => {
        const node = document.createElement("span");
        node.className = className;
        node.textContent = text;
        node.setAttribute("aria-hidden", "true");
        button.appendChild(node);
        transition.nodes.push(node);
        return node;
      };
      const play = (node, frames, duration) => transition.animations.push(node.animate(frames, {
        duration, easing:"cubic-bezier(0.22, 1, 0.36, 1)", fill:"both"
      }));
      if (reduced) {
        play(value, [{ opacity:.4 }, { opacity:1 }], 140);
        play(add("mode-count-increment", `+${count - previous}`), [{ opacity:1 }, { opacity:0 }], 240);
      } else {
        play(add("mode-count-previous", previous > 99 ? "99+" : String(previous)),
          [{ opacity:1, transform:"translateY(0)" }, { opacity:0, transform:"translateY(-14px)" }], 220);
        play(value, [{ opacity:0, transform:"translateY(14px) scale(.8)" }, { opacity:1, transform:"translateY(0) scale(1)" }], 280);
        play(add("mode-count-halo"), [{ opacity:.9, transform:"scale(.9)" }, { opacity:0, transform:"scale(1.35)" }], 400);
        play(add("mode-count-increment", `+${count - previous}`), [
          { opacity:0, transform:"translateY(3px)", offset:0 },
          { opacity:1, transform:"translateY(0)", offset:.2 },
          { opacity:1, transform:"translateY(-3px)", offset:.65 },
          { opacity:0, transform:"translateY(-8px)", offset:1 }
        ], 480);
      }
      Promise.all(transition.animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (this.issueCountTransition === transition) this.cancelIssueCountTransition();
      });
    }

    updateCounts() {
      const count = this.issues.length;
      this.dockCount.textContent = String(count);
      this.issueCount.textContent = String(count);
      if (this.modeIssueCount) {
        const recorded = this.recordedIssueCount();
        const label = recorded > 99 ? "99+" : String(recorded);
        let value = this.modeIssueCount.querySelector(".mode-count-value");
        if (!value || value.textContent !== label) {
          this.cancelIssueCountTransition();
          value = document.createElement("span");
          value.className = "mode-count-value";
          value.setAttribute("aria-hidden", "true");
          value.textContent = label;
          this.modeIssueCount.replaceChildren(value);
        }
        const drafts = count - recorded;
        this.modeIssueCount.setAttribute("aria-label", `打开问题列表，已记录 ${recorded} 个问题${drafts ? `，另有 ${drafts} 个草稿` : ""}`);
        this.modeIssueCount.setAttribute("data-tooltip", drafts ? `问题列表 · ${drafts} 个草稿` : "问题列表");
      }
      const inline = this.shadow.querySelector(".inline-count");
      if (inline) inline.textContent = String(count);
    }

    renderPins() {
      this.annotationTargets = new WeakMap();
      if (!this.enabled || !this.session || !this.isSessionActive()) {
        this.pinsLayer.replaceChildren();
        this.pinsLayer.style.display = "none";
        return;
      }
      this.pinsLayer.style.display = "";
      const previous = new Map(Array.from(this.pinsLayer.children).map((pin) => [pin.dataset.issueId, pin]));
      const occupied = [];
      for (const issue of this.issues) {
        if (!issue.pageSnapshot || issue.pageSnapshot.route !== this.currentRoute()) continue;
        const element = issue.region ? null : this.resolveAnchor(issue.elementAnchor);
        if (!element && !issue.region) continue;
        if (element?.checkVisibility && !element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
        if (element) this.annotationTargets.set(element, issue);
        const rect = issue.region ? {
          ...issue.region,
          left:issue.region.left + (issue.pageSnapshot.scroll?.x || 0) - window.scrollX,
          right:issue.region.right + (issue.pageSnapshot.scroll?.x || 0) - window.scrollX,
          top:issue.region.top + (issue.pageSnapshot.scroll?.y || 0) - window.scrollY,
          bottom:issue.region.bottom + (issue.pageSnapshot.scroll?.y || 0) - window.scrollY
        } : element.getBoundingClientRect();
        if (!this.isVisible(rect) || (element && !this.visibleComposerRect(element, rect))) continue;
        const pin = previous.get(issue.id) || document.createElement("button");
        previous.delete(issue.id);
        pin.type = "button";
        pin.className = "pin";
        if (["major", "crash", "blocked"].includes(issue.severity)) pin.classList.add("major");
        pin.dataset.action = "open-pin";
        pin.dataset.issueId = issue.id;
        pin.setAttribute("aria-label", issue.displayId + " " + (issue.title || ""));
        pin.removeAttribute("title");
        pin.textContent = String(issue.sequence);
        const size = Math.max(24, 12 + pin.textContent.length * 6);
        pin.style.width = pin.style.height = size + "px";
        let left = this.clamp(rect.right - size / 2, 4, window.innerWidth - size - 4);
        let top = this.clamp(rect.top - size / 2, 4, window.innerHeight - size - 4);
        const originLeft = left, originTop = top;
        for (let attempt = 1; attempt <= this.issues.length && occupied.some((box) => left < box.right + 3 && left + size + 3 > box.left && top < box.bottom + 3 && top + size + 3 > box.top); attempt++) {
          const direction = originLeft >= 4 * (size + 4) + 4 ? -1 : 1;
          left = this.clamp(originLeft + direction * (attempt % 5) * (size + 4), 4, window.innerWidth - size - 4);
          top = this.clamp(originTop + Math.floor(attempt / 5) * (size + 4), 4, window.innerHeight - size - 4);
        }
        occupied.push({left,top,right:left+size,bottom:top+size});
        pin.style.left = left + "px";
        pin.style.top = top + "px";
        // Browsing remains native: the marker must not swallow a switch/link.
        pin.style.pointerEvents = this.browseMode || this.interactionDown ? "none" : "auto";
        pin.tabIndex = this.browseMode || this.interactionDown ? -1 : 0;
        if (!pin.parentNode) this.pinsLayer.appendChild(pin);
      }
      for (const pin of previous.values()) pin.remove();
      if (this.tooltip?.dataset?.pinIssueId && !Array.from(this.pinsLayer.children).some((pin) => pin.dataset.issueId === this.tooltip.dataset.pinIssueId)) this.hidePinTooltip();
    }

    issueForHover(element, x, y) {
      if (!element || !this.isSessionActive()) return null;
      let current = element;
      for (let depth = 0; current instanceof Element && depth < 18; depth += 1) {
        const issue = this.annotationTargets.get(current);
        if (issue) return issue;
        current = current.parentElement;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return this.issues.find((issue) => {
        if (!issue.region || issue.pageSnapshot?.route !== this.currentRoute()) return false;
        const rect = issue.region;
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) || null;
    }

    async jumpToIssue(issue) {
      if (issue.pageSnapshot && issue.pageSnapshot.route !== this.currentRoute()) {
        const destination = issue.pageSnapshot.url;
        if (destination) {
          this.storePendingJump(issue);
          this.showToast("正在打开问题所在页面");
          window.location.assign(destination);
        } else {
          this.showToast("请先打开问题所在页面 " + issue.pageSnapshot.route);
        }
        return;
      }
      if (issue.region) {
        window.scrollTo({ left: Math.max(0, issue.region.left + window.scrollX - 80), top: Math.max(0, issue.region.top + window.scrollY - 80), behavior: "smooth" });
        this.showView("inspect");
        this.showToast(issue.displayId + " 已定位到框选区域");
        return;
      }
      const element = this.resolveAnchor(issue.elementAnchor);
      if (!element) {
        const scroll = issue.pageSnapshot && issue.pageSnapshot.scroll;
        if (scroll) window.scrollTo({ left: scroll.x || 0, top: scroll.y || 0, behavior: "smooth" });
        this.showToast("元素结构已变化，已回到原页面位置");
        return;
      }
      element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      window.setTimeout(() => {
        this.selected = element;
        this.hovered = element;
        this.renderSelected(element);
        this.updateInspector(element);
        this.showView("inspect");
      }, 320);
    }

    storePendingJump(issue) {
      try {
        sessionStorage.setItem(PENDING_JUMP_KEY, JSON.stringify({
          sessionId: issue.sessionId,
          issueId: issue.id,
          route: issue.pageSnapshot?.route || "",
          createdAt: Date.now()
        }));
      } catch (_) {
        // Some sandboxed pages disable sessionStorage; manual Inbox navigation remains available.
      }
    }

    async consumePendingJump() {
      if (this.pendingJumpInProgress || !this.enabled || !this.session) return;
      let pending;
      try {
        pending = JSON.parse(sessionStorage.getItem(PENDING_JUMP_KEY) || "null");
      } catch (_) {
        return;
      }
      if (!pending || pending.sessionId !== this.session.id || Date.now() - Number(pending.createdAt || 0) > 120000) {
        try { sessionStorage.removeItem(PENDING_JUMP_KEY); } catch (_) {}
        return;
      }
      const issue = this.issues.find((item) => item.id === pending.issueId);
      if (!issue || (pending.route && pending.route !== this.currentRoute())) return;
      this.pendingJumpInProgress = true;
      try {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const element = this.resolveAnchor(issue.elementAnchor);
          if (element) {
            try { sessionStorage.removeItem(PENDING_JUMP_KEY); } catch (_) {}
            element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
            await new Promise((resolve) => window.setTimeout(resolve, 320));
            this.selected = element;
            this.hovered = element;
            this.renderSelected(element);
            this.updateInspector(element);
            this.showView("inspect");
            this.showToast(issue.displayId + " 已定位");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        try { sessionStorage.removeItem(PENDING_JUMP_KEY); } catch (_) {}
        this.showToast("页面已打开，但元素结构可能已经变化");
      } finally {
        this.pendingJumpInProgress = false;
      }
    }

    startRouteWatch() {
      if (this.routeWatchTimer) return;
      this.lastRoute = this.currentRoute();
      this.routeWatchTimer = window.setInterval(() => {
        if (!this.enabled) return;
        const route = this.currentRoute();
        if (route !== this.lastRoute) {
          this.persistTabContext();
          this.lastRoute = route;
          this.resetInspection();
          this.renderPins();
          this.touchCurrentPage();
          if (!this.browseMode) this.consumePendingJump();
          this.syncModeSurfaces();
          return;
        }
        this.renderPins();
      }, 750);
    }

    stopRouteWatch() {
      if (!this.routeWatchTimer) return;
      window.clearInterval(this.routeWatchTimer);
      this.routeWatchTimer = null;
    }

    async exportSession() {
      if (!this.session) return;
      const button = this.shadow.querySelector("[data-action='export']");
      button.disabled = true;
      button.textContent = "正在生成…";
      const response = await this.sendMessage({ type: "UIDELTA_EXPORT_SESSION", sessionId: this.session.id });
      button.disabled = false;
      button.textContent = "导出证据包";
      if (response && response.ok) {
        const location = response.downloadPath || "Chrome 默认下载文件夹";
        this.showToast("证据包已下载：" + (response.filename || "UIDelta.zip") + " · " + location);
      } else {
        this.showToast((response && response.error) || "导出失败");
      }
    }

    async exportDeliverable(format, button = null) {
      if (!this.session || !["html", "xlsx", "zip"].includes(format)) return;
      this.exportingFormats ||= new Set();
      if (this.exportingFormats.has(format)) return;
      const issues = this.selectedDeliveryIssues();
      if (!issues.length) {
        this.showToast("请先选择至少一个问题");
        return;
      }
      const labels = { html: "HTML 问题单", xlsx: "XLSX 问题表", zip: "Agent 证据包" };
      const targets = Array.from(this.shadow.querySelectorAll("[data-action='deliver-" + format + "']"));
      if (button && !targets.includes(button)) targets.push(button);
      const labelsBefore = targets.map((target) => target.textContent);
      this.exportingFormats.add(format);
      if (this.deliveryError) this.deliveryError.textContent = "";
      for (const target of targets) {
        target.disabled = true;
        target.textContent = "正在生成…";
      }
      try {
        const response = await this.sendMessage({
          type: "UIDELTA_EXPORT_DELIVERABLE",
          sessionId: this.session.id,
          format,
          issueIds: issues.map((issue) => issue.id)
        });
        if (!response?.ok) {
          if (this.deliveryError) this.deliveryError.textContent = response?.error || "交付文件生成失败，请重试。";
          this.showToast(response?.error || "交付文件生成失败");
          return;
        }
        const location = response.downloadPath || "Chrome 默认下载文件夹";
        this.showToast((labels[format] || "交付文件") + "已下载：" + (response.filename || "UIDelta") + " · " + location);
      } finally {
        this.exportingFormats.delete(format);
        const empty = this.selectedDeliveryIssues().length === 0;
        targets.forEach((target, index) => {
          target.disabled = empty;
          target.textContent = labelsBefore[index] || "导出";
        });
      }
    }

    buildAgentHandoff(issues) {
      const payload = issues.map((issue) => ({
        id: issue.displayId,
        title: issue.title,
        description: issue.description,
        resultReference: issue.resultReference || "",
        type: issue.type,
        priority: issue.priority,
        severity: issue.severity,
        page: issue.pageSnapshot?.url || issue.pageSnapshot?.route || "",
        element: issue.elementAnchor?.preferredSelector || issue.elementAnchor?.accessibleName || issue.elementAnchor?.name || "",
        actual: issue.webSnapshot || null,
        expected: issue.designSnapshot || null,
        diffs: issue.diffs || [],
        measurement: issue.measurement || null,
        changeProposal: issue.changeProposal || null,
        evidence: issue.attachmentPaths || issue.attachments || null
      }));
      const intro = [
        "# UIDelta 修复交接",
        "",
        "请基于以下 Issue 修复当前页面。先查看每个问题的 context/detail 截图与元素锚点；不要臆测未提供的设计规格。完成后逐项说明修改的文件、实现方式和验证结果。",
        "",
        "可下载完整证据包以取得 PNG 截图与 issues.json。以下为便于直接粘贴的结构化摘要：",
        "```json",
        JSON.stringify({ schemaVersion: 4, source: "UIDelta", issues: payload }, null, 2),
        "```"
      ];
      return intro.join("\n");
    }

    async copyAgentHandoff() {
      const issues = this.selectedDeliveryIssues();
      if (!issues.length) {
        this.showToast("请先选择至少一个问题");
        return;
      }
      await this.copyText(this.buildAgentHandoff(issues));
      this.showToast("已复制给 Codex 的交接摘要；需要图片时同时导出 ZIP");
    }


    async prepareImport(file) {
      this.importCandidate = null;
      if (this.deliveryError) this.deliveryError.textContent = "";
      if (this.importPreview) this.importPreview.hidden = true;
      if (!file) return;
      if (file.size > 96 * 1024 * 1024) {
        if (this.deliveryError) this.deliveryError.textContent = "交付文件超过 96MB，暂不导入。";
        return;
      }
      try {
        const parsed = await this.readUideltaDeliveryFile(file);
        const candidate = this.validateImportCandidate(parsed.payload, parsed.assetData, file.name);
        this.importCandidate = candidate;
        this.renderImportPreview();
      } catch (error) {
        if (this.deliveryError) this.deliveryError.textContent = error instanceof Error ? error.message : "无法读取交付文件。";
      } finally {
        if (this.importInput) this.importInput.value = "";
      }
    }

    async readUideltaDeliveryFile(file) {
      const name = String(file.name || "").toLowerCase();
      if (name.endsWith(".json") || file.type === "application/json") {
        const payload = JSON.parse(await file.text());
        return { payload, assetData: Array.isArray(payload.assetData) ? payload.assetData : [] };
      }
      if (!name.endsWith(".zip") && file.type !== "application/zip") throw new Error("请选择 UIDelta JSON 或 ZIP 交付文件。");
      const entries = this.readStoredZipEntries(new Uint8Array(await file.arrayBuffer()));
      const issueBytes = entries.get("issues.json");
      if (!issueBytes) throw new Error("这不是 UIDelta 交付包：缺少 issues.json。");
      const payload = JSON.parse(new TextDecoder().decode(issueBytes));
      const assets = Array.isArray(payload.assets) ? payload.assets : [];
      const assetData = assets.map((asset) => {
        const bytes = entries.get(asset.exportPath);
        if (!bytes) return null;
        return { exportPath: asset.exportPath, dataUrl: this.bytesToDataUrl(bytes, asset.mimeType || "image/png") };
      }).filter(Boolean);
      return { payload, assetData };
    }

    readStoredZipEntries(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 30) throw new Error("ZIP 文件无效。");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const entries = new Map();
      let offset = 0;
      while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
        if (offset + 30 > bytes.byteLength) throw new Error("ZIP 文件不完整。");
        const method = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const size = view.getUint32(offset + 22, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        if (method !== 0 || compressedSize !== size) throw new Error("仅支持 UIDelta 导出的未压缩 ZIP 交付包。");
        const nameStart = offset + 30;
        const dataStart = nameStart + nameLength + extraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.byteLength) throw new Error("ZIP 条目不完整。");
        const path = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
        if (!path || path.includes("..") || path.startsWith("/")) throw new Error("ZIP 内含不安全路径，已拒绝导入。");
        entries.set(path, bytes.slice(dataStart, dataEnd));
        offset = dataEnd;
      }
      if (!entries.size) throw new Error("UIDelta ZIP 中没有可读取的文件。");
      return entries;
    }

    bytesToDataUrl(bytes, mimeType) {
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
      return "data:" + mimeType + ";base64," + btoa(binary);
    }

    validateImportCandidate(payload, assetData, filename) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("UIDelta JSON 根对象无效。");
      const schemaVersion = Number(payload.schemaVersion);
      if (!Number.isInteger(schemaVersion) || schemaVersion < 3 || schemaVersion > 4) throw new Error("不支持的 UIDelta 交付格式。请使用 v3 或 v4 的 JSON/ZIP。");
      const issues = Array.isArray(payload.issues) ? payload.issues.filter((issue) => issue && typeof issue === "object" && !Array.isArray(issue)) : [];
      if (!issues.length) throw new Error("交付文件中没有可导入的问题。");
      if (issues.length > 100) throw new Error("一次最多导入 100 个 Issue，请拆分交付包。");
      const existingSourceIds = new Set(this.issues.flatMap((issue) => [issue.id, issue.importedFrom?.issueId]).filter(Boolean));
      const unique = issues.filter((issue) => !existingSourceIds.has(issue.id));
      const duplicateCount = issues.length - unique.length;
      const assetPaths = new Set(assetData.map((asset) => asset.exportPath));
      const missingEvidence = unique.filter((issue) => {
        const paths = issue.attachmentPaths || {};
        return !paths.context || !paths.detail || !assetPaths.has(paths.context) || !assetPaths.has(paths.detail);
      });
      if (missingEvidence.length) throw new Error("导入必须含每条 Issue 的全景与局部证据。请使用 UIDelta 导出的完整 ZIP 包。");
      return { filename, payload: { ...payload, issues: unique }, assetData, issueCount: unique.length, duplicateCount };
    }

    renderImportPreview() {
      if (!this.importPreview) return;
      const candidate = this.importCandidate;
      this.importPreview.replaceChildren();
      this.importPreview.hidden = !candidate;
      if (!candidate) return;
      const title = document.createElement("strong");
      title.textContent = "准备导入 " + candidate.issueCount + " 个 Issue";
      const description = document.createElement("span");
      description.textContent = candidate.filename + (candidate.duplicateCount ? " · 已跳过 " + candidate.duplicateCount + " 个重复 Issue" : " · 已完成证据校验");
      const button = document.createElement("button");
      button.className = "primary-button";
      button.dataset.action = "confirm-import";
      button.textContent = "确认导入到本次走查";
      this.importPreview.append(title, description, button);
    }

    async confirmImport() {
      if (!this.session || !this.importCandidate) return;
      const response = await this.sendMessage({
        type: "UIDELTA_IMPORT_DELIVERABLE",
        sessionId: this.session.id,
        payload: this.importCandidate.payload,
        assetData: this.importCandidate.assetData
      });
      if (!response?.ok) {
        if (this.deliveryError) this.deliveryError.textContent = response?.error || "导入失败。";
        return;
      }
      this.session = response.session || this.session;
      const imported = Array.isArray(response.issues) ? response.issues : [];
      const existing = new Map(this.issues.map((issue) => [issue.id, issue]));
      for (const issue of imported) existing.set(issue.id, issue);
      this.issues = Array.from(existing.values());
      for (const issue of imported) this.deliverySelection.add(issue.id);
      this.importCandidate = null;
      this.updateCounts();
      this.renderIssueList();
      this.renderDeliveryWorkspace();
      this.renderPins();
      this.showToast("已导入 " + imported.length + " 个带证据 Issue");
    }

    async copyCurrentInfo() {
      if (!this.currentInspection) {
        this.showToast("请先选择一个元素");
        return;
      }
      await this.copyText(JSON.stringify(this.currentInspection, null, 2));
      this.showToast("元素关键信息已复制");
    }

    async copyIssue(issue) {
      await this.copyText(JSON.stringify({
        id: issue.displayId,
        title: issue.title,
        description: issue.description,
        resultReference: issue.resultReference || "",
        attachments: issue.attachments || {},
        type: issue.type,
        severity: issue.severity,
        page: issue.pageSnapshot,
        element: issue.elementAnchor,
        actual: issue.webSnapshot,
        expected: issue.designSnapshot,
        diffs: issue.diffs || [],
        measurement: issue.measurement || null
      }, null, 2));
      this.showToast(issue.displayId + " 已复制");
    }

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
    }

    onUiClick(event) {
      event.stopPropagation();
      if (event.target.closest(".mode-toolbar") && Date.now() < this.modeToolbarSuppressClickUntil) {
        event.preventDefault();
        return;
      }
      if (event.target.closest(".image-preview-backdrop")) {
        event.preventDefault();
        this.closeImagePreview();
        return;
      }
      const issueSelect = event.target.closest(".issue-select");
      if (issueSelect) {
        event.stopPropagation();
        this.toggleDeliveryIssue(issueSelect.dataset.deliveryIssueId, issueSelect.checked);
        return;
      }
      const option = event.target.closest("[data-type],[data-severity],[data-priority],[data-filter],[data-mode]");
      if (option) {
        event.preventDefault();
        event.stopPropagation();
        for (const key of ["type", "severity", "priority"]) {
          if (option.dataset[key]) this.setComposerChoice(key, option.dataset[key]);
        }
        if (option.dataset.mode) {
          this.resumeReview(option.dataset.mode);
        }
        if (option.dataset.filter) {
          this.issueFilter = option.dataset.filter;
          for (const filter of this.shadow.querySelectorAll("[data-filter]")) {
            const active = filter.dataset.filter === this.issueFilter;
            filter.classList.toggle("active", active);
            filter.setAttribute("aria-pressed", String(active));
          }
          this.renderIssueList();
        }
        return;
      }

      const button = event.target.closest("[data-action]");
      if (!button) return; // Reading/selecting card text never leaves the list.
      event.preventDefault();
      event.stopPropagation();
      const action = button.dataset.action;
      if (button.disabled) return;
      if (action === "start-session") this.startSession();
      else if (action === "pause-session") this.pauseSession();
      else if (action === "resume-session") this.resumeSession();
      else if (action === "close" || action === "browse") this.minimizePanel();
      else if (action === "close-preview") this.closeImagePreview();
      else if (action === "preview-previous") this.switchPreview(-1);
      else if (action === "preview-next") this.switchPreview(1);
      else if (action === "preview-delivery") this.previewDeliveryExample(button.dataset.format, button);
      else if (action === "minimize") this.minimizePanel();
      else if (action === "restore-panel") this.restorePanel();
      else if (action === "copy") this.copyCurrentInfo();
      else if (action === "record") this.openComposer();
      else if (action === "record-region") this.confirmRegionSelection();
      else if (action === "remove-reference") this.removeReferenceAsset(button.dataset.assetId);
      else if (action === "bind-design") this.openDesignBinding();
      else if (action === "close-design-binding") this.closeDesignBinding();
      else if (action === "clear-design") this.clearDesignSource();
      else if (action === "save-design") this.saveDesignSource();
      else if (action === "use-design-node") this.useDesignNode(button.dataset.nodeId);
      else if (action === "preview-same-type") this.showSameTypePreview();
      else if (action === "toggle-preview-properties") {
        this.uiEditorAdvanced = !this.uiEditorAdvanced;
        if (this.selected?.isConnected) this.updateInspector(this.selected, "UI 预览", { compare: false });
      }
      else if (action === "toggle-preview-target") this.togglePreviewTarget(button.dataset.previewIndex);
      else if (action === "apply-preview-batch") this.applyPreviewBatch();
      else if (action === "reset-preview") {
        const element = this.previewState?.element || this.selected;
        this.resetPreview(true);
        if (element?.isConnected) this.updateInspector(element, "已选中", { compare: false });
      }
      else if (action === "open-inbox") { this.restorePanel(); this.showView("inbox"); }
      else if (action === "open-deliver") this.showView("deliver");
      else if (action === "back-inbox") this.showView("inbox");
      else if (action === "back-inspect") this.showView(this.session?.status === "paused" ? "paused" : "inspect");
      else if (action === "cancel-composer") this.cancelComposer();
      else if (action === "retry-capture") this.retryCaptureEvidence();
      else if (action === "save-issue") this.saveComposer();
      else if (action === "export") this.exportSession();
      else if (action === "deliver-html") this.exportDeliverable("html", button);
      else if (action === "deliver-xlsx") this.exportDeliverable("xlsx", button);
      else if (action === "deliver-zip") this.exportDeliverable("zip", button);
      else if (action === "copy-agent") this.copyAgentHandoff();
      else if (action === "confirm-import") this.confirmImport();
      else if (action === "end-session") this.endSession();
      else if (action === "edit-issue") {
        const issue = this.issues.find((item) => item.id === button.dataset.issueId);
        if (issue) this.openComposer(issue);
      }
      else if (action === "copy-issue") {
        const issue = this.issues.find((item) => item.id === button.dataset.issueId);
        if (issue) this.copyIssue(issue);
      }
      else if (action === "delete-issue") this.deleteIssue(button.dataset.issueId);
      else if (action === "clear-issues") this.clearIssues();
      else if (action === "clear-issue-search") this.applyIssueSearch(true);
      else if (action === "jump-issue") {
        const issue = this.issues.find((item) => item.id === button.dataset.issueId);
        if (issue) this.jumpToIssue(issue);
      } else if (action === "open-pin") {
        const issue = this.issues.find((item) => item.id === button.dataset.issueId);
        if (issue) this.openComposer(issue);
      }
      if (button.closest(".mode-toolbar")) this.animateToolbarAction(button, event);

    }

    onShadowKeyDown(event) {
      event.stopPropagation();
      if (this.preview && !this.preview.hidden && event.key === "Tab") {
        const buttons = Array.from(this.preview.querySelectorAll("button")).filter((button) => !button.hidden && !button.disabled);
        if (buttons.length) {
          const index = buttons.indexOf(this.shadow.activeElement);
          const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
          event.preventDefault();
          buttons[next].focus();
        }
        return;
      }
      const current = event.target.closest?.(".segment");
      if (!current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(current.parentElement.querySelectorAll(".segment"));
      const currentIndex = buttons.indexOf(current);
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = buttons.length - 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      else nextIndex = (currentIndex + 1) % buttons.length;
      event.preventDefault();
      event.stopPropagation();
      const next = buttons[nextIndex];
      for (const key of ["type", "severity", "priority"]) {
        if (next.dataset[key] && this.setComposerChoice(key, next.dataset[key])) next.focus();
      }
    }

    minimizePanel() {
      this.cancelPendingIssueDeletions();
      this.hideDeliveryExampleHover();
      if (!this.enabled) return;
      this.setBrowseMode(true);
      this.shadow.activeElement?.blur?.();
    }

    restorePanel() {
      if (!this.enabled) return;
      this.setBrowseMode(false);
      this.dock.style.display = "none";
      if (this.currentView === "composer" && !this.composer) this.showView("inspect");
      if (this.currentView === "inspect" && this.inspectMode === "ui") {
        this.syncModeSurfaces();
        return;
      }
      this.panel.style.display = "block";
      window.requestAnimationFrame(() => this.clampPanelToViewport());
    }

    clampPanelToViewport() {
      if (!this.enabled) return;
      const clampSurface = (surface) => {
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const left = this.clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
        const top = this.clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));
        if (Math.abs(left - rect.left) < 0.5 && Math.abs(top - rect.top) < 0.5) return;
        surface.style.setProperty("left", left + "px", "important");
        surface.style.setProperty("top", top + "px", "important");
        surface.style.setProperty("right", "auto", "important");
        surface.style.setProperty("bottom", "auto", "important");
      };
      if (this.panel.style.display !== "none") clampSurface(this.panel);
      if (this.uiEditor?.classList.contains("visible")) clampSurface(this.uiEditor);
      if (this.modeToolbar?.dataset.position === "free") {
        const rect = this.modeToolbar.getBoundingClientRect();
        this.positionModeToolbar(rect.left, rect.top);
      }
    }

    resetInspection({ preservePreview = false } = {}) {
      if (!preservePreview) this.resetPreview(false);
      this.uiEditor?.classList.remove("visible");
      this.selected = null;
      this.hovered = null;
      this.selectionLocked = false;
      this.lastSelectionTarget = null;
      this.lastSelectionAt = 0;
      this.lastHoverTarget = null;
      this.lastHoverIssue = null;
      this.lastHoverPin = null;
      this.currentInspection = null;
      this.modifierDown = false;
      this.pierceDown = false;
      this.pendingRegionRect = null;
      this.regionSelection = null;
      this.regionEdit = null;
      this.syncCursorState();
      this.selectedBox.style.display = "none";
      this.hoverBox.style.display = "none";
      this.tooltip.style.display = "none";
      this.measurements.replaceChildren();
      this.currentMeasurement = null;
      this.measurementTarget = null;
      this.lastMeasurement = null;
      this.lastMeasurementSource = null;
      this.lastMeasurementTarget = null;
      this.identityKind.textContent = "—";
      this.identityName.textContent = "点击选择元素";
      this.identityPath.textContent = "未选择元素";
      this.identityLocation.textContent = "页面位置 —";
      for (const name of ["size", "layout", "padding", "gap", "type", "text-color", "surface", "appearance"]) this.setMetric(name, "—");
      this.renderLayerProperties?.(null);
      this.recordButton.disabled = true;
    }

    onPanelPointerDown(event) {
      if (event.button !== 0 || event.target.closest("button")) return;
      this.cancelToolbarTransition();
      const rect = this.panel.getBoundingClientRect();
      this.panelDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      this.panel.classList.add("dragging");
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.addEventListener("pointermove", this.onPanelPointerMove);
      event.currentTarget.addEventListener("pointerup", this.onPanelPointerUp);
      event.currentTarget.addEventListener("pointercancel", this.onPanelPointerUp);
    }

    onPanelPointerMove(event) {
      if (!this.panelDrag || event.pointerId !== this.panelDrag.pointerId) return;
      const width = this.panel.offsetWidth;
      const height = this.panel.offsetHeight;
      const left = this.clamp(event.clientX - this.panelDrag.offsetX, 8, Math.max(8, window.innerWidth - width - 8));
      const top = this.clamp(event.clientY - this.panelDrag.offsetY, 8, Math.max(8, window.innerHeight - height - 8));
      this.panel.style.left = left + "px";
      this.panel.style.top = top + "px";
      this.panel.style.right = "auto";
      this.panel.style.bottom = "auto";
    }

    onPanelPointerUp(event) {
      if (!this.panelDrag || event.pointerId !== this.panelDrag.pointerId) return;
      this.panelDrag = null;
      this.panel.classList.remove("dragging");
      event.currentTarget.removeEventListener("pointermove", this.onPanelPointerMove);
      event.currentTarget.removeEventListener("pointerup", this.onPanelPointerUp);
      event.currentTarget.removeEventListener("pointercancel", this.onPanelPointerUp);
    }

    onUiEditorPointerDown(event) {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea,label")) return;
      this.cancelToolbarTransition();
      const rect = this.uiEditor?.getBoundingClientRect();
      if (!rect) return;
      this.uiEditorDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      this.uiEditor.classList.add("dragging");
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.addEventListener("pointermove", this.onUiEditorPointerMove);
      event.currentTarget.addEventListener("pointerup", this.onUiEditorPointerUp);
      event.currentTarget.addEventListener("pointercancel", this.onUiEditorPointerUp);
      event.preventDefault();
    }

    onUiEditorPointerMove(event) {
      if (!this.uiEditorDrag || event.pointerId !== this.uiEditorDrag.pointerId || !this.uiEditor) return;
      const width = this.uiEditor.offsetWidth;
      const height = this.uiEditor.offsetHeight;
      const left = this.clamp(event.clientX - this.uiEditorDrag.offsetX, 8, Math.max(8, window.innerWidth - width - 8));
      const top = this.clamp(event.clientY - this.uiEditorDrag.offsetY, 8, Math.max(8, window.innerHeight - height - 8));
      this.uiEditor.style.setProperty("left", left + "px", "important");
      this.uiEditor.style.setProperty("top", top + "px", "important");
      this.uiEditor.style.setProperty("right", "auto", "important");
      this.uiEditor.style.setProperty("bottom", "auto", "important");
    }

    onUiEditorPointerUp(event) {
      if (!this.uiEditorDrag || event.pointerId !== this.uiEditorDrag.pointerId) return;
      this.uiEditorDrag = null;
      this.uiEditor?.classList.remove("dragging");
      event.currentTarget.removeEventListener("pointermove", this.onUiEditorPointerMove);
      event.currentTarget.removeEventListener("pointerup", this.onUiEditorPointerUp);
      event.currentTarget.removeEventListener("pointercancel", this.onUiEditorPointerUp);
    }

    onModeToolbarPointerDown(event) {
      if (event.button !== 0 || !this.modeToolbar) return;
      // A mode button is always a click target. Only the slim handle / empty
      // toolbar edge starts a drag so pointer capture can never swallow clicks.
      if (event.target.closest("[data-mode],[data-action]")) return;
      this.cancelIssueCountTransition();
      const rect = this.modeToolbar.getBoundingClientRect();
      this.modeToolbarDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      this.modeToolbar.setPointerCapture(event.pointerId);
    }

    onModeButtonClick(event) {
      const mode = event.currentTarget?.dataset?.mode;
      if (!mode || Date.now() < this.modeToolbarSuppressClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
      this.resumeReview(mode);
      this.animateToolbarAction(event.currentTarget, event);
    }

    onModeToolbarPointerMove(event) {
      const drag = this.modeToolbarDrag;
      if (!drag || event.pointerId !== drag.pointerId || !this.modeToolbar) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
      drag.moved = true;
      this.modeToolbar.classList.add("dragging");
      this.positionModeToolbar(drag.left + deltaX, drag.top + deltaY);
      event.preventDefault();
    }

    positionModeToolbar(left, top) {
      if (!this.modeToolbar) return;
      const rect = this.modeToolbar.getBoundingClientRect();
      left = this.clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
      top = this.clamp(top, 8, Math.max(8, window.innerHeight - rect.height - 8));
      Object.assign(this.modeToolbar.style, { left: left + "px", top: top + "px", right: "auto", bottom: "auto", transform: "none" });
      this.modeToolbar.dataset.position = "free";
      this.modeToolbar.classList.toggle("tooltips-below", top < 48);
    }

    resetModeToolbarPosition() {
      if (!this.modeToolbar) return;
      for (const property of ["left", "top", "right", "bottom", "transform"]) this.modeToolbar.style.removeProperty(property);
      delete this.modeToolbar.dataset.position;
      this.modeToolbar.classList.remove("tooltips-below");
    }

    onModeToolbarPointerUp(event) {
      const drag = this.modeToolbarDrag;
      if (!drag || event.pointerId !== drag.pointerId || !this.modeToolbar) return;
      if (drag.moved) this.modeToolbarSuppressClickUntil = Date.now() + 240;
      this.modeToolbarDrag = null;
      this.modeToolbar.classList.remove("dragging");
      try { this.modeToolbar.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    pageSnapshot() {
      const visualViewport = window.visualViewport;
      return {
        url: location.href,
        route: this.currentRoute(),
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          visualViewport: visualViewport ? {
            width: visualViewport.width,
            height: visualViewport.height,
            offsetLeft: visualViewport.offsetLeft,
            offsetTop: visualViewport.offsetTop,
            scale: visualViewport.scale
          } : null
        },
        scroll: { x: window.scrollX, y: window.scrollY },
        capturedAt: new Date().toISOString()
      };
    }

    async touchCurrentPage() {
      if (!this.session) return;
      const response = await this.sendMessage({
        type: "UIDELTA_TOUCH_PAGE",
        sessionId: this.session.id,
        pageSnapshot: this.pageSnapshot()
      });
      if (response?.session) this.session = response.session;
    }

    captureTargetState(captureToken) {
      const target = this.captureTargets.get(captureToken);
      const composer = target?.composer;
      if (composer && composer !== this.composer) return null;
      const geometry = composer ? this.composerGeometry(composer) : null;
      if (composer && (!geometry || (composer.issue.measurement && !geometry.measurement))) return null;
      const element = target?.element || target;
      const isRegion = Boolean(target?.region);
      if (!isRegion && (!element || !element.isConnected)) return null;
      const rect = geometry?.rect || (isRegion ? target.rect : element.getBoundingClientRect());
      if (!this.isVisible(rect)) return null;
      // The old target.rect is the R-key viewport snapshot. Reusing it after
      // scrolling crops unrelated pixels and masks inner-container movement
      // from the worker's before/after capture stability check.
      const captureRect = geometry?.measurement ? this.captureRectForIssue({ measurement:geometry.measurement }, rect) : rect;
      return {
        pageUrl: location.href,
        documentToken: String(performance.timeOrigin || 0),
        rect: {
          left: captureRect.left,
          top: captureRect.top,
          right: captureRect.right,
          bottom: captureRect.bottom,
          width: captureRect.width,
          height: captureRect.height
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          visualViewport: window.visualViewport ? {
            width: window.visualViewport.width,
            height: window.visualViewport.height,
            offsetLeft: window.visualViewport.offsetLeft,
            offsetTop: window.visualViewport.offsetTop,
            scale: window.visualViewport.scale
          } : undefined
        }
      };
    }

    setCaptureOverlayVisible(visible, preserveMeasurement = false) {
      this.cancelCaptureSurfaceTransition();
      // visibility:hidden and display:none blur an active editor input.
      // Opacity removes the UI from the screenshot without replacing nodes or
      // changing focus, selection, layout or the user's unfinished input.
      if (visible) {
        this.host?.removeAttribute("data-uidelta-capturing");
        for (const entry of this.captureOverlayStyles || []) {
          entry.node.style.opacity = entry.opacity;
          entry.node.style.pointerEvents = entry.pointerEvents;
        }
        this.captureOverlayStyles = null;
        if (this.browseMode) this.syncModeSurfaces?.();
        return;
      }
      this.setCaptureOverlayVisible(true);
      this.host?.setAttribute("data-uidelta-capturing", "");
      this.cancelToolbarTransition();
      this.cancelRecordTransition();
      const nodes = preserveMeasurement
        ? [this.panel, this.dock, this.uiEditor, this.modeToolbar, this.recordPrompt, this.tooltip, this.toast, this.captureFeedback]
        : [this.host];
      this.captureOverlayStyles = nodes.filter(Boolean).map((node) => ({ node, opacity:node.style.opacity, pointerEvents:node.style.pointerEvents }));
      for (const { node } of this.captureOverlayStyles) {
        node.style.opacity = "0";
        node.style.pointerEvents = "none";
      }
    }

    cancelCaptureSurfaceTransition() {
      const transition = this.captureSurfaceTransition;
      this.captureSurfaceTransition = null;
      if (!transition) return;
      for (const animation of transition.animations) animation.cancel();
      transition.resolve(false);
    }

    async transitionCaptureOverlay(visible, preserveMeasurement = false) {
      this.cancelCaptureSurfaceTransition();
      const returning = Boolean(this.captureOverlayStyles?.length);
      if (visible) this.setCaptureOverlayVisible(true);
      if (this.currentView !== "composer" || this.browseMode || (visible && !returning)) {
        if (!visible) this.setCaptureOverlayVisible(false, preserveMeasurement);
        return true;
      }
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const transition = { animations:[] };
      transition.finished = new Promise((resolve) => { transition.resolve = resolve; });
      this.captureSurfaceTransition = transition;
      for (const node of [this.panel, this.modeToolbar, this.dock].filter((node) => node?.animate)) {
        const opacity = node.style.opacity || "1";
        transition.animations.push(node.animate(visible ? [{ opacity:0 }, { opacity }] : [{ opacity }, { opacity:0 }],
          { duration:reduced ? 60 : visible ? 160 : 80, easing:"ease-out" }));
      }
      Promise.all(transition.animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (this.captureSurfaceTransition !== transition) return;
        this.captureSurfaceTransition = null;
        transition.resolve(true);
      });
      // Restoration is cosmetic and must not delay the capture-state ACK.
      if (visible) return true;
      const completed = await transition.finished;
      if (!completed) return false;
      // Only ACK after all overlay pixels are gone. Never capture a fade frame.
      this.setCaptureOverlayVisible(false, preserveMeasurement);
      return true;
    }

    elementAnchor(element) {
      const rect = element.getBoundingClientRect();
      const shadowSelectors = this.shadowSelectorPath(element);
      const preferred = shadowSelectors[shadowSelectors.length - 1] || this.preferredSelector(element);
      const fallback = this.fallbackSelector(element);
      const stableClasses = Array.from(element.classList).filter((name) => this.isStableClass(name)).slice(0, 6);
      return {
        name: this.elementName(element),
        testId: element.getAttribute("data-testid") || "",
        id: element.id || "",
        stableClasses,
        preferredSelector: preferred,
        fallbackSelector: fallback,
        selectors: Array.from(new Set([preferred, fallback].filter(Boolean))),
        shadowSelectors,
        identityKey: shadowSelectors.join(" >>> "),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || this.implicitRole(element),
        accessibleName: this.accessibleName(element),
        text: this.textContent(element).slice(0, 160),
        parentFingerprint: (() => {
          if (element.parentElement) return this.elementLabel(element.parentElement);
          const root = element.getRootNode?.();
          return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? this.elementLabel(root.host) : "";
        })(),
        rect: {
          x: this.round(rect.left + window.scrollX),
          y: this.round(rect.top + window.scrollY),
          viewportX: this.round(rect.left),
          viewportY: this.round(rect.top),
          width: this.round(rect.width),
          height: this.round(rect.height)
        }
      };
    }

    styleSnapshot(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        dimensions: { width: this.round(rect.width), height: this.round(rect.height), boxSizing: style.boxSizing },
        layout: {
          display: style.display,
          position: style.position,
          flexDirection: style.flexDirection,
          justifyContent: style.justifyContent,
          alignItems: style.alignItems,
          gridTemplateColumns: style.gridTemplateColumns
        },
        spacing: {
          margin: this.boxValues(style, "margin"),
          padding: this.boxValues(style, "padding"),
          gap: style.gap,
          rowGap: style.rowGap,
          columnGap: style.columnGap
        },
        typography: {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textAlign: style.textAlign,
          color: style.color
        },
        appearance: {
          backgroundColor: this.resolvedBackground(element),
          borderTop: style.borderTop,
          borderRight: style.borderRight,
          borderBottom: style.borderBottom,
          borderLeft: style.borderLeft,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
          overflow: style.overflow
        }
      };
    }

    preferredSelector(element, root = element.getRootNode()) {
      const escape = this.cssEscape.bind(this);
      const candidates = [];
      const testId = element.getAttribute("data-testid");
      if (testId) candidates.push("[data-testid='" + this.attributeEscape(testId) + "']");
      if (element.id) candidates.push("#" + escape(element.id));
      const aria = element.getAttribute("aria-label");
      const role = element.getAttribute("role");
      if (aria && role) candidates.push("[role='" + this.attributeEscape(role) + "'][aria-label='" + this.attributeEscape(aria) + "']");
      if (aria) candidates.push(element.tagName.toLowerCase() + "[aria-label='" + this.attributeEscape(aria) + "']");
      const name = element.getAttribute("name");
      if (name) candidates.push(element.tagName.toLowerCase() + "[name='" + this.attributeEscape(name) + "']");
      const stableClasses = Array.from(element.classList).filter((nameValue) => this.isStableClass(nameValue)).slice(0, 2);
      if (stableClasses.length) candidates.push(element.tagName.toLowerCase() + "." + stableClasses.map(escape).join("."));
      candidates.push(element.tagName.toLowerCase());
      for (const candidate of candidates) {
        if (this.isUniqueSelector(root, candidate, element)) return candidate;
      }
      return this.fallbackSelector(element, root);
    }

    fallbackSelector(element, root = element.getRootNode()) {
      const parts = [];
      let current = element;
      while (current instanceof Element && parts.length < 12) {
        let part = current.tagName.toLowerCase();
        if (current.id && this.isUniqueSelector(root, "#" + this.cssEscape(current.id), current)) {
          part += "#" + this.cssEscape(current.id);
          parts.unshift(part);
        } else {
          const parent = current.parentElement || current.parentNode;
          const siblings = parent && parent.children
            ? Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName)
            : [];
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
          parts.unshift(part);
        }
        const candidate = parts.join(" > ");
        if (this.isUniqueSelector(root, candidate, element)) return candidate;
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    resolveAnchor(anchor) {
      if (!anchor) return null;
      if (Array.isArray(anchor.shadowSelectors) && anchor.shadowSelectors.length > 1) {
        let root = document;
        let resolved = null;
        for (let index = 0; index < anchor.shadowSelectors.length; index += 1) {
          const selector = anchor.shadowSelectors[index];
          try {
            const matches = root.querySelectorAll(selector);
            if (matches.length !== 1) return null;
            resolved = matches[0];
          } catch (_) {
            return null;
          }
          if (index < anchor.shadowSelectors.length - 1) {
            if (!resolved.shadowRoot) return null;
            root = resolved.shadowRoot;
          }
        }
        const finalSelector = anchor.shadowSelectors[anchor.shadowSelectors.length - 1];
        const structural = finalSelector === anchor.fallbackSelector || /:nth-of-type\(/.test(finalSelector);
        return this.anchorMatchesElement(anchor, resolved, structural) ? resolved : null;
      }
      const selectors = anchor.selectors || [anchor.preferredSelector, anchor.fallbackSelector];
      for (const selector of selectors.filter(Boolean)) {
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1) {
            const structural = selector === anchor.fallbackSelector || /:nth-of-type\(/.test(selector);
            if (this.anchorMatchesElement(anchor, matches[0], structural)) return matches[0];
          }
        } catch (_) {
          continue;
        }
      }
      return null;
    }

    anchorMatchesElement(anchor, element, strict) {
      if (!element || (anchor.tag && element.tagName.toLowerCase() !== anchor.tag)) return false;
      const accessibleName = this.accessibleName(element);
      if (anchor.accessibleName && accessibleName !== anchor.accessibleName) return false;
      if (!strict) return true;
      if (anchor.text && this.textContent(element).slice(0, 160) !== anchor.text) return false;
      if (anchor.parentFingerprint) {
        const root = element.getRootNode?.();
        const parent = element.parentElement || (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root.host : null);
        if (!parent || this.elementLabel(parent) !== anchor.parentFingerprint) return false;
      }
      const storedRect = anchor.rect;
      if (storedRect && Number.isFinite(storedRect.width) && Number.isFinite(storedRect.height)) {
        const rect = element.getBoundingClientRect();
        const widthTolerance = Math.max(8, storedRect.width * 0.25);
        const heightTolerance = Math.max(8, storedRect.height * 0.25);
        if (Math.abs(rect.width - storedRect.width) > widthTolerance || Math.abs(rect.height - storedRect.height) > heightTolerance) return false;
      }
      return true;
    }

    shadowSelectorPath(element) {
      const selectors = [];
      let current = element;
      while (current instanceof Element) {
        const root = current.getRootNode();
        selectors.unshift(this.preferredSelector(current, root));
        if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) current = root.host;
        else break;
      }
      return selectors.filter(Boolean);
    }

    isUniqueSelector(root, selector, element) {
      if (!root || typeof root.querySelectorAll !== "function" || !selector) return false;
      try {
        const matches = root.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === element;
      } catch (_) {
        return false;
      }
    }

    elementName(element) {
      const semantic = this.accessibleName(element) || element.getAttribute("data-testid") || element.getAttribute("name");
      if (semantic) return semantic.slice(0, 80);
      const text = this.textContent(element);
      if (text) return text.slice(0, 80);
      return this.elementLabel(element);
    }

    accessibleName(element) {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel?.trim()) return ariaLabel.trim().slice(0, 160);
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const root = element.getRootNode();
        const getById = typeof root?.getElementById === "function" ? root.getElementById.bind(root) : document.getElementById.bind(document);
        const label = labelledBy.split(/\s+/).map((id) => getById(id)?.textContent || "").join(" ").replace(/\s+/g, " ").trim();
        if (label) return label.slice(0, 160);
      }
      if (element.labels?.length) {
        const label = Array.from(element.labels).map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
        if (label) return label.slice(0, 160);
      }
      for (const attribute of ["alt", "title", "placeholder"]) {
        const value = element.getAttribute(attribute);
        if (value?.trim()) return value.trim().slice(0, 160);
      }
      if (/^(button|a|summary|option)$/i.test(element.tagName)) {
        const text = this.textContent(element);
        if (text) return text.slice(0, 160);
      }
      return "";
    }

    elementLabel(element) {
      const tag = element.tagName.toLowerCase();
      if (element.id) return (tag + "#" + element.id).slice(0, 80);
      const classes = Array.from(element.classList).filter(Boolean).slice(0, 2);
      return classes.length ? (tag + "." + classes.join(".")).slice(0, 80) : tag;
    }

    implicitRole(element) {
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "input") return "textbox";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (tag === "img") return "img";
      return "";
    }

    isStableClass(name) {
      if (!name || name.length > 60) return false;
      if (/^(active|selected|open|focus|hover|disabled|show|hide|visible)$/i.test(name)) return false;
      if (/[a-f0-9]{7,}/i.test(name) || /(^|[-_])[a-z0-9]{8,}$/i.test(name)) return false;
      return true;
    }

    compactBox(style, property) {
      const values = ["Top", "Right", "Bottom", "Left"].map((side) => style[property + side]);
      if (values.every((value) => value === values[0])) return values[0];
      if (values[0] === values[2] && values[1] === values[3]) return values[0] + " " + values[1];
      return values.join(" ");
    }

    boxValues(style, property) {
      return {
        top: style[property + "Top"],
        right: style[property + "Right"],
        bottom: style[property + "Bottom"],
        left: style[property + "Left"]
      };
    }

    resolvedBackground(element) {
      let current = element;
      while (current && current !== document.documentElement) {
        const color = window.getComputedStyle(current).backgroundColor;
        const parsed = this.parseColor(color);
        if (parsed && parsed.alpha > 0.02) return color;
        current = current.parentElement;
      }
      return window.getComputedStyle(document.documentElement).backgroundColor || "rgb(255, 255, 255)";
    }

    parseColor(value) {
      const match = String(value).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/i);
      if (!match) return null;
      return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: match[4] === undefined ? 1 : Number(match[4]) };
    }

    toHex(value) {
      const color = this.parseColor(value);
      if (!color) return value === "transparent" ? "透明" : value;
      const hex = (number) => Math.max(0, Math.min(255, number)).toString(16).padStart(2, "0");
      return "#" + hex(color.red) + hex(color.green) + hex(color.blue);
    }

    issueTitle(description, type) {
      const clean = description.replace(/\s+/g, " ").replace(/[。！？!?]+$/g, "");
      const prefix = type === "functional" ? "功能" : type === "content" ? "文案" : "UI";
      return "【" + prefix + "】" + (clean.length > 40 ? clean.slice(0, 40) + "…" : clean || "图片问题");
    }

    nextSequence() {
      return this.issues.reduce((max, issue) => Math.max(max, Number(issue.sequence) || 0), 0) + 1;
    }

    currentRoute() {
      return location.pathname + location.search + location.hash;
    }

    isSessionActive() {
      return Boolean(this.session && this.session.status === "active");
    }

    pageKey() {
      return location.origin + this.currentRoute();
    }

    shortRoute(route) {
      if (!route) return "/";
      return route.length > 32 ? "…" + route.slice(-31) : route;
    }

    createId(prefix) {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return prefix + "-" + globalThis.crypto.randomUUID();
      return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    cssEscape(value) {
      if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => "\\" + character);
    }

    attributeEscape(value) {
      return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    }

    textContent(element) {
      return String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    }

    showToast(message) {
      window.clearTimeout(this.toastTimer);
      this.toast.textContent = message;
      this.toast.classList.add("visible");
      this.toastTimer = window.setTimeout(() => this.toast.classList.remove("visible"), 2200);
    }

    clearVisuals() {
      this.selectedBox.style.display = "none";
      this.hoverBox.style.display = "none";
      this.tooltip.style.display = "none";
      this.measurements.replaceChildren();
      this.currentMeasurement = null;
      this.measurementTarget = null;
      this.lastMeasurement = null;
      this.lastMeasurementSource = null;
      this.lastMeasurementTarget = null;
      if (!this.enabled) this.pinsLayer.replaceChildren();
      this.recordPrompt?.classList.remove("visible");
      this.regionBox.style.display = "none";
      this.regionBox.classList.remove("editable");
      this.captureFeedback?.classList.remove("visible");
    }

    isVisible(rect) {
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    }

    round(value) {
      return Math.round(value * 10) / 10;
    }

    clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    nextPaint() {
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  const review = new UIDeltaReview();
  globalThis.__uideltaReview = review;
  globalThis.__uiLensInspector = review;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "UIDELTA_CAPTURE_OVERLAY") {
      window.clearTimeout(review.captureOverlayRestoreTimer);
      const preserveMeasurement = Boolean(message.preserveMeasurement);
      if (!message.visible) review.closeImagePreview();
      const visibilityReady = review.transitionCaptureOverlay(Boolean(message.visible), preserveMeasurement);
      if (!message.visible) {
        review.captureOverlayRestoreTimer = window.setTimeout(() => {
          review.setCaptureOverlayVisible(true);
        }, 8000);
      }
      let responded = false;
      let fallbackTimer;
      const respondOnce = (response, restoreOverlay = false) => {
        if (responded) return;
        responded = true;
        window.clearTimeout(fallbackTimer);
        if (restoreOverlay) {
          review.setCaptureOverlayVisible(true);
          window.clearTimeout(review.captureOverlayRestoreTimer);
        }
        sendResponse(response);
      };
      fallbackTimer = window.setTimeout(() => {
        respondOnce({ ok: false, error: "页面未完成重绘，请保持窗口可见后重试。" }, true);
      }, 1200);
      visibilityReady.catch(() => false).then((ready) => {
        if (responded) return;
        if (!ready) {
          respondOnce({ ok: false, error: "取证已中断，请重新截图。" }, true);
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (responded) return;
          const state = review.captureTargetState(message.captureToken);
          if (!state) {
            respondOnce({ ok: false, error: "目标元素已离开页面或不可见，请重新选择。" }, true);
            return;
          }
          respondOnce({ ok: true, ...state });
        }));
      });
      return true;
    }
    if (message.type === "UI_LENS_SET_ENABLED") {
      review.setEnabled(Boolean(message.enabled), message.context || {}).then(() => {
        sendResponse({ ok: true, enabled: review.enabled });
      });
      return true;
    }
    return undefined;
  });
})();
