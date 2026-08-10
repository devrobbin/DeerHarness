'use client';

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/lib/useWebSocket';
import { apiPost } from '@/lib/api';
import { Markdown } from '@/components/Markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const { connected } = useWebSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const data = await apiPost<{ reply: string; thread_id: string; status: string }>('/api/chat', {
        message: text,
        thread_id: threadId,
      });
      setThreadId(data.thread_id);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(`调用失败：${err instanceof Error ? err.message : err}`);
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

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">💬 Chat</h1>
          <p className="text-xs text-gray-400">
            经 Gateway 代理 DeerFlow · DeepSeek-V4-Flash 模型
            {threadId && <span className="ml-2 font-mono">· thread {threadId.slice(0, 12)}</span>}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'Gateway 已连接' : 'Gateway 未连接'}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 && !loading && (
          <p className="py-10 text-center text-gray-400">
            向 DeerFlow 提问吧（支持 Markdown 渲染，如：介绍一下 Harness Engineering）…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`relative max-w-[85%] rounded-lg px-4 py-2.5 ${
                m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              <Markdown content={m.content} invert={m.role === 'user'} />
              {m.role === 'assistant' && (
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
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.3s]" />
                DeerFlow 思考中…
              </span>
            </div>
          </div>
        )}
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="输入消息，回车发送（支持 Markdown）"
          disabled={loading}
          className="flex-1 rounded border border-gray-300 p-2 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="rounded bg-blue-500 px-5 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '思考中…' : '发送'}
        </button>
      </div>
    </div>
  );
}
