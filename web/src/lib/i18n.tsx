'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * DeerHarness 轻量 i18n（移植 DeerFlow appearance-settings 的语言切换）。
 * - 默认简体中文（zh-CN），可在设置 → 外观 切换
 * - 选择持久化到 localStorage（dh_lang）
 * - 字典类型安全：en-US 必须与 zh-CN 键完全一致，未翻译键回退 zh-CN
 */

const zhCN = {
  // 侧栏
  nav: {
    dashboard: '📊 仪表盘',
    chat: '💬 对话',
    studio: '🧪 智能体工作室',
    evolution: '🧬 进化实验室',
    monitor: '🛰️ 监控',
    settings: '🛠️ 设置',
  },
  apiKey: {
    label: '🔑 Gateway API Key',
    save: '保存',
    saved: '✓',
    hint: '仅存于本机浏览器，请求自动携带',
    placeholder: 'Bearer 密钥',
  },
  theme: {
    toLight: '切换到浅色模式',
    toDark: '切换到深色模式',
    dark: '🌙 深色模式（点击切换）',
    light: '☀️ 浅色模式（点击切换）',
  },
  // 设置页
  settings: {
    title: '🛠️ 设置',
    tabs: {
      models: '🧠 模型',
      skills: '🔧 技能',
      mcp: '🔌 MCP',
      channels: '📡 渠道',
      account: '👤 账户',
      users: '👥 用户',
      safety: '🛡️ 安全',
      system: 'ℹ️ 系统',
      appearance: '🎨 外观',
    },
  },
  // 通用
  common: {
    save: '保存',
    cancel: '取消',
    edit: '编辑',
    delete: '删除',
    test: '测试连接',
    retest: '重测',
    testing: '测试中…',
    sending: '发送中…',
    empty: '暂无数据',
    enabled: '已启用',
    disabled: '已禁用',
    copy: '复制',
    created: '创建于',
  },
  // 模型
  models: {
    title: '模型管理',
    add: '+ 添加模型',
    new: '新增模型',
    edit: '编辑模型',
    name: '模型名称（如 deepseek-chat）',
    provider: 'Provider',
    baseUrl: 'Base URL（留空使用默认）',
    apiKeyEnv: 'API Key 环境变量名（可选）',
    maxTokens: 'Max Tokens',
    temperature: 'Temperature',
    defaultAddr: '(默认地址)',
    deleteConfirm: (name: string) => `删除模型「${name}」？`,
    empty: '暂无模型配置',
  },
  // 技能
  skills: {
    title: '技能管理',
    add: '+ 添加技能',
    new: '新增技能',
    edit: '编辑技能',
    name: '名称',
    type: '类型',
    description: '描述',
    config: 'config（JSON）',
    deleteConfirm: (name: string) => `删除技能「${name}」？`,
    empty: '暂无技能',
  },
  // MCP
  mcp: {
    title: 'MCP 服务器',
    add: '+ 添加 MCP',
    new: '新增 MCP 服务器',
    edit: '编辑 MCP 服务器',
    name: '名称',
    transport: '传输方式',
    command: '启动命令',
    sseUrl: 'SSE 端点 URL',
    env: 'env（JSON，可选）',
    deleteConfirm: (name: string) => `删除 MCP 服务器「${name}」？`,
    empty: '暂无 MCP 服务器',
  },
  // 渠道
  channels: {
    title: '渠道集成',
    add: '+ 添加渠道',
    new: '新增渠道',
    edit: '编辑渠道',
    platform: '平台',
    name: '名称',
    webhookUrl: 'Webhook URL',
    botToken: 'Bot Token（可选）',
    noWebhook: '未配置 webhook',
    deleteConfirm: (name: string) => `删除渠道「${name}」？`,
    empty: '暂无渠道配置',
    test: '测试',
    retest: '重发测试',
  },
  // 安全
  safety: {
    title: '安全策略',
    description: '控制 Agent 自进化的边界，防止失控',
    maxRounds: '最大进化轮次',
    maxCost: '单次进化最大费用（USD）',
    approval: '进化结果需要人工审批后才能部署',
    blocked: '禁止进化的领域（逗号分隔）',
    blockedPlaceholder: '例如：医疗, 法律, 金融',
    saving: '保存中...',
    saved: '✅ 已保存',
    saveBtn: '保存设置',
  },
  // 账户
  account: {
    title: '账户设置',
    info: '账户信息',
    username: '用户名',
    role: '角色',
    userId: '用户 ID',
    createdAt: '创建时间',
    apiKeyTitle: 'Gateway API Key',
    apiKeyHint: '所有页面请求通过该密钥鉴权，仅存于本机浏览器',
    rotateTitle: '轮换 API Key',
    rotateHint: '旧密钥立即失效。新密钥仅显示一次，请妥善保存（对应修改密码）',
    rotate: '轮换密钥',
    rotating: '轮换中…',
    newKey: '⚠️ 新 API Key（仅显示一次）',
  },
  // 用户管理
  users: {
    title: '用户管理',
    adminOnly: '🔒 需要管理员权限（当前账户为只读/开发者角色）',
    create: '+ 创建用户',
    createTitle: '创建用户',
    username: '用户名',
    initialKey: '初始 API Key',
    role: '角色',
    createBtn: '创建',
    rotateKey: '重置密钥',
    rotateConfirm: (name: string) => `重置「${name}」的 API Key？新密钥仅显示一次。`,
    deleteConfirm: (name: string) => `删除用户「${name}」？该操作不可恢复。`,
    newKey: (name: string) => `⚠️ 「${name}」的新 API Key（仅显示一次）`,
    empty: '暂无用户',
  },
  // 系统
  system: {
    title: '系统信息',
    refresh: '刷新',
    checking: '检测中…',
    health: '服务健康',
    env: '环境配置',
    up: '正常',
    down: '离线',
    degraded: '异常',
    version: '版本',
    budget: '单请求预算',
    cors: 'CORS 白名单',
    deepseekKey: 'DeepSeek 评测 Key',
    adminKey: '管理员初始 Key',
    configured: '已配置',
    notConfigured: '未配置',
    maskedHint: '密钥与密码仅显示"是否已配置"，不暴露原文',
  },
  // 外观
  appearance: {
    title: '外观设置',
    language: '界面语言',
    zh: '简体中文',
    en: 'English',
    defaultHint: '默认简体中文 · 选择持久化保存',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    themeHint: '主题也会写入侧栏开关，两侧同步生效',
  },
};

export type I18nDict = typeof zhCN;

const enUS: I18nDict = {
  nav: {
    dashboard: '📊 Dashboard',
    chat: '💬 Chat',
    studio: '🧪 Agent Studio',
    evolution: '🧬 Evolution Lab',
    monitor: '🛰️ Monitor',
    settings: '🛠️ Settings',
  },
  apiKey: {
    label: '🔑 Gateway API Key',
    save: 'Save',
    saved: '✓',
    hint: 'Stored locally in this browser only; sent with every request',
    placeholder: 'Bearer key',
  },
  theme: {
    toLight: 'Switch to light mode',
    toDark: 'Switch to dark mode',
    dark: '🌙 Dark mode (click to switch)',
    light: '☀️ Light mode (click to switch)',
  },
  settings: {
    title: '🛠️ Settings',
    tabs: {
      models: '🧠 Models',
      skills: '🔧 Skills',
      mcp: '🔌 MCP',
      channels: '📡 Channels',
      account: '👤 Account',
      users: '👥 Users',
      safety: '🛡️ Safety',
      system: 'ℹ️ System',
      appearance: '🎨 Appearance',
    },
  },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    test: 'Test',
    retest: 'Retest',
    testing: 'Testing…',
    sending: 'Sending…',
    empty: 'No data',
    enabled: 'Enabled',
    disabled: 'Disabled',
    copy: 'Copy',
    created: 'Created',
  },
  models: {
    title: 'Model Management',
    add: '+ Add model',
    new: 'New model',
    edit: 'Edit model',
    name: 'Model name (e.g. deepseek-chat)',
    provider: 'Provider',
    baseUrl: 'Base URL (leave empty for default)',
    apiKeyEnv: 'API key env var name (optional)',
    maxTokens: 'Max tokens',
    temperature: 'Temperature',
    defaultAddr: '(default endpoint)',
    deleteConfirm: (name: string) => `Delete model "${name}"?`,
    empty: 'No models configured',
  },
  skills: {
    title: 'Skill Management',
    add: '+ Add skill',
    new: 'New skill',
    edit: 'Edit skill',
    name: 'Name',
    type: 'Type',
    description: 'Description',
    config: 'config (JSON)',
    deleteConfirm: (name: string) => `Delete skill "${name}"?`,
    empty: 'No skills',
  },
  mcp: {
    title: 'MCP Servers',
    add: '+ Add MCP',
    new: 'New MCP server',
    edit: 'Edit MCP server',
    name: 'Name',
    transport: 'Transport',
    command: 'Launch command',
    sseUrl: 'SSE endpoint URL',
    env: 'env (JSON, optional)',
    deleteConfirm: (name: string) => `Delete MCP server "${name}"?`,
    empty: 'No MCP servers',
  },
  channels: {
    title: 'Channel Integrations',
    add: '+ Add channel',
    new: 'New channel',
    edit: 'Edit channel',
    platform: 'Platform',
    name: 'Name',
    webhookUrl: 'Webhook URL',
    botToken: 'Bot token (optional)',
    noWebhook: 'No webhook configured',
    deleteConfirm: (name: string) => `Delete channel "${name}"?`,
    empty: 'No channels configured',
    test: 'Test',
    retest: 'Resend test',
  },
  safety: {
    title: 'Safety Policy',
    description: 'Guardrails for agent self-evolution to prevent runaway behavior',
    maxRounds: 'Max evolution rounds',
    maxCost: 'Max cost per evolution (USD)',
    approval: 'Evolution results require human approval before deployment',
    blocked: 'Blocked evolution domains (comma separated)',
    blockedPlaceholder: 'e.g. medical, legal, finance',
    saving: 'Saving...',
    saved: '✅ Saved',
    saveBtn: 'Save settings',
  },
  account: {
    title: 'Account Settings',
    info: 'Account info',
    username: 'Username',
    role: 'Role',
    userId: 'User ID',
    createdAt: 'Created at',
    apiKeyTitle: 'Gateway API Key',
    apiKeyHint: 'All page requests authenticate with this key; stored locally only',
    rotateTitle: 'Rotate API Key',
    rotateHint: 'The old key becomes invalid immediately. The new key is shown once — save it now (equivalent to changing your password)',
    rotate: 'Rotate key',
    rotating: 'Rotating…',
    newKey: '⚠️ New API Key (shown once)',
  },
  users: {
    title: 'User Management',
    adminOnly: '🔒 Admin permission required (current account is viewer/developer)',
    create: '+ Create user',
    createTitle: 'Create user',
    username: 'Username',
    initialKey: 'Initial API key',
    role: 'Role',
    createBtn: 'Create',
    rotateKey: 'Reset key',
    rotateConfirm: (name: string) => `Reset "${name}"'s API key? The new key is shown once.`,
    deleteConfirm: (name: string) => `Delete user "${name}"? This cannot be undone.`,
    newKey: (name: string) => `⚠️ New API key for "${name}" (shown once)`,
    empty: 'No users',
  },
  system: {
    title: 'System Info',
    refresh: 'Refresh',
    checking: 'Checking…',
    health: 'Service health',
    env: 'Environment',
    up: 'Up',
    down: 'Down',
    degraded: 'Degraded',
    version: 'Version',
    budget: 'Budget per request',
    cors: 'CORS allowlist',
    deepseekKey: 'DeepSeek eval key',
    adminKey: 'Admin bootstrap key',
    configured: 'Configured',
    notConfigured: 'Not configured',
    maskedHint: 'Keys and passwords only show whether they are configured; never the raw value',
  },
  appearance: {
    title: 'Appearance',
    language: 'Language',
    zh: '简体中文',
    en: 'English',
    defaultHint: 'Simplified Chinese by default · persisted locally',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    themeHint: 'Theme is shared with the sidebar toggle — both stay in sync',
  },
};

export type Lang = 'zh-CN' | 'en-US';

const DICTS: Record<Lang, I18nDict> = { 'zh-CN': zhCN, 'en-US': enUS };
const LANG_KEY = 'dh_lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: I18nDict;
}

const I18nContext = createContext<I18nContextValue>({ lang: 'zh-CN', setLang: () => {}, t: zhCN });

/** 语言提供者：默认简体中文，选择持久化 + 同步 <html lang>。 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh-CN');

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en-US') setLangState('en-US');
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch { /* 隐私模式等场景忽略 */ }
  }, []);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: DICTS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
