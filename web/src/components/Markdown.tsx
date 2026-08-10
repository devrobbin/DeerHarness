'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染组件（GFM：表格 / 任务列表 / 删除线 / 代码块）。
 * 基于 react-markdown（默认安全，不注入 HTML）。
 */
export function Markdown({ content, invert = false }: { content: string; invert?: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none break-words ${
        invert ? 'prose-invert' : ''
      } prose-p:my-1 prose-pre:my-2 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-code:text-[0.85em] prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
