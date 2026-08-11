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
        <AgentList />
        <AgentBuilder />
        {/* 团队编排占满两列：编排过程 + 汇总需要大展示区 */}
        <div className="lg:col-span-2">
          <TeamOrchestrator />
        </div>
        <AgentChat />
        <AgentTraceViewer />
        <AgentCostPanel />
      </div>
    </div>
  );
}
