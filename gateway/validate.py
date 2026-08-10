"""上游路径参数消毒：防路径注入（安全评审 P1-2）。

所有拼进上游 URL 的用户可控参数（project_id / agent_id / session_id /
thread_id 等）必须先经过白名单校验。
"""

from __future__ import annotations

import re

from fastapi import HTTPException

# penguin/deer-flow 的 id 规则：字母数字下划线连字符，长度受限
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def valid_id(value: str, field: str = "id") -> str:
    """校验上游路径参数；非法即 400。"""
    if not value or not _ID_PATTERN.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"{field} 非法：仅允许字母/数字/下划线/连字符，长度 1-64",
        )
    return value
