import type { Metadata } from 'next';
import { LanguageProvider } from '@/lib/i18n';
import { Sidebar } from '@/components/Sidebar';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeerHarness',
  description: 'PenguinHarness × DeerFlow 融合平台 — Self-evolving Agent construction meets robust multi-agent orchestration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <LanguageProvider>
          <ToastProvider>
            <div className="flex">
              <Sidebar />
              <main className="flex-1 p-6">{children}</main>
            </div>
          </ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
