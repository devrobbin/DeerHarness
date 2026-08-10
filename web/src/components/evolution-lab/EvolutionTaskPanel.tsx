'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

interface Props {
  onTaskStarted: (taskId: string) => void;
}

interface Task {
  task_id: string;
  agent_id: string;
  benchmark: string;
  max_rounds: number;
  target_score?: number | null;
  status?: string;
}

export function EvolutionTaskPanel({ onTaskStarted }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState({ agent_id: '', benchmark: 'GDPevo', max_rounds: 5, target_score: 90 });
  const [starting, setStarting] = useState(false);

  const fetchTasks = async () => {
    try {
      const data = await apiGet<{ tasks?: Task[] }>('/api/evolution/tasks');
      setTasks(data.tasks ?? (Array.isArray(data) ? data : []));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    try {
      const data = await apiPost<{ task_id?: string }>('/api/evolution/start', form);
      if (data.task_id) onTaskStarted(data.task_id);
      fetchTasks();
    } catch (err) {
      console.error(err);
      alert(`启动失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">🎯 启动进化任务</h2>

      <form onSubmit={handleStart} className="mb-4 space-y-2">
        <input
          placeholder="Agent ID"
          value={form.agent_id}
          onChange={e => setForm({ ...form, agent_id: e.target.value })}
          className="w-full p-2 border rounded text-sm"
          required
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="Benchmark"
            value={form.benchmark}
            onChange={e => setForm({ ...form, benchmark: e.target.value })}
            className="p-2 border rounded text-sm"
          />
          <input
            type="number"
            placeholder="轮次"
            value={form.max_rounds}
            onChange={e => setForm({ ...form, max_rounds: +e.target.value })}
            className="p-2 border rounded text-sm"
          />
          <input
            type="number"
            placeholder="目标分"
            value={form.target_score}
            onChange={e => setForm({ ...form, target_score: +e.target.value })}
            className="p-2 border rounded text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={starting}
          className="w-full rounded bg-purple-500 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {starting ? '启动中…' : '🚀 启动进化'}
        </button>
      </form>

      <div className="space-y-2">
        {tasks.map(t => (
          <div key={t.task_id} className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm">
            <span className="font-mono text-xs">{t.task_id}</span>
            <span className="text-gray-600">{t.agent_id} · {t.benchmark} · {t.max_rounds}轮</span>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-center text-sm text-gray-400">暂无进化任务</p>}
      </div>
    </div>
  );
}
