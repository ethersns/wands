"""Research forensics: a check that was not performed is never reported as passed.

The invariant under test is narrow and load-bearing. Every finding must be one of
four things — verified, not verified, unassessable, or inapplicable — and the
first of those is only allowed when the stored record actually contains the
evidence the check needs. A report that quietly upgrades "we could not check" to
"we checked and it held" is worse than no report, because it manufactures
confidence the experiment never earned.

The second property is that the assessment is read-only and deterministic. It
must not write, must not re-run a strategy, and must produce the same report for
the same record every time.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from wands.db.models import IntelExperimentRow, MarketCandleRow
from wands.intelligence.forensics import (
    CANNOT_ASSESS,
    NOT_APPLICABLE,
    NOT_VERIFIED,
    VERIFIED,
    ForensicSubject,
    SymbolCoverage,
    assess,
    report_for_row,
)

from .conftest import AUTH

START = datetime(2024, 1, 1, tzinfo=UTC)
END = datetime(2024, 12, 31, tzinfo=UTC)
CUTOFF = datetime(2024, 12, 31, tzinfo=UTC)


def _subject(**overrides) -> ForensicSubject:
    """A record that passes every check the stored data can evidence."""
    base: dict = {
        "study": "strategy_baseline",
        "status": "complete",
        "sample_size": 120,
        "period_start": START,
        "period_end": END,
        "information_cutoff": CUTOFF,
        "benchmark": "BUY_AND_HOLD",
        "metrics": {
            "study": "strategy_baseline",
            "costBps": 11.0,
            "symbols": ["AAPL", "MSFT"],
            "evaluationStatus": {
                "status": "held_out",
                "label": "Held out",
                "reason": "Measured on a window that did not inform the design.",
                "parametersFitted": False,
            },
            "multipleTesting": {
                "tests": 3,
                "bonferroniAlpha": 0.0167,
                "survives": True,
                "survivors": [True, False, False],
            },
            "summary": {"costDrag": 0.004},
        },
        "coverage": {},
        "flags": (),
        "definition_hash": "a" * 64,
        "data_fingerprint": "b" * 64,
        "symbols": ("AAPL", "MSFT"),
        "execution_assumptions": {"entry": "next_session_open"},
        "cost_assumptions": {"roundTripBps": 11.0},
        "parameters": {"strategy": {"kind": "trend"}},
    }
    base.update(overrides)
    return ForensicSubject(**base)


def _coverage(*, last: datetime | None = None, bars: int = 250) -> list[SymbolCoverage]:
    moment = last or datetime(2024, 12, 30, tzinfo=UTC)
    return [
        SymbolCoverage("AAPL", bars, datetime(2024, 1, 2, tzinfo=UTC), moment),
        SymbolCoverage("MSFT", bars, datetime(2024, 1, 2, tzinfo=UTC), moment),
    ]


def _finding(report, identifier: str):
    return next(item for item in report.findings if item.id == identifier)


# --------------------------------------------------------------------------
# The core invariant
# --------------------------------------------------------------------------


def test_no_check_is_verified_without_evidence():
    report = assess(_subject(), price_coverage=_coverage())
    for finding in report.findings:
        if finding.status == VERIFIED:
            assert finding.evidence, f"{finding.id} claims a pass with no evidence"


def test_every_finding_uses_a_known_status():
    report = assess(_subject(), price_coverage=_coverage())
    allowed = {VERIFIED, NOT_VERIFIED, CANNOT_ASSESS, NOT_APPLICABLE}
    assert {finding.status for finding in report.findings} <= allowed


def test_the_report_carries_no_fabricated_probability():
    payload = assess(_subject(), price_coverage=_coverage()).as_dict()
    assert "confidence" not in payload
    assert "probability" not in payload
    assert "%" not in payload["verdict"]


def test_the_same_record_produces_the_same_report():
    first = assess(_subject(), price_coverage=_coverage()).as_dict()
    second = assess(_subject(), price_coverage=_coverage()).as_dict()
    assert first == second


def test_the_verdict_counts_what_it_established():
    payload = assess(_subject(), price_coverage=_coverage()).as_dict()
    counts = payload["counts"]
    assert counts["total"] == len(payload["findings"])
    assert (
        counts["verified"]
        + counts["notVerified"]
        + counts["cannotAssess"]
        + counts["notApplicable"]
        == counts["total"]
    )
    assert payload["verdict"].startswith(f"{counts['verified']} of {counts['total']}")


# --------------------------------------------------------------------------
# Point-in-time and look-ahead
# --------------------------------------------------------------------------


def test_a_window_inside_the_cutoff_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "point_in_time_eligibility").status == VERIFIED


def test_a_window_past_the_cutoff_is_not_verified():
    report = assess(
        _subject(information_cutoff=datetime(2024, 6, 30, tzinfo=UTC)),
        price_coverage=_coverage(),
    )
    finding = _finding(report, "point_in_time_eligibility")
    assert finding.status == NOT_VERIFIED
    assert "after the information cutoff" in finding.explanation


def test_a_missing_cutoff_is_unassessable_rather_than_passed():
    report = assess(_subject(information_cutoff=None), price_coverage=_coverage())
    assert _finding(report, "point_in_time_eligibility").status == CANNOT_ASSESS


def test_a_next_open_fill_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "look_ahead_fill").status == VERIFIED


def test_an_unrecorded_fill_convention_is_unassessable():
    report = assess(_subject(execution_assumptions={}), price_coverage=_coverage())
    assert _finding(report, "look_ahead_fill").status == CANNOT_ASSESS


def test_a_same_close_fill_is_not_verified():
    report = assess(
        _subject(execution_assumptions={"entry": "same_session_close"}),
        price_coverage=_coverage(),
    )
    assert _finding(report, "look_ahead_fill").status == NOT_VERIFIED


def test_a_price_rule_has_no_publication_lag_to_check():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "publication_versus_transaction").status == NOT_APPLICABLE


def test_an_insider_study_verifies_publication_timing():
    report = assess(
        _subject(study="insider_purchase_event_study"), price_coverage=_coverage()
    )
    assert _finding(report, "publication_versus_transaction").status == VERIFIED


# --------------------------------------------------------------------------
# Price and benchmark coverage
# --------------------------------------------------------------------------


def test_a_series_reaching_the_window_end_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "price_coverage").status == VERIFIED


def test_a_stale_series_is_not_verified():
    stale = _coverage(last=datetime(2024, 9, 30, tzinfo=UTC))
    report = assess(_subject(), price_coverage=stale)
    finding = _finding(report, "price_coverage")
    assert finding.status == NOT_VERIFIED
    assert "stop more than" in finding.explanation


def test_a_symbol_with_no_bars_is_not_verified():
    empty = [
        SymbolCoverage("AAPL", 250, datetime(2024, 1, 2, tzinfo=UTC), datetime(2024, 12, 30, tzinfo=UTC)),
        SymbolCoverage("MSFT", 0, None, None),
    ]
    report = assess(_subject(), price_coverage=empty)
    finding = _finding(report, "price_coverage")
    assert finding.status == NOT_VERIFIED
    assert "no stored bar" in finding.explanation


def test_price_coverage_without_a_probe_is_unassessable():
    report = assess(_subject(), price_coverage=None)
    assert _finding(report, "price_coverage").status == CANNOT_ASSESS


def test_a_weekend_at_the_window_end_is_not_staleness():
    # 2024-12-31 is a Tuesday; a series ending Friday 2024-12-27 is complete.
    report = assess(
        _subject(), price_coverage=_coverage(last=datetime(2024, 12, 27, tzinfo=UTC))
    )
    assert _finding(report, "price_coverage").status == VERIFIED


def test_a_missing_benchmark_is_not_verified():
    subject = _subject(
        study="institutional_holdings_study",
        coverage={"benchmarkAvailable": False},
    )
    report = assess(subject, price_coverage=_coverage())
    finding = _finding(report, "benchmark_coverage")
    assert finding.status == NOT_VERIFIED
    assert "raw, not excess" in finding.explanation


def test_an_available_benchmark_is_verified():
    subject = _subject(
        study="institutional_holdings_study",
        coverage={"benchmarkAvailable": True},
    )
    report = assess(subject, price_coverage=_coverage())
    assert _finding(report, "benchmark_coverage").status == VERIFIED


def test_trades_without_a_benchmark_bar_are_not_verified():
    subject = _subject(
        study="insider_purchase_event_study",
        metrics={
            "study": "insider_purchase_event_study",
            "costBps": 11.0,
            "symbols": ["AAPL"],
            "horizons": [
                {"horizonDays": 20, "coverage": {"trades": 10, "missingBenchmark": 4}}
            ],
        },
    )
    report = assess(subject, price_coverage=_coverage())
    finding = _finding(report, "benchmark_coverage")
    assert finding.status == NOT_VERIFIED
    assert "4 of 10" in finding.explanation


# --------------------------------------------------------------------------
# Costs, sample size, sensitivity
# --------------------------------------------------------------------------


def test_a_charged_round_trip_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    finding = _finding(report, "trading_costs")
    assert finding.status == VERIFIED
    assert finding.limitation and "slippage" in finding.limitation.lower()


def test_zero_cost_is_not_verified():
    subject = _subject(
        metrics={"study": "strategy_baseline", "costBps": 0.0, "symbols": ["AAPL"]},
        cost_assumptions={"roundTripBps": 0.0},
    )
    report = assess(subject, price_coverage=_coverage())
    assert _finding(report, "trading_costs").status == NOT_VERIFIED


def test_an_unrecorded_cost_is_unassessable():
    subject = _subject(
        metrics={"study": "strategy_baseline", "symbols": ["AAPL"]},
        cost_assumptions={},
    )
    report = assess(subject, price_coverage=_coverage())
    assert _finding(report, "trading_costs").status == CANNOT_ASSESS


def test_a_sample_below_the_minimum_is_not_verified():
    report = assess(_subject(sample_size=4), price_coverage=_coverage())
    finding = _finding(report, "sample_size")
    assert finding.status == NOT_VERIFIED
    assert "descriptive" in finding.explanation


def test_a_sample_above_the_minimum_is_verified():
    report = assess(_subject(sample_size=120), price_coverage=_coverage())
    assert _finding(report, "sample_size").status == VERIFIED


def test_parameter_sensitivity_is_never_verified():
    # One parameter set and no sweep cannot evidence robustness, however clean
    # the rest of the record is.
    report = assess(_subject(), price_coverage=_coverage())
    finding = _finding(report, "parameter_sensitivity")
    assert finding.status == CANNOT_ASSESS
    assert finding.next_step


def test_survivorship_is_never_verified():
    report = assess(_subject(), price_coverage=_coverage())
    finding = _finding(report, "survivorship_bias")
    assert finding.status == CANNOT_ASSESS
    assert "survivor" in finding.explanation.lower()


def test_a_disclosed_survivorship_limit_is_quoted_as_evidence():
    subject = _subject(
        metrics={
            "study": "strategy_baseline",
            "costBps": 11.0,
            "symbols": ["AAPL"],
            "universe": {"survivorshipLimitation": "Delisted issuers are absent."},
        }
    )
    report = assess(subject, price_coverage=_coverage())
    finding = _finding(report, "survivorship_bias")
    assert "Delisted issuers are absent." in finding.evidence


# --------------------------------------------------------------------------
# Multiple comparisons and out-of-sample independence
# --------------------------------------------------------------------------


def test_a_result_that_survives_the_correction_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "multiple_comparisons").status == VERIFIED


def test_a_result_that_does_not_survive_is_not_verified():
    subject = _subject(
        metrics={
            "study": "strategy_baseline",
            "costBps": 11.0,
            "symbols": ["AAPL"],
            "multipleTesting": {
                "tests": 3,
                "bonferroniAlpha": 0.0167,
                "survives": False,
                "survivors": [False, False, False],
            },
        }
    )
    report = assess(subject, price_coverage=_coverage())
    finding = _finding(report, "multiple_comparisons")
    assert finding.status == NOT_VERIFIED
    assert "by chance" in finding.explanation


def test_an_uncorrected_family_is_unassessable():
    subject = _subject(
        metrics={"study": "strategy_baseline", "costBps": 11.0, "symbols": ["AAPL"]}
    )
    report = assess(subject, price_coverage=_coverage())
    assert _finding(report, "multiple_comparisons").status == CANNOT_ASSESS


def test_a_retrospective_result_is_not_out_of_sample_evidence():
    subject = _subject(
        metrics={
            "study": "strategy_baseline",
            "costBps": 11.0,
            "symbols": ["AAPL"],
            "evaluationStatus": {
                "status": "retrospective_validation",
                "label": "Retrospective validation",
                "reason": "The rules were written against this data.",
                "parametersFitted": False,
            },
        }
    )
    report = assess(subject, price_coverage=_coverage())
    finding = _finding(report, "out_of_sample_independence")
    assert finding.status == NOT_VERIFIED
    assert "not as held out" in finding.explanation
    assert "The rules were written against this data." in finding.evidence


def test_a_held_out_result_is_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "out_of_sample_independence").status == VERIFIED


def test_a_missing_evaluation_status_is_unassessable():
    subject = _subject(
        metrics={"study": "strategy_baseline", "costBps": 11.0, "symbols": ["AAPL"]}
    )
    report = assess(subject, price_coverage=_coverage())
    assert _finding(report, "out_of_sample_independence").status == CANNOT_ASSESS


# --------------------------------------------------------------------------
# Reproducibility
# --------------------------------------------------------------------------


def test_recorded_hashes_are_verified():
    report = assess(_subject(), price_coverage=_coverage())
    assert _finding(report, "reproducibility").status == VERIFIED


def test_a_missing_fingerprint_is_not_reproducible():
    report = assess(_subject(data_fingerprint=""), price_coverage=_coverage())
    finding = _finding(report, "reproducibility")
    assert finding.status == NOT_VERIFIED
    assert "data fingerprint" in finding.explanation


# --------------------------------------------------------------------------
# Next steps
# --------------------------------------------------------------------------


def test_next_steps_only_cover_checks_that_did_not_pass():
    report = assess(_subject(), price_coverage=_coverage())
    passed = {finding.next_step for finding in report.findings if finding.status == VERIFIED}
    assert not (set(report.next_steps) & passed)


def test_a_clean_record_still_reports_the_checks_it_could_not_close():
    report = assess(_subject(), price_coverage=_coverage())
    assert report.next_steps
    assert any("parameter grid" in step for step in report.next_steps)


# --------------------------------------------------------------------------
# Against a stored row
# --------------------------------------------------------------------------


def _row(session, **overrides) -> IntelExperimentRow:
    base: dict = {
        "name": "Trend following (moving average)",
        "signal_version": "1.1",
        "data_version": "dv-1",
        "period_start": START,
        "period_end": END,
        "information_cutoff": CUTOFF,
        "benchmark": "BUY_AND_HOLD",
        "parameters": {"symbols": ["AAPL"]},
        "execution_assumptions": {"entry": "next_session_open"},
        "cost_assumptions": {"roundTripBps": 11.0},
        "sample_size": 120,
        "coverage": {},
        "metrics": {
            "study": "strategy_baseline",
            "costBps": 11.0,
            "symbols": ["AAPL"],
            "evaluationStatus": {"status": "retrospective_validation", "label": "Retrospective validation"},
            "multipleTesting": {"tests": 3, "survives": False, "survivors": [False, False, False]},
        },
        "status": "complete",
        "flags": [],
        "definition_hash": "c" * 64,
        "data_fingerprint": "d" * 64,
        "created_at": datetime(2025, 1, 2, tzinfo=UTC),
        "completed_at": datetime(2025, 1, 2, tzinfo=UTC),
    }
    base.update(overrides)
    row = IntelExperimentRow(**base)
    session.add(row)
    session.flush()
    return row


def _candles(session, *, last: datetime) -> None:
    moment = datetime(2024, 1, 2, tzinfo=UTC)
    while moment <= last:
        session.add(
            MarketCandleRow(
                provider="fixture",
                symbol="AAPL",
                market_type="stocks",
                interval="1d",
                open_time=moment,
                open=Decimal("100"),
                high=Decimal("101"),
                low=Decimal("99"),
                close=Decimal("100"),
                volume=Decimal("1000"),
                provider_timestamp=moment + timedelta(hours=1),
            )
        )
        moment += timedelta(days=1)
    session.flush()


def test_a_stored_row_is_assessed_against_the_real_candle_store(session):
    row = _row(session)
    _candles(session, last=datetime(2024, 12, 30, tzinfo=UTC))

    payload = report_for_row(row, session=session)

    coverage = next(item for item in payload["findings"] if item["id"] == "price_coverage")
    assert coverage["status"] == VERIFIED
    assert any("AAPL" in line for line in coverage["evidence"])


def test_a_stored_row_with_a_short_series_is_not_verified(session):
    row = _row(session)
    _candles(session, last=datetime(2024, 6, 28, tzinfo=UTC))

    payload = report_for_row(row, session=session)

    coverage = next(item for item in payload["findings"] if item["id"] == "price_coverage")
    assert coverage["status"] == NOT_VERIFIED


def test_assessing_a_row_writes_nothing(session):
    row = _row(session)
    _candles(session, last=datetime(2024, 12, 30, tzinfo=UTC))
    before_metrics = dict(row.metrics)
    before_count = session.scalar(select(func.count()).select_from(IntelExperimentRow))

    report_for_row(row, session=session)

    assert dict(row.metrics) == before_metrics
    assert session.scalar(select(func.count()).select_from(IntelExperimentRow)) == before_count


def test_the_member_experiment_endpoint_carries_the_forensic_report(client, session):
    row = _row(session)
    _candles(session, last=datetime(2024, 12, 30, tzinfo=UTC))
    session.commit()

    response = client.get(f"/v1/intelligence/experiments/{row.id}", headers=AUTH)

    assert response.status_code == 200
    forensics = response.json()["data"]["forensics"]
    assert forensics["counts"]["total"] == 12
    assert forensics["verdict"]
    assert forensics["note"]
    statuses = {item["id"]: item["status"] for item in forensics["findings"]}
    assert statuses["out_of_sample_independence"] == NOT_VERIFIED
    assert statuses["parameter_sensitivity"] == CANNOT_ASSESS


def test_the_operator_run_response_does_not_carry_a_forensic_report(client, session):
    # The run response reports what was just recorded, not how far it can be
    # trusted, so the assessment stays on the member read path.
    _row(session)
    session.commit()

    response = client.get("/v1/intelligence/experiments", headers=AUTH)

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert items
    assert all(item.get("forensics") is None for item in items)


@pytest.mark.parametrize(
    "study",
    [
        "strategy_baseline",
        "insider_purchase_event_study",
        "institutional_holdings_study",
    ],
)
def test_every_study_produces_a_complete_report(study):
    report = assess(_subject(study=study), price_coverage=_coverage())
    assert len(report.findings) == 12
    assert report.verdict
