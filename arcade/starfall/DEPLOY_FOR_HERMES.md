# 给 Hermes 的部署交接说明

Ray 想把这个 zip 里的游戏部署到个人网站上。项目名：

```text
Ray Cat Starfall / Ray Cat 星港突围
```

这是一个**完整纯静态前端游戏**，不需要后端、不需要数据库、不需要 npm install、不需要 build，也不依赖外部 CDN。

## 你需要做什么

把整个 `ray-cat-starfall/` 文件夹作为静态资源上传到 Ray 的网站即可。

推荐路径：

```text
/arcade/starfall/
```

上线后入口：

```text
https://Ray的网站域名/arcade/starfall/index.html
```

如果 Ray 的主页需要入口按钮，可以添加：

```html
<a href="/arcade/starfall/index.html">🎮 Ray Cat 星港突围</a>
```

## 文件结构

```text
ray-cat-starfall/
├── index.html
├── README.md
├── DEPLOY_FOR_HERMES.md
├── manifest.webmanifest
├── sw.js
├── assets/
│   └── icon.svg
├── css/
│   └── style.css
└── js/
    ├── storage.js
    ├── audio.js
    ├── game.js
    └── app.js
```

## 本地验证

进入 `ray-cat-starfall/` 后，任选一种方式：

### 方式 1：直接打开

双击 `index.html`。

### 方式 2：静态服务器

```bash
python3 -m http.server 8080
```

浏览器打开：

```text
http://localhost:8080
```

建议用手机 Safari 或 Chrome 手机模拟器检查。

## 上线前检查清单

请重点确认：

- `index.html` 可访问。
- `css/style.css`、`js/*.js`、`assets/icon.svg` 都能正常加载。
- 手机竖屏下页面不会上下滚动。
- 横屏时会显示“请竖屏游玩”。
- 点击“开始突围”能进入帮助弹窗，然后能开始游戏。
- 拖动屏幕可以控制 Ray Cat。
- 底部三个按钮可以释放技能。
- 死亡后可以“再来一局”或返回首页。
- 商店和图鉴可以打开。
- localStorage 能保存最高分、金币、升级和成就。

## 静态托管建议

### 普通网站目录

把整个目录上传到：

```text
/public/arcade/starfall/
```

或 Ray 网站当前静态资源系统对应的目录。

### GitHub Pages

上传项目文件，开启 Pages，根目录发布即可。

### Cloudflare Pages

Build command 留空，Output directory 使用根目录。

### Vercel

Framework 选择 Other，Build command 留空，Output directory 留空或项目根目录。

## 注意事项

1. 这个游戏是竖屏 iPhone 触屏体验，不需要为 PC 鼠标做额外适配。
2. 所有素材都是 Canvas / CSS / SVG 自绘，没有外部版权图片。
3. WebAudio 需要用户首次点击后才能播放，这是 iOS Safari 的正常限制。
4. `navigator.vibrate` 在 iPhone Safari 上可能不支持，代码会自动忽略，不影响游戏。
5. 如果部署在子路径，当前资源引用都是相对路径，通常无需改动。
6. 如果要嵌进已有页面，不建议 iframe；推荐作为独立页面跳转，避免触屏滚动冲突。

## localStorage key

```text
rayStarfall.save.v1
```

清空这个 key 可以重置进度。游戏内设置页也提供了“清空本地存档”。

