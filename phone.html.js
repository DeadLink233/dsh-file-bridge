/**
 * Self-contained pages served by the phone-facing listener.
 *
 * Everything is inline: no CDN, no fonts, no analytics, no build step. The
 * phone may sit on a network without internet access, so any external request
 * would be a defect. The page is deliberately small (< 16 KB) and uses only
 * `<input capture>` (not getUserMedia, which requires a secure context that a
 * plain-http LAN address never provides).
 */

/** Bumped whenever the phone page changes, so a QR rescanned after an update bypasses any WebView cache. */
export const PHONE_BUILD = '7'

const COMMON_CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f4f6fa;
    --card: #ffffff;
    --fg: #12161c;
    --muted: #5d6a7a;
    --line: #e1e7ef;
    --accent: #1a6fd4;
    --accent-ink: #ffffff;
    --ok: #12805c;
    --warn: #9a5b00;
    --err: #bd2b2b;
    --chip: #edf1f7;
    --track: #e6ecf4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c1016;
      --card: #161c24;
      --fg: #e7edf5;
      --muted: #97a3b3;
      --line: #2b3440;
      --accent: #4c9dff;
      --accent-ink: #06121f;
      --ok: #41c98a;
      --warn: #e0a33a;
      --err: #ff6b6b;
      --chip: #1d2530;
      --track: #26303c;
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    min-height: 100vh;
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  button, input { font: inherit; color: inherit; }
  button { touch-action: manipulation; cursor: pointer; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 18px 16px 40px; }
  .top { display: flex; align-items: center; gap: 8px; margin: 4px 0 16px; }
  .brand { font-size: 17px; font-weight: 650; letter-spacing: .2px; }
  .conn {
    margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; color: var(--muted); background: var(--chip);
    border-radius: 999px; padding: 4px 10px;
  }
  .conn::before {
    content: ""; width: 7px; height: 7px; border-radius: 50%;
    background: var(--ok);
  }
  .conn[data-mode="busy"]::before { background: var(--accent); }
  .conn[data-mode="error"]::before { background: var(--err); }
  .lead { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
  .actions { display: grid; grid-template-columns: 1.25fr 1fr; gap: 10px; }
  .actions .act {
    position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    height: 58px; border-radius: 14px; border: 1px solid var(--line);
    background: var(--card); font-size: 16px; font-weight: 600;
    cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
    transition: transform .08s ease, filter .15s ease;
  }
  .actions .act:active { transform: scale(.975); }
  .actions .act:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .actions .primary {
    background: var(--accent); color: var(--accent-ink); border-color: transparent;
    box-shadow: 0 6px 18px -8px rgba(20, 85, 158, .8);
  }
  .actions .secondary { color: var(--fg); }
  .actions svg { width: 21px; height: 21px; flex: none; }
  .visual {
    position: absolute; inset: 0; z-index: 2; border-radius: inherit;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: inherit; pointer-events: none;
  }
  .file {
    position: absolute; inset: 0; top: 0; right: 0; bottom: 0; left: 0;
    width: 100%; height: 100%; opacity: 1; cursor: pointer; font-size: 0;
    color: transparent; background: transparent; border: 0; padding: 0;
    -webkit-appearance: none; appearance: none; z-index: 1;
  }
  .file:focus { outline: none; }
  .empty { color: var(--muted); font-size: 13.5px; text-align: center; margin: 26px 0 0; }
  .empty[hidden] { display: none; }
  .list { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .item {
    display: flex; align-items: center; gap: 12px; padding: 10px;
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  }
  .thumb {
    width: 54px; height: 54px; flex: none; border-radius: 10px; overflow: hidden;
    background: var(--chip);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .kind {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%; color: var(--muted);
    font-size: 11px; font-weight: 700; letter-spacing: .3px;
  }
  .body { min-width: 0; flex: 1; }
  .name { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .bar { height: 3px; border-radius: 3px; background: var(--track); margin-top: 8px; overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 3px; transition: width .18s ease; }
  .item[data-status="done"] .bar { display: none; }
  .item[data-status="queued"] .bar { display: none; }
  .item[data-status="done"] .sub { color: var(--ok); }
  .item[data-status="error"] .sub { color: var(--err); }
  .badge {
    flex: none; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12.5px; font-weight: 600; color: var(--muted); background: var(--chip);
  }
  .item[data-status="done"] .badge { color: var(--ok); background: var(--chip); }
  .item[data-status="error"] .badge {
    color: var(--err); cursor: pointer; border: 1px solid var(--err); background: transparent;
  }
  .tip {
    margin: 18px 0 0; padding: 10px 12px; border-radius: 12px;
    background: var(--chip); color: var(--muted); font-size: 12.5px;
  }
  .tip[hidden] { display: none; }
  .foot { margin: 22px 0 0; color: var(--muted); font-size: 12px; text-align: center; }
`;

const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h3l1.6-2.3h6.8L17 7.5h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>`;
const FILE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/></svg>`;

/** Serialize a value for a `<script>` element without allowing `</script>`. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function pageShell({ title, body, script, bodyClass = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>${title}</title>
<style>${COMMON_CSS}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
<script>${script}</script>
</body>
</html>`;
}

/** The phone transfer page for one pairing token. */
export function phonePageHtml(token, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : 20 * 1024 * 1024
  const maxLabel = maxBytes >= 1024 * 1024
    ? `${Math.round(maxBytes / 1024 / 1024)} MB`
    : `${Math.round(maxBytes / 1024)} KB`
  const body = `
<div class="wrap">
  <div class="top">
    <span class="brand">传文件 → DSH</span>
    <span class="conn" id="conn" data-mode="ok">已连接</span>
  </div>
  <p class="lead">拍照或选择文件，发送后会自动出现在电脑端输入框上方的附件栏。你只需要回到电脑上处理。</p>
  <p class="tip" id="tip" hidden>提示：在 Safari 点「分享 → 添加到主屏幕」，下次可一键打开。</p>
  <div class="actions">
    <div class="act primary">
      <input id="cam" class="file" type="file" accept="image/*" capture="environment" aria-label="拍照">
      <span class="visual" aria-hidden="true">${CAMERA_ICON}<span>拍照</span></span>
    </div>
    <div class="act secondary">
      <input id="files" class="file" type="file" multiple aria-label="选择文件">
      <span class="visual" aria-hidden="true">${FILE_ICON}<span>文件</span></span>
    </div>
  </div>
  <ul class="list" id="list"></ul>
  <p class="empty" id="empty">还没有发送文件</p>
  <p class="foot">同一 Wi-Fi · 单个文件不超过 ${maxLabel} · v${PHONE_BUILD}</p>
</div>`;

  const script = `
(function () {
  var TOKEN = ${scriptJson(token)};
  var MAX_BYTES = ${scriptJson(maxBytes)};
  var UPLOAD = '/p/' + TOKEN + '/upload';
  var items = [];
  var busy = false;
  var seq = 0;
  var list = document.getElementById('list');
  var empty = document.getElementById('empty');
  var conn = document.getElementById('conn');

  try { localStorage.setItem('dsh.photoBridge.token', TOKEN); } catch (e) {}

  function setConn(mode, text) {
    conn.dataset.mode = mode;
    conn.textContent = text;
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function errLabel(code) {
    if (code === 'TOO_LARGE') return '文件太大';
    if (code === 'BAD_TYPE') return '文件为空或无效';
    if (code === 'NOT_FOUND' || code === 'HTTP_404') return '链接已失效';
    if (code === 'timeout') return '上传超时';
    return '网络错误';
  }
  function displayName(file) {
    var name = (file && file.name) || '';
    if (name) return name;
    var type = (file && file.type) || '';
    var ext = type.indexOf('/') >= 0 ? type.split('/')[1] : 'bin';
    ext = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    return 'file-' + Date.now() + '.' + ext;
  }
  function isImage(file) {
    return /^image\//.test((file && file.type) || '') ||
      /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i.test((file && file.name) || '');
  }
  function kindLabel(file) {
    var name = (file && file.name) || '';
    var ext = name.indexOf('.') >= 0 ? name.split('.').pop().toUpperCase() : '';
    return ext && ext.length <= 4 ? ext : 'FILE';
  }

  function createNode(item) {
    var li = document.createElement('li');
    li.className = 'item';
    li.dataset.status = 'queued';
    li.innerHTML = '<div class="thumb"></div>' +
      '<div class="body"><div class="name"></div><div class="sub"></div>' +
      '<div class="bar"><i></i></div></div><div class="badge"></div>';
    var thumb = li.querySelector('.thumb');
    if (isImage(item.file)) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = URL.createObjectURL(item.file);
      thumb.appendChild(img);
    } else {
      var kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = kindLabel(item.file);
      thumb.appendChild(kind);
    }
    li.querySelector('.name').textContent = displayName(item.file);
    return li;
  }

  function statusText(item) {
    if (item.status === 'queued') return '等待上传 · ' + fmtBytes(item.file.size);
    if (item.status === 'uploading') return '上传中… ' + Math.round(item.progress * 100) + '%';
    if (item.status === 'done') return '电脑已收到 · ' + fmtBytes(item.bytes || item.file.size);
    return '失败：' + errLabel(item.error);
  }

  function render(item) {
    var node = item.node;
    node.dataset.status = item.status;
    node.querySelector('.sub').textContent = statusText(item);
    node.querySelector('.bar > i').style.width =
      item.status === 'uploading' ? Math.round(item.progress * 100) + '%'
      : item.status === 'done' ? '100%' : '0%';
    var badge = node.querySelector('.badge');
    badge.textContent = item.status === 'done' ? '✓'
      : item.status === 'error' ? '重试'
      : item.status === 'uploading' ? Math.round(item.progress * 100) + '%'
      : '⏳';
    if (item.status === 'error') {
      badge.onclick = function () {
        if (busy) return;
        item.status = 'queued';
        item.progress = 0;
        item.error = '';
        render(item);
        pump();
      };
    } else {
      badge.onclick = null;
    }
  }

  function addFiles(files) {
    if (!files || files.length === 0) return;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file) continue;
      if (file.size > MAX_BYTES) {
        alert('单个文件不能超过 ' + fmtBytes(MAX_BYTES));
        continue;
      }
      if (file.size === 0) {
        alert('不能发送空文件');
        continue;
      }
      var item = { id: ++seq, file: file, status: 'queued', progress: 0, error: '', bytes: 0 };
      item.node = createNode(item);
      items.push(item);
      list.appendChild(item.node);
      render(item);
    }
    empty.hidden = items.length > 0;
    pump();
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function xhrSend(item) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', UPLOAD, true);
      try {
        xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
        xhr.setRequestHeader('X-Filename', encodeURIComponent(displayName(item.file)));
      } catch (e) {}
      xhr.timeout = 60000;
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        item.progress = e.loaded / e.total;
        render(item);
      };
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status === 200 && body && body.ok) {
          item.progress = 1;
          render(item);
          resolve(body);
          return;
        }
        var code = body && body.code ? body.code : 'HTTP_' + xhr.status;
        var err = new Error(code);
        err.code = code;
        err.retryable = !(xhr.status >= 400 && xhr.status < 500 && xhr.status !== 429);
        reject(err);
      };
      xhr.onerror = function () {
        var err = new Error('network');
        err.code = 'network';
        reject(err);
      };
      xhr.ontimeout = function () {
        var err = new Error('timeout');
        err.code = 'timeout';
        reject(err);
      };
      xhr.send(item.file);
    });
  }

  function attempt(item, n) {
    item.status = 'uploading';
    item.progress = 0;
    render(item);
    setConn('busy', '正在上传…');
    return xhrSend(item).catch(function (err) {
      if (n < 2 && err.retryable !== false) {
        return delay(700 * (n + 1)).then(function () { return attempt(item, n + 1); });
      }
      throw err;
    });
  }

  function pump() {
    if (busy) return;
    var next = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].status === 'queued') { next = items[i]; break; }
    }
    if (!next) {
      var failed = items.some(function (it) { return it.status === 'error'; });
      setConn(failed ? 'error' : 'ok', failed ? '有文件未发送' : '已连接');
      return;
    }
    busy = true;
    attempt(next, 0).then(function (result) {
      next.status = 'done';
      next.bytes = result.bytes || 0;
      next.progress = 1;
      render(next);
    }).catch(function (err) {
      next.status = 'error';
      next.error = err && err.code ? err.code : 'network';
      render(next);
      setConn('error', '上传失败');
    }).then(function () {
      busy = false;
      pump();
    });
  }

  var cam = document.getElementById('cam');
  var filesInput = document.getElementById('files');
  cam.addEventListener('change', function () {
    addFiles(cam.files);
    cam.value = '';
  });
  filesInput.addEventListener('change', function () {
    addFiles(filesInput.files);
    filesInput.value = '';
  });

  window.addEventListener('offline', function () { setConn('error', '网络已断开'); });
  window.addEventListener('online', function () { setConn('ok', '已连接'); pump(); });

  var isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  var standalone = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isIOS && !standalone) {
    var tip = document.getElementById('tip');
    try {
      if (!localStorage.getItem('dsh.photoBridge.tipDismissed')) tip.hidden = false;
    } catch (e) { tip.hidden = false; }
    tip.addEventListener('click', function () {
      tip.hidden = true;
      try { localStorage.setItem('dsh.photoBridge.tipDismissed', '1'); } catch (e) {}
    });
  }

  if (/MicroMessenger/i.test(navigator.userAgent)) {
    var wxTip = document.getElementById('tip');
    wxTip.textContent = '微信内可能无法直接调起相机：请点右上角「···」→「在浏览器打开」。';
    wxTip.hidden = false;
    wxTip.addEventListener('click', function () { wxTip.hidden = true; });
  } else {
    var ua = navigator.userAgent;
    var isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    var isAndroidWebView = /Android/.test(ua) && ua.indexOf('; wv)') !== -1;
    if (isIOS && !isSafari && !standalone) {
      var iosTip = document.getElementById('tip');
      iosTip.textContent = 'iPhone 上的 Chrome/Edge 可能只能打开相册；请用 Safari 打开本页。';
      iosTip.hidden = false;
    } else if (isAndroidWebView) {
      var wvTip = document.getElementById('tip');
      wvTip.textContent = '当前是应用内浏览器，可能无法直接调起相机；请点右上角「···」用 Chrome 打开。';
      wvTip.hidden = false;
    }
  }
})();`;

  return pageShell({ title: '传文件 → DSH', body, script });
}

/** Landing page: resumes a stored pairing token, or explains how to pair. */
export function landingPageHtml() {
  const body = `
<div class="wrap" style="padding-top:44px">
  <div class="top"><span class="brand">传文件 → DSH</span></div>
  <p class="lead">请使用电脑端「手机传文件」面板里显示的配对链接打开本页，或把链接粘贴到下面。</p>
  <label class="lead" for="v">配对链接或 token</label>
  <input id="v" inputmode="latin" autocomplete="off" spellcheck="false"
    placeholder="http://192.168.1.5:8787/p/…"
    style="width:100%;height:48px;border-radius:12px;border:1px solid var(--line);background:var(--card);padding:0 12px;font-size:15px">
  <p></p>
  <button type="button" id="go"
    style="width:100%;height:50px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:650;font-size:16px">打开</button>
  <p class="lead" id="err" style="color:var(--err)"></p>
</div>`;
  const script = `
(function () {
  try {
    var saved = localStorage.getItem('dsh.photoBridge.token');
    if (saved) { location.replace('/p/' + saved); return; }
  } catch (e) {}
  document.getElementById('go').addEventListener('click', function () {
    var value = document.getElementById('v').value.trim();
    var match = value.match(/\\/p\\/([a-f0-9]{16,64})/) || value.match(/^([a-f0-9]{16,64})$/);
    if (!match) {
      document.getElementById('err').textContent = '链接不完整，请重新复制。';
      return;
    }
    location.href = '/p/' + match[1];
  });
})();`;
  return pageShell({ title: '传文件 → DSH', body, script });
}

/** Shown when a stored or typed token no longer matches the current listener. */
export function expiredPageHtml() {
  const body = `
<div class="wrap" style="padding-top:44px">
  <div class="top"><span class="brand">传文件 → DSH</span></div>
  <p class="lead" style="color:var(--err)">这个配对链接已经失效。请在电脑端打开「手机传文件」面板，复制新的链接。</p>
  <p class="lead">如果你刚刚重置过配对 token，旧链接就不能再用了。</p>
  <button type="button" id="clear"
    style="width:100%;height:48px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-weight:600">清除本地旧链接</button>
</div>`;
  const script = `
document.getElementById('clear').addEventListener('click', function () {
  try { localStorage.removeItem('dsh.photoBridge.token'); } catch (e) {}
  location.replace('/');
});`;
  return pageShell({ title: '链接已失效', body, script });
}