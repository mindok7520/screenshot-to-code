from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qs, urlencode, urlparse

import httpx


CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_DEFAULT_ISSUER = "https://auth.openai.com"
CODEX_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex"
CODEX_DEFAULT_ORIGINATOR = "codex_cli_rs"
CODEX_DEFAULT_VERSION = "0.128.0"
CODEX_DEFAULT_PORT = 1455
CODEX_FALLBACK_PORT = 1457
CODEX_CHATGPT_RESPONSE_MODEL_ORDER = {
    "gpt-5.5": 0,
    "gpt-5.4": 1,
    "gpt-5.4-mini": 2,
}
CODEX_CHATGPT_RESPONSE_MODEL_SLUGS = set(CODEX_CHATGPT_RESPONSE_MODEL_ORDER)
CODEX_CHATGPT_RESPONSE_MODEL_EFFORTS = {
    "gpt-5.5": {"low", "medium", "high", "xhigh"},
    "gpt-5.4": {"low", "medium", "high", "xhigh"},
    "gpt-5.4-mini": {"low", "medium", "high", "xhigh"},
}

CODEX_AUTH_SCOPE = (
    "openid profile email offline_access api.connectors.read api.connectors.invoke"
)
TOKEN_REFRESH_INTERVAL_DAYS = 8
ACCESS_TOKEN_REFRESH_WINDOW = timedelta(minutes=5)


class CodexAuthError(Exception):
    """Raised when local Codex auth exists but is unusable."""


class CodexAuthNotConfigured(CodexAuthError):
    """Raised when there is no local ChatGPT/Codex auth file."""


@dataclass(frozen=True)
class CodexAuthCredentials:
    access_token: str
    account_id: str
    email: str | None
    plan_type: str | None
    is_fedramp_account: bool

    def openai_default_headers(self) -> dict[str, str]:
        version = os.environ.get("CODEX_CLIENT_VERSION", CODEX_DEFAULT_VERSION)
        headers = {
            "ChatGPT-Account-ID": self.account_id,
            "originator": CODEX_DEFAULT_ORIGINATOR,
            "User-Agent": f"{CODEX_DEFAULT_ORIGINATOR}/{version}",
            "version": version,
        }
        if self.is_fedramp_account:
            headers["X-OpenAI-Fedramp"] = "true"
        return headers


@dataclass(frozen=True)
class CodexAuthStatus:
    authenticated: bool
    codex_home: str
    email: str | None = None
    account_id: str | None = None
    plan_type: str | None = None
    error: str | None = None


@dataclass
class CodexLoginStart:
    login_id: str
    auth_url: str
    port: int


@dataclass(frozen=True)
class CodexReasoningLevel:
    effort: str
    description: str | None


@dataclass(frozen=True)
class CodexModelOption:
    slug: str
    display_name: str
    description: str | None
    default_reasoning_effort: str | None
    supported_reasoning_levels: list[CodexReasoningLevel]


@dataclass
class _LoginState:
    login_id: str
    state: str
    code_verifier: str
    redirect_uri: str
    issuer: str
    codex_home: Path
    completed: bool = False
    error: str | None = None


@dataclass
class _ActiveLogin:
    login_id: str
    auth_url: str
    port: int
    server: ThreadingHTTPServer
    thread: threading.Thread

    def shutdown(self) -> None:
        self.server.shutdown()
        self.server.server_close()


_LOGIN_LOCK = threading.Lock()
_ACTIVE_LOGIN: _ActiveLogin | None = None


def get_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


def get_auth_file(codex_home: Path | None = None) -> Path:
    return (codex_home or get_codex_home()) / "auth.json"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_json() -> str:
    return _utc_now().isoformat().replace("+00:00", "Z")


def _decode_base64_url(value: str) -> bytes:
    padded = value + ("=" * (-len(value) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _decode_jwt_payload(jwt: str) -> dict[str, Any]:
    parts = jwt.split(".")
    if len(parts) != 3 or not parts[1]:
        raise CodexAuthError("invalid Codex JWT format")
    payload = _decode_base64_url(parts[1])
    decoded = cast(Any, json.loads(payload.decode("utf-8")))
    if not isinstance(decoded, dict):
        raise CodexAuthError("invalid Codex JWT payload")
    return cast(dict[str, Any], decoded)


def _claims_from_id_token(id_token: str) -> dict[str, Any]:
    claims = _decode_jwt_payload(id_token)
    profile_claims_raw = claims.get("https://api.openai.com/profile")
    auth_claims_raw = claims.get("https://api.openai.com/auth")
    profile_claims = (
        cast(dict[str, Any], profile_claims_raw)
        if isinstance(profile_claims_raw, dict)
        else {}
    )
    auth_claims = (
        cast(dict[str, Any], auth_claims_raw)
        if isinstance(auth_claims_raw, dict)
        else {}
    )

    return {
        "email": claims.get("email") or profile_claims.get("email"),
        "chatgpt_plan_type": auth_claims.get("chatgpt_plan_type"),
        "chatgpt_user_id": auth_claims.get("chatgpt_user_id")
        or auth_claims.get("user_id"),
        "chatgpt_account_id": auth_claims.get("chatgpt_account_id"),
        "chatgpt_account_is_fedramp": bool(
            auth_claims.get("chatgpt_account_is_fedramp", False)
        ),
    }


def _jwt_expiration(jwt: str) -> datetime | None:
    try:
        claims = _decode_jwt_payload(jwt)
    except (CodexAuthError, ValueError, json.JSONDecodeError):
        return None
    exp = claims.get("exp")
    if isinstance(exp, (int, float)):
        return datetime.fromtimestamp(exp, timezone.utc)
    return None


def _parse_last_refresh(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _read_auth_json(codex_home: Path | None = None) -> dict[str, Any]:
    auth_file = get_auth_file(codex_home)
    if not auth_file.exists():
        raise CodexAuthNotConfigured("Codex account is not connected.")
    with auth_file.open("r", encoding="utf-8") as f:
        auth = cast(Any, json.load(f))
    if not isinstance(auth, dict):
        raise CodexAuthError("Codex auth.json is invalid.")
    return cast(dict[str, Any], auth)


def _write_auth_json(auth: dict[str, Any], codex_home: Path | None = None) -> None:
    auth_file = get_auth_file(codex_home)
    auth_file.parent.mkdir(parents=True, exist_ok=True)
    with auth_file.open("w", encoding="utf-8") as f:
        json.dump(auth, f, indent=2)
        f.write("\n")


def _get_token_string(tokens: dict[str, Any], key: str) -> str:
    value = tokens.get(key)
    if isinstance(value, str) and value:
        return value
    raise CodexAuthError(f"Codex auth token data is missing {key}.")


def _tokens_from_auth(auth: dict[str, Any]) -> dict[str, Any]:
    auth_mode = auth.get("auth_mode")
    if auth_mode == "apiKey" or auth.get("tokens") is None:
        raise CodexAuthNotConfigured("Local Codex auth is not a ChatGPT login.")
    tokens = auth.get("tokens")
    if not isinstance(tokens, dict):
        raise CodexAuthError("Codex auth token data is invalid.")
    return cast(dict[str, Any], tokens)


def _credentials_from_auth(auth: dict[str, Any]) -> CodexAuthCredentials:
    tokens = _tokens_from_auth(auth)
    id_token = _get_token_string(tokens, "id_token")
    access_token = _get_token_string(tokens, "access_token")
    claims = _claims_from_id_token(id_token)
    account_id = tokens.get("account_id") or claims.get("chatgpt_account_id")
    if not isinstance(account_id, str) or not account_id:
        raise CodexAuthError("Codex auth is missing the ChatGPT account id.")

    email = claims.get("email")
    plan_type = claims.get("chatgpt_plan_type")
    return CodexAuthCredentials(
        access_token=access_token,
        account_id=account_id,
        email=email if isinstance(email, str) else None,
        plan_type=plan_type if isinstance(plan_type, str) else None,
        is_fedramp_account=bool(claims.get("chatgpt_account_is_fedramp")),
    )


def _should_refresh(auth: dict[str, Any]) -> bool:
    tokens = _tokens_from_auth(auth)
    access_token = _get_token_string(tokens, "access_token")
    expires_at = _jwt_expiration(access_token)
    if expires_at is not None:
        return expires_at <= _utc_now() + ACCESS_TOKEN_REFRESH_WINDOW

    last_refresh = _parse_last_refresh(auth.get("last_refresh"))
    if last_refresh is None:
        return False
    return last_refresh < _utc_now() - timedelta(days=TOKEN_REFRESH_INTERVAL_DAYS)


def _issuer() -> str:
    return os.environ.get("CODEX_AUTH_ISSUER", CODEX_DEFAULT_ISSUER).rstrip("/")


def _refresh_codex_tokens(auth: dict[str, Any], codex_home: Path) -> dict[str, Any]:
    tokens = _tokens_from_auth(auth)
    refresh_token = _get_token_string(tokens, "refresh_token")
    response = httpx.post(
        f"{_issuer()}/oauth/token",
        json={
            "client_id": CODEX_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        headers={
            "Content-Type": "application/json",
            "originator": CODEX_DEFAULT_ORIGINATOR,
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise CodexAuthError(
            f"Codex token refresh failed with status {response.status_code}."
        )
    body = cast(Any, response.json())
    if not isinstance(body, dict):
        raise CodexAuthError("Codex token refresh returned an invalid response.")
    body_dict = cast(dict[str, Any], body)

    merged_tokens: dict[str, Any] = dict(tokens)
    for key in ("id_token", "access_token", "refresh_token"):
        value = body_dict.get(key)
        if isinstance(value, str) and value:
            merged_tokens[key] = value

    refreshed: dict[str, Any] = {
        **auth,
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": None,
        "tokens": merged_tokens,
        "last_refresh": _utc_now_json(),
    }
    _write_auth_json(refreshed, codex_home)
    return refreshed


def get_codex_auth_credentials(refresh: bool = True) -> CodexAuthCredentials:
    codex_home = get_codex_home()
    auth = _read_auth_json(codex_home)
    if refresh and _should_refresh(auth):
        auth = _refresh_codex_tokens(auth, codex_home)
    return _credentials_from_auth(auth)


def get_codex_auth_status(refresh: bool = False) -> CodexAuthStatus:
    codex_home = get_codex_home()
    try:
        credentials = get_codex_auth_credentials(refresh=refresh)
    except CodexAuthNotConfigured:
        return CodexAuthStatus(authenticated=False, codex_home=str(codex_home))
    except CodexAuthError as err:
        return CodexAuthStatus(
            authenticated=False,
            codex_home=str(codex_home),
            error=str(err),
        )
    return CodexAuthStatus(
        authenticated=True,
        codex_home=str(codex_home),
        email=credentials.email,
        account_id=credentials.account_id,
        plan_type=credentials.plan_type,
    )


def logout_codex_auth() -> None:
    auth_file = get_auth_file()
    if auth_file.exists():
        auth_file.unlink()


def list_codex_models(refresh: bool = True) -> list[CodexModelOption]:
    credentials = get_codex_auth_credentials(refresh=refresh)
    version = os.environ.get("CODEX_CLIENT_VERSION", CODEX_DEFAULT_VERSION)
    headers = {
        **credentials.openai_default_headers(),
        "Authorization": f"Bearer {credentials.access_token}",
    }
    response = httpx.get(
        f"{CODEX_CHATGPT_BASE_URL}/models",
        params={"client_version": version},
        headers=headers,
        timeout=30,
    )
    if response.status_code >= 400:
        raise CodexAuthError(
            f"Codex model list failed with status {response.status_code}."
        )
    body = response.json()
    if not isinstance(body, dict):
        raise CodexAuthError("Codex model list returned an invalid response.")
    body_dict = cast(dict[str, Any], body)
    raw_models = body_dict.get("models")
    if not isinstance(raw_models, list):
        raise CodexAuthError("Codex model list did not include models.")
    raw_model_list = cast(list[Any], raw_models)

    models: list[CodexModelOption] = []
    for raw_model in raw_model_list:
        if not isinstance(raw_model, dict):
            continue
        model = cast(dict[str, Any], raw_model)
        slug = model.get("slug")
        if slug not in CODEX_CHATGPT_RESPONSE_MODEL_SLUGS:
            continue
        if model.get("supported_in_api") is not True:
            continue
        if model.get("visibility") != "list":
            continue

        raw_levels = model.get("supported_reasoning_levels")
        levels: list[CodexReasoningLevel] = []
        allowed_efforts = CODEX_CHATGPT_RESPONSE_MODEL_EFFORTS.get(slug, set())
        if isinstance(raw_levels, list):
            for raw_level in cast(list[Any], raw_levels):
                if not isinstance(raw_level, dict):
                    continue
                level = cast(dict[str, Any], raw_level)
                effort = level.get("effort")
                if not isinstance(effort, str) or effort not in allowed_efforts:
                    continue
                description = level.get("description")
                levels.append(
                    CodexReasoningLevel(
                        effort=effort,
                        description=description if isinstance(description, str) else None,
                    )
                )
        if not levels:
            continue

        default_effort = model.get("default_reasoning_level")
        if not isinstance(default_effort, str) or default_effort not in allowed_efforts:
            default_effort = None
        display_name = model.get("display_name")
        description = model.get("description")
        models.append(
            CodexModelOption(
                slug=slug,
                display_name=display_name if isinstance(display_name, str) else slug,
                description=description if isinstance(description, str) else None,
                default_reasoning_effort=default_effort,
                supported_reasoning_levels=levels,
            )
        )

    models.sort(key=lambda model: CODEX_CHATGPT_RESPONSE_MODEL_ORDER[model.slug])
    return models


def _generate_pkce() -> tuple[str, str]:
    verifier = _base64_url(secrets.token_bytes(64))
    challenge = _base64_url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _base64_url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _build_authorize_url(
    issuer: str,
    redirect_uri: str,
    code_challenge: str,
    state: str,
) -> str:
    query = {
        "response_type": "code",
        "client_id": CODEX_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": CODEX_AUTH_SCOPE,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "id_token_add_organizations": "true",
        "codex_cli_simplified_flow": "true",
        "state": state,
        "originator": CODEX_DEFAULT_ORIGINATOR,
    }
    return f"{issuer}/oauth/authorize?{urlencode(query)}"


def _exchange_code_for_tokens(
    issuer: str,
    code: str,
    redirect_uri: str,
    code_verifier: str,
) -> dict[str, str]:
    response = httpx.post(
        f"{issuer}/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": CODEX_CLIENT_ID,
            "code_verifier": code_verifier,
        },
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "originator": CODEX_DEFAULT_ORIGINATOR,
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise CodexAuthError(
            f"Codex token exchange failed with status {response.status_code}."
        )
    body = cast(Any, response.json())
    if not isinstance(body, dict):
        raise CodexAuthError("Codex token exchange returned an invalid response.")
    body_dict = cast(dict[str, Any], body)
    token_body: dict[str, str] = {}
    for key in ("id_token", "access_token", "refresh_token"):
        value = body_dict.get(key)
        if not isinstance(value, str) or not value:
            raise CodexAuthError(f"Codex token exchange did not return {key}.")
        token_body[key] = value
    return token_body


def _save_tokens(codex_home: Path, token_body: dict[str, str]) -> None:
    id_token = token_body["id_token"]
    claims = _claims_from_id_token(id_token)
    account_id = claims.get("chatgpt_account_id")
    if not isinstance(account_id, str) or not account_id:
        raise CodexAuthError("Codex login token did not include a ChatGPT account id.")

    auth: dict[str, Any] = {
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": None,
        "tokens": {
            "id_token": id_token,
            "access_token": token_body["access_token"],
            "refresh_token": token_body["refresh_token"],
            "account_id": account_id,
        },
        "last_refresh": _utc_now_json(),
    }
    _write_auth_json(auth, codex_home)


class _CodexLoginCallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    @property
    def login_state(self) -> _LoginState:
        return getattr(self.server, "login_state")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/auth/callback":
            self._handle_callback(parsed.query)
            return
        if parsed.path == "/cancel":
            self.login_state.error = "Login cancelled."
            self.login_state.completed = True
            self._send_html("Login cancelled", "Codex login was cancelled.")
            self._shutdown_server()
            return
        self.send_error(404)

    def _handle_callback(self, query: str) -> None:
        params = parse_qs(query)
        error = params.get("error", [None])[0]
        if error:
            description = params.get("error_description", [error])[0]
            self.login_state.error = description
            self.login_state.completed = True
            self._send_html("Login failed", description)
            self._shutdown_server()
            return

        state = params.get("state", [None])[0]
        code = params.get("code", [None])[0]
        if state != self.login_state.state:
            self._fail_callback("Login state did not match.")
            return
        if not code:
            self._fail_callback("Login callback did not include an authorization code.")
            return

        try:
            token_body = _exchange_code_for_tokens(
                self.login_state.issuer,
                code,
                self.login_state.redirect_uri,
                self.login_state.code_verifier,
            )
            _save_tokens(self.login_state.codex_home, token_body)
        except Exception as err:
            self._fail_callback(str(err))
            return

        self.login_state.completed = True
        self.login_state.error = None
        self._send_html(
            "Codex connected",
            "Codex account login completed. You can close this browser tab.",
        )
        self._shutdown_server()

    def _fail_callback(self, message: str) -> None:
        self.login_state.error = message
        self.login_state.completed = True
        self._send_html("Login failed", message)
        self._shutdown_server()

    def _send_html(self, title: str, message: str) -> None:
        safe_title = html.escape(title)
        safe_message = html.escape(message)
        body = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{safe_title}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 3rem; line-height: 1.5; }}
    main {{ max-width: 36rem; }}
  </style>
</head>
<body>
  <main>
    <h1>{safe_title}</h1>
    <p>{safe_message}</p>
  </main>
</body>
</html>"""
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _shutdown_server(self) -> None:
        threading.Thread(target=self.server.shutdown, daemon=True).start()


def _bind_callback_server(port: int) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), _CodexLoginCallbackHandler)


def _cancel_existing_server(port: int) -> None:
    try:
        httpx.get(f"http://127.0.0.1:{port}/cancel", timeout=1)
    except httpx.HTTPError:
        return


def _start_callback_server() -> tuple[ThreadingHTTPServer, int]:
    for port in (CODEX_DEFAULT_PORT, CODEX_FALLBACK_PORT):
        for attempt in range(2):
            try:
                return _bind_callback_server(port), port
            except OSError:
                if attempt == 0:
                    _cancel_existing_server(port)
                    continue
                break
    raise CodexAuthError(
        f"Could not bind Codex login callback on {CODEX_DEFAULT_PORT} or {CODEX_FALLBACK_PORT}."
    )


def start_codex_login() -> CodexLoginStart:
    global _ACTIVE_LOGIN
    with _LOGIN_LOCK:
        if _ACTIVE_LOGIN is not None:
            _ACTIVE_LOGIN.shutdown()
            _ACTIVE_LOGIN = None

        server, port = _start_callback_server()
        issuer = _issuer()
        code_verifier, code_challenge = _generate_pkce()
        state = secrets.token_urlsafe(32)
        redirect_uri = f"http://localhost:{port}/auth/callback"
        login_id = secrets.token_hex(16)
        auth_url = _build_authorize_url(
            issuer=issuer,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
            state=state,
        )

        setattr(
            server,
            "login_state",
            _LoginState(
                login_id=login_id,
                state=state,
                code_verifier=code_verifier,
                redirect_uri=redirect_uri,
                issuer=issuer,
                codex_home=get_codex_home(),
            ),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        _ACTIVE_LOGIN = _ActiveLogin(
            login_id=login_id,
            auth_url=auth_url,
            port=port,
            server=server,
            thread=thread,
        )
        return CodexLoginStart(login_id=login_id, auth_url=auth_url, port=port)
