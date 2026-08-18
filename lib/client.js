/**
 * dsh-task-done-notify — Client half
 *
 * 页内右下角未读角标条（shell.overlay）。
 *
 * - 每 4s fetch POST /dsh-task-done/poll 拉取未读数 + 最近完成任务列表
 * - unread > 0 时右下角显示小清新卡片 "● N 个任务已完成"
 * - 仅 1 个完成会话时：点击卡片消费该会话并直接跳转（跨工作区自动切换）
 * - 多个完成会话时：点击卡片展开面板（标题 + 相对时间，最多 5 条）逐个消费跳转
 * - 逐个消费：点掉一个只消除该会话的未读，通知条保留显示剩余；剩 1 个时点击直达
 * - 手动切换到任意完成会话 -> 自动消费该会话（轮询检测 current ∈ recent）
 * - 点击其他任意地方 -> 收起面板但保留卡片
 */

window.__ModuleLoader__.load({
  id: 'dsh-task-done-notify',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')

    const CSS_ID = 'dsh-task-done-notify/badge.css'
    const CSS = [
      /* 现代化小清新：白毛玻璃卡片 + 薄荷绿脉冲光点 + 柔和阴影 + 丝滑入场 */
      '.dsh-task-badge {',
      '  position: fixed;',
      '  right: 20px;',
      '  bottom: 20px;',
      '  z-index: 2147483000;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 9px;',
      '  padding: 11px 20px 11px 15px;',
      "  font: 500 13px/1.4 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;",
      '  letter-spacing: 0.2px;',
      '  color: #334155;',
      '  background: linear-gradient(135deg, rgba(255,255,255,0.94), rgba(240,253,250,0.9));',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  border-radius: 14px;',
      '  box-shadow:',
      '    0 8px 28px rgba(15, 40, 70, 0.14),',
      '    0 2px 8px rgba(15, 40, 70, 0.06),',
      '    inset 0 1px 0 rgba(255,255,255,0.95);',
      '  backdrop-filter: blur(14px) saturate(1.5);',
      '  -webkit-backdrop-filter: blur(14px) saturate(1.5);',
      '  cursor: pointer;',
      '  user-select: none;',
      '  pointer-events: auto;',
      '  animation: dshTaskBadgeIn 0.5s cubic-bezier(0.21, 1.02, 0.73, 1) both;',
      '  transition: transform 0.22s ease, box-shadow 0.22s ease;',
      '}',
      '.dsh-task-badge:hover {',
      '  transform: translateY(-2px);',
      '  box-shadow:',
      '    0 12px 34px rgba(15, 40, 70, 0.18),',
      '    0 3px 10px rgba(15, 40, 70, 0.08),',
      '    inset 0 1px 0 rgba(255,255,255,0.95);',
      '}',
      '.dsh-task-badge:active { transform: translateY(0) scale(0.98); }',
      '.dsh-task-badge .dot {',
      '  width: 9px;',
      '  height: 9px;',
      '  border-radius: 50%;',
      '  background: linear-gradient(135deg, #6ee7b7, #10b981);',
      '  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45);',
      '  animation: dshTaskBadgePing 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;',
      '  flex-shrink: 0;',
      '}',
      '.dsh-task-badge .dot.approval {',
      '  background: linear-gradient(135deg, #fcd34d, #f59e0b);',
      '  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.45);',
      '}',
      '.dsh-task-badge .dot.error {',
      '  background: linear-gradient(135deg, #f87171, #ef4444);',
      '  box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);',
      '}',
      '.dsh-task-badge .chev {',
      '  font-size: 9px;',
      '  color: #94a3b8;',
      '  margin-left: 2px;',
      '  transition: transform 0.2s ease;',
      '  flex-shrink: 0;',
      '}',
      '.dsh-task-badge.open .chev { transform: rotate(180deg); }',
      /* 最近完成会话面板 */
      '.dsh-task-pop {',
      '  position: fixed;',
      '  right: 20px;',
      '  bottom: 66px;',
      '  z-index: 2147483000;',
      '  min-width: 260px;',
      '  max-width: 340px;',
      '  max-height: 300px;',
      '  overflow-y: auto;',
      '  background: linear-gradient(160deg, rgba(255,255,255,0.96), rgba(240,253,250,0.94));',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  border-radius: 14px;',
      '  box-shadow:',
      '    0 12px 36px rgba(15, 40, 70, 0.16),',
      '    0 3px 10px rgba(15, 40, 70, 0.07),',
      '    inset 0 1px 0 rgba(255,255,255,0.95);',
      '  backdrop-filter: blur(16px) saturate(1.5);',
      '  -webkit-backdrop-filter: blur(16px) saturate(1.5);',
      '  padding: 6px;',
      '  pointer-events: auto;',
      '  animation: dshTaskPopIn 0.22s cubic-bezier(0.21, 1.02, 0.73, 1) both;',
      '}',
      '.dsh-task-pop .pop-title {',
      '  padding: 8px 10px 6px;',
      '  font-size: 11px;',
      '  color: #94a3b8;',
      '  letter-spacing: 0.3px;',
      '}',
      '.dsh-task-pop-item {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 9px;',
      '  padding: 9px 10px;',
      '  border-radius: 9px;',
      '  cursor: pointer;',
      '  transition: background 0.15s ease;',
      '}',
      '.dsh-task-pop-item:hover { background: rgba(148, 163, 184, 0.14); }',
      '.dsh-task-pop-item .pdot {',
      '  width: 7px;',
      '  height: 7px;',
      '  border-radius: 50%;',
      '  background: linear-gradient(135deg, #6ee7b7, #10b981);',
      '  flex-shrink: 0;',
      '}',
      '.dsh-task-pop-item .pdot.approval {',
      '  background: linear-gradient(135deg, #fcd34d, #f59e0b);',
      '}',
      '.dsh-task-pop-item .pdot.error {',
      '  background: linear-gradient(135deg, #f87171, #ef4444);',
      '}',
      '.dsh-task-pop-item .ptext {',
      '  flex: 1;',
      '  min-width: 0;',
      '  font-size: 13px;',
      '  color: #334155;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '.dsh-task-pop-item .ptime {',
      '  font-size: 10px;',
      '  color: #94a3b8;',
      '  flex-shrink: 0;',
      '}',
      '@keyframes dshTaskPopIn {',
      '  from { opacity: 0; transform: translateY(6px) scale(0.97); }',
      '  to { opacity: 1; transform: translateY(0) scale(1); }',
      '}',
      '@keyframes dshTaskBadgeIn {',
      '  from { opacity: 0; transform: translateY(18px) scale(0.94); }',
      '  to { opacity: 1; transform: translateY(0) scale(1); }',
      '}',
      '@keyframes dshTaskBadgePing {',
      '  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }',
      '  70% { box-shadow: 0 0 0 9px rgba(16, 185, 129, 0); }',
      '  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }',
      '}',
    ].join('\n')

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function post(path) {
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        const envelope = await response.json()
        if (envelope && envelope.ok === true) return envelope.value
      } catch (e) { /* host 未就绪时静默 */ }
      return null
    }

    // ---- 3.2 系统通知：浏览器 Notification API 优先，失败回退 WebAudio 钟声 ----
    /** 浏览器系统通知（右下角弹窗）。返回 true 表示本次已成功弹出系统通知（此时不再叠加 WebAudio）。 */
    function systemNotify(title, body) {
      try {
        const win = typeof window !== 'undefined' ? window : undefined
        if (!win || !win.Notification) return false
        const N = win.Notification
        if (N.permission === 'granted') {
          new N(title || '任务完成', { body: body || '', tag: 'dsh-task-done', silent: false })
          return true
        }
        if (N.permission === 'default') {
          N.requestPermission().then((p) => {
            if (p === 'granted') new N(title || '任务完成', { body: body || '', tag: 'dsh-task-done', silent: false })
          }).catch(() => {})
        }
        return false
      } catch (e) { return false }
    }

    /** WebAudio 钟声（无系统通知权限时回退）：C 大调上行琶音 C5-E5-G5-C6 + 泛音 + shimmer。 */
    function playChime() {
      try {
        const win = typeof window !== 'undefined' ? window : undefined
        if (!win) return
        const Ctor = win.AudioContext || win.webkitAudioContext
        if (!Ctor) return
        if (!playChime.ctx) playChime.ctx = new Ctor()
        const actx = playChime.ctx
        if (actx.state === 'suspended') actx.resume().catch(() => {})
        const now = actx.currentTime
        const notes = [523.25, 659.25, 783.99, 1046.5]
        notes.forEach((freq, i) => {
          const t0 = now + i * 0.09
          const tail = i === notes.length - 1 ? 1.0 : 0.7
          [[1, 0.25], [2, 0.07]].forEach((partial) => {
            const osc = actx.createOscillator()
            const gain = actx.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq * partial[0]
            gain.gain.setValueAtTime(0.0001, t0)
            gain.gain.exponentialRampToValueAtTime(partial[1], t0 + 0.008)
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tail)
            osc.connect(gain)
            gain.connect(actx.destination)
            osc.start(t0)
            osc.stop(t0 + tail + 0.05)
          })
        })
      } catch (e) { /* 提示音失败不影响 */ }
    }

    const inject = ['slots', 'timer', 'sessions', 'workspaces']

    function apply(ctx) {
      ensureCss()
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-task-done-badge' },
        (props) => {
          const [unread, setUnread] = react.useState(0)
          const [errMsg, setErrMsg] = react.useState(null)
          const [popOpen, setPopOpen] = react.useState(false)
          const [recent, setRecent] = react.useState([])
          const unreadRef = react.useRef(0)
          const lastSessionRef = react.useRef(null)
          const recentRef = react.useRef([])
          const notifiedIdsRef = react.useRef(new Set()) // 已弹过系统通知的会话，避免重复弹
          const soundSupportedRef = react.useRef(true)   // 本次会话内是否已探测过 WebAudio 可用
          const channelRef = react.useRef(null)
          const origTitleRef = react.useRef(typeof document !== 'undefined' ? document.title : '')
          const origFaviconRef = react.useRef('')
          const canvasRef = react.useRef(null)

          const updateFaviconAndTitle = (count, recList) => {
            if (typeof document === 'undefined') return
            if (!origTitleRef.current && document.title) origTitleRef.current = document.title
            const recs = Array.isArray(recList) ? recList : []
            const first = recs[0] || null
            const hasErr = recs.some((r) => r && r.kind === 'error')
            const hasAppr = recs.some((r) => r && r.kind === 'approval')

            // 1. Tab 标题动态标记
            if (count > 0 && document.hidden) {
              const prefix = hasErr ? '【出错】' : (hasAppr ? '【待确认】' : '')
              const leadTitle = first && first.title ? first.title : '任务已完成'
              document.title = `(${count}) ${prefix}${leadTitle} - DeepSeek Harness`
            } else if (origTitleRef.current) {
              document.title = origTitleRef.current
            }

            // 2. Favicon 右上角小圆点叠加
            try {
              const link = document.querySelector("link[rel*='icon']") || document.querySelector("link[rel='shortcut icon']")
              if (!link) return
              if (!origFaviconRef.current) origFaviconRef.current = link.href
              if (count <= 0) {
                if (origFaviconRef.current && link.href !== origFaviconRef.current) link.href = origFaviconRef.current
                return
              }
              const img = new Image()
              img.crossOrigin = 'anonymous'
              img.onload = () => {
                try {
                  const canvas = canvasRef.current || document.createElement('canvas')
                  canvasRef.current = canvas
                  canvas.width = 32
                  canvas.height = 32
                  const g = canvas.getContext('2d')
                  g.clearRect(0, 0, 32, 32)
                  g.drawImage(img, 0, 0, 32, 32)
                  g.beginPath()
                  g.arc(24, 8, 6.5, 0, 2 * Math.PI)
                  g.fillStyle = hasErr ? '#ef4444' : (hasAppr ? '#f59e0b' : '#10b981')
                  g.fill()
                  g.lineWidth = 1.5
                  g.strokeStyle = '#ffffff'
                  g.stroke()
                  link.href = canvas.toDataURL('image/png')
                } catch (e) {}
              }
              img.src = origFaviconRef.current
            } catch (e) {}
          }

          // 跨 Tab 广播通道：同步未读状态与已通知会话 ID，避免多 Tab 互相轰炸
          react.useEffect(() => {
            if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
              try {
                const bc = new window.BroadcastChannel('dsh_task_notify_bc')
                channelRef.current = bc
                bc.onmessage = (ev) => {
                  const data = ev && ev.data
                  if (!data || typeof data !== 'object') return
                  if (data.type === 'NOTIFY_FIRED' && Array.isArray(data.ids)) {
                    data.ids.forEach((id) => notifiedIdsRef.current.add(id))
                  } else if (data.type === 'STATE_SYNC') {
                    if (typeof data.unread === 'number') {
                      unreadRef.current = data.unread
                      setUnread(data.unread)
                    }
                    if (Array.isArray(data.recent)) {
                      recentRef.current = data.recent
                      setRecent(data.recent)
                    }
                    if (data.unread <= 0) setPopOpen(false)
                    updateFaviconAndTitle(typeof data.unread === 'number' ? data.unread : 0, data.recent || [])
                  }
                }
              } catch (e) { /* BroadcastChannel 初始化失败兜底 */ }
            }
            return () => {
              if (channelRef.current) {
                try { channelRef.current.close() } catch (e) {}
                channelRef.current = null
              }
            }
          }, [])

          const broadcastState = (u, rec) => {
            if (channelRef.current) {
              try {
                channelRef.current.postMessage({ type: 'STATE_SYNC', unread: u, recent: rec })
              } catch (e) {}
            }
            updateFaviconAndTitle(u, rec)
          }

          const broadcastNotified = (ids) => {
            if (channelRef.current && Array.isArray(ids) && ids.length > 0) {
              try {
                channelRef.current.postMessage({ type: 'NOTIFY_FIRED', ids })
              } catch (e) {}
            }
          }

          react.useEffect(() => {
            let alive = true
            const poll = async () => {
              const r = await post('/dsh-task-done/poll')
              if (alive && r && typeof r.unread === 'number') {
                unreadRef.current = r.unread
                setUnread(r.unread)
                if (typeof r.lastSessionId === 'string' && r.lastSessionId) {
                  lastSessionRef.current = r.lastSessionId
                }
                if (Array.isArray(r.recent)) {
                  recentRef.current = r.recent
                  setRecent(r.recent)
                  // 3.2 系统通知：检测"新增完成会话"（notifiedIds 去重），弹浏览器通知或回退钟声
                  const fresh = r.recent
                    .filter((rec) => rec && typeof rec.sessionId === 'string')
                    .filter((rec) => !notifiedIdsRef.current.has(rec.sessionId + ':' + rec.time))
                  const settings = r.settings || {}
                  const inQuiet = settings.inQuiet === true
                  const allowSystem = settings.system !== false && !inQuiet
                  const allowSound = settings.sound !== false && !inQuiet

                  if (fresh.length > 0) {
                    const shown = fresh.slice(0, 3) // 单次最多通知 3 个，避免轰炸
                    const firedKeys = shown.map((rec) => rec.sessionId + ':' + rec.time)
                    firedKeys.forEach((key) => notifiedIdsRef.current.add(key))
                    broadcastNotified(firedKeys) // 广播给其他 Tab，避免多 Tab 重复发声/弹窗

                    if (settings.enabled !== false) {
                      const titles = shown.map((rec) => {
                        const p = rec.kind === 'error' ? '【出错】' : (rec.kind === 'approval' ? '【待确认】' : '')
                        return p + String(rec.title || '任务已完成')
                      }).filter(Boolean)
                      const title = shown.length === 1 ? titles[0] : shown.length + ' 个任务已处理'
                      const body = titles.length > 1 ? titles.slice(0, 2).join('、') : ''
                      let usedOs = false
                      if (allowSystem) {
                        usedOs = systemNotify(title, body)
                      }
                      if (!usedOs && allowSound) {
                        playChime() // 无系统通知权限/失败 → 回退 WebAudio 钟声
                      }
                    }
                  }
                }
                broadcastState(r.unread, r.recent || [])
              }
              // 手动切换到了某个"完成会话"→ 消费那一个（只消除该会话的未读，其他保留）
              if (alive && unreadRef.current > 0) {
                try {
                  const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot
                    ? ctx.sessions.list.getSnapshot()
                    : null
                  const cur = snap && snap.current
                  if (cur && recentRef.current.some((rec) => rec.sessionId === cur)) {
                    consumeSession(cur)
                  }
                } catch (e) { /* 会话列表未就绪时跳过 */ }
              }
            }
            poll()
            const iv = ctx.timer.interval(poll, 4000)

            // 页面可见性与焦点自适应：切回前台时立即主动 poll 一次并恢复 Tab 标题
            const onFocusOrVisible = () => {
              if (alive && typeof document !== 'undefined') {
                if (!document.hidden && origTitleRef.current) {
                  document.title = origTitleRef.current
                }
                if (!document.hidden) {
                  poll()
                }
              }
            }
            if (typeof window !== 'undefined') {
              window.addEventListener('focus', onFocusOrVisible)
              document.addEventListener('visibilitychange', onFocusOrVisible)
            }

            return () => {
              alive = false
              iv()
              if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onFocusOrVisible)
                document.removeEventListener('visibilitychange', onFocusOrVisible)
              }
            }
          }, [])
          // 消费单个完成会话：通知 host 端移除该会话并扣减 unread，用响应更新本地状态。
          // 不触发全部清除——通知条保留，显示剩余未读数。
          const consumeSession = (sid) => {
            fetch('/dsh-task-done/consume', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: sid }),
            }).then((resp) => resp.json()).then((envelope) => {
              if (!envelope || envelope.ok !== true || !envelope.value) return
              const v = envelope.value
              if (typeof v.unread === 'number') {
                unreadRef.current = v.unread
                setUnread(v.unread)
              }
              if (Array.isArray(v.recent)) {
                recentRef.current = v.recent
                setRecent(v.recent)
              }
              if (v.unread <= 0) setPopOpen(false)
              broadcastState(typeof v.unread === 'number' ? v.unread : 0, v.recent || [])
            }).catch(() => {})
          }
          // 统一清除入口：全部清除（清零未读 + 清空队列）。
          const clearBadge = () => {
            setPopOpen(false)
            if (unreadRef.current <= 0) return
            unreadRef.current = 0
            setUnread(0)
            broadcastState(0, [])
            post('/dsh-task-done/clear').then((r) => {
              if (r && typeof r.unread === 'number' && r.unread > 0) {
                unreadRef.current = r.unread
                setUnread(r.unread)
              }
              if (r && Array.isArray(r.recent)) {
                recentRef.current = r.recent
                setRecent(r.recent)
              }
              broadcastState(r && typeof r.unread === 'number' ? r.unread : 0, r && Array.isArray(r.recent) ? r.recent : [])
            }).catch(() => {})
          }
          // 失败诊断：短暂显示在角标上（3s 后消失），便于排查跳转问题。
          const flashErr = (text) => {
            setErrMsg(text)
            setTimeout(() => setErrMsg(null), 3000)
          }
          // 尝试打开会话；跨工作区时先切 workspace 再打开。
          // select() 要求 sid 在当前 workspace 的已加载摘要里，否则抛 unknown session。
          const openWithFallback = (sid) => {
            try {
              const p = ctx.sessions.open(sid)
              if (p && typeof p.catch === 'function') p.catch((e) => flashErr(String(e && e.message || e)))
              return
            } catch (e) {
              // 跨工作区：找 sid 所在 workspace，切过去再试
              try {
                const wsList = ctx.workspaces && ctx.workspaces.list && ctx.workspaces.list.getSnapshot
                  ? ctx.workspaces.list.getSnapshot().items || []
                  : []
                const w = wsList.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sid))
                if (w && ctx.workspaces && typeof ctx.workspaces.startSession === 'function') {
                  ctx.workspaces.startSession(w.workspaceId)
                  setTimeout(() => {
                    try { ctx.sessions.open(sid) } catch (e2) { flashErr('切换工作区后仍打不开: ' + String(e2 && e2.message || e2)) }
                  }, 600)
                  return
                }
                flashErr('找不到该会话的工作区: ' + String(e && e.message || e))
              } catch (e3) {
                flashErr('跳转失败: ' + String(e3 && e3.message || e3))
              }
            }
          }
          const fmtTime = (t) => {
            try {
              const d = new Date(t)
              const now = Date.now()
              const diff = now - t
              if (diff < 60000) return '刚刚'
              if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
              return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            } catch (e) { return '' }
          }
          // 点击处理（原生捕获阶段）：
          // - 点通知条 -> 仅 1 个完成会话：消费并直接跳转；多个：展开/收起面板
          // - 点面板项 -> 消费该会话 + 跳转（通知条保留，显示剩余）
          // - 点面板空白 -> 保持
          // - 点其他任意地方 -> 收起面板（保留通知条）
          const handleDocClick = (e) => {
            const target = e && e.target
            const closest = (sel) => {
              try { return target && typeof target.closest === 'function' ? target.closest(sel) : null } catch (err) { return null }
            }
            const isBadge = closest('.dsh-task-badge') !== null
            const isPopItem = closest('.dsh-task-pop-item')
            const isPop = closest('.dsh-task-pop') !== null
            if (isBadge) {
              // 去重后的完成会话数：<=1 时无选择余地，点击直达；>1 时展开面板选择
              const count = recentRef.current.length
              if (count <= 1) {
                const sid = lastSessionRef.current
                if (sid) {
                  consumeSession(sid) // 消费（unread 归零 → 通知条消失）
                  openWithFallback(sid)
                } else {
                  flashErr('暂无会话记录')
                }
              } else {
                setPopOpen((v) => !v)
              }
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (isPopItem) {
              const sid = isPopItem.getAttribute('data-sid')
              if (sid) {
                consumeSession(sid) // 只消费这一个，通知条保留显示剩余
                openWithFallback(sid)
              } else {
                flashErr('会话 id 缺失')
              }
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (isPop) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            setPopOpen(false) // 点外部：仅收起面板
          }
          // 点击处理：通知条挂 document 捕获监听
          react.useEffect(() => {
            document.addEventListener('click', handleDocClick, true)
            return () => document.removeEventListener('click', handleDocClick, true)
          }, [])
          if (unread <= 0 && !errMsg) return null
          if (unread <= 0) {
            // 仅诊断消息时显示一个小提示（不带圆点）
            return react.createElement(
              'div',
              { className: 'dsh-task-badge', style: { background: 'rgba(220,60,60,.92)' }, onClick: () => setErrMsg(null) },
              errMsg,
            )
          }
          // 主通知条 + 面板
          const hasError = recent.some((r) => r && r.kind === 'error')
          const hasApproval = recent.some((r) => r && r.kind === 'approval')
          const dotClass = 'dot' + (hasError ? ' error' : (hasApproval ? ' approval' : ''))

          let badgeLabel = String(unread) + ' 个任务已处理'
          if (unread === 1 && recent[0]) {
            if (recent[0].kind === 'error') badgeLabel = '1 个任务执行出错'
            else if (recent[0].kind === 'approval') badgeLabel = '1 个任务等待确认'
            else badgeLabel = '1 个任务已完成'
          } else if (!hasError && !hasApproval) {
            badgeLabel = String(unread) + ' 个任务已完成'
          }

          const badge = react.createElement(
            'div',
            {
              className: 'dsh-task-badge' + (popOpen ? ' open' : ''),
              title: recentRef.current.length > 1 ? '点击展开最近处理的任务，选择跳转' : '点击跳转到该会话；手动切换过去也会消失',
            },
            react.createElement('span', { className: dotClass }),
            errMsg ? errMsg : badgeLabel,
            react.createElement('span', { className: 'chev' }, '▾'),
          )
          const pop = popOpen && recent.length > 0
            ? react.createElement(
                'div',
                { className: 'dsh-task-pop' },
                react.createElement('div', { className: 'pop-title' }, '最近处理的任务'),
                ...recent.map((r) => {
                  const pdotClass = 'pdot' + (r && r.kind === 'error' ? ' error' : (r && r.kind === 'approval' ? ' approval' : ''))
                  let itemLabel = r.title || '任务已完成'
                  if (r && r.kind === 'error') itemLabel = '【出错】' + itemLabel
                  else if (r && r.kind === 'approval') itemLabel = '【待确认】' + itemLabel
                  return react.createElement(
                    'div',
                    { key: r.sessionId, className: 'dsh-task-pop-item', 'data-sid': r.sessionId },
                    react.createElement('span', { className: pdotClass }),
                    react.createElement('span', { className: 'ptext' }, itemLabel),
                    react.createElement('span', { className: 'ptime' }, fmtTime(r.time)),
                  )
                }),
              )
            : null
          return react.createElement(react.Fragment, null, pop, badge)
        },
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
