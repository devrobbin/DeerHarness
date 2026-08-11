'use client';

import { AgentList } from '@/components/agent-studio/AgentList';
import { AgentBuilder } from '@/components/agent-studio/AgentBuilder';
import { AgentTraceViewer } from '@/components/agent-studio/AgentTraceViewer';
import { AgentCostPanel } from '@/components/agent-studio/AgentCostPanel';
import { AgentChat } from '@/components/agent-studio/AgentChat';
import { TeamOrchestrator } from '@/components/agent-studio/TeamOrchestrator';
import { useI18n } from '@/lib/i18n';

export default function StudioPage() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t.nav.studio}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <AgentList />
          <AgentTraceViewer />
        </div>
        <div className="space-y-6">
          <AgentBuilder />
          <AgentChat />
          <TeamOrchestrator />
          <AgentCostPanel />
        </div>
      </div>
    </div>
  );
}
