'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 代码块：语言标签 + 复制按钮 */
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-gray-800">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-1 text-[11px] text-gray-300">
        <span>{language}</span>
        <button onClick={copy} aria-label={copied ? '已复制' : '复制代码'} className="hover:text-white">
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="!my-0 overflow-x-auto bg-gray-900 p-3 text-[13px] leading-relaxed text-gray-100">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** 覆写 pre：块级代码 → 带复制按钮的代码块 */
function Pre({ children }: { children?: React.ReactNode }) {
  const codeChild = Array.isArray(children) ? children[0] : children;
  const props = (codeChild as React.ReactElement<{ className?: string; children?: React.ReactNode }>)?.props;
  const className = props?.className ?? '';
  const language = /language-(\w+)/.exec(className)?.[1] ?? 'code';
  const text = String(props?.children ?? '').replace(/\n$/, '');
  return <CodeBlock language={language}>{text}</CodeBlock>;
}

/**
 * Markdown 渲染组件（GFM：表格 / 任务列表 / 删除线 / 代码块复制）。
 * 基于 react-markdown（默认安全，不注入 HTML）。
 */
export function Markdown({ content, invert = false }: { content: string; invert?: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none break-words ${
        invert ? 'prose-invert' : ''
      } prose-p:my-1 prose-pre:my-2 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-code:text-[0.85em] prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: Pre,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
