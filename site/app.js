(() => {
  const $ = (selector) => document.querySelector(selector);
  let toastTimer;
  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
  function setMode(mode) {
    if (!['inspect', 'record', 'deliver'].includes(mode)) return;
    document.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      if (button.closest('.panel-tabs, .demo-stepbar')) {
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    });
    for (const name of ['inspect', 'record', 'deliver']) $(`#panel-${name}`).hidden = name !== mode;
    $('#saved-description').textContent = $('#issue-description').value.trim() || '卡片间距需要调整。';
    $('#demo-helper').textContent = {
      inspect: '↖ 点击卡片查看尺寸，切换下方步骤体验完整流程。',
      record: '＋ 描述问题，截图和定位随记录一起保留。',
      deliver: '✓ HTML 跟进、XLSX 排期，ZIP 交给前端与 Agent。'
    }[mode];
  }
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#sample-card').addEventListener('click', () => {
    setMode('inspect');
    const rect = $('#sample-card').getBoundingClientRect();
    const width = Math.round(rect.width), height = Math.round(rect.height);
    $('#dimension-label').textContent = `${width} × ${height}`;
    $('#prop-width').textContent = width;
    $('#prop-height').textContent = height;
    notify('已测量演示卡片的实际尺寸');
  });
  $('#save-issue').addEventListener('click', () => {
    if (!$('#issue-description').value.trim()) {
      $('#issue-description').focus();
      notify('先写一句问题描述');
      return;
    }
    setMode('deliver');
    notify('示例记录已保存，可下载体验');
  });
  $('#download-demo').addEventListener('click', () => {
    const description = $('#issue-description').value.trim() || '卡片间距需要调整。';
    const content = `# UIDelta 示例走查记录\n\n> 这是宣传页生成的虚构演示数据，不是真实网页走查。\n\n## UI-001 · 卡片间距\n\n- 页面：https://orbit.example/workspace\n- 元素：.project-card\n- 类型：UI\n- 程度：重要\n\n### 问题描述\n\n${description}\n\n### 对比示例\n\n| 属性 | 设计值 | 实际值 | 差值 |\n| --- | --- | --- | --- |\n| 间距 | 16px | 24px | +8px |\n\n真实插件可导出截图、定位信息及结构化数据。本示例文件不包含真实截图。\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'UIDelta-example-review.md';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已下载示例记录');
  });
  $('#copy-address').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions');
      notify('已复制，在 Chrome 地址栏粘贴后打开');
    } catch {
      $('#copy-address span').textContent = '请选中左侧地址复制';
      notify('请手动复制：chrome://extensions');
    }
  });
  $('#copy-agent-prompt').addEventListener('click', async () => {
    const prompt = $('#agent-prompt-text');
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      notify('提示词已复制，请将走查 ZIP 一起交给 Agent');
    } catch {
      $('#agent-prompt-details').open = true;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(prompt);
      selection.removeAllRanges();
      selection.addRange(range);
      prompt.scrollIntoView({ block: 'center' });
      notify('请复制已选中的提示词，并附上走查 ZIP');
    }
  });
})();
