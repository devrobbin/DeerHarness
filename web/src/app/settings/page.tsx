'use client';

import { useState } from 'react';
import { ModelSettings } from '@/components/settings/ModelSettings';
import { SkillSettings } from '@/components/settings/SkillSettings';
import { MCPSettings } from '@/components/settings/MCPSettings';
import { ChannelSettings } from '@/components/settings/ChannelSettings';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { UserAdmin } from '@/components/settings/UserAdmin';
import { SafetySettings } from '@/components/settings/SafetySettings';
import { SystemSettings } from '@/components/settings/SystemSettings';

const TABS = [
  { id: 'models', label: '🧠 模型', component: ModelSettings },
  { id: 'skills', label: '🔧 技能', component: SkillSettings },
  { id: 'mcp', label: '🔌 MCP', component: MCPSettings },
  { id: 'channels', label: '📡 渠道', component: ChannelSettings },
  { id: 'account', label: '👤 账户', component: AccountSettings },
  { id: 'users', label: '👥 用户', component: UserAdmin },
  { id: 'safety', label: '🛡️ 安全', component: SafetySettings },
  { id: 'system', label: 'ℹ️ 系统', component: SystemSettings },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('models');
  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || ModelSettings;

  return (
    <div className="flex h-full">
      {/* 左侧 Tab 导航 */}
      <div className="w-48 shrink-0 border-r border-gray-200 p-4 dark:border-gray-700">
        <h1 className="mb-4 text-xl font-bold dark:text-gray-100">🛠️ Settings</h1>
        <div className="space-y-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full rounded px-3 py-2 text-left text-sm transition ${
                activeTab === tab.id
                  ? 'bg-blue-100 font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        <ActiveComponent />
      </div>
    </div>
  );
}
