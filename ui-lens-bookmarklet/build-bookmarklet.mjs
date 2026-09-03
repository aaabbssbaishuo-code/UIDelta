import { readFile, writeFile } from "node:fs/promises";

const source = (await readFile(new URL("./bookmarklet.js", import.meta.url), "utf8"))
  .trim()
  .replace(/\s*\n\s*/g, " ");

const installPage = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UIDelta 书签安装</title>
    <style>
      :root { color-scheme:dark; --canvas:#18191d; --surface:#202126; --elevated:#292b31; --border:#3b3d45; --border-strong:#52555e; --text:#f4f5f7; --text-secondary:#b5b8c1; --text-muted:#898d98; --accent:#7187f5; --accent-hover:#8094ff; --accent-soft:rgba(113,135,245,.16); }
      * { box-sizing:border-box; }
      body { margin:0; min-width:0; background:var(--canvas); color:var(--text); font:400 14px/1.55 Inter,"PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      main { width:min(760px,calc(100% - 32px)); margin:clamp(24px,8vh,80px) auto; padding:clamp(20px,5vw,40px); border:1px solid var(--border); border-radius:16px; background:var(--surface); box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 20px 48px rgba(0,0,0,.28); }
      .eyebrow { margin:0 0 8px; color:#b9c3ff; font-size:11px; font-weight:700; letter-spacing:.08em; }
      h1 { margin:0; max-width:620px; font-size:clamp(24px,4vw,30px); line-height:1.2; letter-spacing:-.03em; }
      .lead { max-width:52ch; margin:12px 0 28px; color:var(--text-secondary); font-size:14px; line-height:1.6; }
      .setup { margin-bottom:14px; padding:16px; border:1px solid var(--border); border-radius:12px; background:var(--elevated); }
      .setup h2 { margin:0 0 10px; font-size:14px; }
      .setup ol { display:grid; gap:8px; margin:0; padding-left:20px; color:var(--text-secondary); font-size:13px; line-height:1.55; }
      code { padding:2px 5px; border:1px solid var(--border); border-radius:5px; background:var(--canvas); color:#dfe4ff; font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; }
      .install { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px; border:1px solid rgba(151,165,255,.42); border-radius:12px; background:var(--accent-soft); }
      .install p { margin:0; color:var(--text-secondary); font-size:13px; line-height:1.55; }
      .install strong { display:block; color:var(--text); font-size:14px; }
      #bookmarklet { display:inline-flex; align-items:center; gap:8px; flex:none; min-height:36px; padding:0 14px; border:1px solid rgba(151,165,255,.64); border-radius:8px; background:var(--accent); box-shadow:0 5px 14px rgba(64,81,181,.28); color:#fff; font-size:13px; font-weight:650; text-decoration:none; cursor:grab; }
      #bookmarklet:hover { background:var(--accent-hover); }
      #bookmarklet:active { cursor:grabbing; transform:translateY(1px); }
      .steps { display:grid; gap:12px; margin:24px 0 0; padding:0; list-style:none; counter-reset:step; }
      .steps li { display:flex; gap:10px; align-items:flex-start; color:var(--text-secondary); font-size:13px; line-height:1.55; }
      .steps li > span { min-width:0; overflow-wrap:anywhere; }
      .steps li:before { display:grid; width:22px; height:22px; flex:none; place-items:center; border:1px solid var(--border); border-radius:7px; background:var(--elevated); color:#c5ceff; content:counter(step); counter-increment:step; font-size:11px; font-weight:700; }
      kbd { padding:2px 5px; border:1px solid var(--border); border-radius:4px; background:var(--elevated); color:var(--text-secondary); font:650 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .note { margin:24px 0 0; padding-top:16px; border-top:1px solid var(--border); color:var(--text-muted); font-size:12px; line-height:1.6; }
      #copy { min-height:32px; margin:12px 0 0; padding:0; border:0; background:transparent; color:#c5ceff; font:650 12px Inter,"PingFang SC","Microsoft YaHei",sans-serif; cursor:pointer; }
      #copy:hover,#copy:focus-visible { color:#fff; text-decoration:underline; outline:none; }
      @media (max-width:520px) { main { width:min(100% - 20px,760px); margin:12px auto; padding:20px; border-radius:12px; } .install { align-items:flex-start; flex-direction:column; } #bookmarklet { width:100%; justify-content:center; } }
      @media (prefers-reduced-motion:reduce) { *,*::before,*::after { transition:none!important; } }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">UIDELTA · 页面走查</p>
      <h1>安装 UIDelta 快捷入口</h1>
      <p class="lead">先在 Chrome 中加载扩展。日常走查可从工具栏启用；需要快捷入口时，再将下面的按钮拖到书签栏。</p>

      <section class="setup" aria-labelledby="setup-title">
        <h2 id="setup-title">一、加载未打包扩展</h2>
        <ol>
          <li>先解压 UIDelta 文件夹；不要把 ZIP 文件直接拖进扩展页。</li>
          <li>在 Chrome 地址栏输入 <code>chrome://extensions</code>，开启右上角的「开发者模式」，点击「加载已解压的扩展程序」。</li>
          <li>选择已加载的 UIDelta 文件夹（其中应直接看到 <code>manifest.json</code>），确认扩展已启用；修改代码后只需在扩展页点击刷新，再刷新目标网页。</li>
        </ol>
      </section>

      <section class="install">
        <p><strong>二、拖到浏览器书签栏</strong>这是工具栏之外的快捷入口。</p>
        <a id="bookmarklet" draggable="true">◌&nbsp; UIDelta</a>
      </section>

      <ol class="steps">
        <li><span>打开网页，点击 Chrome 工具栏中的 UIDelta，启用“当前页面”。</span></li>
        <li><span>扩展安装或刷新后，先刷新网页，再点击书签栏中的 <strong>UIDelta</strong>。</span></li>
        <li><span>在底部切换模式；点击固定元素，悬停测距，按 <kbd>R</kbd> 记录问题。</span></li>
        <li><span>若扩展未响应，请在 <code>chrome://extensions</code> 确认已启用，再刷新网页。</span></li>
      </ol>

      <button id="copy" type="button">复制快捷入口代码（无法拖拽时使用）</button>
      <p class="note">Chrome 内置页面、Chrome 网上应用店等受保护页面不支持扩展或书签脚本。快捷入口只发送本地唤醒消息，不读取或上传页面内容。</p>
    </main>
    <script>
      const code = ${JSON.stringify(`javascript:${source}`)};
      const link = document.getElementById("bookmarklet");
      link.href = code;
      document.getElementById("copy").addEventListener("click", async () => {
        await navigator.clipboard.writeText(code);
        document.getElementById("copy").textContent = "已复制：新建书签后，将地址粘贴进去";
      });
    </script>
  </body>
</html>`;

await writeFile(new URL("./install.html", import.meta.url), installPage + "\n");
console.log(`Generated install.html (${source.length} characters of UIDelta trigger code).`);
