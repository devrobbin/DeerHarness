'use client';

import { useState } from 'react';
import { EvolutionTaskPanel } from '@/components/evolution-lab/EvolutionTaskPanel';
import { ScoreChart } from '@/components/evolution-lab/ScoreChart';
import { EvolutionLog } from '@/components/evolution-lab/EvolutionLog';
import { LiveEvolutionTracker } from '@/components/evolution-lab/LiveEvolutionTracker';

export default function EvolutionPage() {
  const [taskId, setTaskId] = useState('');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">🧬 Evolution Lab</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <EvolutionTaskPanel onTaskStarted={setTaskId} />
          <ScoreChart taskId={taskId} />
        </div>
        <div className="space-y-6">
          <LiveEvolutionTracker taskId={taskId} />
          <EvolutionLog taskId={taskId} />
        </div>
      </div>
    </div>
  );
}
