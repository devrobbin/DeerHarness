from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import User, create_user, get_current_user, require_admin, _load_users


router = APIRouter()


class CreateUserRequest(BaseModel):
    username: str
    api_key: str
    role: str = "developer"


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {"user": user.model_dump(exclude={"api_key_hash"})}


@router.get("")
async def list_users(admin: User = Depends(require_admin)):
    users = _load_users()
    # 不返回 api_key_hash
    return {"users": [{k: v for k, v in u.items() if k != "api_key_hash"} for u in users]}


@router.post("")
async def create_new_user(req: CreateUserRequest, admin: User = Depends(require_admin)):
    if req.role not in ("admin", "developer", "viewer"):
        raise HTTPException(status_code=400, detail="无效角色")
    user = create_user(req.username, req.api_key, req.role)
    return {"success": True, "user": user.model_dump(exclude={"api_key_hash"})}
