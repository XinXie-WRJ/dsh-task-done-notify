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
      '@keyframes dshTaskBadgeOut {',
      '  0% {',
      '    opacity: 1;',
      '    transform: translateY(0) scale(1);',
      '    filter: blur(0px);',
      '  }',
      '  100% {',
      '    opacity: 0;',
      '    transform: translateY(22px) scale(0.9);',
      '    filter: blur(4px);',
      '  }',
      '}',
      '@keyframes dshTaskPopOut {',
      '  0% {',
      '    opacity: 1;',
      '    transform: translateY(0) scale(1);',
      '    filter: blur(0px);',
      '  }',
      '  100% {',
      '    opacity: 0;',
      '    transform: translateY(12px) scale(0.94);',
      '    filter: blur(4px);',
      '  }',
      '}',
      '.dsh-task-badge.exiting {',
      '  animation: dshTaskBadgeOut 0.35s cubic-bezier(0.32, 0.72, 0, 1) both !important;',
      '  pointer-events: none !important;',
      '}',
      '.dsh-task-pop.exiting {',
      '  animation: dshTaskPopOut 0.28s cubic-bezier(0.32, 0.72, 0, 1) both !important;',
      '  pointer-events: none !important;',
      '}',
      /* ---- 深色模式自适应规则 (Dark Mode Adaptive) ---- */
      '.dark .dsh-task-badge,',
      "[data-theme='dark'] .dsh-task-badge,",
      "[data-color-mode='dark'] .dsh-task-badge {",
      '  color: #f1f5f9;',
      '  background: linear-gradient(135deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.94));',
      '  border-color: rgba(255, 255, 255, 0.14);',
      '  box-shadow:',
      '    0 10px 30px rgba(0, 0, 0, 0.5),',
      '    0 2px 8px rgba(0, 0, 0, 0.3),',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.12);',
      '}',
      '.dark .dsh-task-badge:hover,',
      "[data-theme='dark'] .dsh-task-badge:hover,",
      "[data-color-mode='dark'] .dsh-task-badge:hover {",
      '  box-shadow:',
      '    0 14px 36px rgba(0, 0, 0, 0.6),',
      '    0 3px 10px rgba(0, 0, 0, 0.4),',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.18);',
      '}',
      '.dark .dsh-task-badge .chev,',
      "[data-theme='dark'] .dsh-task-badge .chev,",
      "[data-color-mode='dark'] .dsh-task-badge .chev {",
      '  color: #64748b;',
      '}',
      '.dark .dsh-task-pop,',
      "[data-theme='dark'] .dsh-task-pop,",
      "[data-color-mode='dark'] .dsh-task-pop {",
      '  background: linear-gradient(160deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.98));',
      '  border-color: rgba(255, 255, 255, 0.14);',
      '  box-shadow:',
      '    0 14px 40px rgba(0, 0, 0, 0.55),',
      '    0 4px 12px rgba(0, 0, 0, 0.35),',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.12);',
      '}',
      '.dark .dsh-task-pop .pop-title,',
      "[data-theme='dark'] .dsh-task-pop .pop-title,",
      "[data-color-mode='dark'] .dsh-task-pop .pop-title {",
      '  color: #64748b;',
      '}',
      '.dark .dsh-task-pop-item:hover,',
      "[data-theme='dark'] .dsh-task-pop-item:hover,",
      "[data-color-mode='dark'] .dsh-task-pop-item:hover {",
      '  background: rgba(255, 255, 255, 0.08);',
      '}',
      '.dark .dsh-task-pop-item .ptext,',
      "[data-theme='dark'] .dsh-task-pop-item .ptext,",
      "[data-color-mode='dark'] .dsh-task-pop-item .ptext {",
      '  color: #f1f5f9;',
      '}',
      '.dark .dsh-task-pop-item .ptime,',
      "[data-theme='dark'] .dsh-task-pop-item .ptime,",
      "[data-color-mode='dark'] .dsh-task-pop-item .ptime {",
      '  color: #64748b;',
      '}',
      /* 跟随系统深色主题 (@media prefers-color-scheme: dark) */
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-badge {",
      '    color: #f1f5f9;',
      '    background: linear-gradient(135deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.94));',
      '    border-color: rgba(255, 255, 255, 0.14);',
      '    box-shadow:',
      '      0 10px 30px rgba(0, 0, 0, 0.5),',
      '      0 2px 8px rgba(0, 0, 0, 0.3),',
      '      inset 0 1px 0 rgba(255, 255, 255, 0.12);',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-badge:hover {",
      '    box-shadow:',
      '      0 14px 36px rgba(0, 0, 0, 0.6),',
      '      0 3px 10px rgba(0, 0, 0, 0.4),',
      '      inset 0 1px 0 rgba(255, 255, 255, 0.18);',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-badge .chev {",
      '    color: #64748b;',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-pop {",
      '    background: linear-gradient(160deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.98));',
      '    border-color: rgba(255, 255, 255, 0.14);',
      '    box-shadow:',
      '      0 14px 40px rgba(0, 0, 0, 0.55),',
      '      0 4px 12px rgba(0, 0, 0, 0.35),',
      '      inset 0 1px 0 rgba(255, 255, 255, 0.12);',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-pop .pop-title {",
      '    color: #64748b;',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-pop-item:hover {",
      '    background: rgba(255, 255, 255, 0.08);',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-pop-item .ptext {",
      '    color: #f1f5f9;',
      '  }',
      "  :root:not([data-theme='light']):not(.light) .dsh-task-pop-item .ptime {",
      '    color: #64748b;',
      '  }',
      '}',
      /* ---- 设置面板样式 (Settings Section Styles) ---- */
      '.dsh-notify-settings {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 16px;',
      '  max-width: 820px;',
      '  padding: 4px 4px 40px;',
      '  color: #334155;',
      "  font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;",
      '}',
      '.dark .dsh-notify-settings,',
      "[data-theme='dark'] .dsh-notify-settings,",
      "[data-color-mode='dark'] .dsh-notify-settings,",
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']):not(.light) .dsh-notify-settings {",
      '    color: #f1f5f9;',
      '  }',
      '}',
      '.dsh-notify-header h2 {',
      '  font-size: 20px;',
      '  font-weight: 650;',
      '  margin: 0 0 4px;',
      '  letter-spacing: -0.02em;',
      '}',
      '.dsh-notify-header p {',
      '  margin: 0;',
      '  font-size: 13px;',
      '  color: #64748b;',
      '  line-height: 1.5;',
      '}',
      '.dsh-notify-card {',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  border-radius: 14px;',
      '  background: rgba(255, 255, 255, 0.7);',
      '  backdrop-filter: blur(14px);',
      '  padding: 16px 18px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 14px;',
      '  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);',
      '}',
      '.dark .dsh-notify-card,',
      "[data-theme='dark'] .dsh-notify-card,",
      "[data-color-mode='dark'] .dsh-notify-card,",
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']):not(.light) .dsh-notify-card {",
      '    background: rgba(30, 41, 59, 0.6);',
      '    border-color: rgba(255, 255, 255, 0.12);',
      '  }',
      '}',
      '.dsh-notify-card-title {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  font-size: 14.5px;',
      '  font-weight: 600;',
      '}',
      '.dsh-notify-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 16px;',
      '}',
      '.dsh-notify-row-info {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 2px;',
      '  flex: 1;',
      '}',
      '.dsh-notify-row-label {',
      '  font-size: 13.5px;',
      '  font-weight: 550;',
      '}',
      '.dsh-notify-row-desc {',
      '  font-size: 12px;',
      '  color: #64748b;',
      '  line-height: 1.4;',
      '}',
      '.dsh-notify-controls {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '}',
      /* Switch */
      '.dsh-notify-switch {',
      '  position: relative;',
      '  display: inline-block;',
      '  width: 44px;',
      '  height: 24px;',
      '  flex-shrink: 0;',
      '}',
      '.dsh-notify-switch input {',
      '  opacity: 0;',
      '  width: 0;',
      '  height: 0;',
      '}',
      '.dsh-notify-slider {',
      '  position: absolute;',
      '  cursor: pointer;',
      '  top: 0; left: 0; right: 0; bottom: 0;',
      '  background-color: #cbd5e1;',
      '  transition: .24s ease;',
      '  border-radius: 24px;',
      '}',
      '.dsh-notify-slider:before {',
      '  position: absolute;',
      '  content: "";',
      '  height: 18px;',
      '  width: 18px;',
      '  left: 3px;',
      '  bottom: 3px;',
      '  background-color: white;',
      '  transition: .24s ease;',
      '  border-radius: 50%;',
      '  box-shadow: 0 1px 4px rgba(0,0,0,0.2);',
      '}',
      '.dsh-notify-switch input:checked + .dsh-notify-slider {',
      '  background-color: #10b981;',
      '}',
      '.dsh-notify-switch input:checked + .dsh-notify-slider:before {',
      '  transform: translateX(20px);',
      '}',
      /* Select & Input */
      '.dsh-notify-select, .dsh-notify-input {',
      '  padding: 6px 10px;',
      '  border-radius: 8px;',
      '  border: 1px solid rgba(148, 163, 184, 0.3);',
      '  background: rgba(255, 255, 255, 0.9);',
      '  font-size: 13px;',
      '  color: inherit;',
      '  outline: none;',
      '  font-family: inherit;',
      '}',
      '.dark .dsh-notify-select, .dark .dsh-notify-input,',
      "[data-theme='dark'] .dsh-notify-select, [data-theme='dark'] .dsh-notify-input,",
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']):not(.light) .dsh-notify-select,",
      "  :root:not([data-theme='light']):not(.light) .dsh-notify-input {",
      '    background: rgba(15, 23, 42, 0.7);',
      '    border-color: rgba(255, 255, 255, 0.15);',
      '    color: #f1f5f9;',
      '  }',
      '}',
      /* Range & Button */
      '.dsh-notify-range {',
      '  width: 120px;',
      '  accent-color: #10b981;',
      '  cursor: pointer;',
      '}',
      '.dsh-notify-btn {',
      '  padding: 6px 14px;',
      '  border-radius: 8px;',
      '  font-size: 12.5px;',
      '  font-weight: 500;',
      '  cursor: pointer;',
      '  transition: all 0.2s ease;',
      '  border: 1px solid rgba(148, 163, 184, 0.3);',
      '  background: rgba(255, 255, 255, 0.9);',
      '  color: inherit;',
      '}',
      '.dsh-notify-btn.primary {',
      '  background: linear-gradient(135deg, #10b981, #059669);',
      '  color: #ffffff;',
      '  border: none;',
      '  font-weight: 600;',
      '}',
      '.dsh-notify-btn:hover { filter: brightness(1.05); }',
      '.dsh-notify-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.dsh-notify-toast {',
      '  padding: 9px 14px;',
      '  border-radius: 8px;',
      '  font-size: 13px;',
      '  background: rgba(16, 185, 129, 0.12);',
      '  color: #10b981;',
      '  border: 1px solid rgba(16, 185, 129, 0.3);',
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

    async function post(path, bodyObj = {}) {
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyObj),
        })
        const envelope = await response.json()
        if (envelope && envelope.ok === true) return envelope.value
      } catch (e) { /* host 未就绪时静默 */ }
      return null
    }

    /** 浏览器系统通知（右下角弹窗）。返回 true 表示本次已成功弹出系统通知。 */
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

    /** 多预设 WebAudio 合成音效引擎（支持晶莹水滴、治愈和弦、柔和舒缓、科技脉冲 + 音量调节）。 */
    function playCustomChime(type = 'crystal', volumePercent = 80) {
      try {
        const win = typeof window !== 'undefined' ? window : undefined
        if (!win) return false
        const Ctor = win.AudioContext || win.webkitAudioContext
        if (!Ctor) return false
        const actx = new Ctor()
        if (actx.state === 'suspended') actx.resume().catch(() => {})
        const now = actx.currentTime
        const masterGain = actx.createGain()
        const vol = Math.max(0, Math.min(1, (typeof volumePercent === 'number' ? volumePercent : 80) / 100))
        masterGain.gain.setValueAtTime(vol * 0.28, now)
        masterGain.connect(actx.destination)

        if (type === 'chord') {
          // 🎵 治愈上升三和弦 (C5 -> E5 -> G5)
          const freqs = [523.25, 659.25, 783.99]
          freqs.forEach((freq, i) => {
            const osc = actx.createOscillator()
            const g = actx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + i * 0.08)
            g.gain.setValueAtTime(0.0001, now + i * 0.08)
            g.gain.linearRampToValueAtTime(0.8, now + i * 0.08 + 0.02)
            g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.45)
            osc.connect(g)
            g.connect(masterGain)
            osc.start(now + i * 0.08)
            osc.stop(now + i * 0.08 + 0.5)
          })
          setTimeout(() => { actx.close().catch(() => {}) }, 800)
          return true
        }

        if (type === 'gentle') {
          // 🍃 柔和舒缓双音 (D5 -> A4)
          const freqs = [587.33, 440.00]
          freqs.forEach((freq, i) => {
            const osc = actx.createOscillator()
            const g = actx.createGain()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(freq, now + i * 0.12)
            g.gain.setValueAtTime(0.0001, now + i * 0.12)
            g.gain.linearRampToValueAtTime(0.7, now + i * 0.12 + 0.03)
            g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.5)
            osc.connect(g)
            g.connect(masterGain)
            osc.start(now + i * 0.12)
            osc.stop(now + i * 0.12 + 0.55)
          })
          setTimeout(() => { actx.close().catch(() => {}) }, 850)
          return true
        }

        if (type === 'cyber') {
          // ⚡ 科技未来脉冲
          const freqs = [440, 880, 1320]
          freqs.forEach((freq, i) => {
            const osc = actx.createOscillator()
            const g = actx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq * 0.8, now + i * 0.06)
            osc.frequency.exponentialRampToValueAtTime(freq, now + i * 0.06 + 0.04)
            g.gain.setValueAtTime(0.0001, now + i * 0.06)
            g.gain.linearRampToValueAtTime(0.6, now + i * 0.06 + 0.02)
            g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.3)
            osc.connect(g)
            g.connect(masterGain)
            osc.start(now + i * 0.06)
            osc.stop(now + i * 0.06 + 0.35)
          })
          setTimeout(() => { actx.close().catch(() => {}) }, 650)
          return true
        }

        // 默认: 💎 crystal 晶莹水滴双音 (440Hz -> 880Hz)
        const o1 = actx.createOscillator()
        const o2 = actx.createOscillator()
        const g1 = actx.createGain()
        const g2 = actx.createGain()

        o1.type = 'sine'
        o1.frequency.setValueAtTime(440, now)
        g1.gain.setValueAtTime(0.6, now)
        g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
        o1.connect(g1)
        g1.connect(masterGain)
        o1.start(now)
        o1.stop(now + 0.4)

        o2.type = 'sine'
        o2.frequency.setValueAtTime(880, now + 0.1)
        g2.gain.setValueAtTime(0.0001, now)
        g2.gain.setValueAtTime(0.8, now + 0.1)
        g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
        o2.connect(g2)
        g2.connect(masterGain)
        o2.start(now + 0.1)
        o2.stop(now + 0.55)

        setTimeout(() => { actx.close().catch(() => {}) }, 700)
        return true
      } catch (e) { return false }
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
          const [exiting, setExiting] = react.useState(false)
          const exitTimerRef = react.useRef(null)
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
              if (!alive || !r || typeof r.unread !== 'number') return

              let rawUnread = r.unread
              let rawRecent = Array.isArray(r.recent) ? r.recent : []
              const settings = r.settings || {}
              const inQuiet = settings.inQuiet === true
              const allowSystem = settings.system !== false && !inQuiet
              const allowSound = settings.sound !== false && !inQuiet

              // 检查当前前台聚焦与活跃会话
              let cur = null
              try {
                const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot
                  ? ctx.sessions.list.getSnapshot()
                  : null
                cur = snap && snap.current
              } catch (e) {}

              const isForegroundFocused = typeof document !== 'undefined' && !document.hidden && typeof document.hasFocus === 'function' && document.hasFocus()

              // 🌟 核心优化：若用户当前正前台聚焦在当前会话（看着 AI 回答结束），静默直消已读，0ms 拦截，绝对不弹角标、零闪烁
              if (isForegroundFocused && cur && rawRecent.some((rec) => rec.sessionId === cur)) {
                const curMatches = rawRecent.filter((rec) => rec.sessionId === cur)
                // 标记为已通知，避免重复发声
                curMatches.forEach((rec) => notifiedIdsRef.current.add(rec.sessionId + ':' + rec.time))
                // 后台静默发送已读消费给 Host
                fetch('/dsh-task-done/consume', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId: cur }),
                }).catch(() => {})

                // 前端过滤掉当前会话的未读，只保留其他后台会话
                const curSub = curMatches.reduce((acc, it) => acc + (it.count || 1), 0)
                rawUnread = Math.max(0, rawUnread - curSub)
                rawRecent = rawRecent.filter((rec) => rec.sessionId !== cur)
              }

              // 同步有效状态至 React
              unreadRef.current = rawUnread
              setUnread(rawUnread)
              recentRef.current = rawRecent
              setRecent(rawRecent)
              if (typeof r.lastSessionId === 'string' && r.lastSessionId) {
                lastSessionRef.current = r.lastSessionId
              }

              // 跨会话/后台任务完成提示（仅对未被静默直消的后台任务生效）
              if (rawRecent.length > 0) {
                const fresh = rawRecent
                  .filter((rec) => rec && typeof rec.sessionId === 'string')
                  .filter((rec) => !notifiedIdsRef.current.has(rec.sessionId + ':' + rec.time))

                if (fresh.length > 0) {
                  const shown = fresh.slice(0, 3)
                  const firedKeys = shown.map((rec) => rec.sessionId + ':' + rec.time)
                  firedKeys.forEach((key) => notifiedIdsRef.current.add(key))
                  broadcastNotified(firedKeys)

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
                      playCustomChime(settings.soundType || 'crystal', typeof settings.volume === 'number' ? settings.volume : 80)
                    }
                  }
                }
              }

              broadcastState(rawUnread, rawRecent)

              // 场景 C：用户之前在其他页面，角标已展示，此时主动点击切换进目标会话 → 播放 350ms 优雅淡出动效
              if (alive && unreadRef.current > 0 && cur && recentRef.current.some((rec) => rec.sessionId === cur)) {
                consumeSession(cur)
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
          // 消费单个完成会话：即刻本地乐观响应 + 350ms 丝滑毛玻璃退场
          const consumeSession = (sid) => {
            const curRecent = recentRef.current || []
            const target = curRecent.find((r) => r && r.sessionId === sid)
            const subCount = target && target.count ? target.count : 1
            const nextRecent = curRecent.filter((r) => r && r.sessionId !== sid)
            const nextUnread = Math.max(0, unreadRef.current - subCount)

            // 本地即时乐观响应
            if (nextUnread <= 0 || nextRecent.length === 0) {
              setExiting(true)
              setPopOpen(false)
              if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
              exitTimerRef.current = setTimeout(() => {
                setExiting(false)
                unreadRef.current = 0
                setUnread(0)
                recentRef.current = []
                setRecent([])
                broadcastState(0, [])
              }, 360)
            } else {
              unreadRef.current = nextUnread
              setUnread(nextUnread)
              recentRef.current = nextRecent
              setRecent(nextRecent)
              broadcastState(nextUnread, nextRecent)
            }

            // 后台异步同步 Host 任务栏
            fetch('/dsh-task-done/consume', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: sid }),
            }).then((resp) => resp.json()).then((envelope) => {
              if (!envelope || envelope.ok !== true || !envelope.value) return
              const v = envelope.value
              if (typeof v.unread === 'number' && v.unread > 0 && !exiting) {
                unreadRef.current = v.unread
                setUnread(v.unread)
              }
              if (Array.isArray(v.recent) && v.recent.length > 0 && !exiting) {
                recentRef.current = v.recent
                setRecent(v.recent)
              }
            }).catch(() => {})
          }

          // 统一清除入口：全部清除（350ms 即刻退场动效）
          const clearBadge = () => {
            setPopOpen(false)
            if (unreadRef.current <= 0 && !exiting) return
            setExiting(true)
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
            exitTimerRef.current = setTimeout(() => {
              setExiting(false)
              unreadRef.current = 0
              setUnread(0)
              recentRef.current = []
              setRecent([])
              broadcastState(0, [])
            }, 360)
            post('/dsh-task-done/clear').catch(() => {})
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
              const count = recentRef.current.length
              if (count <= 1) {
                const sid = lastSessionRef.current || (recentRef.current[0] && recentRef.current[0].sessionId)
                if (sid) {
                  consumeSession(sid) // 0ms 启动 350ms 丝滑退场动效
                  // 稍微延后 80ms 切会话，让浏览器合成器丝滑起跑退场动画，不被切会话的主线程重绘阻塞
                  setTimeout(() => openWithFallback(sid), 80)
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
                consumeSession(sid)
                setTimeout(() => openWithFallback(sid), 80)
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
          if (unread <= 0 && !errMsg && !exiting) return null
          if (unread <= 0 && !exiting) {
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
              className: 'dsh-task-badge' + (popOpen ? ' open' : '') + (exiting ? ' exiting' : ''),
              title: recentRef.current.length > 1 ? '点击展开最近处理的任务，选择跳转' : '点击跳转到该会话；手动切换过去也会消失',
            },
            react.createElement('span', { className: dotClass }),
            errMsg ? errMsg : badgeLabel,
            react.createElement('span', { className: 'chev' }, '▾'),
          )
          // 仅当 popOpen 为 true 时才渲染 pop，彻底防止未展开时退场误弹出列表方框
          const pop = popOpen && recent.length > 0
            ? react.createElement(
                'div',
                { className: 'dsh-task-pop' + (exiting ? ' exiting' : '') },
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

      // ---- 独立设置面板 (DSH Settings Section) ----
      function TaskDoneNotifySettingsSection() {
        const [settings, setSettings] = react.useState({
          enabled: true,
          sound: true,
          soundType: 'crystal',
          volume: 80,
          system: true,
          quietHours: '',
        })
        const [loading, setLoading] = react.useState(true)
        const [saving, setSaving] = react.useState(false)
        const [savedToast, setSavedToast] = react.useState(false)
        const toastTimerRef = react.useRef(null)

        react.useEffect(() => {
          let alive = true
          post('/dsh-task-done/settings').then((val) => {
            if (alive && val && typeof val === 'object') {
              setSettings((prev) => ({ ...prev, ...val }))
              setLoading(false)
            }
          }).catch(() => { setLoading(false) })
          return () => { alive = false }
        }, [])

        const update = (key, val) => {
          setSettings((prev) => ({ ...prev, [key]: val }))
        }

        const save = () => {
          setSaving(true)
          post('/dsh-task-done/settings', settings).then((val) => {
            setSaving(false)
            if (val && typeof val === 'object') setSettings((prev) => ({ ...prev, ...val }))
            setSavedToast(true)
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
            toastTimerRef.current = setTimeout(() => setSavedToast(false), 3000)
          }).catch(() => { setSaving(false) })
        }

        const testSound = () => {
          playCustomChime(settings.soundType || 'crystal', settings.volume)
        }

        const testWindowsToast = () => {
          post('/dsh-task-done/test-notify').catch(() => {})
        }

        return react.createElement(
          'div',
          { className: 'dsh-notify-settings' },
          react.createElement(
            'div',
            { className: 'dsh-notify-header' },
            react.createElement('h2', null, '任务完成通知配置'),
            react.createElement('p', null, '自定义 Agent 任务处理结束后的声音提示、Windows 系统弹窗、勿扰时段与交互行为。'),
          ),
          savedToast ? react.createElement('div', { className: 'dsh-notify-toast' }, '✓ 配置已保存并在所有标签页实时生效！') : null,
          // 卡片 1: 核心开关
          react.createElement(
            'div',
            { className: 'dsh-notify-card' },
            react.createElement('div', { className: 'dsh-notify-card-title' }, '🔔 基础通知与弹窗'),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, '启用任务完成通知'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '总开关：控制是否感知任务结束并展示通知与角标'),
              ),
              react.createElement(
                'label',
                { className: 'dsh-notify-switch' },
                react.createElement('input', {
                  type: 'checkbox',
                  checked: settings.enabled !== false,
                  onChange: (e) => update('enabled', e.target.checked),
                }),
                react.createElement('span', { className: 'dsh-notify-slider' }),
              ),
            ),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, 'Windows 原生 Toast 弹窗'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '任务完成时，通过 Windows 通知中心在桌面右下角弹出横幅通知与摘要'),
              ),
              react.createElement(
                'div',
                { className: 'dsh-notify-controls' },
                react.createElement(
                  'button',
                  { className: 'dsh-notify-btn', onClick: testWindowsToast, title: '向 Windows 投递一条测试 Toast' },
                  '🪟 测试弹窗',
                ),
                react.createElement(
                  'label',
                  { className: 'dsh-notify-switch' },
                  react.createElement('input', {
                    type: 'checkbox',
                    checked: settings.system !== false,
                    onChange: (e) => update('system', e.target.checked),
                  }),
                  react.createElement('span', { className: 'dsh-notify-slider' }),
                ),
              ),
            ),
          ),
          // 卡片 2: 声音与音效
          react.createElement(
            'div',
            { className: 'dsh-notify-card' },
            react.createElement('div', { className: 'dsh-notify-card-title' }, '🔊 提示音效与音量'),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, '声音提示'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '任务完成时播放 WebAudio 专属合成音效'),
              ),
              react.createElement(
                'label',
                { className: 'dsh-notify-switch' },
                react.createElement('input', {
                  type: 'checkbox',
                  checked: settings.sound !== false,
                  onChange: (e) => update('sound', e.target.checked),
                }),
                react.createElement('span', { className: 'dsh-notify-slider' }),
              ),
            ),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, '音效类型'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '选择您喜欢的声音风格预设'),
              ),
              react.createElement(
                'div',
                { className: 'dsh-notify-controls' },
                react.createElement(
                  'select',
                  {
                    className: 'dsh-notify-select',
                    value: settings.soundType || 'crystal',
                    onChange: (e) => update('soundType', e.target.value),
                  },
                  react.createElement('option', { value: 'crystal' }, '💎 晶莹水滴 (默认)'),
                  react.createElement('option', { value: 'chord' }, '🎵 治愈和弦 (Do-Mi-Sol)'),
                  react.createElement('option', { value: 'gentle' }, '🍃 柔和舒缓 (低调双音)'),
                  react.createElement('option', { value: 'cyber' }, '⚡ 科技未来 (脉冲扫频)'),
                ),
                react.createElement(
                  'button',
                  { className: 'dsh-notify-btn', onClick: testSound, title: '按当前音量试听选中的音效' },
                  '▶ 试听',
                ),
              ),
            ),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, '提示音量 (' + (typeof settings.volume === 'number' ? settings.volume : 80) + '%)'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '调整合成提示音的输出响度大小'),
              ),
              react.createElement(
                'div',
                { className: 'dsh-notify-controls' },
                react.createElement('input', {
                  type: 'range',
                  className: 'dsh-notify-range',
                  min: 0,
                  max: 100,
                  step: 5,
                  value: typeof settings.volume === 'number' ? settings.volume : 80,
                  onChange: (e) => update('volume', parseInt(e.target.value, 10)),
                }),
              ),
            ),
          ),
          // 卡片 3: 勿扰时段
          react.createElement(
            'div',
            { className: 'dsh-notify-card' },
            react.createElement('div', { className: 'dsh-notify-card-title' }, '🌙 勿扰时段 (Quiet Hours)'),
            react.createElement(
              'div',
              { className: 'dsh-notify-row' },
              react.createElement(
                'div',
                { className: 'dsh-notify-row-info' },
                react.createElement('div', { className: 'dsh-notify-row-label' }, '免打扰时间区间'),
                react.createElement('div', { className: 'dsh-notify-row-desc' }, '时段内自动静音且不弹 Windows Toast（支持跨午夜，如 "23:00-08:00,12:00-13:00"）'),
              ),
              react.createElement('input', {
                type: 'text',
                className: 'dsh-notify-input',
                style: { width: '220px' },
                placeholder: '例如: 23:00-08:00',
                value: settings.quietHours || '',
                onChange: (e) => update('quietHours', e.target.value),
              }),
            ),
          ),
          // 底部保存按钮
          react.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' } },
            react.createElement(
              'button',
              {
                className: 'dsh-notify-btn primary',
                disabled: saving || loading,
                onClick: save,
              },
              saving ? '保存中…' : '💾 保存配置',
            ),
          ),
        )
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: 'task-done-notify',
          order: 95,
          label: () => '任务完成通知',
        },
        TaskDoneNotifySettingsSection,
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
