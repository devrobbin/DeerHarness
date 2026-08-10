'use client';

import React, { useEffect, useState } from 'react';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

interface MCPServer {
  id: string;
  name: string;
  transport: string;
  command?: string;
  url?: string;
}

export function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', url: '' });

  const fetchServers = async () => {
    try {
      const res = await fetch(`${GATEWAY}/api/settings/mcp`);
      const data = await res.json();
      setServers(data.mcp_servers);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchServers(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${GATEWAY}/api/settings/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now().toString(), ...form, env: {} }),
    });
    setShowForm(false);
    setForm({ name: '', transport: 'stdio', command: '', url: '' });
    fetchServers();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${GATEWAY}/api/settings/mcp/${id}`, { method: 'DELETE' });
    fetchServers();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">MCP 服务器</h2>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
          + 添加 MCP
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
          <input placeholder="名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full p-2 border rounded text-sm" required />
          <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })} className="w-full p-2 border rounded text-sm">
            <option value="stdio">stdio</option>
            <option value="sse">SSE</option>
          </select>
          {form.transport === 'stdio' ? (
            <input placeholder="命令（如 npx @modelcontextprotocol/server-filesystem）" value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} className="w-full p-2 border rounded text-sm" />
          ) : (
            <input placeholder="URL" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="w-full p-2 border rounded text-sm" />
          )}
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 text-sm bg-green-500 text-white rounded">保存</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm bg-gray-300 rounded">取消</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {servers.map(s => (
          <div key={s.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
            <div>
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">{s.transport}</span>
              <p className="text-xs text-gray-500 mt-1">{s.command || s.url}</p>
            </div>
            <button onClick={() => handleDelete(s.id)} className="text-red-500 text-sm hover:text-red-700">删除</button>
          </div>
        ))}
        {servers.length === 0 && <p className="text-center text-gray-400 py-8">暂无 MCP 服务器</p>}
      </div>
    </div>
  );
}
