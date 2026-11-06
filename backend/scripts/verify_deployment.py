"""Deployment verification for a Wands engine host.

Run this on the host after ``alembic upgrade head`` and before handing the
deployment to an operator. It checks what a unit test cannot: that *this*
database is at the expected revision, that the audit trail is actually
immutable, that live trading is off, and — with ``--probe`` — that a permission
denial reaches the durable trail end to end.

    python -m scripts.verify_deployment
    python -m scripts.verify_deployment --probe

Exit code 0 means every check passed. Exit code 1 means at least one failed and
the host should not be treated as ready.

``--probe`` writes to the database: it creates a throwaway viewer credential,
provokes a 403, confirms the denial was audited, then removes the credential.
The audit row is deliberately left behind — the trail is append-only, and a
verification that erases its own evidence is not a verification.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]

PROBE_ACTOR = "deployment-verification@wands.invalid"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def _run(name: str, fn) -> Check:
    try:
        return Check(name, True, fn())
    except Exception as exc:  # noqa: BLE001 - a failed check is data, not a crash
        return Check(name, False, f"{type(exc).__name__}: {exc}")


def _revisions() -> tuple[str | None, str | None]:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    head = ScriptDirectory.from_config(config).get_current_head()

    from wands.db.session import get_engine

    with get_engine().connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    return current, head


def check_database() -> str:
    from wands.db.session import get_engine

    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
        version = connection.execute(text("SELECT version()")).scalar_one()
    return str(version).split(" on ")[0]


def check_revision() -> str:
    current, head = _revisions()
    if current != head:
        raise AssertionError(f"database is at {current!r}, expected head {head!r}")
    return f"at head {head}"


def check_audit_append_only() -> str:
    from wands.db.session import get_engine

    engine = get_engine()
    if engine.dialect.name != "postgresql":
        return f"skipped: {engine.dialect.name} has no trigger guard"

    with engine.connect() as connection:
        present = connection.execute(
            text(
                "SELECT count(*) FROM pg_trigger "
                "WHERE tgname = 'audit_events_append_only' AND NOT tgisinternal"
            )
        ).scalar_one()
    if not present:
        raise AssertionError("audit_events_append_only trigger is missing")
    return "trigger present"


def check_live_trading_disabled() -> str:
    from wands.db.models import EngineStateRow
    from wands.db.session import session_scope

    with session_scope() as session:
        state = session.get(EngineStateRow, 1)
        if state is None:
            raise AssertionError("engine_state row is missing; run bootstrap")
        if state.live_trading_enabled:
            raise AssertionError("live trading is ENABLED in the database")
        return f"mode={state.trading_mode} live_trading_enabled=false"


def check_deployment_flag() -> str:
    from wands.config import get_settings

    settings = get_settings()
    if settings.live_trading_enabled:
        raise AssertionError("WANDS_LIVE_TRADING_ENABLED is true on this host")
    return f"environment={settings.environment} live_trading_enabled=false"


def check_admin_exists() -> str:
    from wands.db.models import User
    from wands.db.session import session_scope

    with session_scope() as session:
        admins = session.scalar(
            select(func.count()).select_from(User).where(User.role == "admin", User.is_active)
        )
    if not admins:
        raise AssertionError("no active admin user; nobody can administer this host")
    return f"{admins} active admin(s)"


def check_audit_trail() -> str:
    from wands.db.models import AuditEvent
    from wands.db.session import session_scope

    with session_scope() as session:
        total = session.scalar(select(func.count()).select_from(AuditEvent))
    return f"{total} audit event(s)"


def probe_denial() -> str:
    from fastapi.testclient import TestClient

    from wands.config import get_settings
    from wands.db.models import ApiKey, AuditEvent, User
    from wands.db.session import session_scope
    from wands.main import create_app
    from wands.security.audit import DENIAL_ACTION
    from wands.security.auth import ALL_SCOPES, generate_api_key

    settings = get_settings()
    pepper = (
        settings.api_key_pepper.get_secret_value() if settings.api_key_pepper is not None else None
    )

    with session_scope() as session:
        user = User(
            email=PROBE_ACTOR,
            display_name="Deployment verification",
            role="viewer",
            mfa_enabled=False,
            is_active=True,
        )
        session.add(user)
        session.flush()
        user_id = user.id
        full, prefix, hashed = generate_api_key(pepper)
        session.add(
            ApiKey(
                user_id=user_id,
                name="deployment verification",
                key_prefix=prefix,
                key_hash=hashed,
                role="viewer",
                scopes=sorted(ALL_SCOPES),
            )
        )

    try:
        client = TestClient(create_app())
        response = client.patch(
            "/v1/risk/policy",
            headers={"authorization": f"Bearer {full}"},
            json={"daily_loss_limit_pct": 50},
        )
        if response.status_code != 403:
            raise AssertionError(f"expected 403 for a viewer, got {response.status_code}")

        with session_scope() as session:
            row = session.scalar(
                select(AuditEvent).where(
                    AuditEvent.actor == PROBE_ACTOR,
                    AuditEvent.action == DENIAL_ACTION,
                )
            )
            if row is None:
                raise AssertionError("the denial was not written to audit_events")
            request_id = row.request_id
            outcome = row.outcome
    finally:
        with session_scope() as session:
            session.execute(delete(ApiKey).where(ApiKey.user_id == user_id))
            session.execute(delete(User).where(User.id == user_id))

    return f"denial audited (outcome={outcome}, request_id={request_id})"


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a Wands engine deployment.")
    parser.add_argument(
        "--probe",
        action="store_true",
        help="write a throwaway credential and confirm a denial is audited end to end",
    )
    args = parser.parse_args()

    checks = [
        _run("database", check_database),
        _run("migration revision", check_revision),
        _run("audit append-only", check_audit_append_only),
        _run("live trading disabled (database)", check_live_trading_disabled),
        _run("live trading disabled (deployment)", check_deployment_flag),
        _run("admin account", check_admin_exists),
        _run("audit trail", check_audit_trail),
    ]
    if args.probe:
        checks.append(_run("denial audited end to end", probe_denial))

    width = max(len(check.name) for check in checks)
    for check in checks:
        status = "PASS" if check.ok else "FAIL"
        print(f"[{status}] {check.name.ljust(width)}  {check.detail}")

    failed = [check for check in checks if not check.ok]
    print()
    if failed:
        print(f"{len(failed)} of {len(checks)} checks failed.")
        return 1
    print(f"All {len(checks)} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
