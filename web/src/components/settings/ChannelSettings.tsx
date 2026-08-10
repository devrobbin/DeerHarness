'use client';

import React, { useEffect, useState } from 'react';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

interface Channel {
  id: string;
  type: string;
  name: string;
  webhook_url?: string;
  enabled: boolean;
}

const CHANNEL_ICONS: Record<string, string> = {
  feishu: '🐦',
  slack: '💼',
  telegram: '✈️',
  wechat: '💬',
};

export function ChannelSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'feishu', name: '', webhook_url: '' });

  const fetchChannels = async () => {
    try {
      const res = await fetch(`${GATEWAY}/api/settings/channels`);
      const data = await res.json();
      setChannels(data.channels);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchChannels(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${GATEWAY}/api/settings/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now().toString(), ...form, enabled: true }),
    });
    setShowForm(false);
    setForm({ type: 'feishu', name: '', webhook_url: '' });
    fetchChannels();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${GATEWAY}/api/settings/channels/${id}`, { method: 'DELETE' });
    fetchChannels();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">渠道集成</h2>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
          + 添加渠道
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full p-2 border rounded text-sm">
            <option value="feishu">飞书</option>
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
            <option value="wechat">企业微信</option>
          </select>
          <input placeholder="渠道名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full p-2 border rounded text-sm" required />
          <input placeholder="Webhook URL" value={form.webhook_url} onChange={e => setForm({ ...form, webhook_url: e.target.value })} className="w-full p-2 border rounded text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 text-sm bg-green-500 text-white rounded">保存</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm bg-gray-300 rounded">取消</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {channels.map(c => (
          <div key={c.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
            <div className="flex items-center gap-2">
              <span>{CHANNEL_ICONS[c.type] || '📡'}</span>
              <div>
                <span className="font-medium">{c.name}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.enabled ? '已启用' : '已禁用'}
                </span>
              </div>
            </div>
            <button onClick={() => handleDelete(c.id)} className="text-red-500 text-sm hover:text-red-700">删除</button>
          </div>
        ))}
        {channels.length === 0 && <p className="text-center text-gray-400 py-8">暂无渠道配置</p>}
      </div>
    </div>
  );
}
