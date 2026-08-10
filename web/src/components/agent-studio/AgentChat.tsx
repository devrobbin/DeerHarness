'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

interface AgentItem {
  agentId: string;
  name: string;
  description?: string;
  project_id: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export function AgentChat() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ agents: AgentItem[] }>('/api/agents')
      .then(d => {
        // 去重：同名 Agent 取第一个（按 project 排序稳定）
        const seen = new Set<string>();
        const unique = d.agents.filter(a => {
          if (seen.has(a.agentId)) return false;
          seen.add(a.agentId);
          return true;
        });
        setAgents(unique);
        if (unique.length > 0) setSelected(unique[0].agentId);
      })
      .catch(console.error);
  }, []);

  const selectedAgent = agents.find(a => a.agentId === selected);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading || !selectedAgent) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const data = await apiPost<{ reply: string; session_id: string }>(
        `/api/agents/${selectedAgent.agentId}/chat`,
        { message: text, project_id: selectedAgent.project_id, session_id: sessionId },
      );
      setSessionId(data.session_id);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(`对话失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  const switchAgent = (agentId: string) => {
    setSelected(agentId);
    setMessages([]);
    setSessionId(undefined);
    setError('');
  };

  return (
    <div className="flex h-[560px] flex-col rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">💬 Agent 对话</h2>
        <select
          value={selected}
          onChange={e => switchAgent(e.target.value)}
          className="max-w-[180px] rounded border border-gray-300 p-1.5 text-xs"
        >
          {agents.map(a => (
            <option key={`${a.project_id}/${a.agentId}`} value={a.agentId}>
              {a.name}（{a.agentId}）
            </option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-xs text-gray-400">
        与 PenguinHarness Agent 对话 · DeepSeek-V4-Flash
        {sessionId && <span className="ml-1 font-mono">· {sessionId.slice(-10)}</span>}
      </p>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 && !loading && (
          <p className="py-6 text-center text-sm text-gray-400">
            选择上方 Agent 开始对话…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">
              Agent 执行中…
            </div>
          </div>
        )}
        {error && <p className="text-center text-xs text-red-500">{error}</p>}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="向 Agent 下达任务"
          disabled={loading}
          className="flex-1 rounded border border-gray-300 p-2 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim() || !selectedAgent}
          className="rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '执行中…' : '发送'}
        </button>
      </div>
    </div>
  );
}
