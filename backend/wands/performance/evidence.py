"""Immutable research evidence.

An evidence record is a snapshot of one test: what it asked, what it assumed,
what it found, and what it could not establish. Records are written once and
finalised once. ``integrity_hash`` covers the record's content, so a later reader
can tell whether it still says what it said when it was sealed.

``live_verified`` is refused. Live verification requires independently
reconcilable execution evidence, which this system does not have, so the label
cannot be earned by marking a row. Until such evidence exists, no live
performance claim is stored or displayed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.db.models import PerfAuditEventRow, PerfEvidenceRecordRow, utcnow
from wands.performance.hashing import content_hash

KINDS = ("backtest", "forward_paper", "live_verified")
REFUSED_KINDS = {
    "live_verified": (
        "Live verification requires independently reconcilable execution evidence, "
        "which this system does not have. The label cannot be applied by marking a "
        "record; it is reserved for evidence that can be reconciled against a broker."
    )
}


def _record_payload(row: PerfEvidenceRecordRow) -> dict[str, Any]:
    return {
        "runId": row.run_id,
        "kind": row.kind,
        "title": row.title,
        "objective": row.objective,
        "strategyVersionId": row.strategy_version_id,
        "dataset": row.dataset,
        "assumptions": row.assumptions,
        "results": row.results,
        "limitations": row.limitations,
        "conclusion": row.conclusion,
        "finalizedAt": row.finalized_at,
    }


class EvidenceVault:
    def __init__(self, session: Session, *, actor: str = "system") -> None:
        self.session = session
        self.actor = actor

    def create(
        self,
        *,
        kind: str,
        title: str,
        objective: str,
        dataset: dict[str, Any],
        assumptions: dict[str, Any],
        results: dict[str, Any],
        limitations: list[str],
        strategy_version_id: Any | None = None,
        conclusion: str | None = None,
    ) -> PerfEvidenceRecordRow:
        if kind not in KINDS:
            raise ValueError(f"Kind must be one of {', '.join(KINDS)}; got {kind!r}.")
        if kind in REFUSED_KINDS:
            raise ValueError(REFUSED_KINDS[kind])

        stamp = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
        run_id = f"PL-{stamp}-{uuid4().hex[:8]}"

        row = PerfEvidenceRecordRow(
            run_id=run_id,
            kind=kind,
            title=title,
            objective=objective,
            strategy_version_id=strategy_version_id,
            dataset=dataset,
            assumptions=assumptions,
            results=results,
            limitations=list(limitations),
            conclusion=conclusion,
            integrity_hash="",
            finalized_at=None,
            created_at=utcnow(),
        )
        row.integrity_hash = content_hash(_record_payload(row))
        self.session.add(row)
        self.session.flush()
        self._audit("evidence.created", row, {"kind": kind})
        return row

    def finalize(
        self, run_id: str, *, conclusion: str
    ) -> PerfEvidenceRecordRow:
        row = self.get(run_id)
        if row.finalized_at is not None:
            raise ValueError(
                f"Evidence record {run_id} is already finalised and cannot be changed."
            )
        row.conclusion = conclusion
        row.finalized_at = utcnow()
        row.integrity_hash = content_hash(_record_payload(row))
        self.session.flush()
        self._audit("evidence.finalized", row, {"conclusion": conclusion})
        return row

    def get(self, run_id: str) -> PerfEvidenceRecordRow:
        row = self.session.scalars(
            select(PerfEvidenceRecordRow).where(PerfEvidenceRecordRow.run_id == run_id)
        ).first()
        if row is None:
            raise LookupError(f"No evidence record with run id {run_id}.")
        return row

    def list_records(self, *, limit: int = 100) -> list[PerfEvidenceRecordRow]:
        return list(
            self.session.scalars(
                select(PerfEvidenceRecordRow)
                .order_by(PerfEvidenceRecordRow.created_at.desc())
                .limit(limit)
            ).all()
        )

    def verify(self, run_id: str) -> bool:
        row = self.get(run_id)
        return content_hash(_record_payload(row)) == row.integrity_hash

    def export(self, run_id: str) -> dict[str, Any]:
        """A readable research report plus the raw record."""
        row = self.get(run_id)
        return {
            "runId": row.run_id,
            "kind": row.kind,
            "title": row.title,
            "objective": row.objective,
            "strategyVersionId": (
                str(row.strategy_version_id) if row.strategy_version_id else None
            ),
            "dataset": row.dataset,
            "assumptions": row.assumptions,
            "results": row.results,
            "limitations": row.limitations,
            "conclusion": row.conclusion,
            "createdAt": row.created_at.isoformat(),
            "finalizedAt": row.finalized_at.isoformat() if row.finalized_at else None,
            "integrityHash": row.integrity_hash,
            "integrityVerified": self.verify(run_id),
            "integrityNote": (
                "The integrity hash is a tamper-evidence check over this record's "
                "content. It is not a third-party audit and does not establish that "
                "the underlying market data was correct."
            ),
        }

    def _audit(
        self, action: str, row: PerfEvidenceRecordRow, detail: dict[str, Any]
    ) -> None:
        self.session.add(
            PerfAuditEventRow(
                occurred_at=utcnow(),
                actor=self.actor,
                action=action,
                subject_type="evidence_record",
                subject_id=row.run_id,
                detail=detail,
            )
        )
