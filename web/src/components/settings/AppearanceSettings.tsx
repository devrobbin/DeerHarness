'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button, Card } from '@/components/ui';
import type { Lang } from '@/lib/i18n';

const THEME_KEY = 'dh_theme';

type Theme = 'light' | 'dark';

/** 外观设置：界面语言 + 主题（移植 DeerFlow appearance-settings-page 的语言选择器）。 */
export function AppearanceSettings() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const initial: Theme = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  const handleTheme = (next: Theme) => {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem(THEME_KEY, next);
  };

  const label = 'mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-lg font-semibold dark:text-gray-100">{t.appearance.title}</h2>

      <Card>
        <label className={label} htmlFor="dh-lang">{t.appearance.language}</label>
        <div className="flex gap-2">
          {(['zh-CN', 'en-US'] as Lang[]).map(l => (
            <Button
              key={l}
              variant={lang === l ? 'primary' : 'ghost'}
              onClick={() => setLang(l)}
              className={lang === l ? '' : 'dark:text-gray-300'}
            >
              {l === 'zh-CN' ? t.appearance.zh : t.appearance.en}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{t.appearance.defaultHint}</p>
      </Card>

      <Card>
        <span className={label}>{t.appearance.theme}</span>
        <div className="flex gap-2">
          {(['light', 'dark'] as Theme[]).map(th => (
            <Button
              key={th}
              variant={theme === th ? 'primary' : 'ghost'}
              onClick={() => handleTheme(th)}
              className={theme === th ? '' : 'dark:text-gray-300'}
            >
              {th === 'light' ? `☀️ ${t.appearance.light}` : `🌙 ${t.appearance.dark}`}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{t.appearance.themeHint}</p>
      </Card>
    </div>
  );
}
