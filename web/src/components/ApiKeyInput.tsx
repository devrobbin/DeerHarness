'use client';

import { useState } from 'react';
import { getApiKey, setApiKey } from '@/lib/api';

/** 侧栏 API Key 输入：认证闭环（评审 A）——key 仅存 localStorage，不落任何服务端。 */
export function ApiKeyInput() {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="dh-api-key" className="block text-[11px] font-medium text-gray-500">
        🔑 Gateway API Key
      </label>
      <div className="flex gap-1.5">
        <input
          id="dh-api-key"
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="Bearer 密钥"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
        <button
          onClick={handleSave}
          className="shrink-0 rounded bg-gray-800 px-2.5 py-1 text-xs text-white hover:bg-gray-700"
        >
          {saved ? '✓' : '保存'}
        </button>
      </div>
      <p className="text-[10px] text-gray-400">仅存于本机浏览器，请求自动携带</p>
    </div>
  );
}
