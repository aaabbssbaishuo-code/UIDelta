# UIDelta Phase 1 验收清单

## 当前状态

- 静态语法、Manifest、消息契约、ZIP 结构、书签 ACK、截图状态漂移保护已自动校验。
- 自动契约测试：`node phase1-contract.test.mjs`。
- 真实 Chrome 的扩展加载、20 条连续 Issue、截图像素与最终下载仍需在安装开发版扩展后执行。本文件不把未执行的项目标记为通过。

## A. 安装与唤醒

- [ ] 在 `chrome://extensions` 通过“加载已解压的扩展程序”选择 `ui-inspection-lens`。
- [ ] 扩展卡片显示版本 `0.3.0`，Service Worker 无错误。
- [ ] 从 `ui-lens-bookmarklet/install.html` 把 UIDelta 拖入书签栏。
- [ ] 书签、扩展按钮、`Option + Shift + I` 均能唤醒/关闭。
- [ ] 进入走查后全页鼠标变为十字准星，按住 Option 变为测量准星，按住 Command 变为穿透准星。

## B. Inspector

- [ ] Hover 显示元素实际宽高；Click 锁定元素。
- [ ] 选中文字、按钮、容器、图片时，关键字段准确：尺寸、布局、padding、gap、字体、字号、字重、行高、字距、颜色、背景、边框、圆角、阴影。
- [ ] 按住 Option 可查看父子元素四边内距与兄弟元素水平/垂直间距；按住 Command 可穿透当前层选择元素。
- [ ] 按住 Space 时隐藏选框与 Pin，可临时点击和操作原网页；松开后恢复 Inspector 与 Pin。
- [ ] UIDelta 浮窗或 Dock 内的按钮获得焦点后，按 Space 激活按钮，不会进入临时网页交互。
- [ ] 普通 DOM、开放 Shadow DOM、滚动容器、sticky/fixed 元素均不会选中 UIDelta 自身。
- [ ] 浮窗可拖动、可收起，缩放窗口后仍留在可视区域。

## C. Session 与连续记录

- [ ] 开始 Session 后记录初始 URL、route、viewport、scroll、DPR、visualViewport scale 与时间。
- [ ] 暂停后页面恢复正常交互；继续后恢复 Inspector。
- [ ] 刷新、SPA 路由切换、同源页面跳转、关闭再打开 UIDelta 后，未完成 Session 与 Issue 均恢复。
- [ ] 连续创建 20 条混合类型 Issue（UI / 功能 / 文案），编号唯一且不重号。
- [ ] 图中使用中性 `#序号`，与最终 `UI/FN/CT-序号` 的数字一致。
- [ ] 每条 Issue 均含 Context 与 Detail；模拟截图失败时不能保存，点击失败状态可重试。
- [ ] 输入一句描述后保存会回到走查并缩成 Dock，不需要 DevTools 或外部截图工具。

## D. 截图矩阵

- [ ] DPR 1 与 DPR 2。
- [ ] 浏览器缩放 80%、100%、125%、150%。
- [ ] 页面顶部、中部、底部及横向滚动位置。
- [ ] 小元素、超宽容器、接近视口边缘的元素、动画元素。
- [ ] 截图不包含 UIDelta 浮窗、Pin、选框或 Toast。
- [ ] Context 与 Detail 高亮框和元素误差不超过 2 CSS px；元素移动/页面刷新时本次截图应失败而不是错位保存。

## E. Dock、Pins 与 Inbox

- [ ] Dock 展示已记录数量与候选占位。
- [ ] 本页 Pin 位置正确；重要问题 Pin 使用红色；点击 Pin 可编辑问题。
- [ ] 重复记录同一元素会提示，但允许继续。
- [ ] 搜索可匹配编号、描述、页面、元素；“本页”和三种类型筛选正确。
- [ ] 编辑、复制、跳转、删除均正确；删除 Issue 同时删除两张证据图。
- [ ] 跨路由跳转能返回原元素；DOM 变化无法定位时有明确降级提示。

## F. 证据包

- [ ] 导出 ZIP 可正常解压，包含 `report.md`、`issues.json` 与每条 Issue 的两张 PNG。
- [ ] Markdown 汇总表、详细问题、关键 Actual UI 样式和图片路径正确。
- [ ] JSON 的 `attachments`、`attachmentPaths` 与 `assets[].exportPath` 可以互相对应。
- [ ] 20 条高分辨率 Issue 仍可在 96MB 上限内导出；超过上限时保留 Session 并给出拆分提示。
- [ ] “结束”下载的包内 Session 状态为 `completed`，下载失败时 Session 不结束。

## G. 产品门槛（5 次真实走查）

- [ ] Median Issue Capture Time 相比现有流程下降至少 30%。
- [ ] 有效 Context + Detail 覆盖率 >95%。
- [ ] Element Anchor 可重新定位率 >95%。
- [ ] 若任一指标未达标，优先修复 Record，不进入第二期 Compare。
