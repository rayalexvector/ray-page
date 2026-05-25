# Ray Page

Ray 的个人展示页。

- 身份定位：AIAgent 产品探索者 / 独立开发者
- 风格：极简高级，参考 Vercel 式黑白留白与精细卡片
- 技术：纯静态 HTML/CSS，无构建依赖
- 部署：GitHub Pages 发布静态站点，`rayalex.cn` 由 Cloudflare 负责 DNS、代理和安全规则

## 本地预览

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 文件结构

```text
.
├── index.html      # 页面主体
├── styles.css      # 视觉样式
├── favicon.svg     # 网站图标
├── og.svg          # 社交分享图
└── robots.txt      # 爬虫配置
```
