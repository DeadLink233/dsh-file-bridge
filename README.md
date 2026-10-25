> [!WARNING]
> **⚠️ 本项目内容完全由 AI 生成**
>
> 除 `vendor/QRCode` 中来自第三方的 MIT 许可代码外，本仓库的**代码、文档、测试和提交信息均由 AI 生成**，并已在真实 DSH 环境中运行验证。
>
> AI 生成不等于安全审计。使用前请自行审查代码、备份数据，并遵守 DSH 插件规范；本项目按“现状”提供，不保证适用于所有环境。

# 手机拍照直传（DSH 插件）

手机拍一张照，**不在电脑上做任何操作**，图片直接出现在当前 DSH 对话输入框上方的附件栏里。

```
手机浏览器 ──HTTP──> 插件自己的局域网端口 ──队列──> DSH 页面轮询 ──> 草稿附件栏
```

- 纯局域网：不经过云端、不联网、不装手机 App。
- 二维码在本地生成，不调用任何在线二维码服务。
- 不动 DSH 自带 Web 服务：GUI 仍只在回环地址上，插件另起一个收图端口。
- 图片进入的是**当前会话的草稿附件**，和从电脑上拖一张图进去完全等价；什么时候发送、配什么文字，由你决定。
- 新建对话还没发送第一句时，Hero 顶部也有入口；照片同样先进入草稿附件栏。
- 插件自身没有 npm 依赖、没有构建步骤；二维码编码器已放在 `vendor/QRCode`。

## 兼容性

- 已验证 DSH `0.2.1-rc.2`。
- `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0`；更宽的版本范围未验证。
- DSH 的客户端 slot 和 Host 服务仍在演进，升级 DSH 大版本后请按下方“验证”步骤重新测试。

## 安装

这是一个独立的 DSH 插件仓库，包含 Host 半、浏览器半、测试和文档；不依赖 DSH Hub 收录。

### 从 GitHub 安装（推荐）

```bash
# 固定到某个 commit，避免默认分支后续变动
dsh plugin --profile <profile> add github:DeadLink233/dsh-photo-bridge#<commit-sha>
```

也可以打开 DSH 侧边栏 **Plugins → Add plugin**，填写 GitHub 仓库地址。

### 从 npm 安装（发布后）

```bash
dsh plugin --profile <profile> add dsh-photo-bridge
```

### 从 DSH Hub 安装（可选）

插件被 DSH Hub 收录后，可以直接在插件页搜索安装。DSH Hub 是社区维护的插件索引，不是 DeepSeek 官方商店；是否收录不影响 GitHub/npm 安装。

### 本地目录安装

1. 解压或克隆到本地，得到 `dsh-photo-bridge/` 文件夹。
2. DSH → **Plugins → Add plugin**。
3. 填入该文件夹的绝对路径，例如 `C:\Tools\dsh-photo-bridge`；不要填 zip 本身的路径。
4. 确认插件行为为 `applied`、开关为开。

这是本地目录链接安装：移动或删除该文件夹会让插件失效；移动后重新 Add plugin 即可。Host 半的改动通常需要重载或重启 DSH 才会生效。

首次启动时如果系统弹出防火墙提示，请允许**专用网络 / 本地网络**入站；否则手机连不上电脑。

## 配对与使用

1. 点开 **📷 手机拍照**（普通会话在输入框下方；新对话在 Hero 顶部）。
2. 手机与电脑连同一个 Wi-Fi，用手机相机扫描面板里的二维码（打不开时再点“复制链接”）。
3. iOS 建议「分享 → 添加到主屏幕」，Android 建议「添加到主屏幕」，下次点图标即可。
4. 在手机上点 **拍照**（或 **相册**），看到 `✓ 电脑已收到` 即可。
5. 回到电脑：缩略图已经出现在输入框上方的附件栏，直接输入问题发送。

### 第一句话之前

新建对话还没发送第一句时，输入框下方的 dock 不会渲染，所以插件额外提供了 Hero 顶部入口。

如果照片先到、页面还没选 Workspace/Session，图片会先在 Host 队列里等待；出现空白 Session 后自动进入草稿附件栏，可以先确认附件再发第一句。发送第一句后，输入框下方的 dock 恢复。

配对链接里带着 token。token 只保存在本机 DSH home 里，卸载插件不会自动删除；想换 token，删除 `<DSH home>/photo-bridge/state.json` 后重启 DSH（旧链接立即失效）。

## 配置

插件行在 `cordis.patch.yml` 里，所有字段都可选：

```yaml
- insert:
    - id: photo-bridge
      name: 'dsh-photo-bridge'
      config:
        port: 8787
        # bind: 192.168.1.5        # 默认自动取第一个非回环 IPv4
        # maxBytes: 20971520       # 单张上限，默认 20 MB
        # keepFiles: true          # ack 后是否保留 inbox 原图
        # retentionHours: 72       # inbox 清理周期
        # token: '0123456789abcdef0123456789abcdef'  # 固定 token（默认自动生成并持久化）
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` | `8787` | 收图端口；被占用时插件启用失败并给出明确报错 |
| `bind` | 自动探测 | 只接受具体网卡地址；拒绝 `0.0.0.0` / `::` |
| `token` | 自动生成 | 16–64 位十六进制；生成后会写进 state.json |
| `maxBytes` | `20971520` | 单张上限，流式累计，超限立即拒绝 |
| `keepFiles` | `true` | `ack` 后是否保留原图（保留时移到 `kept/`，不会再次入队） |
| `retentionHours` | `72` | 超过即从队列与 inbox 清理 |

## 权限与数据

插件会做这些事，安装前请确认可接受：

- **网络**：在指定局域网网卡上监听一个 HTTP 端口（默认 `8787`），用于手机页面和图片上传；不会把 DSH 自己的 Web GUI 暴露到局域网。
- **DSH 回环 API**：在 DSH 的回环 Web 服务上注册 `/photo-bridge/config|queue|item/<id>|ack|model`，浏览器半通过这些接口取图并注入草稿。
- **文件**：在 `<DSH home>/photo-bridge/` 下写入 `state.json`、`inbox/` 和 `kept/` 图片。
- **手机端**：手机浏览器通过 `<input type="file" accept="image/*" capture="environment">` 调起系统相机，需要手机授予相机/照片权限；插件不会在网页里调用 `getUserMedia`。
- **防火墙**：Windows 首次监听可能弹出防火墙提示，需要允许专用网络入站。
- **不访问外网**：手机页面没有外部脚本、字体、统计或二维码服务；token 只在本机生成。

数据目录：

- `<DSH home>/photo-bridge/state.json`：token 等配对状态
- `<DSH home>/photo-bridge/inbox/`：还没被 DSH 收走的图片
- `<DSH home>/photo-bridge/kept/`：已经收走但保留的原图

Windows 通常位于 `%USERPROFILE%\.dsh\photo-bridge\`；macOS / Linux 通常位于 `~/.dsh/photo-bridge/`。

## 卸载

1. 在 DSH 的 Plugins 页面关闭并移除 `dsh-photo-bridge`。
2. 插件卸载时会关闭收图端口；如果 Host 进程仍在运行，最迟下次重启后端口释放。
3. 数据目录不会自动删除。确认不需要历史图片后，手动删除 `<DSH home>/photo-bridge/`。
4. 想立即让所有旧配对链接失效：删除 `state.json` 或其中的 token 后重启 DSH。

## 安全边界

- 手机端所有请求都必须带 URL 里的 token，比较使用定时安全算法。
- 只接受图片魔数（JPEG / PNG / WebP / GIF / HEIC），扩展名由服务端决定，落盘文件名永不拼接客户端输入。
- 单张大小硬上限；无 `getUserMedia`、无外部资源、无第三方统计。
- 同一 Wi-Fi 下拿到配对链接的人可以往你的输入框塞图；链接泄露时删除 `state.json` 换 token。
- 本插件没有安装生命周期脚本；安装时不会在用户主机上执行 `postinstall` 等命令。

## 已知限制

- HEIC 会被接收并作为普通文件附件进入草稿；能否直接作为图片被模型读取取决于 DSH 的附件管线，本版不做转码。
- Windows 防火墙可能拦截首次监听；请在弹窗里允许「专用网络」。
- 手机与电脑不同网段、或路由器开了 AP 隔离时无法连接（可让电脑开热点）。
- 微信内置浏览器可能忽略 `capture`，点「拍照」会打开相册；点右上角「···」→「在浏览器打开」即可直接调起系统相机。
- iPhone 上的 Chrome/Edge，以及部分安卓应用内浏览器/厂商浏览器，也可能忽略 `capture` 而只打开相册；请改用 Safari 或 Chrome。
- 局域网页面是普通 HTTP，不满足 `getUserMedia` 的安全上下文要求，所以网页内无法自建相机预览；调起系统相机只能依赖 `capture`。
- 同一张图在「已注入但尚未 ack」时刷新页面，可能被重复注入一次；ack 成功后不会重复。

## 验证

```bash
node --check index.js
node --check client.js
node --check bridge.js
node test/smoke.mjs
```

`test/smoke.mjs` 会在临时目录和随机端口启动 Host 半，测试手机页面、上传校验、队列/ack、持久化与二维码，不接触真实照片。

## 包内容

```
index.js        Host 半：配置校验 + Cordis 生命周期 + 注册客户端 API 路由
bridge.js       收图 HTTP 服务、队列、魔数校验、inbox 持久化、二维码生成
phone.html.js   手机端页面（零外部请求）
client.js       浏览器半：dock 行 + Hero 入口 + 二维码 + 轮询 + createDrafts/addAttachments
qr.js           配对 URL → SVG path（不访问任何在线二维码服务）
vendor/QRCode   二维码编码器（Kazuhiko Arase，MIT，见 vendor/QRCode/LICENSE）
locale/         中英文界面文案
cordis.patch.yml 插件行的插入配置
```

## License

MIT。`vendor/QRCode` 保留其原始 MIT 许可证和版权声明。