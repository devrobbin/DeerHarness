'use client';

import { useState } from 'react';
import { ModelSettings } from '@/components/settings/ModelSettings';
import { SkillSettings } from '@/components/settings/SkillSettings';
import { MCPSettings } from '@/components/settings/MCPSettings';
import { ChannelSettings } from '@/components/settings/ChannelSettings';
import { SafetySettings } from '@/components/settings/SafetySettings';

const TABS = [
  { id: 'models', label: '🧠 模型', component: ModelSettings },
  { id: 'skills', label: '🔧 技能', component: SkillSettings },
  { id: 'mcp', label: '🔌 MCP', component: MCPSettings },
  { id: 'channels', label: '📡 渠道', component: ChannelSettings },
  { id: 'safety', label: '🛡️ 安全', component: SafetySettings },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('models');
  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || ModelSettings;

  return (
    <div className="flex h-full">
      {/* 左侧 Tab 导航 */}
      <div className="w-48 border-r border-gray-200 p-4">
        <h1 className="text-xl font-bold mb-4">🛠️ Settings</h1>
        <div className="space-y-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-800 font-medium'
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 p-6 overflow-y-auto">
        <ActiveComponent />
      </div>
    </div>
  );
}
