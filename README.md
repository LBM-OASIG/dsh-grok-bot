# dsh-grok-bot

DeepSeek Harness 的工作区 Bot 插件：每个 Bot 是一个真正的 Agent，有自己的会话、人格、模式、长期记忆和自唤醒的例行任务；Bot 之间可以互相发消息，也可以拉 2–6 个 Bot 进一个房间自己聊。

> Grok Bot 只是功能参照，本插件与 xAI 无关联，也不含任何品牌素材。

## 它做了什么

| 能力 | 说明 |
|---|---|
| **建 Bot** | 面板里填名字、简介、模式、头像形状/配色、人格补充；落盘到当前工作区，同时建一个独立 Session 并改名成 Bot 名字 |
| **单聊** | 点 Bot 行的 ↗ 打开它自己的原生会话；人格、模式、记忆在每一轮自动注入 |
| **模式** | `companion / operator / scout / chief` 四档；只看/只查的档位不能写文件、不能跑命令（执行期强制），升级档位立刻生效 |
| **独立记忆** | 每个 Bot 有 `MEMORY.md` + 每日日志；工作区还有一份所有 Bot 共享的 `shared-facts.md`；`bot_memory` 工具读写、搜索、遗忘 |
| **自唤醒** | 每个 Bot 自己的例行任务（每天 / 每 N 分钟 / N 分钟后一次 / cron）；由宿主进程的调度器到点唤醒冷会话；没事可报时 `bot_reclaim` 静默收尾 |
| **跨会话消息** | `bot_send` 可以发给同工作区的其他 Bot 或普通会话；目标冷会话会被自动 resume；交接最多两跳，每 Bot 每分钟最多 10 条 |
| **群聊房间** | 2–6 个 Bot 的常驻房间，`@名字` 定向、无 @ 走主答 Bot、`@everyone` 广播；输入 `@` 时按成员名过滤并点选补全；一轮内并行数受 `maxParallel` 限制，Bot 回复里的 `@` 触发一跳交接；支持停止与逐 token 流式，记录持久化 |
| **面板** | 侧栏 Bots 图标 + 整页面板：Bot 卡片、详情（记忆 / 例行任务 / 自主权 / 用量）、房间、新建/编辑弹窗、设置卡 |

## 安装

```bash
git clone https://github.com/LBM-OASIG/dsh-grok-bot.git
dsh plugin --profile desktop add link:<克隆目录的绝对路径>/dsh-grok-bot
```

Windows 下 `link:` 后面直接写绝对路径即可（如 `link:C:/path/to/dsh-grok-bot`）。UI 插件装完后刷新窗口（或重启 DSH）即可在侧栏看到 **Bots** 图标。

也可以把本目录放进 DSH profile 的依赖里（`link:` 或包名），效果相同。

## 数据落在哪里

全部在工作区内，跟项目记忆同目录：

```
<workspace>/.deepseek-harness/bots/
├─ registry.json           id 账本（永不复用）与主 Bot
├─ config.json             主 Bot、默认模式、每日/每小时预算、免打扰、房间上限、侧栏开关
├─ shared-facts.md         本工作区所有 Bot 共享的事实
├─ groups/<groupId>/       group.json + room.jsonl
└─ <botId>/
   ├─ bot.json             模式、人格、头像、自主权、routine、sessionId
   ├─ runs.jsonl           每次例行唤醒的结果
   └─ memory/              MEMORY.md + YYYY-MM-DD.md
```

聊天记录本身仍由 DSH 持久化在 `$DSH_HOME/sessions/`，插件只保存 `sessionId` 映射，不复制会话内容。

## 模式与工具

| 模式 | 定位 | 能不能写文件 / 跑命令 | 能私信 | 默认例行 |
|---|---|---|---|---|
| `companion` 陪伴 | 陪聊、轻任务，主动但不烦 | ✗ / ✗ | ✗ | ≤4 次/天 |
| `operator` 干活 | 接活、交付结果 | ✓ / ✓ | ✓ | ≤12 次/天 |
| `scout` 侦察 | 只读侦察，给线索不下结论 | ✗ / ✗ | ✗ | ≤8 次/天，默认静默 |
| `chief` 协调 | 拆活、派活、收口（默认主 Bot） | ✓ / ✓ | ✓ | ≤16 次/天 |

只读模式由 Agent 作用域里的执行守卫强制：越权调用会得到一条明确的拒绝理由，而不是真的执行。模式切换会立刻改变守卫判断和 Bot 工具清单，不需要重建会话。

> 实现说明：DSH 的 preset 组合一旦会话开始就无法再切换（`agent-preset/locked`），所以插件只注册一个完整的 `grok-bot-agent` preset，把「模式」放在运行时守卫里而不是 composition 里。这样两个方向的切换都即时生效。

## 例行任务

- 存储在每个 Bot 的 `bot.json.routines`；宿主进程里只有一个调度器，窗口关掉、进程还在时也会到点唤醒。
- 触发时投递一条带 `[BOT ROUTINE]` 标记的宿主消息；没有值得汇报的事就调用 `bot_reclaim`，本轮记为 `silent`，不发可见汇报。
- 护栏：免打扰时段（命中不补发，推进到窗外）、每 Bot 每日/每小时次数上限、同一 Bot 不重叠唤醒、连续失败 3 次自动暂停。
- 「立即跑」是手动触发，绕过免打扰和预算，但仍受「同一 Bot 同时只跑一轮」约束。

## Bot 工具

| 工具 | 作用 |
|---|---|
| `bot_memory` | 读写 / 搜索 / 遗忘本 Bot 记忆（`shared:true` 写入工作区共享事实） |
| `bot_profile` | 读自己的名字、模式、自主权、routine、记忆占用、共享事实（只读） |
| `bot_send` | 给同工作区其他 Bot 或普通会话发消息（hop ≤ 2，限流 10 条/分钟） |
| `bot_routine` | 管理自己的例行任务：list / create / update / delete / run_now |
| `bot_reclaim` | 只在例行唤醒回合有效：无事可报时静默收尾 |

这些工具只注册在 Bot 的 Agent 作用域，普通会话、子智能体和其他 Bot 都拿不到。

## 面板与原生 UI

- `sidebar.panellist` 增加 **Bots** 图标；`main` 同名 key 渲染整页面板。
- `sidebar.session.row.leading` 在 Bot 会话行前画它的头像。
- `conversation.session.header.actions` 在 Bot 会话标题旁显示模式徽章与运行状态。
- `plugins.bundle.config` 提供工作区级设置卡（主 Bot、默认模式、预算、免打扰、房间上限、侧栏开关）。

## Host API

```
GET  /api/dsh-grok-bot/state            全量快照
POST /api/dsh-grok-bot/action           闭合动作
GET  /api/dsh-grok-bot/events           SSE：changed / room.append / room.delta / room.status / bot.status
GET  /api/dsh-grok-bot/room?id=…&before=…  房间分页
```

动作名：`bot.create|update|delete|duplicate|pin|hide|rebuild_session|open_chat`、
`memory.read|write|append|forget`、`shared.read|write`、
`routine.create|update|delete|run_now`、`config.update`、
`group.create|update|delete`、`room.post|stop|history`。

请求体上限 64 KB；非法输入返回 `{ok:false, code, message}`。

## 限制（明确不做）

- **宿主必须活着**：窗口关了没关系，但 DSH 进程退出后就不会再唤醒；没有云端 7×24。
- **共享同一台机器**：Bot 之间共享 cwd、文件系统和权限，没有「每个 Bot 一台云电脑」。
- **没有每 Bot 独立沙箱**：沿用 DSH 现有的审批与工具守卫。
- 不支持语音、Slack/X Chat、团队共享 Bot、Bot 市场。
- 删除 Bot 会删除它的记忆目录，并归档它的会话（历史仍留在 DSH 里，可恢复）。

## 开发

```bash
cd dsh-grok-bot
node --test test/domain.test.mjs test/store.test.mjs test/engine.test.mjs \
  test/rooms.test.mjs test/guard.test.mjs test/scheduler.test.mjs
```

- `client.js` 是手写的 Module Loader 包（与 `dsh-seat-lab` 同一种形态），没有构建步骤，改完刷新窗口即可。
- 宿主代码改动后，用插件管理器禁用/启用 `dsh-grok-bot` 这一行即可热重载，不必重启 DSH。
- 路由与 preset 注册都做了「同一进程内热重载时回收上一次残留」的处理。

## 面板

![Bots 面板](assets/bots-panel.png)

## 验证状态（2026-11-10，桌面版 0.2.2-rc.1）

已在本机真机验证：

- 面板建 Bot → 生成独立 Session、改名、侧栏出现会话行、会话 header 显示 Bot 徽章。
- 聊天里让 Bot「记住我周五不在」→ `bot_memory` 落盘到 `<workspace>/.deepseek-harness/bots/<id>/memory/MEMORY.md`，下一轮注入即生效。
- 「2 分钟后」的一次性 routine 到点由宿主调度器唤醒，结果写进 `runs.jsonl`；silent 巡检记为 `outcome: silent`，不产生可见汇报；`report: "room"` 的结果会自动投到指定房间（`room.jsonl` 里 `meta.source = routine`）。
- 每次例行唤醒都会往该 Bot 的当日日志追加一行（`memory/YYYY-MM-DD.md`），下一轮唤醒时作为记忆上下文注入。
- `bot_send`：Sunny 交给侦察兵，侦察兵回复原文回到 Sunny 的回合里。
- 房间：`@侦察兵` 只有侦察兵回；无 @ 时只有主答 Bot 回；`@everyone` 三个成员都进入 responder 集合（受 `maxParallel` 限流）；停止后不再写入迟到的气泡。
- 房间流式：`/events` 上能收到 `room.delta`（实测一轮 15 个增量帧，文本逐步拼起来），前端边收边渲染，回合结束时落一条 `room.append` 整条气泡。
- **冷启动恢复**：用 `dsh --patch <overlay> --profile web --no-open --port 3801` 另起一个全新宿主进程（同一 `$DSH_HOME` 与工作区），插件从磁盘恢复 3 个 Bot 的 mode/sessionId/`routine.nextAt`/memory 和房间成员，并在新进程里用 `grok-bot-agent` preset 成功建 Bot。桌面 profile 只能由 Electron 启动，无法用 CLI 单独 dump/启动，所以「Electron 进程重启」这一步留给你手动做最后确认。
- `npm test`：47 个用例全过（domain / store / engine / rooms / guard / scheduler / sessions / messaging）。

已真机验证（2026-11-11，0.1.2）：热重载与宿主重启后 Bot、记忆、routine、房间均能从磁盘恢复；禁用/启用插件不会丢失 `bot_*` 工具。

P6 味道项已完成：置顶/取消置顶（卡片 📌 与置顶 chip）、模板导出/导入（详情页导出 JSON、面板顶部从模板导入）、每 Bot 用量（今日/累计唤醒与最近结果）、以 Bot 身份发消息给别的 Bot（详情页表单）、会话 header 的「下次例行 ⏰」。

## 许可证

MIT
