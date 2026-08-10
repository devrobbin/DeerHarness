from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import hashlib
import hmac
import json
import os
import time

import config


security = HTTPBearer(auto_error=False)

USERS_FILE = os.path.join(os.path.dirname(__file__), "config", "users.json")


class User(BaseModel):
    id: str
    username: str
    role: str  # admin / developer / viewer
    api_key_hash: str
    created_at: float


def _load_users() -> list[dict]:
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r") as f:
            return json.load(f)
    return []


def _save_users(users: list[dict]):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)


def create_user(username: str, api_key: str, role: str = "developer") -> User:
    users = _load_users()
    user = User(
        id=hashlib.md5(f"{username}:{time.time()}".encode()).hexdigest()[:12],
        username=username,
        role=role,
        api_key_hash=hashlib.sha256(api_key.encode()).hexdigest(),
        created_at=time.time(),
    )
    users.append(user.model_dump())
    _save_users(users)
    return user


def verify_api_key(api_key: str) -> Optional[User]:
    users = _load_users()
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    for u in users:
        # 恒定时间比较，防时序侧信道
        if hmac.compare_digest(u["api_key_hash"], key_hash):
            return User(**u)
    return None


def bootstrap_admin() -> Optional[User]:
    """启动时播种管理员：用户库为空且配置了 ADMIN_API_KEY 时创建。

    解决"第一个管理员无法创建"的鸡生蛋问题（评审 P0-5）。
    """
    if not config.ADMIN_API_KEY:
        return None
    if _load_users():
        return None
    return create_user("admin", config.ADMIN_API_KEY, role="admin")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    """从 Bearer Token 中验证用户（缺失凭证返回 401）。"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 API Key（Authorization: Bearer <key>）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = verify_api_key(credentials.credentials)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 API Key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """要求管理员权限"""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user


async def require_developer(user: User = Depends(get_current_user)) -> User:
    """要求开发者及以上权限"""
    if user.role not in ("admin", "developer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要开发者权限",
        )
    return user
