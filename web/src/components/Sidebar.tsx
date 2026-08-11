'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ApiKeyInput } from '@/components/ApiKeyInput';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useI18n } from '@/lib/i18n';

const NAV_KEYS = [
  { href: '/', key: 'dashboard' },
  { href: '/chat', key: 'chat' },
  { href: '/studio', key: 'studio' },
  { href: '/evolution', key: 'evolution' },
  { href: '/monitor', key: 'monitor' },
  { href: '/settings', key: 'settings' },
] as const;

/** 侧栏：导航文案随界面语言切换（i18n）。 */
export function Sidebar() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 min-h-screen border-r border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2.5">
        <Logo size={34} />
        <h1 className="text-xl font-bold">DeerHarness</h1>
      </div>
      <p className="mb-6 text-xs text-gray-400">PenguinHarness × DeerFlow</p>
      <nav className="space-y-1">
        {NAV_KEYS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded px-3 py-2 text-sm transition ${
              pathname === item.href
                ? 'bg-blue-50 font-medium text-blue-700 dark:bg-gray-700 dark:text-blue-300'
                : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-blue-300'
            }`}
          >
            {t.nav[item.key]}
          </Link>
        ))}
      </nav>
      <div className="mt-6 space-y-2 border-t border-gray-100 pt-4 dark:border-gray-700">
        <ApiKeyInput />
        <ThemeToggle />
      </div>
    </aside>
  );
}
