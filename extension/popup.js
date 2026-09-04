const toggle = document.getElementById("enabledToggle");
const statusDot = document.getElementById("statusDot");
const description = document.getElementById("modeDescription");
const message = document.getElementById("message");
const retry = document.getElementById("retryStatus");

let activeTabId = null;
let confirmedEnabled = false;
let updating = false;

bootstrap();

async function bootstrap() {
  toggle.disabled = true;
  retry.hidden = true;
  message.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") throw new Error("没有找到当前标签页。");
    activeTabId = tab.id;
    const response = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: activeTabId });
    if (!response?.ok) throw new Error(response?.error || "无法读取走查状态。");
    render(Boolean(response.enabled));
    toggle.disabled = false;
  } catch (error) {
    showError(error?.message || "无法读取走查状态，请重试。");
    retry.hidden = false;
  }
}

retry.addEventListener("click", bootstrap);
toggle.addEventListener("change", async () => {
  if (activeTabId === null || updating) return;
  updating = true;
  toggle.disabled = true;
  message.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({ type: "SET_TAB_INSPECTOR", tabId: activeTabId, enabled: toggle.checked });
    if (!response?.ok) throw new Error(response?.error || "无法切换走查模式。");
    render(Boolean(response.enabled));
  } catch (error) {
    render(confirmedEnabled);
    showError(error?.message || "无法切换走查模式，请重试。");
  } finally {
    toggle.disabled = false;
    updating = false;
  }
});

function render(enabled) {
  confirmedEnabled = Boolean(enabled);
  toggle.checked = enabled;
  statusDot.classList.toggle("is-on", enabled);
  statusDot.setAttribute("aria-label", enabled ? "已启用" : "未启用");
  description.textContent = enabled ? "走查已启用。点击元素即可固定。" : "启用后即可在当前页面进行走查。";
}

function showError(text) {
  message.textContent = text;
}
