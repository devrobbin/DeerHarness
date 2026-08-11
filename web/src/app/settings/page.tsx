'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { ModelSettings } from '@/components/settings/ModelSettings';
import { SkillSettings } from '@/components/settings/SkillSettings';
import { MCPSettings } from '@/components/settings/MCPSettings';
import { ChannelSettings } from '@/components/settings/ChannelSettings';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { UserAdmin } from '@/components/settings/UserAdmin';
import { SafetySettings } from '@/components/settings/SafetySettings';
import { SystemSettings } from '@/components/settings/SystemSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';

const TAB_IDS = [
  'models',
  'skills',
  'mcp',
  'channels',
  'account',
  'users',
  'safety',
  'system',
  'appearance',
] as const;

const COMPONENTS: Record<(typeof TAB_IDS)[number], () => JSX.Element> = {
  models: ModelSettings,
  skills: SkillSettings,
  mcp: MCPSettings,
  channels: ChannelSettings,
  account: AccountSettings,
  users: UserAdmin,
  safety: SafetySettings,
  system: SystemSettings,
  appearance: AppearanceSettings,
};

export default function SettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<(typeof TAB_IDS)[number]>('models');
  const ActiveComponent = COMPONENTS[activeTab];

  return (
    <div className="flex h-full">
      {/* 左侧 Tab 导航 */}
      <div className="w-48 shrink-0 border-r border-gray-200 p-4 dark:border-gray-700">
        <h1 className="mb-4 text-xl font-bold dark:text-gray-100">{t.settings.title}</h1>
        <div className="space-y-1">
          {TAB_IDS.map(id => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full rounded px-3 py-2 text-left text-sm transition ${
                activeTab === id
                  ? 'bg-blue-100 font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {t.settings.tabs[id]}
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
