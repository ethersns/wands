"""Mint a research-scoped API key for the member workspace.

The member research surface authenticates with a credential that carries
``research:read`` and nothing else. ``deny_research_only`` in
``wands/api/deps.py`` then keeps that credential off every operator surface, so
a leaked frontend token cannot reach orders, risk, connections or the engine.

Only the SHA-256 hash of the secret half is stored. The full key is printed
once, here, and cannot be recovered afterwards.

    python -m scripts.create_research_key --email research@example.com

Set the printed value as ``WANDS_RESEARCH_TOKEN`` on the Vercel project.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from wands.config import get_settings
from wands.db.models import ApiKey, User
from wands.db.session import session_scope
from wands.security.auth import RESEARCH_SCOPE, generate_api_key


def main() -> int:
    parser = argparse.ArgumentParser(description="Mint a research-scoped API key.")
    parser.add_argument("--email", required=True, help="account the key belongs to")
    parser.add_argument("--name", default="member research", help="label for the key")
    args = parser.parse_args()

    settings = get_settings()
    pepper = (
        settings.api_key_pepper.get_secret_value() if settings.api_key_pepper is not None else None
    )

    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == args.email))
        if user is None:
            user = User(
                email=args.email,
                display_name="Member research",
                role="viewer",
                mfa_enabled=False,
                is_active=True,
            )
            session.add(user)
            session.flush()
        elif not user.is_active:
            print(f"refusing: {args.email} is inactive", file=sys.stderr)
            return 1

        full, prefix, hashed = generate_api_key(pepper)
        session.add(
            ApiKey(
                user_id=user.id,
                name=args.name,
                key_prefix=prefix,
                key_hash=hashed,
                role="viewer",
                scopes=[RESEARCH_SCOPE],
            )
        )

    print("Research-scoped API key created. It is shown once and cannot be recovered.")
    print()
    print(full)
    print()
    print("Set this as WANDS_RESEARCH_TOKEN on the Vercel project.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
