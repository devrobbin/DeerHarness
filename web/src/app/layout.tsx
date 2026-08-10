import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ApiKeyInput } from '@/components/ApiKeyInput';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeerHarness',
  description: 'PenguinHarness × DeerFlow 融合平台 — Self-evolving Agent construction meets robust multi-agent orchestration',
};

const NAV = [
  { href: '/', label: '📊 Dashboard' },
  { href: '/chat', label: '💬 Chat' },
  { href: '/studio', label: '🧪 Agent Studio' },
  { href: '/evolution', label: '🧬 Evolution Lab' },
  { href: '/monitor', label: '🛰️ Monitor' },
  { href: '/settings', label: '🛠️ Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="flex">
          <aside className="w-52 shrink-0 min-h-screen border-r border-gray-200 bg-white p-4">
            <div className="mb-1 flex items-center gap-2.5">
              <Logo size={34} />
              <h1 className="text-xl font-bold">DeerHarness</h1>
            </div>
            <p className="mb-6 text-xs text-gray-400">PenguinHarness × DeerFlow</p>
            <nav className="space-y-1">
              {NAV.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded px-3 py-2 text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-700"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-6 border-t border-gray-100 pt-4">
              <ApiKeyInput />
            </div>
          </aside>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
