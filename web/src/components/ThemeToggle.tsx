'use client';

import { useEffect, useState } from 'react';

const THEME_KEY = 'dh_theme';

/** 深色模式开关：class 策略（评审遗留：设计系统基础）。 */
export function ThemeToggle() {
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
      aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
      className="w-full rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
    >
      {dark ? '🌙 深色模式（点击切换）' : '☀️ 浅色模式（点击切换）'}
    </button>
  );
}
