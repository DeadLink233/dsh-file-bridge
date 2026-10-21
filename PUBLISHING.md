# 发布到 DSH Hub

DSH Hub 是**社区维护的 DSH 插件索引**，不是 DeepSeek 官方商店。发布指南：
<https://dsh-hub.cc/publish?lang=zh>

这个目录已经按“可提交”的形态整理好：

- 包名：`dsh-photo-bridge`（2026-10-22 查询 npm registry 时可用）
- 版本：`1.0.1`
- 无 npm 依赖、无构建步骤、无安装生命周期脚本
- 根目录有 `package.json`，并声明了 `dsh.bundle.patch`
- 已补 `license`、`keywords`、`engines.dsh`、`publishConfig`
- README 包含能力、配置、权限、卸载和验证方式

## 1. 创建 GitHub 仓库

**这个目录本身就是仓库根目录。** 不要把包含它的父目录整个推上去，否则仓库根目录没有 `package.json`，DSH Hub 检查会失败。

在 GitHub 新建一个公开仓库：

```text
https://github.com/DeadLink233/dsh-photo-bridge
```

然后在本目录执行：

```bash
git init
git add .
git commit -m "Initial public release of dsh-photo-bridge"
git branch -M main
git remote add origin https://github.com/DeadLink233/dsh-photo-bridge.git
git push -u origin main
```

推上去后，在 `package.json` 里补上真实仓库地址（可选，但建议）：

```json
"repository": {
  "type": "git",
  "url": "https://github.com/DeadLink233/dsh-photo-bridge.git"
},
"homepage": "https://github.com/DeadLink233/dsh-photo-bridge#readme"
```

## 2. 添加自动收录 Topic（可选）

GitHub 仓库 → **Topics** → 添加：

```text
dsh-plugin
```

DSH Hub 会定时自动同步带这个 Topic 的仓库。  
如果不想每次 push 都自动进入同步范围，就不要加 Topic，改用第 4 步手动提交。

## 3. 在干净 profile 验证

不要用当前已经装了本地链接版插件的 profile。新建一个 demo profile：

```bash
dsh plugin --profile demo add github:DeadLink233/dsh-photo-bridge#<commit-sha>
```

- `<commit-sha>` 用完整的 40 位 SHA：`git rev-parse HEAD`
- 启动 demo profile
- 确认 Host 的 `photo-bridge` 行成功挂载、8787 端口监听
- 确认普通会话 dock、Hero 入口、侧边栏入口都出现
- 用手机实际上传一张图，确认进入草稿附件栏
- 在仓库里跑：

```bash
node --check index.js
node --check client.js
node --check bridge.js
node test/smoke.mjs
```

## 4. 提交到 DSH Hub

1. 打开 <https://dsh-hub.cc/publish?lang=zh>
2. 用 GitHub 登录
3. 粘贴公开仓库地址
4. 点“检查并发布”

DSH Hub 会检查根目录 `package.json` 里的 `dsh.bundle.patch`，通过后直接发布。  
这是清单检查，不等于安全审核；代码和兼容性仍由你负责。

## 5. 可选：发布到 npm

如果希望用户按包名安装，或想走 DSH Hub 的 npm package 标签：

```bash
npm login
npm publish --access public
```

检查：

```bash
npm view dsh-photo-bridge version
```

然后用户可以直接：

```bash
dsh plugin --profile <profile> add dsh-photo-bridge
```

## 6. 发布后

- 在 DSH Hub 插件页确认标题、描述、图标、README 链接正常
- 用一个全新 profile 从 DSH Hub 安装一次，确认不是只验证了本地目录
- 打 tag：`git tag v1.0.1 && git push --tags`
- 后续每次发版：修改 `version`、更新 README 的兼容性、commit + tag，再等 DSH Hub 同步或手动提交

## 维护提醒

- DSH 升级后重新验证客户端 slot、Host 路由和附件注入
- 已发布版本不要静默改内容；用新版本号发
- npm 包名一旦公开，尽量保持稳定
- 这个插件零运行时依赖，维护成本主要来自 DSH 兼容性和手机浏览器差异
