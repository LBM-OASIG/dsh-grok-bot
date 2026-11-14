# Changelog

## 0.1.4 — 2026-11-15

适配 DSH 0.2.2-rc.3。

- `agents.roots()` 在 rc.2+ 已移除（换成 `list()`）：插件加载直接 failed。现在优先 `list()`、回退 `roots()`，两个版本都能启动。
- `sessionController.list` 的返回从 `{items}` 变成直接数组：`listSessions` 两种形状都兼容。
- 真机验证（rc.3，端口 13564）：插件 active，Bot 例行唤醒 ok，`bot_send` 到普通会话送达、到其他 Bot 送达（对方那轮因模型商 402 余额不足而空回复，属模型账户问题不是插件问题）；四个插槽名在 rc.3 客户端 bundle 里都仍存在。

## 0.1.3 — 2026-11-12

修复同名 Bot 跨工作区串数据的问题。

- `bot_*` 工具、身份/记忆提示段、模式守卫改为按 Agent Session（全局唯一）解析 Bot，不再用 `hub.findById(botId)`；多个工作区都有 `bot` 这种同名 id 时，music-combine 的 Bot 不会再读到 did-you-pay 的空记忆。
- 面板动作统一带 `workspacePath`，宿主 `requireBot` 与 `routine.run_now` 按工作区解析；记忆页、用量、例行任务不再操作错 Bot。
- 身份/记忆提示段在热重载时改为「认领同名段并替换」，不再保留上一轮插件实例的旧 `resolve` 闭包；否则工具已修好，提示词仍会显示另一个工作区的身份与空记忆。
- Agent 注册表改以 Session id 为键（`refresh` / `forget` 同步），同名 Bot 不再互相覆盖注册记录。
- 症状记录：Bot 搜「已发主题」为空、以为长期记忆被清空，实际是读到了另一个工作区同名 Bot 的 23 字节空记忆；原 `MEMORY.md` 一直完好。

## 0.1.2 — 2026-11-11

修复工作区与创建 Bot 的几个数据/排序问题。

- 工作区设置页「每 Bot 每天唤醒上限」保存后会同步写入本工作区所有 Bot 的 `autonomy.maxRunsPerDay`，不再被更低的单 Bot值悄悄压住；Bot 详情页提示实际与工作区上限取小值。
- 预算计数只统计真实定时唤醒（排除 `budget` / `skipped` / 手动记录），被挡下的槽位不再吃掉后续名额；`bot_profile` 新增 `limits`（生效上限、今日已跑、工作区上限），面板 usage 同步为真实唤醒数。
- `bot_send` 优先使用已 live 的 Agent（GUI 里打开着的会话），不再先 `resolveAgent` 导致活动会话被判 unavailable、报「找不到目标」；冷会话仍走恢复路径，跨工作区照旧拒绝。
- 新建 Bot 的默认唤醒数按模式给（companion 4 / operator 12 / scout 8 / chief 16），不再一律写 4。

- 新建 Bot 弹窗新增「工作区」选择器（列出全部已注册工作区并可切换）；面板右上角「新建 Bot」优先落到已有 Bot 的工作区，不再静默写给第一个工作区。
- 工作区分组按标题排序（`localeCompare`，中文按本地拼音），扫描出的新工作区不再随机排在末尾。
- Bot 创建在拿到 Session 后失败时，会把刚建出的孤儿会话归档，不再在侧栏留下「有会话、没 Bot」的残骸。
- Bots 面板只列有 Bot 的工作区，空工作区的占位块整块隐藏；工作区按该区最新 Bot 的创建时间倒序排列（最近建 Bot 的工作区在前），零 Bot 时只显示一个总空状态。
- `bot_send` 能寻址「日志已在磁盘、但还没被会话列表索引」的普通会话（如刚 fork 出来还没点开过的会话）：先 `resolveAgent` 恢复并校验 cwd 属于同一工作区，再投递；跨工作区仍拒绝。
- `bot.update` 在 `autonomy` 变化时重建该 Bot 的工具目录：面板打开/关闭「允许私信」后不必重启 DSH，下一轮就能拿到/失去 `bot_send`。
- 新增 `bot_open_session`（宿主 action `bot.open_session`）：在 Bot 所属工作区新建一条**普通会话**（宿主默认 preset，不是 Bot），不换绑主会话，返回 session id；配合 `bot_send` 把活投过去。真机验证：Bot 工具目录 57 个含该工具，新建会话跑普通 agent（无 `bot_*` 工具），主会话 sessionId 不变。
- `runCounters` 支持注入测试时钟；修掉 00:00–02:00 跑测试必挂的跨天假失败。

## 0.1.0 — 2026-11-10

首个可用版本。

- 工作区级 Bot 域：`bot.json` 真源、永不复用 id、原子落盘、启动扫描全部已注册工作区。
- Bot = 真 Agent + 独立 Session：创建即建会话、改名、侧栏头像、面板打开原生聊天。
- 四档模式（companion / operator / scout / chief）：Agent 作用域执行守卫按实时模式拒绝写文件/跑命令；Bot 工具目录随模式重建。
- 独立记忆：`MEMORY.md` + 每日日志 + 工作区共享 `shared-facts.md`，每轮自动注入（6000 字符预算，共享事实优先保留）；`bot_memory` 工具与面板编辑器。
- 自唤醒 routines：宿主级调度器、冷会话 resume、`bot_reclaim` 静默收尾、免打扰、每日/每小时预算、连续失败暂停。
- 跨会话消息：`bot_send` 支持同工作区 Bot 与普通会话，hop ≤ 2、每分钟 10 条限流、目标冷会话自动 resume。
- 多 Bot 房间：`@名字` / `@everyone` / 主答策略、并行上限、一跳交接、停止、`room.jsonl` 持久化与 SSE 推送。
- 面板：Bots 列表、Bot 详情（记忆 / 例行任务 / 自主权 / 删除）、房间视图（气泡 / @ 菜单 / typing / 停止）、新建与编辑弹窗、工作区设置卡。
- Bot preset 以运行时 `ctx.agentPresets.register()` 注册，支持同进程热重载；路由注册带残留回收。
- P6 打磨：置顶/隐藏、模板导出/导入（不含会话与记忆）、每 Bot 用量统计、以 Bot 身份给别的 Bot 发消息、会话 header 的下次例行时钟。
- 房间流式：订阅 `agent/assistant-stream`，把成员回合的增量文本作为 `room.delta` 推给前端，回合结束再落整条气泡。
- 39 个纯模块与假 Agent 单元测试。
