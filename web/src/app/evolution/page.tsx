'use client';

import { AgentEvalPanel } from '@/components/evolution-lab/AgentEvalPanel';
import { EvalHistory } from '@/components/evolution-lab/EvalHistory';
import { useI18n } from '@/lib/i18n';

export default function EvolutionPage() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t.nav.evolution}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentEvalPanel />
        <EvalHistory />
      </div>
    </div>
  );
}
