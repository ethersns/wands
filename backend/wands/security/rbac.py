"""Role-based access control.

Three roles, strictly ordered. The role always comes from the credential, never
from the request body — that is the whole point of having a role.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    VIEWER = "viewer"
    OPERATOR = "operator"
    ADMIN = "admin"


_RANK: dict[Role, int] = {Role.VIEWER: 0, Role.OPERATOR: 1, Role.ADMIN: 2}


def at_least(role: Role, required: Role) -> bool:
    return _RANK[role] >= _RANK[required]


def parse_role(value: str) -> Role:
    try:
        return Role(value)
    except ValueError:
        # An unknown role in the database must never grant access.
        return Role.VIEWER
