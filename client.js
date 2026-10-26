/**
 * Client half of the phone file bridge.
 *
 * Renders the ambient dock row under the composer, a compact trigger in the
 * blank-session Hero, and a headless drain loop in the New Session row. All of
 * them share the Host queue and the conversation service: the Hero trigger
 * opens the pairing panel, while the headless entry injects a received photo
 * into the blank Session's
 * draft before the first message. The composer dock is skipped while the Hero
 * is showing, which is why the other seats are needed. Everything is plain
 * JavaScript: the browser loads this file as a module factory, so there is no
 * build step and no dependency beyond React.
 */

window.__ModuleLoader__.load({
  id: 'dsh-photo-bridge',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const NS = 'photo-bridge'

    const ZH = {
      title: '手机传文件',
      waiting: '等待手机发送',
      connecting: '连接中…',
      unavailable: '接收服务不可用',
      noLan: '未检测到局域网地址',
      copy: '复制链接',
      copied: '已复制',
      refresh: '刷新',
      panelTitle: '手机传文件',
      panelDesc: '手机与电脑连同一个 Wi-Fi，扫码后拍照或选择文件。发送的内容会自动加入输入框上方的附件栏。',
      qrTitle: '扫码配对',
      qrHint: '用手机相机扫码打开传输页；微信内请点右上角「···」→「在浏览器打开」。',
      qrAlt: '配对二维码',
      unavailableHint: '接收服务没有启动。请确认插件已启用，然后刷新页面重试。',
      noLanHint: '没有检测到局域网地址，手机无法连接。请连接 Wi-Fi 或网线；如果有多块网卡，请在插件配置里填写 bind。',
      lastReceived: '最近接收',
      never: '还没有收到文件',
      injectError: '文件已收到，但加入附件栏失败，会自动重试。',
      firewallHint: '首次使用时，请在 Windows 防火墙提示中选择「允许专用网络」。',
      copyFailed: '复制失败，请手动选择链接。',
      port: '端口',
    }

    const EN = {
      title: 'Phone files',
      waiting: 'Waiting for phone',
      connecting: 'Connecting…',
      unavailable: 'Receiver unavailable',
      noLan: 'No LAN address',
      copy: 'Copy link',
      copied: 'Copied',
      refresh: 'Refresh',
      panelTitle: 'Phone File Bridge',
      panelDesc: 'Connect your phone to the same Wi-Fi, then take a photo or pick a file. What you send is added to the attachment bar above the composer.',
      qrTitle: 'Scan to pair',
      qrHint: 'Scan with your phone camera to open the transfer page. If it opens inside an app, use the menu to open it in your browser.',
      qrAlt: 'Pairing QR code',
      unavailableHint: 'The receiver is not running. Check that the plugin is enabled, then reload the page.',
      noLanHint: 'No LAN address was detected, so the phone cannot connect. Join a Wi-Fi or wired network, or set bind in the plugin config.',
      lastReceived: 'Last received',
      never: 'No files yet',
      injectError: 'A file arrived but could not be added to the draft; it will retry automatically.',
      firewallHint: 'On first use, allow private networks in the Windows Firewall prompt.',
      copyFailed: 'Copy failed; select the link manually.',
      port: 'Port',
    }

    const CLAIM_TTL_MS = 60_000
    const MAX_PER_TICK = 5
    const SINCE_KEY = 'dsh.photoBridge.since'

    /** Page-wide bookkeeping shared by every mounted dock (there is normally one). */
    const shared = {
      claims: new Map(),
      pendingAcks: new Map(),
      /** One queue drain at a time even when more than one slot entry is mounted. */
      tickBusy: false,
    }

    const CSS = `
      .pb-root { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; max-width: 100%; }
      .pb-root[data-variant="hero"] { display: inline-flex; }
      .pb-root[data-variant="hero"] .pb-row { height: 26px; padding: 0 6px; gap: 5px; }
      .pb-root[data-variant="hero"] .pb-icon svg { width: 15px; height: 15px; }
      .pb-root[data-variant="brand"] { display: inline-flex; }
      .pb-root[data-variant="brand"] .pb-brand-row {
        justify-content: center; padding: 0; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: var(--dsw-radius-lg, 12px);
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
      }
      .pb-root[data-variant="brand"] .pb-brand-row:hover {
        background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
      }
      .pb-root[data-variant="brand"] .pb-icon svg { width: 18px; height: 18px; }
      .pb-root[data-variant="brand"] .pb-dot {
        position: absolute; top: 4px; right: 4px;
        box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2);
      }
      .pb-row {
        display: inline-flex; align-items: center; gap: 6px; height: 24px; max-width: 100%;
        padding: 0 8px; border: 0; border-radius: 7px; background: transparent;
        color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 1;
        cursor: pointer; min-width: 0;
      }
      .pb-row:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
      .pb-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .pb-row:disabled { cursor: default; opacity: .7; }
      .pb-icon { display: inline-flex; flex: none; }
      .pb-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pb-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-idle-primary); }
      .pb-dot[data-tone="ok"] { background: var(--dsw-alias-state-success-primary); }
      .pb-dot[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
      .pb-dot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
      .pb-status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pb-chevron { display: inline-flex; flex: none; transition: transform .15s ease; }
      .pb-chevron[data-open="true"] { transform: rotate(180deg); }
      .pb-panel {
        position: fixed; z-index: 1100; box-sizing: border-box;
        width: 420px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
        overflow-y: auto; overscroll-behavior: contain;
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 12px);
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay)); color: var(--dsw-alias-label-secondary);
        box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, .2));
        backdrop-filter: var(--dsw-menu-backdrop-filter, none);
        padding: 12px; font-size: 12.5px; line-height: 1.5;
      }
      .pb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .pb-heading { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
      .pb-note { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
      .pb-url {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px; line-height: 1.45; word-break: break-all; user-select: all;
        color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
        border-radius: 6px; padding: 6px 8px;
      }
      .pb-pair { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .pb-qr {
        flex: none; width: 164px; height: 164px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1); background: #fff;
      }
      .pb-pair-text { display: flex; flex-direction: column; gap: 6px; flex: 1 1 150px; min-width: 140px; }
      .pb-pair-title { color: var(--dsw-alias-label-primary); font-size: 12.5px; font-weight: 600; }
      .pb-url-compact { font-size: 10.5px; line-height: 1.4; padding: 4px 6px; }
      .pb-fallback { display: flex; flex-direction: column; gap: 8px; }
      .pb-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .pb-btn {
        height: 24px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1);
        background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .pb-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .pb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .pb-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
      .pb-warn { color: var(--dsw-alias-state-warn-primary); }
      .pb-err { color: var(--dsw-alias-state-error-primary); }
    `

    function safeStorageGet(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    }

    function safeStorageSet(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        /* private mode */
      }
    }

    function readSince() {
      const value = Number(safeStorageGet(SINCE_KEY))
      return Number.isFinite(value) && value > 0 ? value : 0
    }

    function writeSince(value) {
      if (!Number.isFinite(value) || value <= readSince()) return
      safeStorageSet(SINCE_KEY, String(value))
    }

    function claim(id) {
      shared.claims.set(id, Date.now())
    }

    function isClaimed(id) {
      const at = shared.claims.get(id)
      if (at === undefined) return false
      if (Date.now() - at > CLAIM_TTL_MS) {
        shared.claims.delete(id)
        return false
      }
      return true
    }

    function release(id) {
      shared.claims.delete(id)
    }

    async function requestJson(path, init) {
      const response = await fetch(path, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        /* not JSON */
      }
      if (!response.ok || !body || body.ok !== true) {
        const code = body && typeof body.code === 'string' ? body.code : `HTTP_${response.status}`
        const error = new Error(code)
        error.code = code
        throw error
      }
      return body
    }

    async function loadConfig() {
      let lastError
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await requestJson('/photo-bridge/config')
        } catch (error) {
          lastError = error
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
        }
      }
      throw lastError ?? new Error('unavailable')
    }

    async function flushAcks() {
      for (const [id, seq] of [...shared.pendingAcks]) {
        try {
          await requestJson('/photo-bridge/ack', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          shared.pendingAcks.delete(id)
          release(id)
          writeSince(seq)
        } catch {
          /* keep it queued and retry on the next tick */
        }
      }
    }

    function relativeTime(timestamp, locale) {
      const chinese = String(locale || '').toLowerCase().startsWith('zh')
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
      if (seconds < 10) return chinese ? '刚刚' : 'just now'
      if (seconds < 60) return chinese ? `${seconds} 秒前` : `${seconds}s ago`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return chinese ? `${minutes} 分钟前` : `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return chinese ? `${hours} 小时前` : `${hours}h ago`
      const days = Math.floor(hours / 24)
      return chinese ? `${days} 天前` : `${days}d ago`
    }

    function UploadIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M12 16V4' }),
        h('path', { d: 'M7 9l5-5 5 5' }),
        h('path', { d: 'M5 16v4h14v-4' }),
      )
    }

    function Chevron({ open }) {
      return h(
        'span',
        { className: 'pb-chevron', 'data-open': String(open) },
        h(
          'svg',
          {
            viewBox: '0 0 16 16',
            width: 10,
            height: 10,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          h('path', { d: 'M4 6l4 4 4-4' }),
        ),
      )
    }

    function createPhotoDock(ctx) {
      const bound = ctx.locale.bind(NS)

      function PhotoDock(props) {
        const t = typeof props.t === 'function' ? props.t : bound
        const variant = props.variant === 'brand'
          ? 'brand'
          : props.variant === 'headless'
            ? 'headless'
            : props.variant === 'hero'
              ? 'hero'
              : 'dock'
        const sessionId = props.sessionId
        const inputActions = props.inputActions
        const [open, setOpen] = React.useState(false)
        const [reloadKey, setReloadKey] = React.useState(0)
        const [config, setConfig] = React.useState({ phase: 'loading' })
        const [state, setState] = React.useState({ lastAt: 0, error: '', copied: false, copiedError: false })
        const [now, setNow] = React.useState(Date.now())
        const [panelStyle, setPanelStyle] = React.useState(null)
        const rootRef = React.useRef(null)
        const rowRef = React.useRef(null)
        const panelRef = React.useRef(null)
        const copyTimer = React.useRef(undefined)
        const [, refreshLocale] = React.useReducer((value) => value + 1, 0)

        React.useEffect(() => {
          const unsubscribe = ctx.locale.subscribe(() => refreshLocale())
          return unsubscribe
        }, [])

        React.useEffect(() => {
          const timer = setInterval(() => setNow(Date.now()), 30_000)
          return () => clearInterval(timer)
        }, [])

        React.useEffect(() => {
          if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
          return () => {
            if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
          }
        }, [])

        React.useEffect(() => {
          let cancelled = false
          setConfig({ phase: 'loading' })
          loadConfig()
            .then((value) => {
              if (!cancelled) setConfig({ phase: 'ready', ...value })
            })
            .catch((error) => {
              if (!cancelled) setConfig({ phase: 'error', message: error?.code ?? String(error) })
            })
          return () => {
            cancelled = true
          }
        }, [reloadKey])

        React.useLayoutEffect(() => {
          if (!open) {
            setPanelStyle(null)
            return undefined
          }
          const place = () => {
            const row = rowRef.current
            const panel = panelRef.current
            if (!row || !panel || typeof window === 'undefined') return
            const anchor = row.getBoundingClientRect()
            const width = panel.offsetWidth
            const height = panel.offsetHeight
            const margin = 12
            const gap = 8
            const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - width - margin)
            let top = anchor.top - height - gap
            if (top < margin) {
              top = Math.max(margin, Math.min(window.innerHeight - height - margin, anchor.bottom + gap))
            }
            setPanelStyle({
              position: 'fixed',
              left: Math.round(left),
              top: Math.round(top),
              visibility: 'visible',
            })
          }
          place()
          const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
          if (observer && panelRef.current) observer.observe(panelRef.current)
          window.addEventListener('resize', place)
          window.addEventListener('scroll', place, true)
          return () => {
            if (observer) observer.disconnect()
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
          }
        }, [open])

        React.useEffect(() => {
          if (!open) return undefined
          const dismiss = (event) => {
            const target = event.target
            if (target instanceof Node &&
              (rootRef.current?.contains(target) || panelRef.current?.contains(target))) return
            setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('pointerdown', dismiss, true)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', dismiss, true)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [open])

        React.useEffect(() => {
          if (config.phase !== 'ready' || !config.ok || !sessionId) return undefined
          let stopped = false
          let busy = false
          let timer

          const tick = async () => {
            if (stopped || busy || shared.tickBusy) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            busy = true
            shared.tickBusy = true
            try {
              await flushAcks()
              const since = readSince()
              const queue = await requestJson(`/photo-bridge/queue?since=${since}`)
              const items = Array.isArray(queue.items) ? queue.items : []
              let injected = 0
              for (const item of items) {
                if (stopped || injected >= MAX_PER_TICK) break
                if (!item || typeof item.id !== 'string') continue
                if (isClaimed(item.id) || shared.pendingAcks.has(item.id)) continue
                claim(item.id)
                try {
                  const response = await fetch(`/photo-bridge/item/${encodeURIComponent(item.id)}`, {
                    cache: 'no-store',
                    credentials: 'same-origin',
                  })
                  if (!response.ok) throw new Error(`HTTP_${response.status}`)
                  const blob = await response.blob()
                  const name = typeof item.name === 'string' && item.name ? item.name : `file-${item.id}`
                  const file = new File([blob], name, {
                    type: typeof item.mime === 'string' && item.mime ? item.mime : blob.type || 'application/octet-stream',
                  })
                  if (typeof ctx.conversation?.createDrafts !== 'function') {
                    throw new Error('conversation-unavailable')
                  }
                  const drafts = ctx.conversation.createDrafts(sessionId, [file])
                  if (!drafts || drafts.length === 0) throw new Error('draft-failed')
                  const accepted = typeof inputActions?.addAttachments === 'function'
                    ? inputActions.addAttachments(drafts.map((draft) => draft.id))
                    : false
                  if (!accepted) {
                    ctx.conversation.releaseDraftAttachments?.(drafts)
                    release(item.id)
                    break
                  }
                  injected += 1
                  shared.pendingAcks.set(item.id, item.seq)
                  setState((previous) => ({ ...previous, lastAt: Date.now(), error: '' }))
                  await flushAcks()
                } catch (error) {
                  release(item.id)
                  setState((previous) => ({ ...previous, error: error?.code ?? error?.message ?? 'error' }))
                  break
                }
              }
            } catch (error) {
              setState((previous) => ({ ...previous, error: error?.code ?? 'unavailable' }))
            } finally {
              busy = false
              shared.tickBusy = false
            }
          }

          tick()
          timer = setInterval(tick, 1000)
          const onVisibility = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick()
          }
          document.addEventListener?.('visibilitychange', onVisibility)
          return () => {
            stopped = true
            clearInterval(timer)
            document.removeEventListener?.('visibilitychange', onVisibility)
          }
        }, [config.phase, config.ok, config.token, sessionId, inputActions])

        if (variant === 'headless') return null

        const locale = ctx.locale.getLocale().active
        const ready = config.phase === 'ready' && config.ok
        let tone = 'idle'
        let status = t('connecting')
        if (config.phase === 'error') {
          tone = 'error'
          status = t('unavailable')
        } else if (ready && config.loopback) {
          tone = 'warn'
          status = t('noLan')
        } else if (ready) {
          tone = 'ok'
          status = state.lastAt ? relativeTime(state.lastAt, locale) : t('waiting')
        }
        if (state.error) {
          tone = tone === 'ok' ? 'warn' : tone
        }

        const copy = async () => {
          if (!config.url) return
          try {
            await navigator.clipboard.writeText(config.url)
            setState((previous) => ({ ...previous, copied: true, copiedError: false }))
            if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
            copyTimer.current = setTimeout(() => {
              setState((previous) => ({ ...previous, copied: false }))
            }, 1600)
          } catch {
            setState((previous) => ({ ...previous, copied: false, copiedError: true }))
          }
        }

        const panelId = 'photo-bridge-panel'
        const qr = ready && config.qr && typeof config.qr.path === 'string' ? config.qr : null
        const qrNode = qr
          ? h(
              'svg',
              {
                className: 'pb-qr',
                viewBox: `0 0 ${qr.total} ${qr.total}`,
                width: 164,
                height: 164,
                shapeRendering: 'crispEdges',
                role: 'img',
                'aria-label': t('qrAlt'),
              },
              h('rect', { width: qr.total, height: qr.total, fill: '#ffffff' }),
              h('path', { d: qr.path, fill: '#000000' }),
            )
          : null
        const copyAction = ready && config.url
          ? h(
              'button',
              { type: 'button', className: 'pb-btn', onClick: copy },
              state.copied ? t('copied') : t('copy'),
            )
          : null
        const refreshAction = h(
          'button',
          {
            type: 'button',
            className: 'pb-btn',
            onClick: () => setReloadKey((value) => value + 1),
          },
          t('refresh'),
        )

        const brandSize = (() => {
          const value = Number(props.size)
          return Number.isFinite(value) && value > 0 ? Math.min(48, Math.max(24, value)) : 34
        })()
        const buttonClass = variant === 'brand'
          ? ['pb-row', 'pb-brand-row', props.className].filter(Boolean).join(' ')
          : 'pb-row'
        const showLabel = variant === 'dock'

        return h(
          'div',
          { className: 'pb-root', 'data-variant': variant, ref: rootRef },
          h('style', { key: 'photo-bridge-style' }, CSS),
          h(
            'button',
            {
              type: 'button',
              className: buttonClass,
              ref: rowRef,
              style: variant === 'brand' ? { width: brandSize, height: brandSize } : undefined,
              'aria-expanded': open,
              'aria-haspopup': 'dialog',
              'aria-controls': open ? panelId : undefined,
              'aria-label': variant === 'dock' ? undefined : `${t('title')}: ${status}`,
              title: variant === 'dock' ? t('panelTitle') : `${t('panelTitle')} — ${status}`,
              onClick: () => setOpen((value) => !value),
            },
            h('span', { className: 'pb-icon' }, h(UploadIcon, null)),
            showLabel ? h('span', { className: 'pb-title' }, t('title')) : null,
            h('span', { className: 'pb-dot', 'data-tone': tone, 'aria-hidden': true }),
            variant === 'dock' ? h('span', { className: 'pb-status' }, status) : null,
            variant === 'dock' ? h(Chevron, { open }) : null,
          ),
          open && typeof document !== 'undefined'
            ? ReactDOM.createPortal(
                h(
                  'div',
                  {
                    className: 'pb-panel',
                    id: panelId,
                    ref: panelRef,
                    role: 'dialog',
                    'aria-label': t('panelTitle'),
                    style: panelStyle ?? { position: 'fixed', left: 0, top: 0, visibility: 'hidden' },
                  },
                h(
                  'div',
                  { className: 'pb-head' },
                  h('span', { className: 'pb-heading' }, t('panelTitle')),
                  h(
                    'span',
                    { className: 'pb-note' },
                    ready
                      ? `${t('port')} ${config.port ?? '—'}`
                      : config.phase === 'error'
                        ? t('unavailable')
                        : t('connecting'),
                  ),
                ),
                h(
                  'div',
                  {
                    className:
                      config.phase === 'error' || (ready && config.loopback) ? 'pb-warn' : undefined,
                  },
                  config.phase === 'error'
                    ? t('unavailableHint')
                    : ready && config.loopback
                      ? t('noLanHint')
                      : t('panelDesc'),
                ),
                qrNode
                  ? h(
                      'div',
                      { className: 'pb-pair' },
                      qrNode,
                      h(
                        'div',
                        { className: 'pb-pair-text' },
                        h('span', { className: 'pb-pair-title' }, t('qrTitle')),
                        h('span', { className: 'pb-note' }, t('qrHint')),
                        h('div', { className: 'pb-url pb-url-compact' }, config.url),
                        h('div', { className: 'pb-actions' }, copyAction, refreshAction),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'pb-fallback' },
                      ready && config.url ? h('div', { className: 'pb-url' }, config.url) : null,
                      h('div', { className: 'pb-actions' }, copyAction, refreshAction),
                    ),
                state.copiedError ? h('div', { className: 'pb-err' }, t('copyFailed')) : null,
                h(
                  'div',
                  { className: 'pb-meta' },
                  h('span', null, `${t('lastReceived')}: ${state.lastAt ? relativeTime(state.lastAt, locale) : t('never')}`),
                  state.error ? h('span', { className: 'pb-err' }, t('injectError')) : null,
                ),
                h('div', { className: 'pb-note' }, t('firewallHint')),
                ),
                document.body,
              )
            : null,
        )
      }

      return PhotoDock
    }

    return {
      inject: ['slots', 'locale', 'conversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'photo-bridge: zh locale')
        ctx.effect(() => ctx.locale.register(NS, 'zh-CN', ZH), 'photo-bridge: zh-CN locale')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'photo-bridge: en locale')
        ctx.effect(() => ctx.locale.register(NS, 'en-US', EN), 'photo-bridge: en-US locale')

        const PhotoDock = createPhotoDock(ctx)
        const PhotoHeadless = (props) => h(PhotoDock, { ...props, variant: 'headless' })
        const PhotoBrand = (props) => h(PhotoDock, { ...props, variant: 'brand' })

        // Normal conversations: the ambient row below the composer.
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'photo-bridge',
              order: 12,
              locale: NS,
            },
            PhotoDock,
          ),
        )

        // Blank New Session: the dock is skipped while the hero is showing. This
        // headless entry only runs the drain/injection loop; the visible trigger
        // is the root-scoped Hero brand mark below.
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register(
            {
              name: 'conversation.hero.options',
              id: 'photo-bridge',
              order: 12,
              locale: NS,
            },
            PhotoHeadless,
          ),
        )

        // Frame-wide Hero seat: no Session is required to pair the phone.
        ctx.slots.inject('conversation.hero.brand.mark', () =>
          ctx.slots.register(
            { name: 'conversation.hero.brand.mark' },
            PhotoBrand,
          ),
        )
      },
    }
  },
})
