'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Input, Spinner, tokens } from '@/components/ui';

interface Channel {
  id: string;
  type: string;
  name: string;
  webhook_url?: string;
  bot_token?: string;
  enabled: boolean;
}

type TestState = { ok?: boolean; message: string; loading?: boolean };

const CHANNEL_ICONS: Record<string, string> = { feishu: '🐦', slack: '💼', telegram: '✈️', wechat: '💬' };
const CHANNEL_LABELS: Record<string, string> = { feishu: '飞书', slack: 'Slack', telegram: 'Telegram', wechat: '企业微信' };

const EMPTY_FORM = { type: 'feishu', name: '', webhook_url: '', bot_token: '' };

/** 渠道集成：启用开关 + 测试消息移植 DeerFlow channels-settings（连接状态 + 操作按钮） */
export function ChannelSettings() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const fetchChannels = useCallback(async () => {
    try {
      const data = await apiGet<{ channels: Channel[] }>('/api/settings/channels');
      setChannels(data.channels);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };

  const openEdit = (c: Channel) => {
    setForm({ type: c.type, name: c.name, webhook_url: c.webhook_url ?? '', bot_token: c.bot_token ?? '' });
    setEditing(c);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { type: form.type, name: form.name, webhook_url: form.webhook_url, bot_token: form.bot_token, enabled: true };
      if (editing === 'new') {
        await apiPost('/api/settings/channels', { id: `ch-${Date.now()}`, ...body });
      } else if (editing) {
        await apiPut(`/api/settings/channels/${editing.id}`, { id: editing.id, ...body, enabled: editing.enabled });
      }
      setEditing(null);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (c: Channel) => {
    if (!window.confirm(t.channels.deleteConfirm(c.name))) return;
    try {
      await apiDelete(`/api/settings/channels/${c.id}`);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (c: Channel) => {
    try {
      await apiPut(`/api/settings/channels/${c.id}`, { ...c, enabled: !c.enabled });
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 真实发送一条测试消息到 webhook，验证渠道连通性 */
  const handleTest = async (c: Channel) => {
    setTestStates(prev => ({ ...prev, [c.id]: { message: '', loading: true } }));
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(`/api/settings/channels/${c.id}/test`);
      setTestStates(prev => ({ ...prev, [c.id]: { ok: res.ok, message: res.message } }));
    } catch (err) {
      setTestStates(prev => ({ ...prev, [c.id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">{t.channels.title}</h2>
        <Button onClick={openNew} disabled={editing !== null}>{t.channels.add}</Button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {editing && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{editing === 'new' ? t.channels.new : t.channels.edit}</h3>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.channels.platform}</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={tokens.input}>
                  {Object.entries(CHANNEL_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.channels.name}</label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.channels.webhookUrl}</label>
              <Input value={form.webhook_url} onChange={e => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.channels.botToken}</label>
              <Input type="password" value={form.bot_token} onChange={e => setForm({ ...form, bot_token: e.target.value })} placeholder="用于签名校验的机器人令牌" />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t.common.save}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {channels.map(c => {
          const test = testStates[c.id];
          return (
            <Card key={c.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span>{CHANNEL_ICONS[c.type] || '📡'}</span>
                  <span className={`truncate font-medium ${c.enabled ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{c.name}</span>
                  <Badge color={c.enabled ? 'green' : 'gray'}>{c.enabled ? t.common.enabled : t.common.disabled}</Badge>
                  <Badge color="gray">{CHANNEL_LABELS[c.type] || c.type}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{c.webhook_url || t.channels.noWebhook}</p>
                {test && (
                  <p className={`mt-1 text-xs ${test.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {test.loading ? <Spinner label={t.common.sending} /> : `${test.ok ? '✅' : '❌'} ${test.message}`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => handleToggle(c)}
                  title={c.enabled ? t.common.disabled : t.common.enabled}
                  className={`relative h-5 w-9 rounded-full transition ${c.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${c.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <Button variant="ghost" onClick={() => handleTest(c)} disabled={test?.loading} title="发送测试消息">
                  {test?.ok ? t.channels.retest : t.channels.test}
                </Button>
                <Button variant="ghost" onClick={() => openEdit(c)}>{t.common.edit}</Button>
                <Button variant="danger" onClick={() => handleDelete(c)}>{t.common.delete}</Button>
              </div>
            </Card>
          );
        })}
        {channels.length === 0 && <p className="py-8 text-center text-gray-400 dark:text-gray-500">{t.channels.empty}</p>}
      </div>
    </div>
  );
}
