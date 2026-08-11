'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

const THEME_KEY = 'dh_theme';

/** 深色模式开关：class 策略（评审遗留：设计系统基础），文案随界面语言切换。 */
export function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const initial = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDark(initial);
    document.documentElement.classList.toggle('dark', initial);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? t.theme.toLight : t.theme.toDark}
      className="w-full rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
    >
      {dark ? t.theme.dark : t.theme.light}
    </button>
  );
}
