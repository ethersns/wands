"""Request dependencies: authentication, authorisation, MFA, request context.

Authorisation is a dependency on the route, not a check inside the handler, so
a new route cannot accidentally ship without it — the parameter is required for
the handler to run at all.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import User
from wands.db.session import get_session
from wands.errors import Forbidden, MfaRequired, Unauthorized
from wands.security.auth import Principal, authenticate_token
from wands.security.rbac import Role, at_least
from wands.security.secrets import SecretBox
from wands.security.totp import verify as verify_totp


def request_id_of(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("A bearer token is required.")
    return token.strip()


def current_principal(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Principal:
    principal = authenticate_token(session, bearer_token(request), settings)
    # Stashed so the denial handler can still name the actor after a permission
    # dependency has raised and the request is unwinding.
    request.state.principal = principal
    return principal


def require_role(required: Role) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not at_least(principal.role, required):
            raise Forbidden(f"This action requires the {required} role.")
        return principal

    return dependency


def require_scope(scope: str) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.has_scope(scope):
            raise Forbidden(f"This credential is missing the {scope} scope.")
        return principal

    return dependency


def enforce_mfa(
    request: Request,
    session: Session,
    principal: Principal,
    settings: Settings,
) -> None:
    """Challenge an enrolled principal for a second factor.

    The service token is exempt: it is a server-to-server credential that never
    reaches a browser, so there is no human to challenge. Every human credential
    that has enrolled MFA must present a valid code for privileged actions.
    """
    if principal.is_service or not principal.mfa_enabled:
        return

    code = request.headers.get("x-wands-mfa-code", "")
    if not code:
        raise MfaRequired("This action requires a multi-factor authentication code.")

    user = session.get(User, principal.user_id) if principal.user_id else None
    if user is None or not user.mfa_secret_encrypted:
        raise MfaRequired("Multi-factor authentication is not provisioned for this account.")

    secret = SecretBox(settings.require_encryption_key()).decrypt(user.mfa_secret_encrypted)[
        "secret"
    ]
    if not verify_totp(secret, code):
        raise MfaRequired("The multi-factor authentication code is not valid.")


def admin_principal(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> Principal:
    """Admin role plus a second factor where one is enrolled."""
    enforce_mfa(request, session, principal, settings)
    return principal
