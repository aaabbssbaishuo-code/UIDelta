const toggle = document.getElementById("enabledToggle");
const statusDot = document.getElementById("statusDot");
const description = document.getElementById("modeDescription");
const message = document.getElementById("message");

let activeTabId = null;

bootstrap();

async function bootstrap() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== "number") {
    showError("没有找到当前标签页。");
    toggle.disabled = true;
    return;
  }

  activeTabId = tab.id;
  const response = await chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: activeTabId });
  if (response?.ok) render(Boolean(response.enabled));
  else showError(response?.error || "无法读取走查状态。");
}

toggle.addEventListener("change", async () => {
  if (activeTabId === null) return;
  toggle.disabled = true;
  message.textContent = "";

  const response = await chrome.runtime.sendMessage({
    type: "SET_TAB_INSPECTOR",
    tabId: activeTabId,
    enabled: toggle.checked
  });

  toggle.disabled = false;
  if (response?.ok) render(response.enabled);
  else {
    toggle.checked = !toggle.checked;
    showError(response?.error || "无法切换走查模式。");
  }
});

function render(enabled) {
  toggle.checked = enabled;
  statusDot.classList.toggle("is-on", enabled);
  statusDot.setAttribute("aria-label", enabled ? "已启用" : "未启用");
  description.textContent = enabled ? "走查已启用。点击元素即可固定。" : "启用后即可在当前页面进行走查。";
}

function showError(text) {
  message.textContent = text;
}
