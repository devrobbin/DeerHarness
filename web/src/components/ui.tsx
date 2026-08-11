'use client';

import React from 'react';

/**
 * DeerHarness 设计系统基元（评审遗留：消除散落的 Tailwind 重复类）。
 * 后续页面逐步迁移到这些基元 + 设计 token。
 */

// ---------- 设计 token ----------
export const tokens = {
  colors: {
    brand: 'bg-blue-500 hover:bg-blue-600',
    brandText: 'text-blue-600',
    purple: 'bg-purple-500 hover:bg-purple-600',
    danger: 'text-red-500 hover:text-red-700',
  },
  radius: 'rounded-lg',
  card: 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800',
  input: 'w-full rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100',
};

// ---------- 基元 ----------

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'purple' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    purple: 'bg-purple-500 text-white hover:bg-purple-600',
    ghost: 'border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300',
    danger: 'text-red-500 hover:text-red-700',
  }[variant];
  return (
    <button
      {...props}
      className={`rounded px-4 py-2 text-sm disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${tokens.input} ${className ?? ''}`} />;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`${tokens.card} ${className ?? ''}`}>{children}</div>;
}

export function Badge({
  children,
  color = 'gray',
}: {
  children: React.ReactNode;
  color?: 'green' | 'red' | 'gray' | 'purple' | 'amber';
}) {
  const styles = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }[color];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${styles}`}>{children}</span>;
}

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-500" role="status" aria-live="polite">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.3s]" />
      {label}
    </span>
  );
}
