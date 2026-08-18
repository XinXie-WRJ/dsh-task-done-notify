/**
 * dsh-task-done-notify — Host half
 *
 * 任务完成检测 + Windows 系统通知 + dsh 桌面端任务栏数字角标。
 *
 * - 检测：每 1.2s 轮询根 agent 状态，捕捉 running -> idle 转换（根会话任务结束）
 * - 通知：powershell.exe (5.1) WinRT Toast，AUMID DeepSeekHarness.DSH（自动注册），
 *   带 Notification.Default 声音；点击通知 -> 经带 AUMID 的开始菜单快捷方式启动 dsh-desktop
 * - 角标：ITaskbarList3.SetOverlayIcon 红底白字数字图标（1-99, 99+）
 * - RPC：POST /dsh-task-done/poll | /clear | /diag（client 半边调用）
 *
 * 前置：仅 Windows；powershell.exe 存在于 System32（系统自带）。
 */

export const name = 'dsh-task-done-notify'

export const inject = ['timer', 'subprocess', 'webServer', 'settings']

export function apply(ctx) {
  // ---- 3. 设置持久化：enabled / sound / soundType / volume / system / quietHours 写 settings.yaml（GUI 可切）----
  const settingsDefaults = {
    enabled: true,
    sound: true,
    soundType: 'crystal',
    volume: 80,
    system: true,
    quietHours: '',
  }
  let settingsValue = { ...settingsDefaults }
  let settingsReady = false
  const SETTINGS_NS = 'task-done-notify'
  ;(async () => {
    try {
      const { installSettingsSection, settingsNamespace } = await import('@deepseek-ai/dsh-settings')
      const zmod = await import('@deepseek-ai/schemastery')
      const z = zmod.default || zmod
      const NS = settingsNamespace(SETTINGS_NS)
      const Schema = z.object({
        enabled: z.boolean().default(true),
        sound: z.boolean().default(true),
        soundType: z.string().default('crystal'),
        volume: z.number().default(80),
        system: z.boolean().default(true),
        quietHours: z.string().default(''),
      })
      installSettingsSection(ctx, NS, Schema, { ...settingsDefaults }, {
        setSource: (current) => {
          settingsValue = { ...settingsDefaults, ...(current || {}) }
          settingsReady = true
        },
        onChange: () => {},
      })
    } catch (e) {
      console.error('[task-done] settings init failed (non-fatal):', e && e.message ? e.message : e)
    }
  })()

  /** 判断当前时间是否处于勿扰时段 (如 "23:00-08:00,12:00-13:00") */
  function isQuietTime(quietHoursStr, now = new Date()) {
    if (!quietHoursStr || typeof quietHoursStr !== 'string') return false
    const ranges = quietHoursStr.split(',').map((s) => s.trim()).filter(Boolean)
    if (ranges.length === 0) return false
    const curMin = now.getHours() * 60 + now.getMinutes()
    for (const range of ranges) {
      const parts = range.split('-').map((s) => s.trim())
      if (parts.length !== 2) continue
      const [startStr, endStr] = parts
      const startParts = startStr.split(':').map((s) => parseInt(s, 10))
      const endParts = endStr.split(':').map((s) => parseInt(s, 10))
      if (startParts.length !== 2 || endParts.length !== 2) continue
      if (isNaN(startParts[0]) || isNaN(startParts[1]) || isNaN(endParts[0]) || isNaN(endParts[1])) continue
      const startMin = startParts[0] * 60 + startParts[1]
      const endMin = endParts[0] * 60 + endParts[1]
      if (startMin <= endMin) {
        if (curMin >= startMin && curMin <= endMin) return true
      } else {
        if (curMin >= startMin || curMin <= endMin) return true
      }
    }
    return false
  }

  // ---- 状态 ----
  let unread = 0 // 未读完成数（任务栏角标 + 页内角标条）
  let pending = 0 // 2s 去抖窗口内累计的完成数
  let flushHandle = null // 去抖 timer
  let lastTitle = '任务已完成'
  let lastReply = '' // 最近一次完成回合的回复摘要（通知正文）
  let lastFireSessionId = null // 最近一次触发完成的会话 id
  const recentCompletions = [] // 最近完成会话队列（sessionId + title + time，上限 RECENT_MAX）
  let chain = Promise.resolve() // PowerShell 调用串行队列
  const seenAgents = new Set() // 观测到过的 agent id（用于 diag 展示；事件驱动下不再需要轮询状态 Map）
  // 任务栏角标幂等跟踪：避免无谓重复 PowerShell 调用（unread 未变 / 已是空的就不重画）
  let lastBadgeCount = 0 // 最后一次实际下发的角标数字（0 = 没画过数字角标）
  let badgeCleared = true // 角标当前是否为空（初始为空；只有画过数字后才变 false）
  let badgeTimer = null // 角标刷新去抖 timer（快速连续消费时合并为一次重画）
  let badgePending = null // 待下发的角标状态（去抖窗口内只保留最末目标）

  // 任务栏角标刷新：去抖 300ms 合并 + 幂等跳过
  // - count <= 0 -> CLEAR（仅当角标非空才发）
  // - count > 0  -> UPDATE 重画数字（仅当数字变化才发）
  const badgeWaiters = [] // 已在去抖窗口内的等待者（timer 触发后统一 resolve）
  function drawBadge(count) {
    const target = { count }
    if (badgeTimer) {
      // 已在去抖窗口内：覆盖为最新目标，复用同一 timer（不重复 spawn PS），
      // 并把本次 wait 挂到同一批，等 timer 触发后统一 resolve。
      badgePending = target
      return new Promise((resolve) => { badgeWaiters.push(resolve) })
    }
    badgePending = target
    return new Promise((resolve) => {
      badgeTimer = ctx.timeout(() => {
        badgeTimer = null
        const p = badgePending
        badgePending = null
        const waiters = badgeWaiters.splice(0)
        if (!p) { resolve(); waiters.forEach((w) => w()); return }
        const c = p.count
        if (c <= 0) {
          if (badgeCleared) { resolve(); waiters.forEach((w) => w()); return } // 本来就空，不发
          badgeCleared = true
          lastBadgeCount = 0
          const pr = enqueue('CLEAR', '', '', 0)
          pr.then(() => { resolve(); waiters.forEach((w) => w()) }, () => { resolve(); waiters.forEach((w) => w()) })
        } else {
          if (!badgeCleared && c === lastBadgeCount) { resolve(); waiters.forEach((w) => w()); return } // 数字没变，不发
          lastBadgeCount = c
          badgeCleared = false
          const pr = enqueue('UPDATE', '', '', c)
          pr.then(() => { resolve(); waiters.forEach((w) => w()) }, () => { resolve(); waiters.forEach((w) => w()) })
        }
      }, 300)
    })
  }
  const REPLY_MAX_CHARS = 200 // 通知正文（回复摘要）上限
  const RECENT_MAX = 5 // 页内面板保留的最近完成会话数

  const CS_TASKBAR = [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    '[ComImport]',
    '[Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]',
    '[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    'public interface ITaskbarList3 {',
    '    void HrInit();',
    '    void AddTab(IntPtr hwnd);',
    '    void DeleteTab(IntPtr hwnd);',
    '    void ActivateTab(IntPtr hwnd);',
    '    void SetActiveAlt(IntPtr hwnd);',
    '    void MarkFullscreenWindow(IntPtr hwnd, bool fullscreen);',
    '    void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);',
    '    void SetProgressState(IntPtr hwnd, uint state);',
    '    void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);',
    '    void UnregisterTab(IntPtr hwndTab);',
    '    void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);',
    '    void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint reserved);',
    '    void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);',
    '    void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);',
    '    void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);',
    '    void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);',
    '    void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);',
    '    void SetThumbnailClip(IntPtr hwnd, ref RECT prcClip);',
    '}',
    '[ComImport]',
    '[Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]',
    'public class TaskbarList {}',
    '[StructLayout(LayoutKind.Sequential)]',
    'public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    'public static class TaskbarBadge {',
    '    public static void SetOverlay(IntPtr hwnd, IntPtr hIcon, string desc) {',
    '        var t = (ITaskbarList3)new TaskbarList();',
    '        t.HrInit();',
    '        t.SetOverlayIcon(hwnd, hIcon, desc);',
    '    }',
    '    public static void ClearOverlay(IntPtr hwnd) {',
    '        var t = (ITaskbarList3)new TaskbarList();',
    '        t.HrInit();',
    '        t.SetOverlayIcon(hwnd, IntPtr.Zero, "");',
    '    }',
    '}',
    "'@",
  ].join('\n')

  const PS_TEMPLATE = (action) => [
    "$ErrorActionPreference = 'Continue'",
    `$action = '${action}'`,
    "$titleB64 = '__TITLE_B64__'",
    "$bodyB64 = '__BODY_B64__'",
    '$count = __COUNT__',
    '',
    '$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($titleB64))',
    '$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($bodyB64))',
    CS_TASKBAR,
    '',
    "# 窗口定位：",
    "# 1. 过滤通用多标签浏览器（chrome/msedge/firefox等），避免污染用户日常整个浏览器的任务栏图标；",
    "# 2. 仅对 DSH 专属桌面客户端（dsh, dsh-desktop, electron, tauri 等）注入任务栏底层 SetOverlayIcon。",
    "$browserRegex = '^(chrome|msedge|firefox|brave|opera|vivaldi|360chrome|qqbrowser|sogouexplorer|iexplore)$'",
    "$dsh = Get-Process | Where-Object {",
    "    $_.MainWindowHandle -ne 0 -and",
    "    $_.ProcessName -notmatch $browserRegex -and",
    "    ($_.MainWindowTitle -match 'DeepSeek Harness' -or $_.ProcessName -match 'dsh|electron|tauri')",
    "} | Select-Object -First 1",
    '',
    '# 画任务栏角标（红底白字数字）——NOTIFY 与 UPDATE 复用',
    '$psBadge = {',
    '    if ($dsh) {',
    '        try {',
    '            Add-Type -AssemblyName System.Drawing',
    '            $bmp = New-Object System.Drawing.Bitmap 16,16',
    '            $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '            $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    '            $g.Clear([System.Drawing.Color]::Transparent)',
    '            # 圆底：1px 内边距 + 系统标准通知红 #E81123',
    '            $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 17, 35))',
    '            $g.FillEllipse($brush, 1, 1, 14, 14)',
    "            if ($count -gt 99) { $label = '99' } else { $label = [string]$count }",
    '            $size = if ($label.Length -le 1) { 9.5 } else { 8 }',
    "            $font = New-Object System.Drawing.Font('Segoe UI', $size, [System.Drawing.FontStyle]::Bold)",
    '            # 数字精确居中（实测踩坑：GDI+ StringFormat+小矩形会丢字符，必须 MeasureString 手动居中；',
    '            # MeasureString 宽度含字距偏大，但 DrawString 实际渲染正常，无需自适应缩字号）',
    '            $ms = $g.MeasureString($label, $font)',
    '            $mx = (16 - $ms.Width) / 2',
    '            $my = (16 - $ms.Height) / 2 + 1',
    '            $g.DrawString($label, $font, [System.Drawing.Brushes]::White, $mx, $my)',
    '            $hicon = $bmp.GetHicon()',
    "            [TaskbarBadge]::SetOverlay($dsh.MainWindowHandle, $hicon, 'dsh-task-badge')",
    '            $g.Dispose(); $bmp.Dispose()',
    "        } catch { Write-Output ('BADGE_ERR: ' + $_.Exception.Message) }",
    '    }',
    '}',
    '',
    "if ($action -eq 'NOTIFY') {",
    "    try {",
    "        $regPath = 'HKCU:\Software\Classes\AppUserModelId\DeepSeekHarness.DSH'",
    "        if (-not (Test-Path $regPath)) {",
    "            New-Item -Path $regPath -Force | Out-Null",
    "            New-ItemProperty -Path $regPath -Name 'DisplayName' -Value 'DeepSeek Harness' -PropertyType String -Force | Out-Null",
    "        }",
    "        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()",
    "        $xml.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual><audio src='ms-winsoundevent:Notification.Default'/></toast>\")",
    "        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DeepSeekHarness.DSH').Show($toast)",
    "    } catch {",
    "        Write-Output ('TOAST_ERR: ' + $_.Exception.Message)",
    "    }",
    "    & $psBadge",
    "    Write-Output 'NOTIFIED'",
    "} elseif ($action -eq 'UPDATE') {",
    '    & $psBadge',
    "    Write-Output 'UPDATED'",
    '} else {',
    '    $allMatching = Get-Process | Where-Object {',
    '        $_.MainWindowHandle -ne 0 -and',
    "        ($_.MainWindowTitle -match 'DeepSeek Harness' -or $_.ProcessName -match 'dsh|electron|tauri|chrome|msedge|firefox')",
    '    }',
    '    foreach ($p in $allMatching) {',
    '        try { [TaskbarBadge]::ClearOverlay($p.MainWindowHandle) } catch {}',
    '    }',
    "    Write-Output 'CLEARED'",
    '}',
  ].join('\n')

  function buildScript(action, title, body, count) {
    const t = Buffer.from(title || 'DeepSeek Harness', 'utf8').toString('base64')
    const b = Buffer.from(body || '任务已完成', 'utf8').toString('base64')
    return PS_TEMPLATE(action)
      .replace('__TITLE_B64__', t)
      .replace('__BODY_B64__', b)
      .replace('__COUNT__', String(count))
  }

  // 脚本缓存：UPDATE/CLEAR 的 title/body 恒为空，只随 count 变化，缓存编译产物避免重复 base64 编码。
  // NOTIFY 的 title/body 每次不同，不缓存。
  const _scriptCache = new Map()
  function runScript(action, title, body, count) {
    let script
    if (action === 'UPDATE' || action === 'CLEAR') {
      const key = action + ':' + count
      script = _scriptCache.get(key)
      if (!script) {
        script = buildScript(action, title, body, count)
        _scriptCache.set(key, script)
      }
    } else {
      script = buildScript(action, title, body, count)
    }
    const b64 = Buffer.from(script, 'utf16le').toString('base64')
    const proc = ctx.subprocess.spawn({
      argv: [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64,
      ],
      cwd: 'C:\\',
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 8192 },
        stderr: { maxBytes: 8192 },
      },
      // 8s 超时（原 20s）：单个 powershell 卡死不至于拖住整条调用链 20s
      graceMs: 8000,
    })
    return proc.done.then(() => {
      const r = proc.collected.stdout
      const text = r ? r.readFrom(0).text : ''
      return text
    }).catch((err) => {
      console.error('[task-done] powershell failed:', err)
      return ''
    })
  }

  function enqueue(action, title, body, count) {
    chain = chain.then(() => runScript(action, title, body, count))
    return chain
  }

  // ---- 根 agent 列表（仅用于 /diag 展示，不再做完成检测轮询）----
  function rootAgents() {
    const agents = ctx.get('agents')
    if (!agents) return []
    try { return agents.roots() } catch (e) { return [] }
  }

  // ---- 任务完成检测：事件驱动（零轮询）----
  // 监听 agent/status：每个 agent 状态转换都会 emit（idle/running，no-op 转换不 emit）。
  // status==='idle' 即等价于轮询版的 running→idle 边沿（已 idle 的 agent 不会再 emit，
  // 天然不会误触发"启动时就在 idle"的会话）。一次完整运行（含多轮）收敛到 idle 只 emit 一次。
  // 3.3：子代理（session.header.origin==='subagent'）idle 不再单独 fire——等父 agent
  // idle 时统一通知（父的 idle 表示整段活动含所有子代理收敛完成），避免"子+父"双通知刷屏。
  function onAgentStatus({ agent, status }) {
    if (status !== 'idle') return
    if (!agent || typeof agent.id !== 'string') return
    if (!seenAgents.has(agent.id)) seenAgents.add(agent.id)
    // 3. master 开关：enabled=false 时不通知也不累计未读（完全静默）
    if (settingsReady && settingsValue.enabled === false) return
    // 子代理过滤：父 agent 收敛时会再 emit idle，由它统一 fire
    try {
      const header = agent.session && agent.session.header
      if (header && header.origin === 'subagent') return
    } catch (e) { /* header 不可读时视为顶层 */ }
    fire(agent)
  }

  /** 智能文本净化：剥离 Markdown 代码块、表格、标题符、链接等杂质，提取易读总结句。 */
  function cleanSummaryText(raw, maxChars = REPLY_MAX_CHARS) {
    if (!raw || typeof raw !== 'string') return ''
    let text = raw
    text = text.replace(/```[\s\S]*?```/g, ' [代码] ')
    text = text.replace(/`([^`]+)`/g, '$1')
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    text = text.replace(/^#+\s+/gm, '')
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
    text = text.replace(/(\*|_)(.*?)\1/g, '$2')
    text = text.replace(/^>\s+/gm, '')
    text = text.replace(/\|[^\n]+\|/g, ' ')
    text = text.replace(/[-|:]{3,}/g, ' ')
    text = text.replace(/[ \t]+/g, ' ').replace(/\r?\n\s*/g, ' ').trim()
    return truncate(text, maxChars)
  }

  /** 记录一次会话完成到最近队列（同会话去重、移到最前并累计 count，超上限丢最旧）。 */
  function recordCompletion(sessionId, title, kind = 'done') {
    const idx = recentCompletions.findIndex((r) => r.sessionId === sessionId)
    if (idx >= 0) {
      const existing = recentCompletions[idx]
      recentCompletions.splice(idx, 1)
      recentCompletions.unshift({
        sessionId,
        title: title || existing.title || '任务已完成',
        time: Date.now(),
        kind: kind || existing.kind || 'done',
        count: (existing.count || 1) + 1,
      })
    } else {
      recentCompletions.unshift({
        sessionId,
        title: title || '任务已完成',
        time: Date.now(),
        kind: kind || 'done',
        count: 1,
      })
    }
    if (recentCompletions.length > RECENT_MAX) recentCompletions.pop()
  }

  function fire(agent) {
    let title = ''
    try {
      const st = ctx.get('sessionTitle')
      const snap = st && st.get(agent.session)
      if (snap && snap.title) {
        title = snap.title.length > 40 ? snap.title.slice(0, 40) + '…' : snap.title
        lastTitle = title
      }
    } catch (e) { /* 标题尽力而为 */ }
    lastFireSessionId = agent.id
    recordCompletion(agent.id, title, 'done')
    pending += 1
    if (!flushHandle) flushHandle = ctx.timeout(flush, 2000)
  }

  /** 检查会话最终状态（成功 / 阻塞等待审批 / 报错），并提取净化后的最新回复摘要。 */
  async function inspectSessionState(sessionId) {
    let kind = 'done'
    let summary = ''
    let detail = ''
    try {
      const sq = ctx.get('sessionQuery')
      if (!sq || !sessionId) return { kind, summary, detail }
      const snap = await sq.readSurface(sessionId)
      const events = snap && Array.isArray(snap.events) ? snap.events : []

      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (!ev) continue

        // 检测错误/失败事件
        if (ev.type === 'error' || ev.type === 'turn/error' || (ev.data && ev.data.error)) {
          kind = 'error'
          const err = ev.data && (ev.data.error || ev.data.message)
          detail = typeof err === 'string' ? err : (err && err.message) || '执行出现错误'
          break
        }

        // 检测审批/提问/阻塞事件
        if (ev.type === 'approval/request' || ev.type === 'ask_question' || ev.type === 'tool/approval' || ev.type === 'agent/turn-stopping') {
          kind = 'approval'
          break
        }

        // 提取最后一条助手回复
        if (!summary && ev.type === 'assistant/message') {
          const msg = ev.data && ev.data.message
          if (msg && Array.isArray(msg.content)) {
            let text = ''
            for (const block of msg.content) {
              if (block && block.type === 'text' && typeof block.text === 'string') text += block.text
            }
            if (text) summary = text
          }
        }
      }
    } catch (e) { /* 状态检测尽力而为 */ }
    return { kind, summary, detail }
  }

  function truncate(text, max) {
    if (text.length <= max) return text
    return text.slice(0, max) + '…'
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      ctx.timeout(ms).then(() => null),
    ])
  }

  async function flush() {
    flushHandle = null
    const n = pending
    pending = 0
    if (n <= 0) return

    let title = lastTitle
    let body = ''
    if (n === 1 && lastFireSessionId) {
      const state = await withTimeout(inspectSessionState(lastFireSessionId), 1500)
      if (state) {
        if (state.kind === 'error') {
          title = `【出错】${lastTitle}`
          body = state.detail ? truncate(state.detail, REPLY_MAX_CHARS) : '任务执行遇到异常'
          recordCompletion(lastFireSessionId, lastTitle, 'error')
        } else if (state.kind === 'approval') {
          title = `【待确认】${lastTitle}`
          body = 'Agent 等待您的回复或审批'
          recordCompletion(lastFireSessionId, lastTitle, 'approval')
        } else if (state.summary) {
          const cleaned = cleanSummaryText(state.summary, REPLY_MAX_CHARS)
          if (cleaned) {
            lastReply = cleaned
            body = cleaned
          }
        }
      }
    }
    if (n > 1) {
      title = n + ' 个任务已完成'
      body = lastReply ? truncate(lastReply, REPLY_MAX_CHARS) : ''
    }
    if (!body) body = '任务已完成'
    unread += n
    const inQuiet = isQuietTime(settingsValue.quietHours)
    const allowToast = settingsValue.system !== false && !inQuiet
    const action = allowToast ? 'NOTIFY' : 'UPDATE'
    await enqueue(action, title, body, unread)
    // NOTIFY 的 PS 脚本内部已重画任务栏角标（数字 = unread），同步幂等跟踪状态，
    // 避免随后同数字的 consume/clear 再白发一次 UPDATE/CLEAR。
    lastBadgeCount = unread
    badgeCleared = false
  }

  // ---- 完成检测：订阅 agent/status 事件（零轮询）----
  // 现有 agent 只登记到 seenAgents（diag 展示用），不触发——事件驱动下已 idle 的 agent
  // 本就不会再 emit，天然满足"首次只记录不通知"。
  for (const a of rootAgents()) {
    if (a && typeof a.id === 'string' && !seenAgents.has(a.id)) seenAgents.add(a.id)
  }
  ctx.effect(
    () => ctx.on('agent/status', onAgentStatus),
    'dsh-task-done: agent/status listener',
  )

  // ---- HTTP RPC：client 半边轮询未读 / 点击清空 ----
  const readJsonBody = async (req) => {
    return await new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolve(null) }
      })
      req.on('error', () => resolve(null))
    })
  }
  const json = (res, obj, status = 200) => {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  }

  const pathname = (req) => (req.url ?? '/').split('?')[0]

  const handler = async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const payload = await readJsonBody(req)
    const p = pathname(req)
    try {
      if (p === '/dsh-task-done/poll') {
        // 自愈同步：如果 recentCompletions 为空，强制 unread 为 0 且 lastFireSessionId 为 null
        if (recentCompletions.length === 0) {
          unread = 0
          lastFireSessionId = null
        } else {
          // 确保 unread 严格等于队列中的实际未读数
          unread = recentCompletions.reduce((acc, r) => acc + (r.count || 1), 0)
        }
        const inQuiet = isQuietTime(settingsValue.quietHours)
        json(res, {
          ok: true,
          value: {
            unread,
            lastSessionId: lastFireSessionId ?? null,
            recent: recentCompletions.slice(0, RECENT_MAX),
            settings: { ...settingsValue, inQuiet },
          },
        })
        return
      }
      if (p === '/dsh-task-done/clear') {
        // 全部清除：清零未读 + 清空最近队列 + 清任务栏角标
        unread = 0
        lastFireSessionId = null
        recentCompletions.length = 0
        await drawBadge(0)
        json(res, { ok: true, value: { unread: 0, recent: [] } })
        return
      }
      if (p === '/dsh-task-done/consume') {
        // 消费单个完成会话：从队列移除该会话，重新计算真实未读数
        const sid = payload && typeof payload.sessionId === 'string' ? payload.sessionId : null
        let removed = null
        if (sid) {
          const idx = recentCompletions.findIndex((r) => r.sessionId === sid)
          if (idx >= 0) {
            removed = recentCompletions[idx]
            recentCompletions.splice(idx, 1)
          }
        }
        // 强一致性未读数重新计算
        unread = recentCompletions.reduce((acc, r) => acc + (r.count || 1), 0)
        if (recentCompletions.length === 0) {
          unread = 0
          lastFireSessionId = null
        }
        await drawBadge(unread)
        json(res, { ok: true, value: { unread, removed: !!removed, recent: recentCompletions.slice(0, RECENT_MAX) } })
        return
      }
      if (p === '/dsh-task-done/diag') {
        json(res, { ok: true, value: { unread, pending, roots: rootAgents().length, seen: seenAgents.size } })
        return
      }
      if (p === '/dsh-task-done/settings') {
        if (payload && typeof payload === 'object') {
          if (typeof payload.enabled === 'boolean') settingsValue.enabled = payload.enabled
          if (typeof payload.sound === 'boolean') settingsValue.sound = payload.sound
          if (typeof payload.soundType === 'string') settingsValue.soundType = payload.soundType
          if (typeof payload.volume === 'number') settingsValue.volume = Math.max(0, Math.min(100, payload.volume))
          if (typeof payload.system === 'boolean') settingsValue.system = payload.system
          if (typeof payload.quietHours === 'string') settingsValue.quietHours = payload.quietHours

          try {
            if (ctx.settings && typeof ctx.settings.replace === 'function') {
              const { settingsNamespace } = await import('@deepseek-ai/dsh-settings')
              await ctx.settings.replace(settingsNamespace(SETTINGS_NS), settingsValue)
            }
          } catch (err) {}
        }
        const inQuiet = isQuietTime(settingsValue.quietHours)
        json(res, { ok: true, value: { ...settingsValue, inQuiet } })
        return
      }
      if (p === '/dsh-task-done/client-leave') {
        // 客户端离开/页面关闭：主动清除任何残留的任务栏角标
        await drawBadge(0)
        json(res, { ok: true })
        return
      }
      if (p === '/dsh-task-done/test-notify') {
        // 诊断：走完整 enqueue 链路发一条测试通知（验证 PowerShell/toast 是否工作）
        try {
          const out = await enqueue('NOTIFY', 'dsh-task-done 测试', '通知链路测试：如果你看到这条，说明 PowerShell toast 正常', 0)
          json(res, { ok: true, value: { sent: true, output: String(out).slice(0, 500) } })
        } catch (e) {
          json(res, { ok: false, error: { code: 'notify-failed', message: String(e) } }, 500)
        }
        return
      }
      json(res, { ok: false, error: { code: 'not-found' } }, 404)
    } catch (e) {
      json(res, { ok: false, error: { code: 'internal', message: String(e) } }, 500)
    }
    void payload
  }

  const disposer = ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-task-done',
    handler,
  })
  ctx.effect(() => disposer, 'dsh-task-done: routes')

  // 启动时初始化：彻底清理可能残留的历史角标
  drawBadge(0).catch(() => {})

  console.log('[task-done] host half ready (bundle v1)')
}
