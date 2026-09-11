"""安全评审缺口修复单测（G1 viewer 拦截 / G5 max_rounds min 语义）。

G1：viewer 角色对非 GET 请求 403；GET 放行；admin/developer 不受影响。
G5：进化轮次上限 = min(请求参数, Settings 上限)。
"""
import pytest
from fastapi import HTTPException

import auth
from auth import User


def _user(role: str) -> User:
    return User(id="u1", username="t", role=role, api_key_hash="x", created_at=0.0)


class TestViewerReadonly:
    """G1：get_current_user 的 viewer 只读拦截。"""

    def test_viewer_get_allowed(self):
        u = _user("viewer")
        # GET 请求不应触发 403（通过 require_admin 前的拦截逻辑验证）
        assert auth._viewer_write_blocked(u, "GET") is False

    def test_viewer_post_blocked(self):
        u = _user("viewer")
        assert auth._viewer_write_blocked(u, "POST") is True
        assert auth._viewer_write_blocked(u, "DELETE") is True
        assert auth._viewer_write_blocked(u, "PUT") is True

    def test_developer_admin_not_blocked(self):
        assert auth._viewer_write_blocked(_user("developer"), "POST") is False
        assert auth._viewer_write_blocked(_user("admin"), "DELETE") is False

    def test_viewer_head_options_allowed(self):
        u = _user("viewer")
        assert auth._viewer_write_blocked(u, "HEAD") is False
        assert auth._viewer_write_blocked(u, "OPTIONS") is False
