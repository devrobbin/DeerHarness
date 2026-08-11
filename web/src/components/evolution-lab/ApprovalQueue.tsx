'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Badge, Button } from '@/components/ui';

interface Approval {
  id: number;
  task_id: string;
  version: number;
  proposal: {
    target: string;
    member_id?: string;
    new_text?: string;
    reason?: string;
  };
  created_at: number;
}

interface ApprovalQueueProps {
  taskId: string;
  onChanged: () => void;
}

const TARGET_LABELS: Record<string, string> = {
  workflow_task: '工作流任务模板',
  soul: '主代理 soul',
  member_prompt: '成员人设',
};

/** 审批队列：待审批的进化改进方案（应用 / 拒绝） */
export function ApprovalQueue({ taskId, onChanged }: ApprovalQueueProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!taskId) { setApprovals([]); return; }
    try {
      const d = await apiGet<{ approvals: Approval[] }>(`/api/evolution/tasks/${taskId}/approvals`);
      setApprovals(d.approvals ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (approvalId: number, action: 'approve' | 'reject') => {
    try {
      await apiPost(`/api/evolution/tasks/${taskId}/${action}`, { approval_id: approvalId });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!taskId) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-amber-800 dark:text-amber-300">🛂 进化审批队列</h2>
        <Badge color="amber">{approvals.length} 待审批</Badge>
      </div>
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      <div className="space-y-3">
        {approvals.map(a => (
          <div key={a.id} className="rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-700 dark:bg-gray-800">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {TARGET_LABELS[a.proposal.target] ?? a.proposal.target}
                {a.proposal.member_id ? ` · ${a.proposal.member_id}` : ''}
              </span>
              <span className="text-[11px] text-gray-400">第 {a.version} 轮方案</span>
            </div>
            <p className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">💡 {a.proposal.reason}</p>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] leading-relaxed text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {a.proposal.new_text}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => handleAction(a.id, 'approve')} className="bg-green-500 hover:bg-green-600">✅ 应用改进</Button>
              <Button variant="ghost" onClick={() => handleAction(a.id, 'reject')} className="text-red-500">✕ 拒绝</Button>
            </div>
          </div>
        ))}
        {approvals.length === 0 && <p className="text-xs text-gray-400">当前无待审批方案</p>}
      </div>
    </div>
  );
}
