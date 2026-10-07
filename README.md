# Ray Page

Ray 的个人展示页。

- 身份定位：AIAgent 产品探索者 / 独立开发者
- 风格：极简高级，参考 Vercel 式黑白留白与精细卡片
- 技术：静态 HTML/CSS/JS，无线上构建依赖；开发测试使用 Node 22
- 部署：GitHub Pages 发布静态站点，`rayalex.cn` 由 Cloudflare 负责 DNS、代理和安全规则

## 本地预览

使用只暴露公开文件的本地预览服务，禁止从项目根目录直接启动无过滤的文件服务器，因为本机可能有 `.local-secrets`。

然后访问：

```bash
npm ci
npm run preview
```

访问 `http://127.0.0.1:8080`。预览不会模拟登录，真实业务测试应使用测试脚本内的假账号和上游。

## 文件结构

```text
.
├── index.html      # 页面主体
├── styles.css      # 视觉样式
├── favicon.svg     # 网站图标
├── og.svg          # 社交分享图
└── robots.txt      # 爬虫配置
```

## 功能与验证

主页保留原有展示；自 2026-10-07 起，MiMo 登录、聊天和粤语字幕入口显示“维护中”，等待新模型接入。共享会员与游戏存档数据继续保留。`arcade/` 包含游戏大厅、Starfall 和 Frontier。认证和存档使用安全 v2 读取路径，历史和游戏进度按稳定用户 ID 隔离。无归属旧数据保留，不自动认领；存档管理提供备份导出和明确恢复选择。

```bash
npm run check
npm test
npm run browser:install
npm run test:browser
```

浏览器回归使用独立临时环境、合成账号和模拟上游。Linux 优先使用已安装的稳定版 Chrome，CI 明确使用该配置并记录版本；其他环境回退到打包 Chromium。`browser:install` 只安装到 `~/.codex/browser/raypage-playwright`，不使用共享缓存。可用 `CHROMIUM_PATH` 指定已安装的隔离浏览器。禁止使用 Hermes 的浏览器路径。测试不是实际邮件、模型账单、真机麦克风或 Safari 验收。

维护模式回归直接测试发布页面，并对照退役前版本核对主页文字及布局。原认证、媒体生命周期回归仅在测试服务器的响应中关闭维护开关，以保留未启用代码的验证；线上没有查询参数或浏览器存储开关可恢复 AI 服务。

游戏专项覆盖异常存档的保留与恢复、受限存储、旧 Service Worker 更新，以及 320px/390px/短横屏弹窗的触摸滚动、关闭与焦点恢复。Frontier 回归检查快速暂停恢复仅有一条动画循环、后台停帧和实际触摸移动；游戏画质保持不变。大厅仍保留竖屏游玩限制，已打开的弹窗可在横屏操作。

公开仓库只包含前端和测试，不包含生产凭据、用户数据或 Worker 私有源码。后端在本机 `.local-secrets/ray-backend` 独立版本管理，包含迁移、恢复验证和受保护发布工具；该目录不能提交到本仓库或暴露给 HTTP 服务。

- [云存档协议与迁移](docs/game-save-cloud-api.md)
- [发布与恢复说明](docs/release-runbook.md)
