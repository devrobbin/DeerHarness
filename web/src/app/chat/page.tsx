'use client';

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/lib/useWebSocket';
import { apiGet, apiStream } from '@/lib/api';
import { Markdown } from '@/components/Markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ThreadItem {
  thread_id: string;
  updated_at?: string;
}

export default function ChatPage() {
  const { connected } = useWebSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // 加载历史会话列表
  useEffect(() => {
    apiGet<{ threads: ThreadItem[] }>('/api/chat/threads')
      .then(d => setThreads(d.threads ?? []))
      .catch(() => setThreads([]));
  }, [threadId]);

  /** 流式发送：POST /api/chat/stream，逐段渲染 AI 回复 */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setLoading(true);
    try {
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
    } catch (err) {
      setMessages(prev => prev.slice(0, -1)); // 移除空回复气泡
      setError(`调用失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  /** 加载历史会话 */
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

  const newChat = () => {
    setMessages([]);
    setThreadId(undefined);
    setError('');
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

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">💬 Chat</h1>
          <p className="text-xs text-gray-400">
            经 Gateway 代理 DeerFlow · DeepSeek-V4-Flash 模型 · 流式输出
            {threadId && <span className="ml-2 font-mono">· thread {threadId.slice(0, 12)}</span>}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'Gateway 已连接' : 'Gateway 未连接'}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <select
          value=""
          onChange={e => e.target.value && loadThread(e.target.value)}
          className="rounded border border-gray-300 p-1.5 text-xs text-gray-600"
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
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
        >
          ✨ 新对话
        </button>
        {threadId && <span className="text-xs text-gray-400">（继续当前会话）</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 && !loading && (
          <p className="py-10 text-center text-gray-400">
            向 DeerFlow 提问吧（支持 Markdown 渲染与流式输出）…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`relative max-w-[85%] rounded-lg px-4 py-2.5 ${
                m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.role === 'assistant' && !m.content && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.3s]" />
                </span>
              )}
              {m.content && <Markdown content={m.content} invert={m.role === 'user'} />}
              {m.role === 'assistant' && m.content && (
                <button
                  onClick={() => copyText(`msg-${i}`, m.content)}
                  className="absolute -right-2 -top-2 hidden rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 shadow-sm hover:text-blue-600 group-hover:block"
                >
                  {copied === `msg-${i}` ? '✓ 已复制' : '复制'}
                </button>
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="输入消息，回车发送（支持 Markdown，流式输出）"
          disabled={loading}
          className="flex-1 rounded border border-gray-300 p-2 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="rounded bg-blue-500 px-5 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '生成中…' : '发送'}
        </button>
      </div>
    </div>
  );
}
