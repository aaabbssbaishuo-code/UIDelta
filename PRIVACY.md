# Privacy and permissions / 隐私与权限

Applies to UIDelta v0.9.4. Updated 2026-09-03.

UIDelta has no account system, analytics, remote backend or external API integration. The extension does not upload review data. Its `fetch()` calls convert locally generated data URLs to blobs for capture/export; they are not external network requests.

## Local data

Review sessions, page URLs and titles, element text/attributes/anchors, computed styles, issue descriptions, optional design snapshots, reference images and screenshots are stored in the extension's IndexedDB. Active-tab state is stored using Chrome extension session storage. HTML, Excel and ZIP reports are written to the user's download location only when export is requested.

Unclaimed screenshot assets are eligible for cleanup after 30 minutes; completed sessions after 30 days. Cleanup runs when extension lifecycle/message handling invokes it, so these are retention thresholds rather than exact deletion deadlines. See `cleanupExpiredPendingAssets()` and `cleanupStaleCompletedSessions()` in `extension/service-worker.js`.

You can delete issues through the issue list. Uninstalling the extension removes its local extension data. Export important records first. Files already exported to Downloads remain until you delete them yourself.

## Why each permission exists

| Permission | Purpose |
| --- | --- |
| `activeTab` | Work with the page the user activates and capture the visible tab |
| `scripting` | Inject the inspection code when the user activates UIDelta |
| `storage` | Keep tab activation state across service-worker restarts |
| `tabs` | Read page identity and switch to pages associated with issues |
| `downloads` | Save requested reports and expose download status/path |
| `unlimitedStorage` | Keep screenshot evidence in local storage without small default quotas |
| `<all_urls>` host access | Support content-script activation, bookmark triggers and cross-page review on regular web/file pages |

Broad access is requested in this preview. Chrome's own permission and protected-page restrictions still apply. Site data is read to inspect and record UI; it is not sent to the maintainer. Local file access additionally requires enabling it in Chrome settings.

## Sharing reports

Reports may contain URLs, visible text, screenshots and imported design data. Sharing a report is a separate user action. Review its contents before sharing outside your team, especially when inspecting internal systems.

## Website

The marketing page contains no analytics, trackers or externally loaded fonts. Its interactive example uses fictional data in memory and downloads only on request. Opening GitHub links is subject to GitHub's own policies. Hosting infrastructure may maintain standard access logs.

## 中文说明

当前扩展不上传走查数据、不接入统计服务、不需要账号或 API Key。记录、页面定位、截图和设计快照存储在本地；只有用户主动导出时才生成下载文件。导出的报告可能含页面内容和截图，请按团队的数据分享规则处理。删除扩展会清除其本地记录，但不会删除已下载文件。
