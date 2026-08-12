'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Badge, Button, Spinner } from '@/components/ui';

interface GraphNode { id: string; name: string; role: string; }
interface GraphEdge { from: string; to: string; label: string; status: string; }

interface FlowGraphProps {
  threadId: string;
}

/**
 * 通信流可视化（评审参考 agency-swarm communication_flows）：
 * 把一次团队 run 的 orchestrator→成员 分派画成连线图。
 * 数据来自 /api/fusion/team/graph/{thread_id}。
 */
export function FlowGraph({ threadId }: FlowGraphProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const load = async () => {
    if (!threadId) { setNodes([]); setEdges([]); return; }
    setLoading(true);
    setError('');
    try {
      const d = await apiGet<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/fusion/team/graph/${threadId}`);
      setNodes(d.nodes ?? []);
      setEdges(d.edges ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [threadId]);

  if (!threadId) return null;

  // SVG 布局：orchestrator 居中，成员围绕成环
  const W = 520, H = 260, CX = W / 2, CY = H / 2, R = 92;
  const memberNodes = nodes.filter(n => n.role !== 'orchestrator');
  const orchNode = nodes.find(n => n.role === 'orchestrator');
  const pos: Record<string, { x: number; y: number }> = {};
  if (orchNode) pos[orchNode.id] = { x: CX, y: CY };
  memberNodes.forEach((n, i) => {
    const ang = (2 * Math.PI * i) / Math.max(1, memberNodes.length) - Math.PI / 2;
    pos[n.id] = { x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang) };
  });

  const statusColor = (s: string) => (s === 'failed' ? '#f87171' : s === 'completed' ? '#4ade80' : '#a78bfa');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold dark:text-gray-100">🕸️ 通信流</h2>
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Spinner label="加载…" /> : '刷新'}
        </Button>
      </div>
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      {edges.length === 0 && !loading && <p className="py-8 text-center text-sm text-gray-400">该团队 run 无分派记录（选择一次团队任务后查看）</p>}
      {edges.length > 0 && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
            {/* 边（先画，在节点下层） */}
            {edges.map((e, i) => {
              const from = pos[e.from] ?? { x: CX, y: CY };
              const to = pos[e.to] ?? from;
              return (
                <g key={i}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={statusColor(e.status)} strokeWidth={2} strokeOpacity={0.7}
                    markerEnd="url(#arrow)" />
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle" fontSize={9} fill="#9ca3af">
                    {e.label.slice(0, 16)}
                  </text>
                </g>
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
              </marker>
            </defs>
            {/* 节点 */}
            {nodes.map(n => {
              const p = pos[n.id] ?? { x: CX, y: CY };
              const isOrch = n.role === 'orchestrator';
              return (
                <g key={n.id} onClick={() => setSelected(n)} style={{ cursor: 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={isOrch ? 30 : 24}
                    fill={isOrch ? '#7c3aed' : '#3b82f6'} fillOpacity={0.9} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={isOrch ? 10 : 8} fill="#fff">
                    {n.name.slice(0, isOrch ? 10 : 8)}
                  </text>
                  <text x={p.x} y={p.y + (isOrch ? 44 : 38)} textAnchor="middle" fontSize={8} fill="#9ca3af">
                    {n.id.slice(0, 14)}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full bg-purple-500" />主代理</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full bg-blue-500" />成员</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full bg-green-400" />已完成</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full bg-purple-400" />进行中</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="h-2 w-2 rounded-full bg-red-400" />失败</span>
          </div>
          {selected && (
            <div className="mt-2 rounded bg-gray-50 p-2 text-xs dark:bg-gray-700/50">
              <p className="text-gray-700 dark:text-gray-200">📌 {selected.name}（{selected.id}）</p>
              <p className="text-gray-500 dark:text-gray-400">
                收到 {edges.filter(e => e.to === selected.id).length} 次分派
                {selected.id !== 'orchestrator' && ` · 作为 ${selected.role}`}
              </p>
              <div className="mt-1 space-y-0.5">
                {edges.filter(e => e.to === selected.id).map((e, i) => (
                  <p key={i} className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor(e.status) }} />
                    {e.label.slice(0, 40)} <Badge color={e.status === 'completed' ? 'green' : e.status === 'failed' ? 'red' : 'purple'}>{e.status}</Badge>
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
