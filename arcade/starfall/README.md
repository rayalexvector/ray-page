# Ray Cat Starfall / Ray Cat 星港突围

一个可以直接部署到个人网站的精良竖屏触屏网页游戏。定位不是小游戏合集，而是一款更完整的单机手机网页动作 Roguelite：玩家拖动 Ray Cat 在霓虹星港中闪避弹幕、自动射击、收集 AI 芯片升级、挑战 Boss，并用本地保存的星屑金币购买永久强化。

## 核心特色

- **iPhone 竖屏触屏优先**：拖动控制移动，底部三个大按钮释放技能，不依赖键盘和鼠标。
- **Canvas 动作战斗**：自动射击、敌人弹幕、碰撞、粒子、震屏、发光、Boss 阶段技能。
- **Roguelite 本局成长**：升级时三选一强化，包括双子猫爪、Codex 缓存、Hermes 护盾、AI 小助手、NOVA 核心等。
- **永久升级商店**：猫舱装甲、射速、磁场、闪避、金币收益、NOVA 核心等永久强化。
- **成就图鉴**：最高分、最远波次、总击杀、Boss 击败、金币累计等成就。
- **本地存档**：所有进度保存在浏览器 `localStorage`，不需要登录、后端或数据库。
- **WebAudio 音效与振动反馈**：可在设置中关闭；不支持振动的浏览器会自动忽略。
- **iPhone Safari 适配**：安全区、横屏提示、防误触、防页面滚动、高清 DPR Canvas。
- **离线缓存**：HTTPS 或 localhost 环境下自动注册 Service Worker，首次访问后可离线打开。

## 操作方式

1. 按住屏幕拖动，Ray Cat 会跟随手指移动。
2. 猫爪光弹自动发射，专心躲弹幕和收集芯片/金币。
3. 底部按钮：
   - **闪避**：短暂无敌，并清除身边敌弹。
   - **护盾**：获得吸收伤害的 Hermes 护盾。
   - **NOVA**：清屏爆发，对全场敌人造成大量伤害。
4. HP 归零后结算，本局金币会加入永久钱包。

## 项目结构

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

## 本地打开

最简单方式：直接双击 `index.html` 用浏览器打开。

更推荐使用任意静态服务器预览，例如：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 部署方式

这是纯静态前端项目，不需要 npm、不需要 build、不需要后端。

### GitHub Pages

1. 新建仓库，例如 `ray-cat-starfall`。
2. 上传本项目所有文件。
3. 在仓库设置中开启 Pages。
4. Source 选择 `main` 分支根目录。
5. 等待 GitHub Pages 发布。

### Cloudflare Pages

1. 新建 Pages 项目。
2. 连接 Git 仓库，或直接上传本项目文件夹。
3. Build command 留空。
4. Output directory 填 `/` 或留空。
5. 发布即可。

### Vercel

1. 新建项目并导入仓库。
2. Framework 选择 `Other`。
3. Build command 留空。
4. Output directory 留空或设为项目根目录。
5. 部署即可。

### 放进已有个人网站

可以将整个文件夹上传到你网站的静态目录，比如：

```text
/arcade/starfall/
```

然后访问：

```text
https://你的域名/arcade/starfall/index.html
```

如果已有主页，可以添加入口：

```html
<a href="/arcade/starfall/index.html">🎮 Ray Cat 星港突围</a>
```

## localStorage 数据

游戏使用以下 key：

```text
rayStarfall.save.v1
```

保存内容包括：

- 最高分、最远波次、最长存活时间
- 总局数、总击杀、Boss 击败数
- 星屑金币钱包
- 永久升级等级
- 成就解锁记录
- 音效、振动、低闪烁模式设置
- 新手帮助是否看过

所有数据都只保存在本机浏览器中。清除浏览器网站数据后，进度也会清空。

## 已实现功能清单

- 首页、设置、商店、成就图鉴、帮助弹窗
- iPhone 竖屏安全区适配和横屏提示
- Canvas 高清渲染与窗口尺寸自适应
- 拖动移动、自动射击、三技能按钮
- 普通敌人、射击敌人、自爆雷、追踪敌人、Boss
- 玩家子弹、敌方弹幕、碰撞、伤害、无敌帧、护盾
- 芯片、金币、回血掉落
- 本局升级三选一
- 永久升级商店
- 成就系统与 toast 提示
- WebAudio 音效、振动反馈、低闪烁模式
- 后台自动暂停，减少耗电
- Service Worker 离线缓存

## 后续可继续优化方向

这些都不是基础运行所必需：

- 增加章节地图、剧情事件和更多 Boss。
- 增加更多 Ray Cat 皮肤和弹幕形态。
- 增加每日挑战种子和排行榜截图分享。
- 接入你个人网站的统一导航、统计或主题系统。
- 做更细致的 iPhone 真机手感调参。

