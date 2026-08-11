'use client';

import React, { useEffect, useRef } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: string;
  children: React.ReactNode;
}

/**
 * 右侧滑出抽屉（评审 P2-a11y）：Esc 关闭 + aria-modal + 焦点 trap + 滚动锁。
 */
export function Drawer({ open, onClose, title, subtitle, width = 'w-[30rem]', children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // 滚动锁

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // 焦点 trap：Tab 循环在抽屉内
    const panel = ref.current;
    const handleFocus = (e: FocusEvent) => {
      if (panel && !panel.contains(e.target as Node)) {
        (panel.querySelector('button') as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('focusin', handleFocus);
    // 初始焦点到关闭按钮
    requestAnimationFrame(() => {
      (panel?.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', handleFocus);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={ref}
        className={`relative z-10 flex h-full ${width} max-w-[94vw] flex-col bg-white shadow-2xl dark:bg-gray-800`}
        style={{ animation: 'drawer-in 0.22s ease' }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-100">{title}</p>
            {subtitle && <p className="font-mono text-xs text-gray-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-1 text-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
