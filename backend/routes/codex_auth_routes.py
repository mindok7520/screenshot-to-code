from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from codex_auth import (
    CodexAuthError,
    CodexAuthNotConfigured,
    get_codex_auth_status,
    list_codex_models,
    logout_codex_auth,
    start_codex_login,
)


router = APIRouter(prefix="/api/codex-auth")


@router.get("/status")
async def codex_auth_status() -> dict[str, object]:
    return asdict(get_codex_auth_status(refresh=False))


@router.post("/login/start")
async def codex_login_start() -> dict[str, object]:
    try:
        return asdict(start_codex_login())
    except CodexAuthError as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.get("/models")
async def codex_models() -> dict[str, object]:
    try:
        return {"models": [asdict(model) for model in list_codex_models()]}
    except CodexAuthNotConfigured as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    except CodexAuthError as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.post("/logout")
async def codex_logout() -> dict[str, bool]:
    logout_codex_auth()
    return {"ok": True}
