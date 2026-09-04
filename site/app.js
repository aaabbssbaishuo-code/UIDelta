(() => {
  const $ = selector => document.querySelector(selector);
  let toastTimer;
  function notify(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
  const screens = {
    inspect: {alt:'新版 UIDelta 测量面板：在网页上查看尺寸、布局、间距和外观属性',description:'差多少，直接量。选中元素查看尺寸与样式，在页面上试改，确认修改方向。'},
    record: {alt:'新版 UIDelta 记录面板：页面全景、元素细节、问题描述与展开的分类选项',description:'问题在哪，证据就在哪。写下修改要求，截图与元素位置跟着记录一起保存。'},
    delivery: {alt:'新版 UIDelta 交付面板：HTML、XLSX、ZIP 和悬浮示例入口',description:'记录一次，接着改。HTML 用来查看，XLSX 用来排期，ZIP 交给前端或 Agent。'}
  };
  function setScreen(name,focus=false) {
    if(!screens[name])return;
    document.querySelectorAll('[data-screen]').forEach(button=>{
      const active=button.dataset.screen===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();
    });
    $('#product-screen').setAttribute('aria-labelledby',`screen-${name}-tab`);
    $('#product-mobile-source').srcset=`brand/screenshots/panel-${name}.png`;
    $('#product-screen-image').src=`brand/screenshots/workspace-${name}.png`;
    $('#product-screen-image').alt=screens[name].alt;
    $('#product-screen-original').href=`brand/screenshots/workspace-${name}.png`;
    $('#product-screen-description').textContent=screens[name].description;
  }
  document.querySelectorAll('[data-screen]').forEach(button=>{
    button.addEventListener('click',()=>setScreen(button.dataset.screen));
    button.addEventListener('keydown',event=>{
      const keys=Object.keys(screens);let index=keys.indexOf(button.dataset.screen);
      if(event.key==='ArrowRight')index=(index+1)%keys.length;
      else if(event.key==='ArrowLeft')index=(index+keys.length-1)%keys.length;
      else if(event.key==='Home')index=0;
      else if(event.key==='End')index=keys.length-1;
      else return;
      event.preventDefault();setScreen(keys[index],true);
    });
  });
  document.addEventListener('keydown', event => { if(event.key==='Escape') document.querySelectorAll('.preview-trigger:hover, .preview-trigger:focus').forEach(el => el.classList.add('dismissed')); });
  document.querySelectorAll('.preview-trigger').forEach(el => { for(const event of ['pointerleave','blur']) el.addEventListener(event, () => el.classList.remove('dismissed')); });
  $('#download-demo').addEventListener('click',()=>{
    const content='# UIDelta 示例走查记录\n\n> 虚构页面与示例数据，用于说明交付内容。\n\n## UI-001 · 卡片间距\n\n- 页面：https://orbit.example/workspace\n- 元素：.project-card\n- 类型：UI\n- 优先级：尽快\n- 影响程度：视觉瑕疵\n\n卡片间距为 24px，请调整为设计稿中的 16px。\n\n真实插件可以导出 HTML、XLSX 和 ZIP，包含截图与定位。本 Markdown 示例不附截图，也不会修改项目源码。\n';
    const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='UIDelta-example-review.md';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已下载示例走查记录');
  });
  $('#copy-address').addEventListener('click',async()=>{try{await navigator.clipboard.writeText('chrome://extensions');notify('已复制，在 Chrome 地址栏粘贴后打开');}catch{$('#copy-address span').textContent='请选中左侧地址复制';notify('请手动复制：chrome://extensions');}});
  $('#copy-agent-prompt').addEventListener('click',async()=>{
    const prompt=$('#agent-prompt-text');
    try{await navigator.clipboard.writeText(prompt.textContent.trim());notify('提示词已复制，请将走查 ZIP 一起交给 Agent');}
    catch{$('#agent-prompt-details').open=true;const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(prompt);selection.removeAllRanges();selection.addRange(range);prompt.scrollIntoView({block:'center'});notify('请复制已选中的提示词，并附上走查 ZIP');}
  });
})();
