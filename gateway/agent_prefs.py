"""Agent 模型偏好存储：每 Agent 默认模型（provider + model_id）。

背景：penguin agent config 不携带模型 id（模型为项目级默认 + 会话级选择），
DeerHarness 在偏好层实现"每 Agent 可切模型"：
- 会话创建时（/api/agents/{id}/chat）把偏好作为 {modelId, provider} 传给 penguin
- 无偏好 → 不传，penguin 回落项目默认模型
"""

from __future__ import annotations

import json
import os
import threading
from typing import Optional

PREF_FILE = os.path.join(os.path.dirname(__file__), "config", "agent_prefs.json")

_lock = threading.Lock()


def _load() -> dict:
    if os.path.exists(PREF_FILE):
        try:
            with open(PREF_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def get_model_pref(agent_id: str) -> Optional[dict]:
    """返回 {provider, model_id}；未设置返回 None。"""
    return _load().get(agent_id)


def set_model_pref(agent_id: str, provider: Optional[str], model_id: Optional[str]) -> dict:
    """设置偏好；provider/model_id 同时为空 = 清除（回落项目默认）。"""
    with _lock:
        prefs = _load()
        if provider and model_id:
            prefs[agent_id] = {"provider": provider, "model_id": model_id}
        else:
            prefs.pop(agent_id, None)
        os.makedirs(os.path.dirname(PREF_FILE), exist_ok=True)
        tmp = PREF_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(prefs, f, indent=2, ensure_ascii=False)
        os.replace(tmp, PREF_FILE)
        return prefs.get(agent_id) or {}
