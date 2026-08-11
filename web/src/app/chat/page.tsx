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
  workflows: Workflow[];
}

/** 对话目标：默认 DeerFlow / 单个 penguin Agent / 团队（模板+工作流） */
type ChatMode = 'default' | 'agent' | 'team';

const MODE_LABELS: Record<ChatMode, string> = {
  default: '💬 默认对话',
  agent: '🤖 Agent 对话',
  team: '🧭 团队对话',
};

const LOADING_TEXT: Record<ChatMode, string> = {
  default: '生成中…',
  agent: 'Agent 思考中…',
  team: '团队编排中…',
};

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

  // 对话目标状态
  const [mode, setMode] = useState<ChatMode>('default');
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState('');
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [template, setTemplate] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [agentSessions, setAgentSessions] = useState<Record<string, string>>({});

  // 新消息自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
    setMessages([]);
    setThreadId(undefined);
    setError('');
  };

  /** 默认模式：SSE 流式（原逻辑） */
  const sendDefault = async (text: string) => {
    const res = await apiStream('/api/chat/stream', { message: text, thread_id: threadId });
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

  /** 团队模式：模板 + 工作流，主代理编排分派 */
  const sendTeam = async (text: string) => {
    const data = await apiPost<{
      reply: string;
      status: string;
      team: string[];
      delegations: { tool: string; result: string }[];
    }>('/api/fusion/team/run', {
      task: text,
      template: template || undefined,
      workflow: workflow || undefined,
    });
    setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: data.reply, delegations: data.delegations }]);
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
    try {
      if (mode === 'agent') await sendAgent(text);
      else if (mode === 'team') await sendTeam(text);
      else await sendDefault(text);
    } catch (err) {
      setMessages(prev => prev.slice(0, -1)); // 移除空回复气泡
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
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
            {mode === 'default' && '经 Gateway 代理 DeerFlow · 流式输出'}
            {mode === 'agent' && '与 penguin Agent 直接对话 · 会话延续'}
            {mode === 'team' && '主代理拆解任务 → 分派子代理 → 汇总（模板 + 工作流）'}
            {threadId && <span className="ml-2 font-mono">· thread {threadId.slice(0, 12)}</span>}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'Gateway 已连接' : 'Gateway 未连接'}
        </span>
      </div>

      {/* 对话目标选择：默认 / Agent / 团队（+工作流） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(MODE_LABELS) as ChatMode[]).map(m => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              mode === m
                ? 'bg-blue-500 font-medium text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {MODE_LABELS[m]}
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
              <option value="">📚 历史会话…</option>
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
              ✨ 新对话
            </button>
          </>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {messages.length === 0 && !loading && (
          <p className="py-10 text-center text-gray-400">
            {mode === 'default' && '向 DeerFlow 提问吧（支持 Markdown 渲染与流式输出）…'}
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

      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={
            mode === 'default'
              ? '输入消息，回车发送（支持 Markdown，流式输出）'
              : mode === 'agent'
                ? `向「${targetLabel}」提问，回车发送…`
                : `下达任务给「${targetLabel}」，回车后主代理将拆解并分派…`
          }
          disabled={loading}
          className="flex-1 disabled:opacity-50"
        />
        <Button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? LOADING_TEXT[mode] : '发送'}
        </Button>
      </div>
    </div>
  );
}
