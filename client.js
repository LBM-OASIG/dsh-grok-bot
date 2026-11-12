/* dsh-grok-bot — Web client half.
 *
 * Hand-written Module Loader bundle (same shape as dsh-seat-lab): no build
 * step; React comes from the host module table. Surfaces:
 *   sidebar.panellist                 Bots entry
 *   main (key dsh-grok-bot)           the Bots workspace page
 *   sidebar.session.row.leading       the Bot avatar before a Bot Session title
 *   conversation.session.header.actions  mode chip + status for a Bot Session
 *   plugins.bundle.config             workspace-wide settings card
 */
window.__ModuleLoader__.load({
  id: 'dsh-grok-bot',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const { createElement: h, useEffect, useReducer, useRef, useState } = React;

    const NS = 'dsh-grok-bot';

    const ZH = {
      title: 'Bots',
      subtitle: '工作区里的常驻 AI 同事：各有会话、记忆和例行任务。',
      stats: (b, r, w) => `${b} 个常驻 Bot · ${r} 个房间 · ${w} 个工作区`,
      wakesToday: (n) => `今日 ${n} 次唤醒`,
      emptyTitle: (name) => `「${name}」还没有 Bot`,
      empty: '这个工作区还没有 Bot。新建一个，它会有自己的会话、记忆和例行任务。',
      emptyRoom: '还没有房间。拉 2–6 个 Bot 进一个房间，就能让它们自己对话。',
      newBot: '新建 Bot',
      newRoom: '新建房间',
      count: (n) => `${n} 个 Bot`,
      workspaceMissing: '工作区目录不存在',
      noWorkspace: '还没有注册任何工作区。先在 DSH 里打开一个工作区，再回到这里。',
      openChat: '打开聊天',
      edit: '编辑',
      duplicate: '复制',
      hide: '隐藏',
      show: '显示',
      remove: '删除',
      pin: '置顶',
      unpin: '取消置顶',
      exportTemplate: '导出模板',
      importTemplate: '从模板导入',
      importAction: '导入',
      templateHint: '把导出的 JSON 粘贴到这里；会新建一个 Bot（不含记忆和旧会话）。',
      templateInvalid: '模板 JSON 解析失败',
      sendTo: '发消息给别的 Bot',
      sendHint: '以这个 Bot 的身份给同工作区另一个 Bot 发消息，最多两跳。',
      sendAction: '发送',
      mode: { companion: '陪伴', operator: '干活', scout: '侦察', chief: '协调' },
      state: { dormant: '休眠', idle: '空闲', busy: '运行中', missing: '会话丢失', error: '出错' },
      fail: '操作失败',
      rooms: '房间',
      room: '房间',
      members: '成员',
      memory: '记忆',
      routines: '例行任务',
      autonomy: '自主权',
      close: '关闭',
      save: '保存',
      cancel: '取消',
      create: '创建',
      name: '名字',
      label: '一句话简介',
      persona: '人格补充',
      modeField: '模式',
      workspaceField: '工作区',
      avatar: '头像',
      section: '分组',
      allowDm: '允许私信别的 Bot',
      allowRoutines: '允许例行任务',
      maxRuns: '每天最多唤醒',
      quietHours: '免打扰时段',
      quietStart: '开始',
      quietEnd: '结束',
      injected: '注入占用',
      memoryHint: '一行一条事实；写入后下一轮生效。',
      shared: '工作区共享事实',
      sharedHint: '这里的内容会注入本工作区所有 Bot。',
      addRoutine: '添加例行任务',
      whenDaily: '每天',
      whenEvery: '每 N 分钟',
      whenAfter: 'N 分钟后一次',
      whenCron: 'cron',
      time: '时间',
      minutes: '分钟',
      expr: 'cron 表达式',
      instruction: '任务指令',
      report: '汇报方式',
      reportChat: '留在聊天',
      reportSilent: '无事静默',
      reportRoom: '投到房间',
      enable: '启用',
      disable: '暂停',
      runNow: '立即跑',
      nextAt: '下次',
      lastRun: '上次',
      noRoutine: '还没有例行任务。',
      routineCount: (n) => `${n} 条`,
      danger: '删除这个 Bot 会一并删除它的记忆目录；会话会被归档。',
      confirmDelete: '确认删除这个 Bot？它的记忆文件会被删除，会话会被归档。',
      roomName: '房间名字',
      topic: '话题',
      lead: '主答 Bot',
      policy: '无 @ 时',
      policyPrimary: '只让主答 Bot 回',
      policyAll: '所有成员都回',
      maxParallel: '并行上限',
      handoff: '交接深度',
      pickMembers: '选 2–6 个成员',
      post: '发送',
      stop: '停止',
      typing: '正在整理…',
      roomEmpty: '房间还没有消息。@ 一个 Bot 开始，或者直接发一条让主答 Bot 回。',
      everyone: '所有人',
      notMine: '该会话还没有绑定 Bot。',
      settingsTitle: '工作区 Bot 设置',
      primary: '主 Bot',
      none: '（无）',
      defaultMode: '默认模式',
      globalBudget: '每 Bot 每天唤醒上限',
      hourlyBudget: '每小时上限',
      maxMembers: '房间成员上限',
      showSessions: '在侧栏显示 Bot 会话',
      saveConfig: '保存设置',
      dataDir: '数据目录',
      loading: '加载中…',
      open: '打开',
      roomStatus: { idle: '空闲', routing: '分配中', running: '对话中', stopping: '停止中', stopped: '已停止', error: '出错' },
    };

    const EN = {
      title: 'Bots',
      subtitle: 'Resident AI teammates in this workspace, each with its own session, memory and routines.',
      stats: (b, r, w) => `${b} bots · ${r} rooms · ${w} workspaces`,
      wakesToday: (n) => `${n} wakes today`,
      emptyTitle: (name) => `No bots in ${name} yet`,
      empty: 'No bots in this workspace yet. Create one: it gets its own session, memory and routines.',
      emptyRoom: 'No rooms yet. Put 2–6 bots into a room and let them talk.',
      newBot: 'New bot',
      newRoom: 'New room',
      count: (n) => `${n} bot${n === 1 ? '' : 's'}`,
      workspaceMissing: 'Workspace directory is missing',
      noWorkspace: 'No workspace is registered yet. Open a workspace in DSH first.',
      openChat: 'Open chat',
      edit: 'Edit',
      duplicate: 'Duplicate',
      hide: 'Hide',
      show: 'Show',
      remove: 'Delete',
      pin: 'Pin',
      unpin: 'Unpin',
      exportTemplate: 'Export template',
      importTemplate: 'Import template',
      importAction: 'Import',
      templateHint: 'Paste an exported JSON here; it creates a new Bot (without memory or the old Session).',
      templateInvalid: 'The template JSON could not be parsed',
      sendTo: 'Message another Bot',
      sendHint: 'Send as this Bot to another Bot in the same workspace; at most two hops.',
      sendAction: 'Send',
      mode: { companion: 'Companion', operator: 'Operator', scout: 'Scout', chief: 'Chief' },
      state: { dormant: 'Dormant', idle: 'Idle', busy: 'Working', missing: 'Session missing', error: 'Error' },
      fail: 'Action failed',
      rooms: 'Rooms',
      room: 'Room',
      members: 'Members',
      memory: 'Memory',
      routines: 'Routines',
      autonomy: 'Autonomy',
      close: 'Close',
      save: 'Save',
      cancel: 'Cancel',
      create: 'Create',
      name: 'Name',
      label: 'One-line description',
      persona: 'Extra persona',
      modeField: 'Mode',
      workspaceField: 'Workspace',
      avatar: 'Avatar',
      section: 'Section',
      allowDm: 'Allow messaging other Bots',
      allowRoutines: 'Allow routines',
      maxRuns: 'Wakes per day',
      quietHours: 'Quiet hours',
      quietStart: 'Start',
      quietEnd: 'End',
      injected: 'Injected',
      memoryHint: 'One fact per line; changes apply on the next turn.',
      shared: 'Workspace shared facts',
      sharedHint: 'Injected into every Bot in this workspace.',
      addRoutine: 'Add routine',
      whenDaily: 'Daily at',
      whenEvery: 'Every N minutes',
      whenAfter: 'Once after N minutes',
      whenCron: 'cron',
      time: 'Time',
      minutes: 'Minutes',
      expr: 'cron expression',
      instruction: 'Instruction',
      report: 'Report',
      reportChat: 'Stay in chat',
      reportSilent: 'Silent when idle',
      reportRoom: 'Post to room',
      enable: 'Enable',
      disable: 'Pause',
      runNow: 'Run now',
      nextAt: 'Next',
      lastRun: 'Last',
      noRoutine: 'No routines yet.',
      routineCount: (n) => `${n} routine${n === 1 ? '' : 's'}`,
      danger: 'Deleting a Bot removes its memory directory; the Session is archived.',
      confirmDelete: 'Delete this Bot? Its memory files are removed and the Session archived.',
      roomName: 'Room name',
      topic: 'Topic',
      lead: 'Lead Bot',
      policy: 'Without @',
      policyPrimary: 'Only the lead Bot replies',
      policyAll: 'Every member replies',
      maxParallel: 'Parallel limit',
      handoff: 'Hand-off depth',
      pickMembers: 'Pick 2–6 members',
      post: 'Send',
      stop: 'Stop',
      typing: 'Thinking…',
      roomEmpty: 'The room is empty. @ a bot to begin, or just send a message for the lead Bot.',
      everyone: 'everyone',
      notMine: 'This Session is not bound to a Bot.',
      settingsTitle: 'Workspace Bot settings',
      primary: 'Primary Bot',
      none: 'none',
      defaultMode: 'Default mode',
      globalBudget: 'Wakes per Bot per day',
      hourlyBudget: 'Per hour',
      maxMembers: 'Room member limit',
      showSessions: 'Show Bot sessions in the sidebar',
      saveConfig: 'Save settings',
      dataDir: 'Data directory',
      loading: 'Loading…',
      open: 'Open',
      roomStatus: { idle: 'Idle', routing: 'Routing', running: 'Talking', stopping: 'Stopping', stopped: 'Stopped', error: 'Error' },
    };

    const CSS = `
.dgb-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden;container:dgb/inline-size}
.dgb-head{padding:18px clamp(20px,4vw,40px) 12px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.dgb-head-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dgb-title{font-size:20px;font-weight:600;line-height:1.3;margin:0}
.dgb-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0}
.dgb-head-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.dgb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dgb-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary)}
.dgb-btn:disabled{opacity:.45;cursor:not-allowed}
.dgb-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.dgb-btn-primary:hover:not(:disabled){filter:brightness(1.06)}
.dgb-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:transparent}
.dgb-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 6px}
.dgb-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dgb-body{flex:1;min-height:0;overflow-y:auto;padding:14px clamp(20px,4vw,40px) 40px;display:flex;flex-direction:column;gap:18px}
.dgb-ws{display:flex;flex-direction:column;gap:8px}
.dgb-ws-head{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;flex-wrap:wrap}
.dgb-ws-title{color:var(--dsw-alias-label-primary);font-weight:600}
.dgb-ws-path{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.dgb-ws-missing{color:var(--dsw-alias-state-error-primary);font-size:11px}
.dgb-list{display:flex;flex-direction:column;gap:8px}
.dgb-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.dgb-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dgb-card[data-hidden="true"]{opacity:.55}
.dgb-card-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dgb-card-top{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dgb-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dgb-chip{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:6px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);flex:none;white-space:nowrap}
.dgb-chip-mode{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);color:var(--dsw-alias-brand-primary)}
.dgb-chip-primary{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dgb-card-sub{color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgb-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,#9aa0a6)}
.dgb-dot[data-tone="busy"]{background:var(--dsw-alias-brand-primary)}
.dgb-dot[data-tone="error"],.dgb-dot[data-tone="missing"]{background:var(--dsw-alias-state-error-primary)}
.dgb-dot[data-tone="idle"]{background:var(--dsw-alias-state-success-primary)}
.dgb-actions{display:flex;align-items:center;gap:2px;flex:none;opacity:0;transition:opacity .15s ease}
.dgb-card:hover .dgb-actions,.dgb-card:focus-within .dgb-actions{opacity:1}
.dgb-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px}
.dgb-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dgb-empty{padding:24px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dgb-error{margin-top:8px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
.dgb-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none}
.dgb-loading{color:var(--dsw-alias-label-secondary);font-size:12px;padding:20px 0}
.dgb-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,#000 42%,transparent);padding:24px}
.dgb-modal{width:min(720px,92vw);max-height:86vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden}
.dgb-modal-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.dgb-modal-title{font-weight:600;font-size:15px}
.dgb-modal-body{padding:16px 18px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;min-height:0}
.dgb-modal-foot{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);flex:none}
.dgb-field{display:flex;flex-direction:column;gap:5px}
.dgb-field > label{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}
.dgb-input,.dgb-textarea,.dgb-select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;outline:none}
.dgb-input:focus,.dgb-textarea:focus,.dgb-select:focus{border-color:var(--dsw-alias-brand-primary)}
.dgb-textarea{resize:vertical;min-height:84px;line-height:1.55;font-family:inherit}
.dgb-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dgb-checks{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary)}
.dgb-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.dgb-shapes{display:flex;gap:6px;flex-wrap:wrap}
.dgb-shape{width:34px;height:34px;padding:0;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dgb-shape[data-on="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.dgb-colors{display:flex;gap:6px;flex-wrap:wrap}
.dgb-color{width:24px;height:24px;padding:0;border-radius:7px;border:2px solid transparent;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
.dgb-color[data-on="true"]{border-color:var(--dsw-alias-label-primary)}
.dgb-detail{display:flex;flex-direction:column;gap:14px}
.dgb-detail-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dgb-detail-name{display:flex;flex-direction:column;min-width:0;gap:2px}
.dgb-detail-title{font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dgb-section{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dgb-section-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dgb-section-title{font-weight:600;font-size:13px}
.dgb-section-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}
.dgb-meta{color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:14px;flex-wrap:wrap}
.dgb-routine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px}
.dgb-routine-text{flex:1;min-width:180px;line-height:1.5}
.dgb-routine-meta{color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;gap:10px;flex-wrap:wrap}
.dgb-addform{display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:10px}
.dgb-room{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base)}
.dgb-room-head{display:flex;align-items:center;gap:10px;padding:14px clamp(16px,3vw,28px);border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.dgb-room-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}
.dgb-stack{display:flex;align-items:center}
.dgb-stack .dgb-avatar{margin-right:-8px;box-shadow:0 0 0 1px var(--dsw-alias-bg-base)}
.dgb-room-body{flex:1;min-height:0;overflow-y:auto;padding:14px clamp(16px,3vw,28px);display:flex;flex-direction:column;gap:10px}
.dgb-bubble{display:flex;gap:8px;max-width:min(760px,92%)}
.dgb-bubble[data-self="true"]{align-self:flex-end;flex-direction:row-reverse}
.dgb-bubble-col{display:flex;flex-direction:column;gap:3px;min-width:0}
.dgb-bubble-author{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center}
.dgb-bubble-text{padding:8px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-word;line-height:1.55;font-size:13px}
.dgb-bubble[data-kind="user"] .dgb-bubble-text{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2))}
.dgb-bubble[data-kind="system"] .dgb-bubble-text{background:transparent;border-style:dashed;color:var(--dsw-alias-label-secondary);font-size:12px}
.dgb-bubble[data-typing="true"] .dgb-bubble-text{color:var(--dsw-alias-label-secondary);font-style:italic}
.dgb-room-foot{flex:none;border-top:1px solid var(--dsw-alias-border-l1);padding:10px clamp(16px,3vw,28px) 14px;display:flex;flex-direction:column;gap:6px}
.dgb-composer{display:flex;gap:8px;align-items:flex-end}
.dgb-composer textarea{flex:1;min-height:38px;max-height:140px;resize:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:10px;padding:9px 11px;font:inherit;font-size:13px;line-height:1.45;outline:none}
.dgb-mentions{display:flex;gap:6px;flex-wrap:wrap}
.dgb-mention{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:999px;padding:2px 10px;font:inherit;font-size:12px;cursor:pointer}
.dgb-mention:hover{border-color:var(--dsw-alias-brand-primary)}
.dgb-room-status{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;align-items:center}
.dgb-banner{padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dgb-settings{display:flex;flex-direction:column;gap:12px;padding:4px 2px;font-size:13px}
.dgb-settings .dgb-row2{align-items:end}

/* ------------------------ design language v2 ----------------------- */
.dgb-head{background:color-mix(in srgb,var(--dsw-alias-bg-base) 74%,transparent);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);box-shadow:inset 0 1px 0 rgba(255,255,255,.04);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dgb-title{font-size:22px;letter-spacing:-.02em;line-height:1.2}
.dgb-sub{font-size:12px;line-height:1.6}
.dgb-btn{height:30px;border-radius:9px;font-size:12px;font-weight:550;transition:transform .1s ease-out,border-color .15s ease,background-color .15s ease}
.dgb-btn:active:not(:disabled),.dgb-icon-btn:active,.dgb-mention:active,.dgb-shape:active,.dgb-color:active{transform:scale(.97);transition:transform .1s ease-out}
.dgb-card{padding:12px 14px;border-radius:14px;gap:12px;transition:transform .1s ease-out,border-color .15s ease,background-color .15s ease}
.dgb-card:active{transform:scale(.97)}
.dgb-chip{height:20px;border-radius:7px;padding:0 7px;font-size:11px;font-weight:550;border-color:transparent;background:var(--dsw-alias-bg-layer-2)}
.dgb-chip-mode{display:inline-flex;gap:5px;font-weight:600;background:color-mix(in srgb,var(--dgb-mode,#4e7cf6) 12%,transparent);color:color-mix(in srgb,var(--dgb-mode,#4e7cf6) 76%,var(--dsw-alias-label-primary))}
.dgb-chip-mode::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--dgb-mode,#4e7cf6);flex:none}
.dgb-chip-mode[data-mode="companion"]{--dgb-mode:#c75b7a}
.dgb-chip-mode[data-mode="scout"]{--dgb-mode:#0e9384}
.dgb-chip-mode[data-mode="chief"]{--dgb-mode:#b0721a}
.dgb-chip-mode[data-mode="operator"]{--dgb-mode:#4e7cf6}
.dgb-chip-primary{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 78%,var(--dsw-alias-label-primary))}
.dgb-name{font-size:14.5px;letter-spacing:-.005em}
.dgb-card-sub{font-size:12px;line-height:1.5}
.dgb-card-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex:none;margin-left:auto}
.dgb-usage{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dgb-avatar{border-radius:50%;overflow:hidden;box-shadow:0 0 0 1px rgba(17,18,22,.08),0 1px 2px rgba(16,18,23,.12)}
.dgb-avatar[data-shape="squircle"]{border-radius:31%}
.dgb-ws-head{align-items:center;gap:8px}
.dgb-ws-folder{display:inline-flex;color:var(--dsw-alias-label-secondary);flex:none}
.dgb-ws-title{font-weight:600;font-size:12.5px}
.dgb-empty{display:flex;align-items:center;gap:12px;padding:16px 18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.dgb-empty-icon{width:34px;height:34px;border-radius:10px;border:1px dashed var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);flex:none}
.dgb-empty-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dgb-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dgb-empty-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dgb-empty-actions{display:flex;gap:8px;flex:none}
.dgb-overlay{background:color-mix(in srgb,#0d0f13 44%,transparent);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.dgb-modal{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent);backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);border-radius:16px;box-shadow:0 24px 60px rgba(10,12,16,.34),inset 0 1px 0 rgba(255,255,255,.18);animation:dgb-modal-pop .34s cubic-bezier(.2,.9,.2,1)}
@keyframes dgb-modal-pop{from{opacity:0;transform:scale(.94) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
.dgb-modal-head{border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent}
.dgb-section{border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent)}
.dgb-bubble-text{border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 80%,transparent)}
.dgb-room-head{background:color-mix(in srgb,var(--dsw-alias-bg-base) 74%,transparent);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%)}
.dgb-room-foot{background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%)}
@media (prefers-reduced-motion:reduce){.dgb-modal{animation:none}.dgb-card:active,.dgb-btn:active:not(:disabled),.dgb-icon-btn:active,.dgb-mention:active{transform:none}}
@media (prefers-reduced-transparency:reduce){.dgb-head,.dgb-room-head,.dgb-room-foot,.dgb-modal,.dgb-overlay{backdrop-filter:none;-webkit-backdrop-filter:none}.dgb-modal{background:var(--dsw-alias-bg-layer-1)}}
@media (prefers-contrast:more){.dgb-card,.dgb-section,.dgb-empty{border-color:var(--dsw-alias-label-secondary)}}
`;

    /* --------------------------------------------------------------- utilities */

    function dictionary(ctx) {
      let id = '';
      try {
        const snapshot = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : undefined;
        id = String(snapshot?.id ?? snapshot?.locale ?? snapshot ?? '');
      } catch {
        id = '';
      }
      return id.toLowerCase().startsWith('en') ? EN : ZH;
    }

    /** Shared snapshot store: one fetch + one SSE stream for every surface. */
    const store = {
      snapshot: null,
      error: '',
      loading: true,
      started: false,
      subs: new Set(),
      deltas: new Map(),
      appendSeq: 0,
    };

    async function fetchState() {
      const response = await fetch(`/api/dsh-grok-bot/state?_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`state request failed (${response.status})`);
      return response.json();
    }

    function notifyStore() {
      for (const listener of store.subs) {
        try {
          listener();
        } catch {
          /* a broken surface must not stop the others */
        }
      }
    }

    async function reloadStore() {
      try {
        store.snapshot = await fetchState();
        store.error = '';
      } catch (error) {
        store.error = String(error?.message ?? error);
      } finally {
        store.loading = false;
        notifyStore();
      }
    }

    /** Subscribe to host events once; the store fans out to mounted surfaces. */
    function startStore() {
      if (store.started) return;
      store.started = true;
      void reloadStore();
      let source;
      let retry = 0;
      let timer = 0;
      let disposed = false;
      const connect = () => {
        if (disposed) return;
        source = new EventSource(`/api/dsh-grok-bot/events?_=${Date.now()}`);
        source.addEventListener('changed', () => void reloadStore());
        source.addEventListener('bot.status', () => void reloadStore());
        source.addEventListener('room.status', () => void reloadStore());
        source.addEventListener('room.delta', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (typeof data?.groupId === 'string' && typeof data?.botId === 'string' && typeof data?.text === 'string') {
              store.deltas.set(`${data.groupId}|${data.botId}`, data.text);
              notifyStore();
            }
          } catch {
            /* a malformed frame is ignored */
          }
        });
        source.addEventListener('room.append', () => {
          store.appendSeq += 1;
          store.deltas.clear();
          void reloadStore();
        });
        source.onopen = () => {
          retry = 0;
        };
        source.onerror = () => {
          source?.close();
          if (disposed) return;
          retry += 1;
          timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(5, retry)));
        };
      };
      connect();
      store.stopEvents = () => {
        disposed = true;
        clearTimeout(timer);
        source?.close();
      };
    }

    /** Subscribe one component to the shared store. */
    function useBotStore() {
      const [, bump] = useReducer((value) => value + 1, 0);
      useEffect(() => {
        startStore();
        const listener = () => bump();
        store.subs.add(listener);
        return () => {
          store.subs.delete(listener);
        };
      }, []);
      return store;
    }

    async function postAction(action, payload) {
      const response = await fetch('/api/dsh-grok-bot/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, payload: payload ?? {} }),
      });
      const body = await response.json().catch(() => ({ ok: false, message: 'invalid response' }));
      if (body.snapshot !== undefined) {
        store.snapshot = body.snapshot;
        store.error = '';
        notifyStore();
      }
      if (response.status >= 400 || body.ok === false) {
        throw new Error(body.message ?? `action failed (${response.status})`);
      }
      return body;
    }

    async function fetchRoom(groupId, before) {
      const query = `id=${encodeURIComponent(groupId)}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const response = await fetch(`/api/dsh-grok-bot/room?${query}&_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`room request failed (${response.status})`);
      return response.json();
    }

    function timeText(iso) {
      if (typeof iso !== 'string' || iso === '') return '—';
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime())) return '—';
      return date.toLocaleString();
    }

    function shortText(text, max) {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim();
      return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
    }

    /** Save one JSON value as a browser download. */
    function downloadJson(fileName, value) {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    /* ----------------------------------------------------------------- avatar */

    const SHAPES = ['circle', 'squircle'];
    const COLORS = ['#c75b7a', '#0e9384', '#b0721a', '#4e7cf6', '#3e8e5a', '#b85c4a', '#2f7f9e', '#66708a', '#7c8034', '#4e5560'];

    function mixColor(hex, target, amount) {
      const raw = String(hex).replace('#', '');
      if (raw.length !== 6) return hex;
      const base = [0, 2, 4].map((index) => parseInt(raw.slice(index, index + 2), 16));
      const to = target === 'white' ? 255 : 0;
      return '#' + base.map((value) => Math.round(value + (to - value) * amount).toString(16).padStart(2, '0')).join('');
    }

    function Avatar({ avatar, name, size = 38, fontSize }) {
      const shape = avatar && SHAPES.includes(avatar.shape) ? avatar.shape : 'circle';
      const color = avatar && typeof avatar.color === 'string' ? avatar.color : COLORS[0];
      const initial = String(name ?? '?').trim().slice(0, 1).toUpperCase();
      const labelSize = fontSize ?? Math.max(10, Math.round(size * 0.375));
      const gradientId = 'dgb-av-' + String(color).replace('#', '') + '-' + shape;
      const light = mixColor(color, 'white', 0.3);
      const dark = mixColor(color, 'black', 0.18);
      const baseShape = shape === 'squircle'
        ? h('rect', { key: 'base', x: 2, y: 2, width: 36, height: 36, rx: 12, fill: `url(#${gradientId})` })
        : h('circle', { key: 'base', cx: 20, cy: 20, r: 19, fill: `url(#${gradientId})` });
      const glossShape = shape === 'squircle'
        ? h('rect', { key: 'gloss', x: 2, y: 2, width: 36, height: 36, rx: 12, fill: `url(#${gradientId}-gloss)` })
        : h('circle', { key: 'gloss', cx: 20, cy: 20, r: 19, fill: `url(#${gradientId}-gloss)` });
      return h(
        'span',
        { className: 'dgb-avatar', 'data-shape': shape, style: { width: size, height: size } },
        h(
          'svg',
          { viewBox: '0 0 40 40', width: size, height: size, 'aria-hidden': 'true' },
          h(
            'defs',
            { key: 'defs' },
            h('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 0.6, y2: 1 },
              h('stop', { offset: '0%', stopColor: light }),
              h('stop', { offset: '46%', stopColor: color }),
              h('stop', { offset: '100%', stopColor: dark }),
            ),
            h('radialGradient', { id: `${gradientId}-gloss`, cx: 0.3, cy: 0.02, r: 0.9 },
              h('stop', { offset: '0%', stopColor: '#fff', stopOpacity: 0.32 }),
              h('stop', { offset: '100%', stopColor: '#fff', stopOpacity: 0 }),
            ),
          ),
          baseShape,
          glossShape,
          h(
            'text',
            {
              key: 'initial',
              x: 20,
              y: 20 + labelSize * 0.36,
              textAnchor: 'middle',
              fontSize: labelSize,
              fontWeight: 650,
              fill: '#fff',
              style: { textShadow: '0 1px 1px rgba(0,0,0,.18)' },
            },
            initial,
          ),
        ),
      );
    }
    const BotIcon = ({ size = 18 }) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 6, width: 18, height: 13, rx: 5, fill: 'currentColor', opacity: 0.9 }),
        h('circle', { cx: 9, cy: 12.5, r: 1.6, fill: '#fff' }),
        h('circle', { cx: 15, cy: 12.5, r: 1.6, fill: '#fff' }),
        h('path', { d: 'M12 4v2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 3.2, r: 1.2, fill: 'currentColor' }),
      );

    const FolderIcon = ({ size = 16 }) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );

    const RoomIcon = ({ size = 16 }) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('circle', { cx: 8, cy: 9, r: 3.2, fill: 'currentColor', opacity: 0.9 }),
        h('circle', { cx: 16.5, cy: 9.5, r: 2.6, fill: 'currentColor', opacity: 0.6 }),
        h('path', { d: 'M3 19c0-3 2.4-5 5-5s5 2 5 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M14.5 18.4c0-2.2 1.6-3.8 3.5-3.8s3 1.4 3 3.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.6 }),
      );

    /* --------------------------------------------------------------- UI pieces */

    function Modal({ title, onClose, children, footer }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [onClose]);
      return h(
        'div',
        { className: 'dgb-overlay', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'dgb-modal' },
          h('div', { className: 'dgb-modal-head' },
            h('span', { className: 'dgb-modal-title' }, title),
            h('button', { type: 'button', className: 'dgb-icon-btn', onClick: onClose, style: { marginLeft: 'auto' }, title: '关闭' }, '✕'),
          ),
          h('div', { className: 'dgb-modal-body' }, children),
          footer === undefined ? null : h('div', { className: 'dgb-modal-foot' }, footer),
        ),
      );
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'dgb-field' },
        h('label', null, label),
        children,
        hint === undefined ? null : h('span', { className: 'dgb-section-hint' }, hint),
      );
    }

    function StatusDot({ state, t }) {
      const tone = state === 'busy' ? 'busy' : state === 'idle' ? 'idle' : state === 'error' || state === 'missing' ? state : 'dormant';
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
        h('span', { className: 'dgb-dot', 'data-tone': tone }),
        t.state[state] ?? state,
      );
    }

    function avatarOf(bot) {
      return bot?.avatar ?? { shape: 'circle', color: COLORS[0] };
    }

    /* --------------------------------------------------------------- bot dialog */

    const MODE_DAILY = { companion: 4, operator: 12, scout: 8, chief: 16 };

    const emptyDraft = (mode) => ({
      name: '',
      label: '',
      mode: mode ?? 'companion',
      persona: '',
      section: '',
      avatar: { shape: 'circle', color: COLORS[0] },
      autonomy: { dm: false, routines: true, maxRunsPerDay: MODE_DAILY[mode] ?? 4, quietHours: null },
    });

    function BotDialog({ t, workspace, workspaces, bot, onClose, onDone }) {
      const editing = bot !== null && bot !== undefined;
      const [draft, setDraft] = useState(() =>
        editing
          ? {
              name: bot.name,
              label: bot.label ?? '',
              mode: bot.mode,
              persona: bot.persona ?? '',
              section: bot.section ?? '',
              avatar: avatarOf(bot),
              autonomy: { ...bot.autonomy },
            }
          : { ...emptyDraft(workspace?.config?.defaultMode), workspacePath: workspace?.path ?? '' },
      );
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
      const patchAutonomy = (key, value) =>
        setDraft((current) => ({ ...current, autonomy: { ...current.autonomy, [key]: value } }));

      const submit = () => {
        if (draft.name.trim() === '') {
          setError('名字不能为空');
          return;
        }
        setBusy(true);
        setError('');
        const quiet = draft.autonomy.quietHours;
        const normalizedQuiet =
          Array.isArray(quiet) && quiet[0] !== '' && quiet[1] !== '' ? [quiet[0], quiet[1]] : null;
        const clean = { ...draft, autonomy: { ...draft.autonomy, quietHours: normalizedQuiet } };
        delete clean.workspacePath;
        const target = editing
          ? workspace
          : (workspaces ?? []).find((item) => item.path === draft.workspacePath && !item.missing);
        if (target === undefined) {
          setError(t.workspaceMissing);
          setBusy(false);
          return;
        }
        const payload = editing
          ? { id: bot.id, workspacePath: bot.workspacePath, patch: clean }
          : { workspacePath: target.path, ...clean };
        void postAction(editing ? 'bot.update' : 'bot.create', payload)
          .then(() => onDone(editing ? bot.id : undefined))
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false));
      };

      return h(Modal, {
        title: editing ? `编辑 ${bot.name}` : t.newBot,
        onClose,
        footer: [
          h('button', { key: 'c', type: 'button', className: 'dgb-btn', onClick: onClose }, t.cancel),
          h('button', { key: 's', type: 'button', className: 'dgb-btn dgb-btn-primary', disabled: busy, onClick: submit }, editing ? t.save : t.create),
        ],
      },
        error !== '' ? h('div', { className: 'dgb-error' }, error) : null,
        editing
          ? null
          : h(Field, {
              label: t.workspaceField,
              hint: (workspaces ?? []).find((item) => item.path === draft.workspacePath)?.path ?? '',
            },
              h('select', {
                className: 'dgb-select',
                value: draft.workspacePath,
                onChange: (event) => patch('workspacePath', event.target.value),
              },
                (workspaces ?? [])
                  .filter((item) => item.missing !== true)
                  .map((item) => h('option', { key: item.path, value: item.path }, item.title)),
              ),
            ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.name }, h('input', { className: 'dgb-input', value: draft.name, onChange: (event) => patch('name', event.target.value) })),
          h(Field, { label: t.label }, h('input', { className: 'dgb-input', value: draft.label, onChange: (event) => patch('label', event.target.value) })),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.modeField },
            h('select', {
              className: 'dgb-select',
              value: draft.mode,
              onChange: (event) => {
                const mode = event.target.value;
                setDraft((current) => ({
                  ...current,
                  mode,
                  autonomy: editing
                    ? current.autonomy
                    : { ...current.autonomy, maxRunsPerDay: MODE_DAILY[mode] ?? 4 },
                }));
              },
            },
              ['companion', 'operator', 'scout', 'chief'].map((mode) =>
                h('option', { key: mode, value: mode }, `${t.mode[mode]}`),
              ),
            ),
          ),
          h(Field, { label: t.section }, h('input', { className: 'dgb-input', value: draft.section, onChange: (event) => patch('section', event.target.value) })),
        ),
        h(Field, { label: t.avatar },
          h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } },
            h(Avatar, { avatar: draft.avatar, name: draft.name || 'A', size: 44 }),
            h('div', { className: 'dgb-shapes' },
              SHAPES.map((shape) =>
                h('button', {
                  key: shape,
                  type: 'button',
                  className: 'dgb-shape',
                  'data-on': draft.avatar.shape === shape ? 'true' : 'false',
                  onClick: () => patch('avatar', { ...draft.avatar, shape }),
                }, h(Avatar, { avatar: { shape, color: draft.avatar.color }, name: draft.name || 'A', size: 26, fontSize: 12 })),
              ),
            ),
            h('div', { className: 'dgb-colors' },
              COLORS.map((color) =>
                h('button', {
                  key: color,
                  type: 'button',
                  className: 'dgb-color',
                  style: { background: color },
                  'data-on': draft.avatar.color === color ? 'true' : 'false',
                  onClick: () => patch('avatar', { ...draft.avatar, color }),
                }),
              ),
            ),
          ),
        ),
        h(Field, { label: t.persona, hint: '模式模板之外，再给 Ta 一点自己的味道。' },
          h('textarea', {
            className: 'dgb-textarea',
            value: draft.persona,
            onChange: (event) => patch('persona', event.target.value),
            placeholder: '例如：说话短一点，别端着；叫我大肥鱼。',
          }),
        ),
        h(Field, { label: t.autonomy },
          h('div', { className: 'dgb-checks' },
            h('label', { className: 'dgb-check' },
              h('input', { type: 'checkbox', checked: draft.autonomy.dm === true, onChange: (event) => patchAutonomy('dm', event.target.checked) }),
              t.allowDm,
            ),
            h('label', { className: 'dgb-check' },
              h('input', { type: 'checkbox', checked: draft.autonomy.routines !== false, onChange: (event) => patchAutonomy('routines', event.target.checked) }),
              t.allowRoutines,
            ),
          ),
          h('div', { className: 'dgb-row2', style: { marginTop: 8 } },
            h(Field, { label: t.maxRuns, hint: '与工作区上限取小值；工作区设置页保存会同步所有 Bot' },
              h('input', {
                className: 'dgb-input',
                type: 'number',
                min: 0,
                value: draft.autonomy.maxRunsPerDay ?? 4,
                onChange: (event) => patchAutonomy('maxRunsPerDay', Number(event.target.value)),
              }),
            ),
            h(Field, { label: t.quietHours },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h('input', {
                  className: 'dgb-input',
                  placeholder: '23:00',
                  value: draft.autonomy.quietHours?.[0] ?? '',
                  onChange: (event) => {
                    const value = event.target.value.trim();
                    const end = draft.autonomy.quietHours?.[1] ?? '';
                    patchAutonomy('quietHours', value === '' && end === '' ? null : [value, end]);
                  },
                }),
                h('span', null, '–'),
                h('input', {
                  className: 'dgb-input',
                  placeholder: '07:00',
                  value: draft.autonomy.quietHours?.[1] ?? '',
                  onChange: (event) => {
                    const start = draft.autonomy.quietHours?.[0] ?? '';
                    const value = event.target.value.trim();
                    patchAutonomy('quietHours', start === '' && value === '' ? null : [start, value]);
                  },
                }),
              ),
            ),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------- room dialog */

    function RoomDialog({ t, workspace, onClose, onDone }) {
      const available = (store.snapshot?.bots ?? []).filter((bot) => bot.workspacePath === workspace.path);
      const [draft, setDraft] = useState({ name: '', topic: '', members: [], leadBotId: '', responderPolicy: 'primary', maxParallel: 2, handoffDepth: 1 });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
      const toggleMember = (id) => {
        setDraft((current) => {
          const members = current.members.includes(id)
            ? current.members.filter((member) => member !== id)
            : [...current.members, id].slice(0, 6);
          const leadBotId = members.includes(current.leadBotId) ? current.leadBotId : members[0] ?? '';
          return { ...current, members, leadBotId };
        });
      };
      const submit = () => {
        if (draft.name.trim() === '') {
          setError('房间名字不能为空');
          return;
        }
        if (draft.members.length < 2) {
          setError(t.pickMembers);
          return;
        }
        setBusy(true);
        setError('');
        void postAction('group.create', {
          workspacePath: workspace.path,
          name: draft.name,
          topic: draft.topic,
          members: draft.members,
          leadBotId: draft.leadBotId,
          responderPolicy: draft.responderPolicy,
          maxParallel: Number(draft.maxParallel) || 1,
          handoffDepth: Number(draft.handoffDepth) || 0,
        })
          .then(() => onDone())
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false));
      };

      return h(Modal, {
        title: t.newRoom,
        onClose,
        footer: [
          h('button', { key: 'c', type: 'button', className: 'dgb-btn', onClick: onClose }, t.cancel),
          h('button', { key: 's', type: 'button', className: 'dgb-btn dgb-btn-primary', disabled: busy, onClick: submit }, t.create),
        ],
      },
        error !== '' ? h('div', { className: 'dgb-error' }, error) : null,
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.roomName }, h('input', { className: 'dgb-input', value: draft.name, onChange: (event) => patch('name', event.target.value) })),
          h(Field, { label: t.topic }, h('input', { className: 'dgb-input', value: draft.topic, onChange: (event) => patch('topic', event.target.value) })),
        ),
        h(Field, { label: t.members, hint: t.pickMembers },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            available.map((bot) =>
              h('label', { key: bot.id, className: 'dgb-check' },
                h('input', { type: 'checkbox', checked: draft.members.includes(bot.id), onChange: () => toggleMember(bot.id) }),
                h(Avatar, { avatar: avatarOf(bot), name: bot.name, size: 22, fontSize: 10 }),
                bot.name,
                h('span', { className: 'dgb-chip' }, t.mode[bot.mode] ?? bot.mode),
              ),
            ),
          ),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.lead },
            h('select', { className: 'dgb-select', value: draft.leadBotId, onChange: (event) => patch('leadBotId', event.target.value) },
              available.filter((bot) => draft.members.includes(bot.id)).map((bot) => h('option', { key: bot.id, value: bot.id }, bot.name)),
            ),
          ),
          h(Field, { label: t.policy },
            h('select', { className: 'dgb-select', value: draft.responderPolicy, onChange: (event) => patch('responderPolicy', event.target.value) },
              h('option', { value: 'primary' }, t.policyPrimary),
              h('option', { value: 'all' }, t.policyAll),
            ),
          ),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.maxParallel }, h('input', { className: 'dgb-input', type: 'number', min: 1, max: 6, value: draft.maxParallel, onChange: (event) => patch('maxParallel', event.target.value) })),
          h(Field, { label: t.handoff }, h('input', { className: 'dgb-input', type: 'number', min: 0, max: 2, value: draft.handoffDepth, onChange: (event) => patch('handoffDepth', event.target.value) })),
        ),
      );
    }

    /* --------------------------------------------------------- import dialog */

    function ImportDialog({ t, workspace, onClose, onDone }) {
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const submit = () => {
        let template;
        try {
          template = JSON.parse(text);
        } catch {
          setError(t.templateInvalid);
          return;
        }
        setBusy(true);
        setError('');
        void postAction('bot.import', { workspacePath: workspace.path, template })
          .then(() => onDone())
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false));
      };
      return h(Modal, {
        title: t.importTemplate,
        onClose,
        footer: [
          h('button', { key: 'c', type: 'button', className: 'dgb-btn', onClick: onClose }, t.cancel),
          h('button', { key: 'i', type: 'button', className: 'dgb-btn dgb-btn-primary', disabled: busy, onClick: submit }, t.importAction),
        ],
      },
        error !== '' ? h('div', { className: 'dgb-error' }, error) : null,
        h(Field, { label: 'JSON', hint: t.templateHint },
          h('textarea', { className: 'dgb-textarea', style: { minHeight: 200 }, value: text, onChange: (event) => setText(event.target.value) }),
        ),
      );
    }

    /* --------------------------------------------------------------- bot detail */

    function BotDetail({ t, bot, workspace, onBack, onEdit, onDeleted }) {
      const [memory, setMemory] = useState(null);
      const [shared, setShared] = useState('');
      const [memoryBusy, setMemoryBusy] = useState(false);
      const [error, setError] = useState('');
      const [routineDraft, setRoutineDraft] = useState({ kind: 'daily', time: '09:00', minutes: 60, expr: '0 9 * * *', instruction: '', report: 'chat', groupId: '', enabled: true });
      const [showRoutineForm, setShowRoutineForm] = useState(false);
      const [sendTarget, setSendTarget] = useState('');
      const [sendText, setSendText] = useState('');
      const [sendResult, setSendResult] = useState('');
      const peers = (store.snapshot?.bots ?? []).filter((item) => item.id !== bot.id && item.workspacePath === bot.workspacePath);
      const workspaceGroups = (store.snapshot?.groups ?? []).filter((group) => group.workspacePath === bot.workspacePath);

      useEffect(() => {
        let alive = true;
        void postAction('memory.read', { id: bot.id, workspacePath: bot.workspacePath })
          .then((result) => {
            if (!alive) return;
            setMemory(result.memory);
            setShared(result.memory.shared ?? '');
          })
          .catch((failure) => setError(String(failure?.message ?? failure)));
        return () => {
          alive = false;
        };
      }, [bot.id]);

      const saveMemory = () => {
        if (memory === null) return;
        setMemoryBusy(true);
        setError('');
        void postAction('memory.write', { id: bot.id, workspacePath: bot.workspacePath, text: memory.text })
          .then(() => postAction('shared.write', { workspacePath: workspace.path, text: shared }))
          .then(() => postAction('memory.read', { id: bot.id, workspacePath: bot.workspacePath }))
          .then((result) => {
            setMemory(result.memory);
            setShared(result.memory.shared ?? '');
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setMemoryBusy(false));
      };

      const addRoutine = () => {
        if (routineDraft.instruction.trim() === '') {
          setError('任务指令不能为空');
          return;
        }
        const when =
          routineDraft.kind === 'daily'
            ? { kind: 'daily', time: routineDraft.time }
            : routineDraft.kind === 'every'
              ? { kind: 'every', minutes: Number(routineDraft.minutes) || 60 }
              : routineDraft.kind === 'after'
                ? { kind: 'after', minutes: Number(routineDraft.minutes) || 60 }
                : { kind: 'cron', expr: routineDraft.expr };
        void postAction('routine.create', {
          id: bot.id,
          workspacePath: bot.workspacePath,
          when,
          instruction: routineDraft.instruction,
          report: routineDraft.report,
          groupId: routineDraft.report === 'room' && routineDraft.groupId !== '' ? routineDraft.groupId : null,
          enabled: true,
        })
          .then(() => {
            setShowRoutineForm(false);
            setRoutineDraft((current) => ({ ...current, instruction: '' }));
          })
          .catch((failure) => setError(String(failure?.message ?? failure)));
      };

      const describeWhen = (when) => {
        if (when.kind === 'daily') return `${t.whenDaily} ${when.time}`;
        if (when.kind === 'every') return `${t.whenEvery.replace('N', String(when.minutes))}`;
        if (when.kind === 'after') return `${t.whenAfter.replace('N', String(when.minutes))}`;
        return `cron ${when.expr}`;
      };

      return h('div', { className: 'dgb-detail' },
        h('div', { className: 'dgb-detail-head' },
          h('button', { type: 'button', className: 'dgb-btn dgb-btn-ghost', onClick: onBack }, '← 返回'),
          h(Avatar, { avatar: avatarOf(bot), name: bot.name, size: 44 }),
          h('div', { className: 'dgb-detail-name' },
            h('div', { className: 'dgb-detail-title' },
              bot.name,
              h('span', { className: 'dgb-chip dgb-chip-mode' }, t.mode[bot.mode] ?? bot.mode),
              bot.primary === true ? h('span', { className: 'dgb-chip dgb-chip-primary' }, t.primary) : null,
              h(StatusDot, { state: bot.runtimeState ?? 'dormant', t }),
            ),
            h('span', { className: 'dgb-card-sub' }, bot.label || bot.id),
          ),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            h('button', {
              type: 'button',
              className: 'dgb-btn',
              onClick: () => {
                void postAction('bot.export', { id: bot.id, workspacePath: bot.workspacePath })
                  .then((result) => downloadJson(bot.id + '-template.json', result.template))
                  .catch((failure) => setError(String(failure?.message ?? failure)));
              },
            }, t.exportTemplate),
            h('button', {
              type: 'button',
              className: 'dgb-btn',
              onClick: () => openBotSession(bot),
            }, t.openChat),
            h('button', { type: 'button', className: 'dgb-btn', onClick: onEdit }, t.edit),
          ),
        ),
        error !== '' ? h('div', { className: 'dgb-error' }, error) : null,
        h('div', { className: 'dgb-meta' },
          bot.sessionId ? h('span', null, `Session: ${shortText(bot.sessionId, 44)}`) : h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, t.state.missing),
          h('span', null, `记忆 ${memory === null ? '…' : memory.bytes} B · 注入 ${memory === null ? '…' : memory.injected.chars} 字符`),
          h('span', null, `${t.routineCount(bot.routines.length)}`),
          h('span', null, `${t.usage ?? '用法'}: ${bot.usage?.today ?? 0}/${bot.usage?.total ?? 0}${bot.usage?.lastOutcome ? ` · ${bot.usage.lastOutcome}` : ''}`),
          h('span', null, bot.workspacePath),
        ),
        bot.runtimeState === 'missing'
          ? h('div', { className: 'dgb-section' },
              h('div', { className: 'dgb-section-head' }, h('span', { className: 'dgb-section-title' }, t.state.missing)),
              h('p', { className: 'dgb-section-hint' }, '这个 Bot 的会话已经不在了（被归档或删除）。可以重建一个，旧历史不会迁移。'),
              h('button', {
                type: 'button',
                className: 'dgb-btn',
                onClick: () => {
                  if (!window.confirm('确认重建这个 Bot 的会话？旧历史不会迁移。')) return;
                  void postAction('bot.rebuild_session', { id: bot.id, workspacePath: bot.workspacePath, confirm: true }).catch((failure) => setError(String(failure?.message ?? failure)));
                },
              }, '重建会话'),
            )
          : null,
        h('div', { className: 'dgb-section' },
          h('div', { className: 'dgb-section-head' },
            h('span', { className: 'dgb-section-title' }, t.memory),
            h('span', { className: 'dgb-chip' }, `${t.injected}: ${memory === null ? '…' : `${memory.injected.chars}/6000`}`),
            h('button', { type: 'button', className: 'dgb-btn dgb-btn-primary', style: { marginLeft: 'auto' }, disabled: memoryBusy || memory === null, onClick: saveMemory }, t.save),
          ),
          h('p', { className: 'dgb-section-hint' }, t.memoryHint),
          h('textarea', {
            className: 'dgb-textarea',
            style: { minHeight: 150 },
            value: memory === null ? '' : memory.text,
            onChange: (event) => setMemory((current) => ({ ...(current ?? {}), text: event.target.value })),
          }),
          h(Field, { label: t.shared, hint: t.sharedHint },
            h('textarea', {
              className: 'dgb-textarea',
              style: { minHeight: 74 },
              value: shared,
              onChange: (event) => setShared(event.target.value),
            }),
          ),
          memory !== null && memory.logs.length > 0
            ? h('div', null,
                memory.logs.map((entry) =>
                  h('div', { key: entry.day, className: 'dgb-section-hint', style: { marginTop: 6 } },
                    h('b', null, entry.day),
                    h('pre', { style: { whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11.5 } }, entry.text),
                  ),
                ),
              )
            : null,
        ),
        h('div', { className: 'dgb-section' },
          h('div', { className: 'dgb-section-head' },
            h('span', { className: 'dgb-section-title' }, t.routines),
            h('span', { className: 'dgb-chip' }, t.routineCount(bot.routines.length)),
            h('button', { type: 'button', className: 'dgb-btn', style: { marginLeft: 'auto' }, onClick: () => setShowRoutineForm((value) => !value) }, t.addRoutine),
          ),
          bot.routines.length === 0 && !showRoutineForm ? h('p', { className: 'dgb-section-hint' }, t.noRoutine) : null,
          bot.routines.map((routine) =>
            h('div', { key: routine.id, className: 'dgb-routine' },
              h('div', { className: 'dgb-routine-text' },
                h('div', null, routine.instruction),
                h('div', { className: 'dgb-routine-meta' },
                  h('span', null, describeWhen(routine.when)),
                  h('span', null, `${t.report}: ${routine.report === 'silent' ? t.reportSilent : routine.report === 'room' ? t.reportRoom : t.reportChat}`),
                  h('span', null, `${t.nextAt}: ${timeText(routine.nextAt)}`),
                  routine.lastRunAt ? h('span', null, `${t.lastRun}: ${timeText(routine.lastRunAt)} · ${routine.lastOutcome ?? ''}`) : null,
                  routine.failures > 0 ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `失败 ${routine.failures}`) : null,
                  routine.pausedReason ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, routine.pausedReason) : null,
                ),
              ),
              h('button', {
                type: 'button',
                className: 'dgb-btn',
                onClick: () => void postAction('routine.update', { id: bot.id, workspacePath: bot.workspacePath, routineId: routine.id, enabled: !routine.enabled }).catch((failure) => setError(String(failure?.message ?? failure))),
              }, routine.enabled ? t.disable : t.enable),
              h('button', {
                type: 'button',
                className: 'dgb-btn',
                onClick: () => void postAction('routine.run_now', { id: bot.id, workspacePath: bot.workspacePath, routineId: routine.id }).catch((failure) => setError(String(failure?.message ?? failure))),
              }, t.runNow),
              h('button', {
                type: 'button',
                className: 'dgb-icon-btn',
                onClick: () => void postAction('routine.delete', { id: bot.id, workspacePath: bot.workspacePath, routineId: routine.id }).catch((failure) => setError(String(failure?.message ?? failure))),
                title: '删除',
              }, '✕'),
            ),
          ),
          showRoutineForm
            ? h('div', { className: 'dgb-addform' },
                h('div', { className: 'dgb-row2' },
                  h(Field, { label: t.whenDaily },
                    h('select', {
                      className: 'dgb-select',
                      value: routineDraft.kind,
                      onChange: (event) => setRoutineDraft((current) => ({ ...current, kind: event.target.value })),
                    },
                      h('option', { value: 'daily' }, t.whenDaily),
                      h('option', { value: 'every' }, t.whenEvery),
                      h('option', { value: 'after' }, t.whenAfter),
                      h('option', { value: 'cron' }, t.whenCron),
                    ),
                  ),
                  routineDraft.kind === 'daily'
                    ? h(Field, { label: t.time }, h('input', { className: 'dgb-input', value: routineDraft.time, onChange: (event) => setRoutineDraft((current) => ({ ...current, time: event.target.value })) }))
                    : routineDraft.kind === 'cron'
                      ? h(Field, { label: t.expr }, h('input', { className: 'dgb-input', value: routineDraft.expr, onChange: (event) => setRoutineDraft((current) => ({ ...current, expr: event.target.value })) }))
                      : h(Field, { label: t.minutes }, h('input', { className: 'dgb-input', type: 'number', min: 1, value: routineDraft.minutes, onChange: (event) => setRoutineDraft((current) => ({ ...current, minutes: event.target.value })) })),
                ),
                h(Field, { label: t.instruction }, h('textarea', { className: 'dgb-textarea', value: routineDraft.instruction, onChange: (event) => setRoutineDraft((current) => ({ ...current, instruction: event.target.value })), placeholder: '例如：检查昨天的待办并汇报；没事就静默收尾。' })),
                h(Field, { label: t.report },
                  h('select', { className: 'dgb-select', value: routineDraft.report, onChange: (event) => setRoutineDraft((current) => ({ ...current, report: event.target.value })) },
                    h('option', { value: 'chat' }, t.reportChat),
                    h('option', { value: 'silent' }, t.reportSilent),
                    h('option', { value: 'room' }, t.reportRoom),
                  ),
                ),
                routineDraft.report === 'room'
                  ? h(Field, { label: t.room },
                      h('select', {
                        className: 'dgb-select',
                        value: routineDraft.groupId,
                        onChange: (event) => setRoutineDraft((current) => ({ ...current, groupId: event.target.value })),
                      },
                        h('option', { key: 'none', value: '' }, '（选一个房间）'),
                        workspaceGroups.map((group) => h('option', { key: group.id, value: group.id }, group.name)),
                      ),
                    )
                  : null,
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
                  h('button', { type: 'button', className: 'dgb-btn', onClick: () => setShowRoutineForm(false) }, t.cancel),
                  h('button', { type: 'button', className: 'dgb-btn dgb-btn-primary', onClick: addRoutine }, t.addRoutine),
                ),
              )
            : null,
        ),
        h('div', { className: 'dgb-section' },
          h('div', { className: 'dgb-section-head' }, h('span', { className: 'dgb-section-title' }, t.sendTo)),
          h('p', { className: 'dgb-section-hint' }, t.sendHint),
          h('div', { className: 'dgb-row2' },
            h(Field, { label: '目标' },
              h('select', {
                className: 'dgb-select',
                value: sendTarget,
                onChange: (event) => setSendTarget(event.target.value),
              },
                h('option', { key: 'none', value: '' }, '（选一个）'),
                peers.map((peer) => h('option', { key: peer.id, value: peer.id }, peer.name)),
              ),
            ),
            h('button', {
              type: 'button',
              className: 'dgb-btn dgb-btn-primary',
              style: { alignSelf: 'end', marginTop: 6 },
              disabled: sendTarget === '' || sendText.trim() === '',
              onClick: () => {
                setSendResult('');
                void postAction('bot.send', { id: bot.id, workspacePath: bot.workspacePath, target: sendTarget, text: sendText })
                  .then((result) => {
                    setSendResult(String(result.text ?? '已送达'));
                    setSendText('');
                  })
                  .catch((failure) => setSendResult(String(failure?.message ?? failure)));
              },
            }, t.sendAction),
          ),
          h('textarea', {
            className: 'dgb-textarea',
            style: { minHeight: 60 },
            value: sendText,
            placeholder: '要交给对方的事：目标、边界、交付物。',
            onChange: (event) => setSendText(event.target.value),
          }),
          sendResult !== '' ? h('div', { className: 'dgb-banner' }, sendResult) : null,
        ),
        h('div', { className: 'dgb-section' },
          h('div', { className: 'dgb-section-head' }, h('span', { className: 'dgb-section-title' }, '危险区')),
          h('p', { className: 'dgb-section-hint' }, t.danger),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', {
              type: 'button',
              className: 'dgb-btn dgb-btn-danger',
              onClick: () => {
                if (!window.confirm(t.confirmDelete)) return;
                void postAction('bot.delete', { id: bot.id, workspacePath: bot.workspacePath, confirm: true }).then(() => onDeleted()).catch((failure) => setError(String(failure?.message ?? failure)));
              },
            }, t.remove),
          ),
        ),
      );
    }

    /* ---------------------------------------------------------------- room view */

    function RoomView({ t, group, bots, onBack, onDeleted }) {
      const shared = useBotStore();
      const [messages, setMessages] = useState([]);
      const [draft, setDraft] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [typing, setTyping] = useState(false);
      const bodyRef = useRef(null);
      const groupId = group.id;
      const members = (bots ?? []).filter((bot) => group.members.includes(bot.id));
      const status = group.runtime ?? { status: 'idle', responders: [] };
      const mentionMatch = /(^|\s)@([^\s@]*)$/.exec(draft);
      const mentionQuery = mentionMatch === null ? null : mentionMatch[2].toLowerCase();
      const mentionCandidates = mentionQuery === null
        ? []
        : members.filter((member) => member.name.toLowerCase().includes(mentionQuery)).slice(0, 6);

      const load = () => {
        void fetchRoom(groupId)
          .then((page) => {
            setMessages(page.messages ?? []);
            requestAnimationFrame(() => {
              if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
            });
          })
          .catch((failure) => setError(String(failure?.message ?? failure)));
      };

      useEffect(() => {
        load();
      }, [groupId, shared.appendSeq]);

      useEffect(() => {
        setTyping(status.status === 'running');
      }, [status.status]);

      const send = () => {
        const text = draft.trim();
        if (text === '') return;
        setBusy(true);
        setError('');
        void postAction('room.post', { groupId, text })
          .then(() => {
            setDraft('');
            load();
          })
          .catch((failure) => setError(String(failure?.message ?? failure)))
          .finally(() => setBusy(false));
      };

      const stop = () => {
        void postAction('room.stop', { groupId }).catch((failure) => setError(String(failure?.message ?? failure)));
      };

      return h('div', { className: 'dgb-room' },
        h('div', { className: 'dgb-room-head' },
          h('button', { type: 'button', className: 'dgb-btn dgb-btn-ghost', onClick: onBack }, '← 返回'),
          h('div', { className: 'dgb-room-title' }, h(RoomIcon, null), group.name),
          h('span', { className: 'dgb-stack' }, members.slice(0, 6).map((bot) => h(Avatar, { key: bot.id, avatar: avatarOf(bot), name: bot.name, size: 24, fontSize: 10 }))),
          h('div', { className: 'dgb-room-status' },
            h('span', { className: 'dgb-chip' }, t.roomStatus[status.status] ?? status.status),
            status.status === 'running' ? h('span', null, t.typing) : null,
          ),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            h('button', { type: 'button', className: 'dgb-btn dgb-btn-danger', disabled: status.status !== 'running' && status.status !== 'routing', onClick: stop }, t.stop),
            h('button', {
              type: 'button',
              className: 'dgb-btn dgb-btn-ghost',
              onClick: () => {
                if (!window.confirm('删除这个房间？记录会被删除。')) return;
                void postAction('group.delete', { groupId }).then(() => onDeleted()).catch((failure) => setError(String(failure?.message ?? failure)));
              },
            }, t.remove),
          ),
        ),
        error !== '' ? h('div', { className: 'dgb-error', style: { margin: '10px 18px 0' } }, error) : null,
        h('div', { className: 'dgb-room-body', ref: bodyRef },
          messages.length === 0 ? h('div', { className: 'dgb-empty' }, t.roomEmpty) : null,
          messages.map((message) => {
            const bot = message.authorId === null ? undefined : members.find((member) => member.id === message.authorId);
            return h('div', {
              key: message.id,
              className: 'dgb-bubble',
              'data-kind': message.kind,
              'data-self': message.kind === 'user' ? 'true' : 'false',
            },
              message.kind === 'bot' && bot !== undefined ? h(Avatar, { avatar: avatarOf(bot), name: bot.name, size: 26, fontSize: 11 }) : null,
              h('div', { className: 'dgb-bubble-col' },
                h('div', { className: 'dgb-bubble-author' },
                  message.kind === 'user' ? '我' : message.kind === 'bot' ? (bot?.name ?? message.authorId ?? 'Bot') : 'system',
                  h('span', null, timeText(message.at)),
                ),
                h('div', { className: 'dgb-bubble-text' }, message.text),
              ),
            );
          }),
          [...store.deltas.entries()]
            .filter(([key]) => key.startsWith(`${groupId}|`))
            .map(([key, value]) => {
              const botId = key.slice(groupId.length + 1);
              const bot = members.find((member) => member.id === botId);
              return h('div', { key: `stream-${botId}`, className: 'dgb-bubble', 'data-kind': 'bot', 'data-typing': 'true' },
                bot !== undefined ? h(Avatar, { avatar: avatarOf(bot), name: bot.name, size: 26, fontSize: 11 }) : null,
                h('div', { className: 'dgb-bubble-col' },
                  h('div', { className: 'dgb-bubble-author' }, bot?.name ?? botId),
                  h('div', { className: 'dgb-bubble-text' }, value === '' ? t.typing : value),
                ),
              );
            }),
          typing && store.deltas.size === 0
            ? h('div', { className: 'dgb-bubble', 'data-typing': 'true' },
                h('div', { className: 'dgb-bubble-col' }, h('div', { className: 'dgb-bubble-text' }, t.typing)),
              )
            : null,
        ),
        h('div', { className: 'dgb-room-foot' },
          mentionCandidates.length > 0
            ? h('div', { className: 'dgb-mentions', style: { borderTop: '1px dashed var(--dsw-alias-border-l1)', paddingTop: 6 } },
                mentionCandidates.map((member) =>
                  h('button', {
                    key: `mention-${member.id}`,
                    type: 'button',
                    className: 'dgb-mention',
                    onClick: () => setDraft((current) => current.replace(/@[^\s@]*$/, `@${member.name} `)),
                  }, `@${member.name}`),
                ),
              )
            : null,
          h('div', { className: 'dgb-mentions' },
            h('button', { type: 'button', className: 'dgb-mention', onClick: () => setDraft((current) => `${current}@everyone `.trimStart()) }, `@${t.everyone}`),
            members.map((bot) =>
              h('button', { key: bot.id, type: 'button', className: 'dgb-mention', onClick: () => setDraft((current) => `${current}@${bot.name} `.trimStart()) }, `@${bot.name}`),
            ),
          ),
          h('div', { className: 'dgb-composer' },
            h('textarea', {
              value: draft,
              placeholder: `@${members[0]?.name ?? 'Bot'} 说点什么…`,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              },
            }),
            h('button', { type: 'button', className: 'dgb-btn dgb-btn-primary', disabled: busy, onClick: send }, t.post),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------ settings card */

    function SettingsCard({ t }) {
      const snapshot = useBotStore();
      const configs = snapshot.snapshot?.configs ?? [];
      const [selected, setSelected] = useState(0);
      const [draft, setDraft] = useState(null);
      const entry = configs[selected];
      useEffect(() => {
        setDraft(entry === undefined ? null : { ...entry.config });
      }, [entry?.workspacePath]);
      if (entry === undefined || draft === null) return h('div', { className: 'dgb-loading' }, t.loading);
      const bots = (snapshot.snapshot?.bots ?? []).filter((bot) => bot.workspacePath === entry.workspacePath);
      const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
      return h('div', { className: 'dgb-settings' },
        h('div', { className: 'dgb-section-head' },
          h('span', { className: 'dgb-section-title' }, t.settingsTitle),
          h('select', { className: 'dgb-select', style: { maxWidth: 280, marginLeft: 'auto' }, value: String(selected), onChange: (event) => setSelected(Number(event.target.value)) },
            configs.map((item, index) => h('option', { key: item.workspacePath, value: String(index) }, item.workspacePath)),
          ),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.primary },
            h('select', { className: 'dgb-select', value: draft.primaryBotId ?? '', onChange: (event) => patch('primaryBotId', event.target.value || null) },
              h('option', { value: '' }, t.none),
              bots.map((bot) => h('option', { key: bot.id, value: bot.id }, bot.name)),
            ),
          ),
          h(Field, { label: t.defaultMode },
            h('select', { className: 'dgb-select', value: draft.defaultMode ?? 'companion', onChange: (event) => patch('defaultMode', event.target.value) },
              ['companion', 'operator', 'scout', 'chief'].map((mode) => h('option', { key: mode, value: mode }, t.mode[mode])),
            ),
          ),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.globalBudget, hint: '保存后应用到本工作区所有 Bot；单个 Bot 详情里还能再调小。' }, h('input', { className: 'dgb-input', type: 'number', min: 0, value: draft.maxRunsPerDay ?? 20, onChange: (event) => patch('maxRunsPerDay', Number(event.target.value)) })),
          h(Field, { label: t.hourlyBudget }, h('input', { className: 'dgb-input', type: 'number', min: 0, value: draft.maxRunsPerHour ?? 4, onChange: (event) => patch('maxRunsPerHour', Number(event.target.value)) })),
        ),
        h('div', { className: 'dgb-row2' },
          h(Field, { label: t.maxMembers }, h('input', { className: 'dgb-input', type: 'number', min: 2, max: 6, value: draft.maxGroupMembers ?? 6, onChange: (event) => patch('maxGroupMembers', Number(event.target.value)) })),
          h('label', { className: 'dgb-check', style: { alignSelf: 'end', paddingBottom: 6 } },
            h('input', { type: 'checkbox', checked: draft.showBotSessions !== false, onChange: (event) => patch('showBotSessions', event.target.checked) }),
            t.showSessions,
          ),
        ),
        h(Field, { label: t.quietHours },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('input', { className: 'dgb-input', placeholder: '23:00', value: draft.quietHours?.[0] ?? '', onChange: (event) => patch('quietHours', [event.target.value.trim(), draft.quietHours?.[1] ?? '']) }),
            h('span', null, '–'),
            h('input', { className: 'dgb-input', placeholder: '07:00', value: draft.quietHours?.[1] ?? '', onChange: (event) => patch('quietHours', [draft.quietHours?.[0] ?? '', event.target.value.trim()]) }),
            h('button', { type: 'button', className: 'dgb-btn', onClick: () => patch('quietHours', null) }, t.none),
          ),
        ),
        h('p', { className: 'dgb-section-hint' }, `${t.dataDir}: ${entry.workspacePath}\\.deepseek-harness\\bots`),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', {
            type: 'button',
            className: 'dgb-btn dgb-btn-primary',
            onClick: () => void postAction('config.update', { workspacePath: entry.workspacePath, patch: draft }),
          }, t.saveConfig),
        ),
      );
    }

    /* --------------------------------------------------------------- main panel */

    function openBotSession(bot) {
      const target = bot.sessionId;
      if (typeof target !== 'string') return;
      const uiWorkspace = typeof ctxRef.current?.get === 'function' ? ctxRef.current.get('uiWorkspace', false) : undefined;
      if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
        try {
          uiWorkspace.openSession(target);
          return;
        } catch {
          /* fall through to the event route */
        }
      }
      window.dispatchEvent(new CustomEvent('dsh-grok-bot:open-session', { detail: { sessionId: target } }));
    }

    const ctxRef = { current: undefined };
    function BotsPanel({ t }) {
      const shared = useBotStore();
      const snapshot = shared.snapshot;
      const [dialog, setDialog] = useState(null);
      const [selectedId, setSelectedId] = useState(null);
      const [roomId, setRoomId] = useState(null);
      const [error, setError] = useState('');

      const bots = snapshot?.bots ?? [];
      const groups = snapshot?.groups ?? [];
      const workspaces = snapshot?.workspaces ?? [];
      const activeWorkspaces = workspaces.filter((workspace) =>
        bots.some((bot) => bot.workspacePath === workspace.path),
      );
      const selected = selectedId === null ? null : bots.find((bot) => bot.id === selectedId);
      const room = roomId === null ? null : groups.find((group) => group.id === roomId);

      const run = (action, payload) => {
        setError('');
        return postAction(action, payload).catch((failure) => {
          setError(String(failure?.message ?? failure));
          throw failure;
        });
      };

      if (room !== null) {
        return h(RoomView, {
          t,
          group: room,
          bots,
          onBack: () => setRoomId(null),
          onDeleted: () => setRoomId(null),
        });
      }

      return h('div', { className: 'dgb-page' },
        h('div', { className: 'dgb-head' },
          h('div', { className: 'dgb-head-row' },
            selected === null ? h('h1', { className: 'dgb-title' }, t.title) : h('h1', { className: 'dgb-title' }, t.title),
            h('span', { className: 'dgb-chip' }, t.count(bots.length)),
            h('div', { className: 'dgb-head-actions' },
              h('button', {
                type: 'button',
                className: 'dgb-btn',
                disabled: workspaces.length === 0,
                onClick: () => {
                  const target = workspaces.find((workspace) => !workspace.missing);
                  if (target === undefined) return;
                  setDialog({ kind: 'import', workspace: target });
                },
              }, t.importTemplate),
              h('button', {
                type: 'button',
                className: 'dgb-btn',
                disabled: bots.length < 2,
                onClick: () => {
                  const target = workspaces.find((workspace) => bots.some((bot) => bot.workspacePath === workspace.path));
                  if (target === undefined) return;
                  setDialog({ kind: 'room', workspace: target });
                },
              }, t.newRoom),
              h('button', {
                type: 'button',
                className: 'dgb-btn dgb-btn-primary',
                disabled: workspaces.length === 0,
                onClick: () => {
                  const target =
                    workspaces.find((workspace) => !workspace.missing && bots.some((bot) => bot.workspacePath === workspace.path)) ??
                    workspaces.find((workspace) => !workspace.missing);
                  if (target === undefined) return;
                  setDialog({ kind: 'bot', workspace: target, bot: null });
                },
              }, t.newBot),
            ),
          ),
          h('p', { className: 'dgb-sub' }, snapshot === null || snapshot === undefined ? t.subtitle : t.stats(bots.length, groups.length, activeWorkspaces.length)),
          shared.error !== '' ? h('div', { className: 'dgb-error' }, `${t.fail}: ${shared.error}`) : null,
          error !== '' ? h('div', { className: 'dgb-error' }, `${t.fail}: ${error}`) : null,
        ),
        h('div', { className: 'dgb-body' },
          shared.loading ? h('div', { className: 'dgb-loading' }, t.loading) : null,
          !shared.loading && workspaces.length === 0 ? h('div', { className: 'dgb-empty' }, t.noWorkspace) : null,
          selected !== null
            ? h(BotDetail, {
                t,
                bot: selected,
                workspace: workspaces.find((workspace) => workspace.path === selected.workspacePath) ?? { path: selected.workspacePath, config: {} },
                onBack: () => setSelectedId(null),
                onEdit: () => setDialog({
                  kind: 'bot',
                  workspace: workspaces.find((workspace) => workspace.path === selected.workspacePath),
                  bot: selected,
                }),
                onDeleted: () => setSelectedId(null),
              })
            : [
                bots.length === 0
                  ? h('div', { className: 'dgb-empty', style: { marginTop: 4 } },
                      h('span', { className: 'dgb-empty-icon' }, h(FolderIcon, { size: 16 })),
                      h('div', { className: 'dgb-empty-main' },
                        h('span', { className: 'dgb-empty-title' }, t.title),
                        h('span', { className: 'dgb-empty-hint' }, t.empty),
                      ),
                      h('div', { className: 'dgb-empty-actions' },
                        h('button', {
                          type: 'button',
                          className: 'dgb-btn',
                          disabled: workspaces.every((workspace) => workspace.missing),
                          onClick: () => {
                            const target = workspaces.find((workspace) => !workspace.missing);
                            if (target !== undefined) setDialog({ kind: 'bot', workspace: target, bot: null });
                          },
                        }, t.newBot),
                        h('button', {
                          type: 'button',
                          className: 'dgb-btn dgb-btn-ghost',
                          disabled: workspaces.every((workspace) => workspace.missing),
                          onClick: () => {
                            const target = workspaces.find((workspace) => !workspace.missing);
                            if (target !== undefined) setDialog({ kind: 'import', workspace: target });
                          },
                        }, t.importTemplate),
                      ),
                    )
                  : null,
                activeWorkspaces.map((workspace) => {
                  const rows = bots.filter((bot) => bot.workspacePath === workspace.path);
                  const config = (snapshot?.configs ?? []).find((item) => item.workspacePath === workspace.path)?.config ?? {};
                  return h('div', { key: workspace.path, className: 'dgb-ws' },
                    h('div', { className: 'dgb-ws-head' },
                      h('span', { className: 'dgb-ws-folder' }, h(FolderIcon, { size: 14 })),
                      h('span', { className: 'dgb-ws-title' }, workspace.title),
                      h('span', { className: 'dgb-ws-path' }, workspace.path),
                      h('span', { className: 'dgb-chip' }, t.count(rows.length)),
                      workspace.missing === true ? h('span', { className: 'dgb-ws-missing' }, t.workspaceMissing) : null,
                      h('button', {
                        type: 'button',
                        className: 'dgb-icon-btn',
                        style: { marginLeft: 'auto' },
                        title: t.newBot,
                        onClick: () => setDialog({ kind: 'bot', workspace, bot: null }),
                      }, '＋'),
                    ),
                    h('div', { className: 'dgb-list' },
                      rows.map((bot) =>
                        h('div', {
                          key: bot.id,
                          className: 'dgb-card',
                          'data-hidden': bot.hidden === true ? 'true' : 'false',
                          onClick: () => setSelectedId(bot.id),
                        },
                          h(Avatar, { avatar: avatarOf(bot), name: bot.name }),
                          h('div', { className: 'dgb-card-main' },
                            h('div', { className: 'dgb-card-top' },
                              h('span', { className: 'dgb-name' }, bot.name),
                              bot.primary === true || config.primaryBotId === bot.id ? h('span', { className: 'dgb-chip dgb-chip-primary' }, t.primary) : null,
                              bot.pinned === true ? h('span', { className: 'dgb-chip' }, t.pin) : null,
                              h('span', { className: 'dgb-chip dgb-chip-mode', 'data-mode': bot.mode }, t.mode[bot.mode] ?? bot.mode),
                              bot.section !== '' ? h('span', { className: 'dgb-chip' }, bot.section) : null,
                            ),
                            h('span', { className: 'dgb-card-sub' }, bot.label || bot.id),
                          ),
                          h('div', { className: 'dgb-card-side' },
                            h(StatusDot, { state: bot.runtimeState ?? 'dormant', t }),
                            h('span', { className: 'dgb-usage' }, t.wakesToday(bot.usage?.today ?? 0)),
                          ),
                          h('div', { className: 'dgb-actions' },
                            bot.sessionId ? h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: t.openChat,
                              onClick: (event) => {
                                event.stopPropagation();
                                openBotSession(bot);
                              },
                            }, '↗') : null,
                            h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: t.edit,
                              onClick: (event) => {
                                event.stopPropagation();
                                setDialog({ kind: 'bot', workspace, bot });
                              },
                            }, '✎'),
                            h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: bot.pinned ? t.unpin : t.pin,
                              onClick: (event) => {
                                event.stopPropagation();
                                void run('bot.pin', { id: bot.id, workspacePath: bot.workspacePath, pinned: !bot.pinned });
                              },
                            }, bot.pinned ? '📌' : '📍'),
                            h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: t.duplicate,
                              onClick: (event) => {
                                event.stopPropagation();
                                void run('bot.duplicate', { id: bot.id, workspacePath: bot.workspacePath });
                              },
                            }, '⧉'),
                            h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: bot.hidden ? t.show : t.hide,
                              onClick: (event) => {
                                event.stopPropagation();
                                void run('bot.hide', { id: bot.id, workspacePath: bot.workspacePath, hidden: !bot.hidden });
                              },
                            }, bot.hidden ? '◌' : '⦿'),
                            h('button', {
                              type: 'button',
                              className: 'dgb-icon-btn',
                              title: t.remove,
                              onClick: (event) => {
                                event.stopPropagation();
                                if (!window.confirm(t.confirmDelete)) return;
                                void run('bot.delete', { id: bot.id, workspacePath: bot.workspacePath, confirm: true });
                              },
                            }, '✕'),
                          ),
                        ),
                      ),
                    ),
                  );
                }),
                groups.length === 0 && !shared.loading
                  ? h('div', { className: 'dgb-ws' },
                      h('div', { className: 'dgb-ws-head' }, h('span', { className: 'dgb-ws-title' }, t.rooms)),
                      h('div', { className: 'dgb-empty' }, t.emptyRoom),
                    )
                  : h('div', { className: 'dgb-ws' },
                      h('div', { className: 'dgb-ws-head' }, h('span', { className: 'dgb-ws-title' }, t.rooms)),
                      h('div', { className: 'dgb-list' },
                        groups.map((group) => {
                          const members = bots.filter((bot) => group.members.includes(bot.id));
                          return h('div', { key: group.id, className: 'dgb-card', onClick: () => setRoomId(group.id) },
                            h('span', { className: 'dgb-stack' }, members.slice(0, 4).map((bot) => h(Avatar, { key: bot.id, avatar: avatarOf(bot), name: bot.name, size: 34 }))),
                            h('div', { className: 'dgb-card-main' },
                              h('div', { className: 'dgb-card-top' },
                                h('span', { className: 'dgb-name' }, group.name),
                                h('span', { className: 'dgb-chip' }, `${members.length} ${t.members}`),
                                h('span', { className: 'dgb-chip' }, t.roomStatus[group.runtime?.status ?? 'idle'] ?? ''),
                              ),
                              h('span', { className: 'dgb-card-sub' }, group.topic || members.map((bot) => bot.name).join(' · ')),
                            ),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                              h('span', { className: 'dgb-chip' }, group.responderPolicy === 'all' ? t.policyAll : t.policyPrimary),
                              h('button', { type: 'button', className: 'dgb-icon-btn', title: '删除', onClick: (event) => {
                                event.stopPropagation();
                                if (!window.confirm('删除这个房间？记录会被删除。')) return;
                                void run('group.delete', { groupId: group.id });
                              } }, '✕'),
                            ),
                          );
                        }),
                      ),
                    ),
              ],
        ),
        dialog === null
          ? null
          : dialog.kind === 'bot'
            ? h(BotDialog, {
                t,
                workspace: dialog.workspace,
                workspaces,
                bot: dialog.bot,
                onClose: () => setDialog(null),
                onDone: (id) => {
                  setDialog(null);
                  if (typeof id === 'string') setSelectedId(id);
                },
              })
            : dialog.kind === 'import'
              ? h(ImportDialog, {
                  t,
                  workspace: dialog.workspace,
                  onClose: () => setDialog(null),
                  onDone: () => setDialog(null),
                })
              : h(RoomDialog, {
                  t,
                  workspace: dialog.workspace,
                  onClose: () => setDialog(null),
                  onDone: () => setDialog(null),
                }),
      );
    }

    /* ------------------------------------------------------------- sidebar seats */

    function SidebarIcon({ size, active }) {
      const edge = typeof size === 'number' ? size : 18;
      return h(
        'svg',
        { width: edge, height: edge, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { opacity: active ? 1 : 0.78, color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor' } },
        h('rect', { x: 3, y: 6, width: 18, height: 13, rx: 5, fill: 'currentColor', opacity: 0.92 }),
        h('circle', { cx: 9, cy: 12.5, r: 1.6, fill: 'var(--dsw-alias-bg-base)' }),
        h('circle', { cx: 15, cy: 12.5, r: 1.6, fill: 'var(--dsw-alias-bg-base)' }),
        h('path', { d: 'M12 4v2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 3.2, r: 1.2, fill: 'currentColor' }),
      );
    }

    /** The 16px leading cell of a Session row: a Bot avatar when this row is a Bot. */
    function SessionRowAvatar({ sessionId }) {
      const shared = useBotStore();
      const bots = shared.snapshot?.bots ?? [];
      const bot = bots.find((item) => item.sessionId === sessionId);
      if (bot === undefined) return null;
      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16 },
        title: `${bot.name} · ${dictionaryLabel(bot.mode)}`,
      }, h(Avatar, { avatar: avatarOf(bot), name: bot.name, size: 14, fontSize: 8 }));
    }

    /** Mode chip + live status beside the Session title for a Bot Session. */
    function HeaderBadge({ sessionId, t }) {
      const shared = useBotStore();
      const bots = shared.snapshot?.bots ?? [];
      const bot = bots.find((item) => item.sessionId === sessionId);
      if (bot === undefined) return null;
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 20,
            padding: '0 7px',
            borderRadius: 999,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            fontSize: 11,
            color: 'var(--dsw-alias-label-secondary)',
          },
        },
        [
          h('span', { key: 'dot', className: 'dgb-dot', 'data-tone': bot.runtimeState === 'busy' ? 'busy' : bot.runtimeState === 'idle' ? 'idle' : 'dormant' }),
          `Bot · ${t.mode[bot.mode] ?? bot.mode}`,
          bot.nextRoutineAt ? h('span', { key: 'clock', title: `下次例行：${timeText(bot.nextRoutineAt)}`, style: { opacity: 0.8 } }, `⏰${new Date(bot.nextRoutineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : null,
        ],
      );
    }

    function dictionaryLabel(mode) {
      return ZH.mode[mode] ?? mode;
    }

    /* ------------------------------------------------------------------- plugin */

    const plugin = {
      name: 'dsh-grok-bot',
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctxRef.current = ctx;
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-grok-bot';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-grok-bot: styles');

        const t = () => dictionary(ctx);
        const label = () => dictionary(ctx).title;

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'dsh-grok-bot', order: 30, label },
            (props) => h(SidebarIcon, props),
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'dsh-grok-bot' },
            (props) => h(BotsPanel, { ...props, t: t() }),
          ),
        );

        ctx.slots.inject('sidebar.session.row.leading', () =>
          ctx.slots.register(
            { name: 'sidebar.session.row.leading', id: 'grok-bot-avatar', order: 5 },
            (props) => h(SessionRowAvatar, props),
          ),
        );

        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'grok-bot-badge', order: -5 },
            (props) => h(HeaderBadge, { sessionId: props.sessionId, t: t() }),
          ),
        );

        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-grok-bot' },
            () => h(SettingsCard, { t: t() }),
          ),
        );
      },
    };

    module.exports = plugin;
    return plugin;
  },
});
