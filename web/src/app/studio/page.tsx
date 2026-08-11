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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
        {/* 左列：Agent 列表撑满整行高度 */}
        <AgentList />
        {/* 右列：Builder / 对话 / Trace 三卡片均分高度，与左列齐平 */}
        <div className="flex flex-col gap-6">
          <div className="flex-1"><AgentBuilder /></div>
          <div className="flex-1"><AgentChat /></div>
          <div className="flex-1"><AgentTraceViewer /></div>
        </div>
        <div className="lg:col-span-2"><AgentCostPanel /></div>
        {/* 团队编排全宽置底：不挤压其他面板 */}
        <div className="lg:col-span-2">
          <TeamOrchestrator />
        </div>
      </div>
    </div>
  );
}
