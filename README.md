# Ray Page

Ray 的个人展示页。

- 身份定位：AIAgent 产品探索者 / 独立开发者
- 风格：极简高级，参考 Vercel 式黑白留白与精细卡片
- 技术：纯静态 HTML/CSS，无构建依赖
- 部署：当前腾讯云 VPS，后续可绑定腾讯云域名

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

## 后续域名接入

域名实名审核通过后，在腾讯云 DNS 添加解析：

- 类型：A
- 主机记录：@ 和/或 www
- 记录值：腾讯云 VPS 公网 IP

随后在服务器侧配置正式域名与 HTTPS。
