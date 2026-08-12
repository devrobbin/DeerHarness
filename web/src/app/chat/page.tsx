'use client';

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/lib/useWebSocket';
import { apiGet, apiPost, apiStream } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Markdown } from '@/components/Markdown';
import { Button, Input } from '@/components/ui';
import { useToast } from '@/components/Toast';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  delegations?: { tool: string; result: string }[];
}

interface ThreadItem {
  thread_id: string;
  updated_at?: string;
}

interface AgentItem {
  agentId: string;
  name: string;
}

interface Workflow {
  id: string;
  label: string;
  task: string;
}

interface TeamTemplate {
  name: string;
  icon: string;
  description: string;
  members: string[] | null; // null = 全部 Agent
  workflows: Workflow[];
}

interface MemberStatus {
  agent_id: string;
  state: 'idle' | 'working' | 'done' | 'failed';
  task_count: number;
}

interface TeamStatus {
  thread_id: string;
  status: string;
  members: MemberStatus[];
  delegations_total: number;
  other: { started: number; done: number; failed: number };
  terminal: boolean;
  reply?: string;
  delegations?: { tool: string; result: string }[];
}

/** 对话目标：默认 DeerFlow / 单个 penguin Agent / 团队（模板+工作流） */
type ChatMode = 'default' | 'agent' | 'team';

export default function ChatPage() {
  const { t } = useI18n();
  const { connected } = useWebSocket();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  // 对话目标状态
  const [mode, setMode] = useState<ChatMode>('default');
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState('');
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [template, setTemplate] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [agentSessions, setAgentSessions] = useState<Record<string, string>>({});

  // 团队模式：成员实时工作状态（轮询 /api/fusion/team/status）
  const [teamStatus, setTeamStatus] = useState<Record<string, MemberStatus>>({});
  const [teamMembers, setTeamMembers] = useState<AgentItem[]>([]);
  const pollRef = useRef<number | null>(null);

  // 成员抽屉：点击成员徽章 → 右侧推拉窗展示该成员会话内容
  const [drawerMember, setDrawerMember] = useState<AgentItem | null>(null);
  const [teamThreadId, setTeamThreadId] = useState('');
  const [delegationsByMember, setDelegationsByMember] = useState<
    Record<string, { prompt: string; result: string; status: string }[]>
  >({});
  const [otherDelegations, setOtherDelegations] = useState<
    { prompt: string; result: string; status: string }[]
  >([]);

  /** 拉取分派详情（成员抽屉数据源） */
  const loadDelegations = async (threadId: string) => {
    try {
      const d = await apiGet<{ members: Record<string, { prompt: string; result: string; status: string }[]>; other: { prompt: string; result: string; status: string }[] }>(
        `/api/fusion/team/delegations/${threadId}`,
      );
      setDelegationsByMember(d.members);
      setOtherDelegations(d.other ?? []);
    } catch { /* 详情拉取失败不阻塞展示 */ }
  };

  const openMemberDrawer = (m: AgentItem) => {
    setDrawerMember(m);
    if (teamThreadId && !delegationsByMember[m.agentId]) loadDelegations(teamThreadId);
  };

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  // 成员抽屉 Esc 关闭 + 滚动锁（评审 P2 a11y）
  useEffect(() => {
    if (!drawerMember) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerMember(null); };
    // 焦点 trap + 初始聚焦关闭按钮（对齐 AgentSettings，评审 P1-2）
    const onFocus = (e: FocusEvent) => {
      const panel = document.querySelector('[data-member-drawer]');
      if (panel && !panel.contains(e.target as Node)) {
        (panel.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    requestAnimationFrame(() => {
      (document.querySelector('[data-member-drawer] button[aria-label="关闭"]') as HTMLElement | null)?.focus();
    });
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [drawerMember]);

  // 新消息自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // 卸载时中止在途 SSE 读流（评审 P2）
  useEffect(() => () => { activeAbortRef.current?.abort(); }, []);

  // 加载历史会话列表（仅默认模式）
  useEffect(() => {
    if (mode !== 'default') return;
    apiGet<{ threads: ThreadItem[] }>('/api/chat/threads')
      .then(d => setThreads(d.threads ?? []))
      .catch(() => setThreads([]));
  }, [mode, threadId]);

  // 加载 Agent 与团队模板（目标选择器数据）
  useEffect(() => {
    apiGet<{ agents: AgentItem[] }>('/api/agents')
      .then(d => {
        const seen = new Set<string>();
        const unique = d.agents.filter(a => {
          if (seen.has(a.agentId)) return false;
          seen.add(a.agentId);
          return true;
        });
        setAgents(unique);
        if (unique.length > 0) setAgentId(unique[0].agentId);
      })
      .catch(console.error);
    apiGet<{ templates: TeamTemplate[] }>('/api/fusion/team/templates')
      .then(d => {
        setTemplates(d.templates ?? []);
        if (d.templates?.length > 0) setTemplate(d.templates[0].name);
      })
      .catch(console.error);
  }, []);

  const activeTemplate = templates.find(x => x.name === template) ?? null;

  const switchMode = (next: ChatMode) => {
    setMode(next);
    newChat();
  };

  const newChat = () => {
    stopPolling();
    setMessages([]);
    setThreadId(undefined);
    setError('');
    setTeamStatus({});
  };

  /** 默认模式：SSE 流式（原逻辑）；AbortController 支持路由离开中止（评审 P2） */
  const sendDefault = async (text: string, signal?: AbortSignal) => {
    const res = await apiStream('/api/chat/stream', { message: text, thread_id: threadId }, signal);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`HTTP ${res.status}: ${detail.slice(0, 120)}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let current = '';
    let newThreadId: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        let evt = 'message';
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) evt = line.slice(6).trim();
          // 多行 data: 用换行连接（评审 D：修复 trim 破坏代码块缩进）
          else if (line.startsWith('data:')) data += line.slice(5) + '\n';
        }
        if (!data.trim()) continue;
        const payload = JSON.parse(data.trimEnd());
        if (evt === 'meta') {
          newThreadId = payload.thread_id;
        } else if (evt === 'text') {
          current += payload;
          setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: current }]);
        }
      }
    }
    if (newThreadId) setThreadId(newThreadId);
    if (!current) {
      // 流里没有文本：回退查询一次最终内容
      const last = await apiGet<{ messages: ChatMessage[] }>(`/api/chat/threads/${newThreadId ?? threadId ?? ''}/messages`);
      const ai = [...last.messages].reverse().find(m => m.role === 'assistant');
      if (ai) setMessages(prev => [...prev.slice(0, -1), ai]);
    }
  };

  /** Agent 模式：与单个 penguin Agent 对话（会话延续） */
  const sendAgent = async (text: string) => {
    if (!agentId) throw new Error('请先选择 Agent');
    const data = await apiPost<{ reply: string; session_id: string; agent_id: string }>(
      `/api/agents/${encodeURIComponent(agentId)}/chat`,
      { message: text, session_id: agentSessions[agentId] || undefined },
    );
    setAgentSessions(prev => ({ ...prev, [data.agent_id]: data.session_id }));
    setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: data.reply }]);
  };

  /** 团队模式：/team/start 立即返回 → 轮询 /team/status 实时展示成员工作状态 */
  const sendTeam = async (text: string) => {
    // 确定本次团队班底（模板成员或全部），初始化状态栏
    const memberIds = activeTemplate?.members
      ? activeTemplate.members
      : agents.map(a => a.agentId);
    const members = agents.filter(a => memberIds.includes(a.agentId));
    setTeamMembers(members);
    setTeamStatus(Object.fromEntries(members.map(m => [m.agentId, { agent_id: m.agentId, state: 'idle', task_count: 0 }])));

    const start = await apiPost<{ thread_id: string; team: string[] }>('/api/fusion/team/start', {
      task: text,
      template: template || undefined,
      workflow: workflow || undefined,
    });
    setTeamThreadId(start.thread_id);
    setDelegationsByMember({});
    setOtherDelegations([]);

    let attempts = 0;
    const MAX_ATTEMPTS = 100; // 100 × 3s ≈ 5 分钟

    const poll = async () => {
      if (attempts++ > MAX_ATTEMPTS) {
        setMessages(prev => prev.slice(0, -1));
        setError('团队任务超时（约 5 分钟），请稍后重试');
        setLoading(false);
        return;
      }
      try {
        const d = await apiGet<TeamStatus>(`/api/fusion/team/status/${start.thread_id}`);
        // 合并最新成员状态（terminal 后注册表清理 → 保留最后一次快照）
        if (d.members.length > 0) {
          setTeamStatus(prev => ({ ...prev, ...Object.fromEntries(d.members.map(m => [m.agent_id, m])) }));
        }
        // 抽屉打开时同步刷新成员分派详情（进行中任务实时变为已完成+结果）
        if (drawerMember) loadDelegations(start.thread_id);
        if (!d.terminal) {
          pollRef.current = window.setTimeout(poll, 3000);
          return;
        }
        setLoading(false);
        const reply = d.reply || '（团队任务已结束，未返回汇总内容）';
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: reply, delegations: d.delegations ?? [] }]);
        loadDelegations(start.thread_id); // 预拉成员分派详情（抽屉数据）
      } catch (err) {
        setLoading(false);
        setMessages(prev => prev.slice(0, -1));
        setError(`进度查询失败：${err instanceof Error ? err.message : err}`);
      }
    };
    poll();
  };

  /** 统一发送：按目标模式分支 */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setLoading(true);
    // AbortController：组件卸载时中止仍在进行的 SSE 读流（评审 P2）
    const controller = new AbortController();
    activeAbortRef.current = controller;
    try {
      if (mode === 'agent') await sendAgent(text);
      else if (mode === 'team') await sendTeam(text);
      else await sendDefault(text, controller.signal);
    } catch (err) {
      setMessages(prev => prev.slice(0, -1)); // 移除空回复气泡
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
      activeAbortRef.current = null;
    }
  };

  /** 加载历史会话（默认模式） */
  const loadThread = async (tid: string) => {
    if (!tid) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiGet<{ messages: ChatMessage[] }>(`/api/chat/threads/${tid}/messages`);
      setMessages(data.messages ?? []);
      setThreadId(tid);
    } catch (err) {
      setError(`加载失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const targetLabel =
    mode === 'agent'
      ? agents.find(a => a.agentId === agentId)?.name ?? agentId
      : mode === 'team'
        ? activeTemplate
          ? `${activeTemplate.icon} ${activeTemplate.description.split('：')[0]}${workflow ? ` · ${activeTemplate.workflows.find(w => w.id === workflow)?.label ?? workflow}` : ''}`
          : ''
        : 'DeerFlow';

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.nav.chat}</h1>
          <p className="text-xs text-gray-400">
            {mode === 'default' && t.chatMode.defaultSub}
            {mode === 'agent' && t.chatMode.agentSub}
            {mode === 'team' && t.chatMode.teamSub}
            {threadId && <span className="ml-2 font-mono">· thread {threadId.slice(0, 12)}</span>}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          {connected ? t.chatMode.connected : t.chatMode.disconnected}
        </span>
      </div>

      {/* 对话目标选择：默认 / Agent / 团队（+工作流） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['default','agent','team'] as ChatMode[]).map(m => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              mode === m
                ? 'bg-blue-500 font-medium text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {t.chatMode[m]}
          </button>
        ))}

        {mode === 'agent' && (
          <select
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            className="rounded border border-gray-300 p-1.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            {agents.map(a => (
              <option key={a.agentId} value={a.agentId}>{a.name}（{a.agentId}）</option>
            ))}
          </select>
        )}

        {mode === 'team' && (
          <>
            <select
              value={template}
              onChange={e => { setTemplate(e.target.value); setWorkflow(''); }}
              className="rounded border border-gray-300 p-1.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {templates.map(x => (
                <option key={x.name} value={x.name}>{x.icon} {x.description.split('：')[0]}</option>
              ))}
            </select>
            {activeTemplate && activeTemplate.workflows.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeTemplate.workflows.map(wf => (
                  <button
                    key={wf.id}
                    onClick={() => setWorkflow(workflow === wf.id ? '' : wf.id)}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                      workflow === wf.id
                        ? 'bg-purple-100 font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {workflow === wf.id ? '✓ ' : ''}{wf.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'default' && (
          <>
            <select
              value=""
              onChange={e => e.target.value && loadThread(e.target.value)}
              className="rounded border border-gray-300 p-1.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">{t.chatMode.history}</option>
              {threads.slice(0, 20).map(t => (
                <option key={t.thread_id} value={t.thread_id}>
                  {t.thread_id.slice(0, 18)} · {t.updated_at?.slice(0, 10) ?? ''}
                </option>
              ))}
            </select>
            <button
              onClick={newChat}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300"
            >
              {t.chatMode.newChat}
            </button>
          </>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {messages.length === 0 && !loading && (
          <p className="py-10 text-center text-gray-400">
            {mode === 'default' && t.chatMode.defaultEmpty}
            {mode === 'agent' && `选择上方 Agent（当前：${targetLabel}）后开始对话…`}
            {mode === 'team' && `选择团队与工作流（当前：${targetLabel}），下达任务后主代理将拆解分派…`}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`relative max-w-[85%] rounded-lg px-4 py-2.5 ${
                m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
              }`}
            >
              {m.role === 'assistant' && !m.content && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.3s]" />
                </span>
              )}
              {m.role === 'assistant' && m.delegations && m.delegations.length > 0 && (
                <div className="mb-2 rounded border border-purple-200 bg-purple-50/70 p-2 dark:border-purple-800 dark:bg-purple-900/20">
                  <p className="mb-1 text-[11px] font-medium text-purple-600 dark:text-purple-300">
                    🤝 子代理分派（{m.delegations.length} 次）
                  </p>
                  {m.delegations.map((d, di) => (
                    <p key={di} className="whitespace-pre-wrap text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="font-mono text-purple-500 dark:text-purple-400">task #{di + 1}</span>{' '}
                      {d.result.slice(0, 160)}{d.result.length > 160 ? '…' : ''}
                    </p>
                  ))}
                </div>
              )}
              {m.content && <Markdown content={m.content} invert={m.role === 'user'} />}
              {m.role === 'assistant' && m.content && (
                <button
                  onClick={() => copyText(`msg-${i}`, m.content)}
                  aria-label="复制回复内容"
                  className="absolute -right-2 -top-2 hidden rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 shadow-sm hover:text-blue-600 group-hover:block"
                >
                  {copied === `msg-${i}` ? '✓ 已复制' : '复制'}
                </button>
              )}
            </div>
          </div>
        ))}
        {error && <p role="alert" className="text-center text-sm text-red-500">{error}</p>}
      </div>

      {/* 团队模式：已启用成员实时工作状态（工作中转圈；点击成员查看其会话内容） */}
      {mode === 'team' && teamMembers.length > 0 && (
        <div className="mt-2 mb-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-400 dark:text-gray-500">{t.chatMode.members(teamMembers.length)}</span>
          {teamMembers.map(m => {
            const st = teamStatus[m.agentId]?.state ?? 'idle';
            const badge =
              st === 'working'
                ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                : st === 'done'
                  ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : st === 'failed'
                    ? 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
            return (
              <button
                key={m.agentId}
                onClick={() => openMemberDrawer(m)}
                title="点击查看该成员会话内容"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-600 ${badge}`}
              >
                {st === 'working' ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                ) : st === 'done' ? (
                  '✅'
                ) : st === 'failed' ? (
                  '❌'
                ) : (
                  '⏳'
                )}
                {m.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && handleSend()}
          placeholder={
            mode === 'default'
              ? t.chatMode.defaultPlaceholder
              : mode === 'agent'
                ? t.chatMode.agentPlaceholder(targetLabel)
                : t.chatMode.teamPlaceholder(targetLabel)
          }
          disabled={loading}
          className="flex-1 disabled:opacity-50"
        />
        <Button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? t.chatMode[`${mode}Loading` as 'defaultLoading'] : t.chatMode.send}
        </Button>
      </div>

      {/* 成员会话抽屉：点击成员徽章右侧滑出，展示该成员本次会话内容 */}
      {drawerMember && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${drawerMember.name} 会话内容`}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerMember(null)} />
          <div
            data-member-drawer
            className="relative z-10 flex h-full w-[26rem] max-w-[92vw] flex-col bg-white shadow-2xl dark:bg-gray-800"
            style={{ animation: 'drawer-in 0.22s ease' }}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <p className="font-semibold text-gray-800 dark:text-gray-100">{drawerMember.name}</p>
                <p className="font-mono text-xs text-gray-400">{drawerMember.agentId}</p>
              </div>
              <button
                onClick={() => setDrawerMember(null)}
                aria-label="关闭"
                className="rounded px-2 py-1 text-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {(() => {
                const tasks = delegationsByMember[drawerMember.agentId] ?? [];
                if (tasks.length === 0) {
                  return (
                    <p className="py-10 text-center text-sm text-gray-400">
                      本次会话中该成员未被分派任务
                    </p>
                  );
                }
                return tasks.map((task, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        📨 分派任务 #{i + 1}
                      </p>
                      {task.status === 'completed' && <span className="text-xs text-green-600 dark:text-green-400">✅ 已完成</span>}
                      {task.status === 'failed' && <span className="text-xs text-red-500">❌ 失败</span>}
                      {task.status === 'running' && <span className="text-xs text-purple-500">🔄 进行中</span>}
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                      {task.prompt}
                    </pre>
                    {task.result && (
                      <>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">📄 执行结果</p>
                        <div className="max-h-96 overflow-y-auto rounded border border-gray-200 p-2 text-xs dark:border-gray-600">
                          <Markdown content={task.result} />
                        </div>
                      </>
                    )}
                  </div>
                ));
              })()}

              {otherDelegations.length > 0 && (
                <div className="rounded border border-dashed border-gray-300 p-3 dark:border-gray-600">
                  <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                    ⚙️ 其他分派（无法归属成员）{otherDelegations.length} 次
                  </p>
                  {otherDelegations.slice(0, 5).map((t, i) => (
                    <p key={i} className="mb-1 line-clamp-2 text-[11px] text-gray-400">
                      {t.prompt.slice(0, 120)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
