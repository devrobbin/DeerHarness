'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { EvolutionTaskPanel } from '@/components/evolution-lab/EvolutionTaskPanel';
import { ApprovalQueue } from '@/components/evolution-lab/ApprovalQueue';
import { LiveEvolutionTracker } from '@/components/evolution-lab/LiveEvolutionTracker';
import { EvolutionLog } from '@/components/evolution-lab/EvolutionLog';
import { ScoreChart } from '@/components/evolution-lab/ScoreChart';
import { AgentEvalPanel } from '@/components/evolution-lab/AgentEvalPanel';
import { EvalHistory } from '@/components/evolution-lab/EvalHistory';

export default function EvolutionPage() {
  const { t } = useI18n();
  const [selectedTask, setSelectedTask] = useState('');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-gray-100">{t.nav.evolution}</h1>

      {/* 进化闭环：目标选择 → 审批队列 → 实时追踪/得分对比 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <EvolutionTaskPanel onTaskSelected={setSelectedTask} selectedTaskId={selectedTask} />
          <ApprovalQueue taskId={selectedTask} onChanged={() => setSelectedTask(v => v)} />
        </div>
        <div className="space-y-6">
          <ScoreChart taskId={selectedTask} />
          <LiveEvolutionTracker taskId={selectedTask} />
          <EvolutionLog taskId={selectedTask} />
        </div>
      </div>

      {/* 单 Agent 评测（保留） */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentEvalPanel />
        <EvalHistory />
      </div>
    </div>
  );
}
