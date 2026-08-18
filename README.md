# dsh-task-done-notify

**DeepSeek Harness 任务完成提醒插件**：任务（根会话回合）完成时，弹出 Windows 系统通知并给 dsh 桌面端任务栏图标加数字角标。

## 功能

- 🔔 **系统通知**：任务完成弹 Windows 原生 Toast（ChatGPT 风格：标题=会话标题，正文=该回合回复摘要，上限 200 字符），带系统提示音，2 秒内多条合并为 "N 个任务已完成"
- 🔴 **任务栏数字角标**：dsh 桌面端（dsh-desktop）任务栏图标右下角显示红底白字未读数（1–99，99+ 显示 "99+"）
- 🖱️ **点击通知带回**：点击通知 → 启动 Tauri 版桌面（经 wscript 隐藏激活脚本，规避杀软启发式误报）；未运行则启动
- ● **页内角标条**：Web UI 右下角显示 "● N 个任务已完成"，点击即清空
- ✨ **焦点自动清除**：窗口/标签获得焦点时自动清空角标（点击任务栏图标带回 = 在看）
- 🖱️ **点击任意位置清除**：任务完成后，在窗口内点击任意位置即清除角标（捕获阶段监听，含角标条自身）
- 🧩 **可插拔**：出现在「设置 → 插件 → 插件列表」，随时启停

## 安装

> ### 方式一：从 GitHub 安装（推荐）
>
> ```sh
> git clone https://github.com/XinXie-WRJ/dsh-task-done-notify.git
> cd dsh-task-done-notify
> dsh plugin --profile web add .
> ```
>
> 若已克隆在本地任意位置，直接 `dsh plugin --profile web add <克隆目录路径>` 即可。
>
> ### 方式二：本机开发路径（link 安装，改代码即时生效）
>
> ```sh
> dsh plugin --profile web add D:\MyProject\Tools\DSHTools\dsh-task-done-notify
> ```

安装后**重启 dsh web / 桌面版**，插件即出现在插件列表页并生效。

## 卸载

```sh
dsh plugin --profile web remove dsh-task-done-notify
```

## 版本管理（Git）

本仓库由 git 管理（远端：`https://github.com/XinXie-WRJ/dsh-task-done-notify`，本地目录 `D:\MyProject\Tools\DSHTools\dsh-task-done-notify`），每次改动可以方便回退：

```sh
# 查看历史 / 回退示例
git log --oneline
git checkout <commit> -- lib/index.js   # 单独回滚某个文件
git revert <commit>                      # 撤销某次提交
```

> 本机开发目录通过 `dsh plugin add <目录>` link 安装，改完 `lib/` 后用注入器热重载（`dev_reload_package dsh-task-done-notify`）即生效，再 commit 推送即可安全迭代。`.gitignore` 已排除 `node_modules/`、`*.tgz`、本地 `*.dsh-bak-*` 备份文件。

## 工作原理

| 环节 | 实现 |
| --- | --- |
| 完成检测 | Host 每 1.2s 轮询根 agent 状态，捕捉 `running → idle` 转换（仅根会话，子代理不触发） |
| 通知 | 调用 `powershell.exe` (5.1) WinRT Toast；AUMID `DeepSeekHarness.DSH` 自动注册（注册表 + 开始菜单快捷方式），中文走 base64 → UTF-8 |
| 角标 | `ITaskbarList3.SetOverlayIcon`（C# 互操作），GDI+ 绘制数字图标 |
| 点击带回 | Toast 激活 → 开始菜单快捷方式（带 AUMID，存在则幂等补写）→ `wscript.exe` 执行通用激活 vbs（v2：按标题聚焦任意桌面版窗口 → 探测常见安装路径启动 → 浏览器兜底打开 3080）；不使用 PowerShell 激活脚本（避免杀软启发式误报） |
| 页内 UI | client 半边注册 `shell.overlay`，每 4s `POST /dsh-task-done/poll` 拉未读，点击 `POST /dsh-task-done/clear` |

## 要求（分发）

- **Windows 10/11**（WinRT Toast + 任务栏 API 均为 Windows 专属）
- **dsh web 或任意桌面版**（不依赖特定壳：窗口按标题 `DeepSeek Harness` 定位，Tauri / Electron / 自研壳均兼容）
- 纯浏览器场景：通知、页内角标条、点击任意位置清除全部可用；任务栏红点自动跳过
- 通知音跟随系统"通知"音量设置

## 已知限制

- 未读数存内存，dsh 重启后清零
- 任务栏红点只作用于可探测到的桌面端窗口（标题含 "DeepSeek Harness"）；纯浏览器场景无红点，但通知/角标条照常
- 会话级跳转（点击通知直达某会话）受限于桌面壳本身不支持深度链接，当前为窗口级聚焦（已有窗口）或启动桌面版/浏览器兜底
- 0.1.1 起不再用 PowerShell 激活脚本（旧版被杀软启发式误报，见变更记录）

## 变更记录

- **0.1.5**（2026-08-15）：任务栏角标样式优化——数字改为 `MeasureString` 精确居中（原硬编码坐标导致数字偏位）；加抗锯齿（`SmoothingMode`/`TextRenderingHint`）；圆底加 1px 内边距 + 系统标准通知红 `#E81123`；超过 99 显示 "99"（原 "99+" 三位在 16px 内放不下）。**已知坑**：GDI+ 的 `StringFormat` + 小矩形（14×14）绘制多字符数字会丢字符（如 "12" 只画 "1"），必须用 `MeasureString` 手动计算居中坐标。
- **0.1.4**（2026-08-15）：通知内容升级为 ChatGPT 风格——标题显示会话标题，正文显示该回合最后一条回复摘要（经 `sessionQuery.readSurface` 读取，上限 200 字符、保留换行、1.5s 超时保护；多条合并时显示 "N 个任务已完成" + 最近摘要）。
- **0.1.3**（2026-08-15）：通用化改造。窗口定位改为全进程按标题匹配（不再依赖 `dsh-desktop`/`electron` 进程名白名单，任意桌面壳兼容）；激活 vbs 升级 v2（标题聚焦 → 常见路径探测启动 → 浏览器兜底 3080）；AUMID IconUri 自适应；vbs 带版本标记自动覆盖升级。
- **0.1.2**（2026-08-15）：激活快捷方式策略改为"不存在则创建、存在则幂等补写 AUMID"。已存在的快捷方式（如手动放置的 wscript 隐藏启动器）不再被跳过，统一补写 `DeepSeekHarness.DSH` AUMID 使 toast 点击激活生效，且保留其原有目标/参数/图标。
- **0.1.1**（2026-08-15）：修复杀软误报。旧版在 `%APPDATA%\...\Start Menu\Programs` 生成目标为 `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File ...activate.ps1` 的激活快捷方式，组合特征与恶意 LNK 高度一致，被实时监控判定为 `HEUR:Trojan/LNK.Agent.b` 并删除。现改为快捷方式指向 `wscript.exe + launch-hidden.vbs`（zip 便携版官方隐藏启动器，无脚本链风险）。

## 文件结构

```
lib/index.js    Host 半边：检测 + PowerShell 通知/角标 + /dsh-task-done/* 路由
lib/client.js   Client 半边：右下角角标条 + 焦点自动清除（__ModuleLoader__ 格式）
package.json    dsh.bundle + dsh.client 声明
cordis.patch.yml 插件行插入（安装时自动应用）
```
