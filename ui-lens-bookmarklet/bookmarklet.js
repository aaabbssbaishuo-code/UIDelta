(() => {
  const MESSAGE_SOURCE = "uidelta-bookmark";
  const ACK_SOURCE = "uidelta-extension";
  const TOGGLE_MESSAGE = "UIDELTA_TOGGLE";
  const ACK_MESSAGE = "UIDELTA_TOGGLE_ACK";
  const STATE_KEY = "__uideltaBookmarkTrigger";
  const STATUS_ATTRIBUTE = "data-uidelta-bookmark-status";
  const ACK_TIMEOUT_MS = 1800;

  const previousTrigger = window[STATE_KEY];
  if (previousTrigger && typeof previousTrigger.cancel === "function") {
    previousTrigger.cancel();
  }

  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `uidelta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let ackTimer;
  let finished = false;

  const removeStatus = () => {
    document.querySelector(`[${STATUS_ATTRIBUTE}]`)?.remove();
  };

  const cleanup = () => {
    window.clearTimeout(ackTimer);
    window.removeEventListener("message", onMessage);
    if (window[STATE_KEY]?.requestId === requestId) {
      delete window[STATE_KEY];
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };

  const showExtensionHint = () => {
    removeStatus();

    const host = document.createElement("uidelta-bookmark-status");
    host.setAttribute(STATUS_ATTRIBUTE, "true");
    host.style.cssText =
      "all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647;width:min(300px,calc(100vw - 24px));pointer-events:none";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .notice {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          padding: 12px;
          border: 1px solid #3b3d45;
          border-radius: 10px;
          background: #202126;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 12px 28px rgba(0,0,0,.28);
          color: #f4f5f7;
          font: 500 12px/1.55 Inter,"PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          animation: enter .18s ease-out both;
        }
        .mark {
          display: grid;
          width: 20px;
          height: 20px;
          flex: none;
          place-items: center;
          border: 1px solid rgba(151,165,255,.42);
          border-radius: 6px;
          background: rgba(113,135,245,.16);
          color: #dbe1ff;
          font-size: 12px;
          font-weight: 800;
        }
        strong { display:block; margin-bottom:1px; font-size:12px; font-weight:650; }
        span { color:#b5b8c1; }
        @keyframes enter { from { opacity:0; transform:translateY(6px); } }
        @media (prefers-reduced-motion: reduce) { .notice { animation:none; } }
      </style>
      <div class="notice" role="status" aria-live="polite">
        <div class="mark" aria-hidden="true">U</div>
        <div><strong>UIDelta 未在此页面启用</strong><span>请确认扩展已启用，然后刷新当前网页后重试。</span></div>
      </div>`;

    (document.documentElement || document.body).appendChild(host);
    window.setTimeout(() => host.remove(), 6000);
  };

  function onMessage(event) {
    if (event.source !== window) return;
    const message = event.data;
    if (
      !message ||
      message.source !== ACK_SOURCE ||
      message.type !== ACK_MESSAGE ||
      message.ok === false ||
      message.requestId !== requestId
    ) {
      return;
    }

    removeStatus();
    finish();
  }

  window[STATE_KEY] = {
    requestId,
    cancel: finish,
  };
  window.addEventListener("message", onMessage);
  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: TOGGLE_MESSAGE,
      requestId,
      version: 1,
    },
    "*",
  );

  ackTimer = window.setTimeout(() => {
    showExtensionHint();
    finish();
  }, ACK_TIMEOUT_MS);
})();
