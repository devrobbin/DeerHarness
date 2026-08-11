"""用户管理路由：账户信息 / 轮换密钥 / 管理员 CRUD。

移植自 PenguinHarness admin-users-page（用户表 + 创建 + 重置凭据 + 删除），
密钥轮换语义对应 DeerFlow account 的修改密码（网关登录凭证为 API Key）。
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import (
    User,
    create_user,
    delete_user,
    get_current_user,
    require_admin,
    rotate_user_key,
    update_user_role,
    _load_users,
)


router = APIRouter()

VALID_ROLES = ("admin", "developer", "viewer")


class CreateUserRequest(BaseModel):
    username: str
    api_key: str
    role: str = "developer"


class UpdateUserRequest(BaseModel):
    role: str


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {"user": user.model_dump(exclude={"api_key_hash"})}


@router.post("/me/rotate-key")
async def rotate_my_key(user: User = Depends(get_current_user)):
    """轮换自己的 API Key（对应修改密码；新密钥仅返回一次）。"""
    new_key = rotate_user_key(user.id)
    return {"success": True, "api_key": new_key}


@router.get("")
async def list_users(admin: User = Depends(require_admin)):
    users = _load_users()
    # 不返回 api_key_hash
    return {"users": [{k: v for k, v in u.items() if k != "api_key_hash"} for u in users]}


@router.post("")
async def create_new_user(req: CreateUserRequest, admin: User = Depends(require_admin)):
    if req.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="无效角色")
    user = create_user(req.username, req.api_key, req.role)
    return {"success": True, "user": user.model_dump(exclude={"api_key_hash"})}


@router.put("/{user_id}")
async def update_user(user_id: str, req: UpdateUserRequest, admin: User = Depends(require_admin)):
    """修改角色（管理员）。"""
    if req.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="无效角色")
    user = update_user_role(user_id, req.role)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"success": True, "user": user.model_dump(exclude={"api_key_hash"})}


@router.post("/{user_id}/rotate-key")
async def rotate_user_key_admin(user_id: str, admin: User = Depends(require_admin)):
    """管理员为用户重置 API Key。"""
    new_key = rotate_user_key(user_id)
    if not new_key:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"success": True, "api_key": new_key}


@router.delete("/{user_id}")
async def delete_user_route(user_id: str, admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    users = _load_users()
    target = next((u for u in users if u["id"] == user_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["role"] == "admin" and sum(1 for u in users if u["role"] == "admin") <= 1:
        raise HTTPException(status_code=400, detail="不能删除最后一个管理员")
    delete_user(user_id)
    return {"success": True}
