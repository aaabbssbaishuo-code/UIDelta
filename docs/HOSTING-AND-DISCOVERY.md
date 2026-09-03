# 不买域名，也可以公开 UIDelta

## 访问与搜索是两件事

`http://127.0.0.1:4173/` 是本机预览地址，其他人的电脑不能通过这个地址访问你的网页。

部署到 GitHub Pages 后，项目可以使用免费的默认地址：

`https://aaabbssbaishuo-code.github.io/UIDelta/`

GitHub Pages 允许使用默认 `github.io` 地址，也支持以后绑定自己的域名。自定义域名是可选项。[GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Cloudflare Pages 等服务也会提供默认项目子域名，例如 `<project>.pages.dev`，同样不必先购买域名。[Cloudflare 静态站点说明](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

## 想让别人搜索到

网站首先需要公开可访问、内容可抓取且没有禁止索引。再让搜索引擎发现它，比如在公开 GitHub README 中链接网站，或在搜索引擎的站长工具里验证站点并提交 sitemap。

本仓库已准备网页标题、说明、canonical、Open Graph 信息和 `sitemap.xml`。部署后可在 Google Search Console 中添加网址前缀属性并验证，随后提交 `sitemap.xml` 或请求收录。

收录和排名由搜索引擎决定，不是买域名或提交 sitemap 后就能保证。[Google 重新抓取与索引说明](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)

## 当前上线条件

仓库的部署流程使用 GitHub Actions。上次推送被 GitHub 拒绝，因为本机 OAuth 凭据缺少 `workflow` 权限。素材和网站已在本地准备好；完成授权并成功推送、启用 Pages 后，免费公开地址才能上线。不要将本机预览地址当作已上线的官网。
