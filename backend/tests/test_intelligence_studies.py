"""The Quant Lab studies: honest counts, point-in-time eligibility, reproducibility.

Three properties are asserted here because they are the ones a research product
can quietly get wrong.

*Eligibility is the filing's acceptance time.* A Form 4 reports a trade from last
week and is published today. Filtering on the transaction date would let the
study buy at a price that was already history.

*A small sample is reported as a small sample.* With no qualifying rows the study
returns the count, not a statistic computed from nothing.

*A re-run is the same experiment.* The definition hash is the identity, so a
second run reports whether the data still produces the same answer instead of
recording a second, apparently independent, result.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from wands.config import get_settings
from wands.db.models import (
    IntelFilingRow,
    IntelInsiderTransactionRow,
    IntelInstitutionRow,
    IntelInstitutionalHoldingRow,
    IntelSecurityIdentifierRow,
    MarketCandleRow,
)
from wands.intelligence.experiments import ExperimentDefinition
from wands.intelligence.strategies import RULE_MOVING_AVERAGE, TREND
from wands.intelligence.studies import (
    INSIDER_PURCHASE,
    INSTITUTIONAL_DECREASE,
    INSTITUTIONAL_INCREASE,
    STATUS_COMPLETE,
    STATUS_INSUFFICIENT,
    STUDY_INSIDER,
    STUDY_INSTITUTIONAL,
    STUDY_STRATEGY,
    QuantLab,
)
from wands.intelligence.validation import SignalValidator

from .intelligence_fakes import FakePriceProvider, daily_series

MONDAY = datetime(2024, 3, 4, 9, 30, tzinfo=UTC)
PERIOD_START = datetime(2024, 1, 1, tzinfo=UTC)
PERIOD_END = datetime(2024, 12, 31, tzinfo=UTC)
CUTOFF = datetime(2024, 12, 31, tzinfo=UTC)

AAPL_CUSIP_BASE = "03783310"
AAPL_CUSIP = "037833100"


def _lab(session, *, prices: FakePriceProvider | None = None) -> QuantLab:
    settings = get_settings()
    validator = SignalValidator(session, settings, prices=prices or FakePriceProvider())
    return QuantLab(session, settings, validator=validator)


def _prices(*, sessions: int = 60) -> FakePriceProvider:
    return FakePriceProvider(
        series={
            "AAPL": daily_series("AAPL", MONDAY, sessions, daily_return=0.004),
            "SPY": daily_series("SPY", MONDAY, sessions, start_price=500.0, daily_return=0.001),
        }
    )


def _purchase(
    session,
    *,
    accepted_at: datetime,
    transaction_date: datetime | None = None,
    symbol: str = "AAPL",
    open_market: bool = True,
    amendment: bool = False,
    acquired_disposed: str = "A",
    ordinal: int = 0,
) -> None:
    accession = f"0000320193-24-{ordinal:06d}"
    filing = IntelFilingRow(
        accession_number=accession,
        form_type="4",
        accepted_at=accepted_at,
        symbol=symbol,
        is_amendment=amendment,
    )
    session.add(filing)
    session.flush()
    session.add(
        IntelInsiderTransactionRow(
            filing_id=filing.id,
            accession_number=accession,
            symbol=symbol,
            transaction_date=transaction_date or (accepted_at - timedelta(days=3)),
            transaction_code="P",
            acquired_disposed=acquired_disposed,
            shares=Decimal("1000"),
            price_per_share=Decimal("100"),
            value=Decimal("100000"),
            is_open_market=open_market,
            is_amendment=amendment,
            accepted_at=accepted_at,
            ordinal=ordinal,
        )
    )
    session.commit()


def _insider_definition(**overrides) -> ExperimentDefinition:
    base = {
        "name": "Insider open-market purchases",
        "period_start": PERIOD_START,
        "period_end": PERIOD_END,
        "information_cutoff": CUTOFF,
        "categories": (INSIDER_PURCHASE,),
        "horizons": (5,),
        "parameters": {"symbols": ["AAPL"]},
    }
    base.update(overrides)
    return ExperimentDefinition(**base)


def _strategy_definition(**overrides) -> ExperimentDefinition:
    base = {
        "name": "Trend following (moving average)",
        "period_start": PERIOD_START,
        "period_end": PERIOD_END,
        "information_cutoff": CUTOFF,
        "benchmark": "BUY_AND_HOLD",
        "categories": (),
        "horizons": (),
        "parameters": {
            "symbols": ["AAPL"],
            "strategy": {
                "kind": TREND,
                "rule": RULE_MOVING_AVERAGE,
                "fastWindow": 5,
                "slowWindow": 20,
                "costBps": 11.0,
            },
        },
    }
    base.update(overrides)
    return ExperimentDefinition(**base)


def _candles(
    session,
    symbol: str = "AAPL",
    *,
    start_day: int = 0,
    sessions: int = 200,
    step: float = 0.4,
) -> None:
    """Insert ``sessions`` weekday bars beginning ``start_day`` days after 2024-01-01.

    ``start_day`` lets a test extend an existing series without colliding with the
    candle table's (provider, symbol, interval, open_time) uniqueness.
    """
    origin = datetime(2024, 1, 1, tzinfo=UTC)
    price = 100.0 + step * start_day
    day = start_day
    added = 0
    while added < sessions:
        moment = origin + timedelta(days=day)
        day += 1
        if moment.weekday() >= 5:
            continue
        price = price + step
        added += 1
        session.add(
            MarketCandleRow(
                provider="fixture",
                symbol=symbol,
                market_type="stocks",
                interval="1d",
                open_time=moment,
                open=Decimal(str(round(price, 4))),
                high=Decimal(str(round(price + 1, 4))),
                low=Decimal(str(round(price - 1, 4))),
                close=Decimal(str(round(price, 4))),
                volume=Decimal("1000"),
                quality="historical",
                provider_timestamp=moment,
            )
        )
    session.commit()


# --------------------------------------------------------------------------
# Insider purchases
# --------------------------------------------------------------------------


def test_the_insider_study_reports_zero_rather_than_a_statistic(session):
    outcome = _lab(session).run_insider_study(_insider_definition())

    assert outcome.payload["study"] == STUDY_INSIDER
    assert outcome.payload["status"] == STATUS_INSUFFICIENT
    assert outcome.payload["sampleSize"] == 0
    assert outcome.payload["horizons"] == []
    assert outcome.experiment.sample_size == 0
    assert any("Exactly 0" in flag for flag in outcome.payload["flags"])


def test_a_purchase_published_after_the_cutoff_is_not_in_the_sample(session):
    """The transaction date is inside the window; the publication is not."""
    _purchase(
        session,
        accepted_at=CUTOFF + timedelta(days=1),
        transaction_date=datetime(2024, 6, 3, tzinfo=UTC),
    )

    outcome = _lab(session).run_insider_study(_insider_definition())

    availability = outcome.payload["dataAvailability"]
    assert availability["insiderTransactionsStored"] == 1
    assert availability["openMarketPurchasesInWindow"] == 0
    assert outcome.payload["sampleSize"] == 0


def test_a_purchase_published_inside_the_window_is_in_the_sample(session):
    _purchase(session, accepted_at=datetime(2024, 3, 4, 18, 0, tzinfo=UTC))

    outcome = _lab(session, prices=_prices()).run_insider_study(_insider_definition())

    assert outcome.payload["dataAvailability"]["openMarketPurchasesInWindow"] == 1
    assert outcome.payload["sampleSize"] == 1
    assert outcome.payload["horizons"][0]["horizonDays"] == 5


def test_awards_and_amendments_are_not_discretionary_purchases(session):
    _purchase(session, accepted_at=datetime(2024, 3, 4, 18, 0, tzinfo=UTC), open_market=False, ordinal=1)
    _purchase(session, accepted_at=datetime(2024, 3, 5, 18, 0, tzinfo=UTC), amendment=True, ordinal=2)
    _purchase(
        session,
        accepted_at=datetime(2024, 3, 6, 18, 0, tzinfo=UTC),
        acquired_disposed="D",
        ordinal=3,
    )

    outcome = _lab(session).run_insider_study(_insider_definition())

    assert outcome.payload["dataAvailability"]["insiderTransactionsStored"] == 3
    assert outcome.payload["dataAvailability"]["openMarketPurchasesInWindow"] == 0


def test_a_purchase_without_a_symbol_is_counted_as_unmatched(session):
    _purchase(session, accepted_at=datetime(2024, 3, 4, 18, 0, tzinfo=UTC), symbol="")

    outcome = _lab(session).run_insider_study(_insider_definition())

    availability = outcome.payload["dataAvailability"]
    assert availability["insiderTransactionsStored"] == 1
    assert availability["purchasesWithoutSymbol"] == 1
    assert availability["openMarketPurchasesInWindow"] == 0


def test_the_insider_study_states_that_eligibility_is_publication(session):
    outcome = _lab(session).run_insider_study(_insider_definition())

    limitations = " ".join(outcome.payload["limitations"])
    assert "public availability" in limitations
    assert "never the transaction date" in limitations


# --------------------------------------------------------------------------
# Institutional holdings
# --------------------------------------------------------------------------


def _institution(session, *, cik: str = "0001067983", name: str = "FIXTURE CAPITAL") -> IntelInstitutionRow:
    row = IntelInstitutionRow(cik=cik, name=name)
    session.add(row)
    session.flush()
    return row


def _mapping(session, *, symbol: str = "AAPL", cusip: str = AAPL_CUSIP_BASE) -> None:
    session.add(
        IntelSecurityIdentifierRow(
            cusip=cusip,
            symbol=symbol,
            effective_from=datetime(2020, 1, 1, tzinfo=UTC),
            verification_status="verified",
            confidence=Decimal("1"),
            is_primary=True,
        )
    )
    session.commit()


def _holding(
    session,
    institution: IntelInstitutionRow,
    *,
    period: datetime,
    accepted_at: datetime,
    shares: int,
    value: int,
    cusip: str = AAPL_CUSIP,
    amendment: bool = False,
    ordinal: int = 0,
) -> None:
    session.add(
        IntelInstitutionalHoldingRow(
            institution_id=institution.id,
            accession_number=f"0001067983-24-{ordinal:06d}",
            ordinal=ordinal,
            period_of_report=period,
            accepted_at=accepted_at,
            cusip=cusip,
            issuer_name="APPLE INC",
            value_usd=Decimal(str(value)),
            shares=Decimal(str(shares)),
            is_amendment=amendment,
        )
    )
    session.commit()


def _institutional_definition(**overrides) -> ExperimentDefinition:
    base = {
        "name": "Institutional position changes",
        "period_start": PERIOD_START,
        "period_end": PERIOD_END,
        "information_cutoff": CUTOFF,
        "benchmark": "SPY",
        "categories": (INSTITUTIONAL_INCREASE, INSTITUTIONAL_DECREASE),
        "horizons": (5,),
        "parameters": {"symbols": ["AAPL"]},
    }
    base.update(overrides)
    return ExperimentDefinition(**base)


def test_the_institutional_study_reports_no_events_rather_than_an_empty_result(session):
    outcome = _lab(session).run_institutional_study(_institutional_definition())

    assert outcome.payload["study"] == STUDY_INSTITUTIONAL
    assert outcome.payload["status"] == STATUS_INSUFFICIENT
    assert outcome.payload["sampleSize"] == 0
    assert any("INSUFFICIENT DATA" in flag for flag in outcome.payload["flags"])


def test_a_reported_increase_is_measured_from_the_later_filing(session):
    institution = _institution(session)
    _mapping(session)
    _holding(
        session,
        institution,
        period=datetime(2024, 3, 31, tzinfo=UTC),
        accepted_at=datetime(2024, 5, 10, tzinfo=UTC),
        shares=1000,
        value=100_000,
        ordinal=1,
    )
    _holding(
        session,
        institution,
        period=datetime(2024, 6, 30, tzinfo=UTC),
        accepted_at=datetime(2024, 8, 12, tzinfo=UTC),
        shares=1500,
        value=150_000,
        ordinal=2,
    )

    outcome = _lab(session, prices=_prices()).run_institutional_study(
        _institutional_definition()
    )

    coverage = outcome.payload["coverage"]
    assert coverage["mappedSecurities"] == 1
    assert coverage["deduplicatedPositions"] == 2
    assert coverage["events"][INSTITUTIONAL_INCREASE] == 1
    assert coverage["events"][INSTITUTIONAL_DECREASE] == 0


def test_an_amended_holding_is_counted_once_at_its_final_value(session):
    institution = _institution(session)
    _mapping(session)
    period = datetime(2024, 3, 31, tzinfo=UTC)
    _holding(
        session,
        institution,
        period=period,
        accepted_at=datetime(2024, 5, 10, tzinfo=UTC),
        shares=1000,
        value=100_000,
        ordinal=1,
    )
    _holding(
        session,
        institution,
        period=period,
        accepted_at=datetime(2024, 5, 20, tzinfo=UTC),
        shares=1200,
        value=120_000,
        amendment=True,
        ordinal=2,
    )

    outcome = _lab(session).run_institutional_study(_institutional_definition())

    coverage = outcome.payload["coverage"]
    assert coverage["holdingsRows"] == 2
    assert coverage["deduplicatedPositions"] == 1
    assert coverage["events"][INSTITUTIONAL_INCREASE] == 0


def test_an_unmapped_cusip_is_reported_rather_than_guessed(session):
    institution = _institution(session)
    _mapping(session)
    _holding(
        session,
        institution,
        period=datetime(2024, 3, 31, tzinfo=UTC),
        accepted_at=datetime(2024, 5, 10, tzinfo=UTC),
        shares=1000,
        value=100_000,
        cusip="999999999",
    )

    outcome = _lab(session).run_institutional_study(_institutional_definition())

    assert outcome.payload["coverage"]["holdingsRows"] == 0
    assert outcome.payload["sampleSize"] == 0


def test_a_missing_benchmark_is_flagged_and_excess_returns_are_not_reported(session):
    institution = _institution(session)
    _mapping(session)
    _holding(
        session,
        institution,
        period=datetime(2024, 3, 31, tzinfo=UTC),
        accepted_at=datetime(2024, 5, 10, tzinfo=UTC),
        shares=1000,
        value=100_000,
        ordinal=1,
    )
    _holding(
        session,
        institution,
        period=datetime(2024, 6, 30, tzinfo=UTC),
        accepted_at=datetime(2024, 8, 12, tzinfo=UTC),
        shares=1500,
        value=150_000,
        ordinal=2,
    )

    # Prices for the security, but no SPY bars at all.
    prices = FakePriceProvider(
        series={"AAPL": daily_series("AAPL", MONDAY, 60, daily_return=0.004)}
    )
    outcome = _lab(session, prices=prices).run_institutional_study(
        _institutional_definition()
    )

    assert outcome.payload["coverage"]["benchmarkAvailable"] is False
    assert any("No SPY bars" in flag for flag in outcome.payload["flags"])
    increase = next(
        item
        for item in outcome.payload["categories"]
        if item["category"] == INSTITUTIONAL_INCREASE
    )
    horizon = increase["horizons"][0]
    assert horizon["excess"]["count"] == 0
    assert horizon["excess"]["mean"] is None


def test_the_institutional_study_never_calls_an_increase_a_purchase(session):
    outcome = _lab(session).run_institutional_study(_institutional_definition())

    limitations = " ".join(outcome.payload["limitations"])
    assert "not a real-time purchase" in limitations
    assert "45 days" in limitations


# --------------------------------------------------------------------------
# Baseline strategies
# --------------------------------------------------------------------------


def test_the_strategy_study_reports_missing_prices_per_symbol(session):
    outcome = _lab(session).run_strategy_study(_strategy_definition())

    assert outcome.payload["study"] == STUDY_STRATEGY
    assert outcome.payload["status"] == STATUS_INSUFFICIENT
    assert outcome.payload["sampleSize"] == 0
    assert outcome.payload["series"][0]["status"] == "no_price_data"
    assert outcome.payload["coverage"]["symbolsWithPrices"] == 0


def test_the_strategy_study_runs_on_stored_bars(session):
    _candles(session)

    outcome = _lab(session).run_strategy_study(_strategy_definition())

    assert outcome.payload["status"] == STATUS_COMPLETE
    assert outcome.payload["coverage"]["symbolsWithPrices"] == 1
    assert outcome.payload["coverage"]["bars"] > 0
    series = outcome.payload["series"][0]
    assert series["status"] == STATUS_COMPLETE
    assert len(series["equityCurve"]) == len(series["curveDates"])
    assert len(series["benchmarkCurve"]) == len(series["curveDates"])
    assert series["metrics"]["benchmarkReturn"] is not None


def test_the_strategy_study_charges_the_configured_costs(session):
    _candles(session)

    cheap = _lab(session).run_strategy_study(
        _strategy_definition(
            name="cheap",
            parameters={
                "symbols": ["AAPL"],
                "strategy": {
                    "kind": TREND,
                    "rule": RULE_MOVING_AVERAGE,
                    "fastWindow": 5,
                    "slowWindow": 20,
                    "costBps": 0.0,
                },
            },
        )
    )
    expensive = _lab(session).run_strategy_study(
        _strategy_definition(
            name="expensive",
            parameters={
                "symbols": ["AAPL"],
                "strategy": {
                    "kind": TREND,
                    "rule": RULE_MOVING_AVERAGE,
                    "fastWindow": 5,
                    "slowWindow": 20,
                    "costBps": 50.0,
                },
            },
        )
    )

    assert cheap.payload["summary"]["totalCosts"] == pytest.approx(0.0)
    assert expensive.payload["summary"]["totalCosts"] > 0
    assert (
        expensive.payload["summary"]["meanTradeReturn"]
        < cheap.payload["summary"]["meanTradeReturn"]
    )


def test_the_strategy_study_states_that_parameters_were_not_fitted(session):
    outcome = _lab(session).run_strategy_study(_strategy_definition())

    limitations = " ".join(outcome.payload["limitations"])
    assert "not fitted values" in limitations
    assert "Not realised account P&L" in limitations


# --------------------------------------------------------------------------
# Reproducibility
# --------------------------------------------------------------------------


def test_re_running_the_same_definition_returns_the_stored_experiment(session):
    _candles(session)
    definition = _strategy_definition()

    first = _lab(session).run_strategy_study(definition)
    second = _lab(session).run_strategy_study(definition)

    assert first.reproduction == "new"
    assert second.reproduction == "identical"
    assert second.experiment.id == first.experiment.id
    assert second.payload == first.payload
    assert len(_lab(session).list()) == 1


def test_renaming_an_experiment_does_not_create_a_second_one(session):
    _candles(session)

    first = _lab(session).run_strategy_study(_strategy_definition(name="Trend following"))
    second = _lab(session).run_strategy_study(_strategy_definition(name="Renamed"))

    assert second.experiment.id == first.experiment.id
    assert second.reproduction == "identical"
    assert len(_lab(session).list()) == 1


def test_changing_a_parameter_creates_a_new_experiment(session):
    _candles(session)

    first = _lab(session).run_strategy_study(_strategy_definition())
    second = _lab(session).run_strategy_study(
        _strategy_definition(
            parameters={
                "symbols": ["AAPL"],
                "strategy": {
                    "kind": TREND,
                    "rule": RULE_MOVING_AVERAGE,
                    "fastWindow": 10,
                    "slowWindow": 40,
                    "costBps": 11.0,
                },
            }
        )
    )

    assert second.experiment.id != first.experiment.id
    assert second.experiment.definition_hash != first.experiment.definition_hash
    assert len(_lab(session).list()) == 2


def test_changed_data_is_reported_rather_than_overwritten(session):
    _candles(session)
    definition = _strategy_definition()

    first = _lab(session).run_strategy_study(definition)
    stored_metrics = dict(first.experiment.metrics)

    _candles(session, start_day=300, sessions=60)
    second = _lab(session).run_strategy_study(definition)

    assert second.reproduction == "data_changed"
    assert second.experiment.id == first.experiment.id
    assert second.experiment.metrics == stored_metrics
    assert "preserved" in second.note


def test_the_stored_experiment_carries_its_reproduction_metadata(session):
    _candles(session)

    outcome = _lab(session).run_strategy_study(_strategy_definition())
    row = outcome.experiment

    assert row.signal_version
    assert row.data_version
    assert row.definition_hash
    assert row.data_fingerprint
    assert row.period_start == PERIOD_START
    assert row.period_end == PERIOD_END
    assert row.information_cutoff == CUTOFF
    assert row.benchmark == "BUY_AND_HOLD"
    assert row.parameters["strategy"]["fastWindow"] == 5
    assert row.execution_assumptions == {}
    assert row.completed_at is not None


def test_the_experiment_payload_is_customer_safe(session):
    from wands.intelligence.studies import experiment_payload

    _candles(session)
    outcome = _lab(session).run_strategy_study(_strategy_definition())

    payload = experiment_payload(outcome.experiment)

    assert set(payload) == {
        "id",
        "name",
        "status",
        "signalVersion",
        "dataVersion",
        "periodStart",
        "periodEnd",
        "informationCutoff",
        "benchmark",
        "parameters",
        "executionAssumptions",
        "costAssumptions",
        "sampleSize",
        "coverage",
        "metrics",
        "flags",
        "definitionHash",
        "dataFingerprint",
        "createdAt",
        "completedAt",
    }
    # Nothing that could reach an order, a credential or a broker connection.
    forbidden = {"apiKey", "token", "secret", "connectionId", "orderId", "accountId"}
    assert not (forbidden & set(payload))


# --------------------------------------------------------------------------
# The member read surface
# --------------------------------------------------------------------------


def test_the_member_feed_lists_a_recorded_experiment(client, session):
    from .conftest import AUTH

    _candles(session)
    _lab(session).run_strategy_study(_strategy_definition())
    session.commit()

    body = client.get("/v1/intelligence/experiments", headers=AUTH).json()

    assert body["provenance"] == "live"
    items = body["data"]["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Trend following (moving average)"
    assert items[0]["sampleSize"] >= 0
    assert items[0]["definitionHash"]


def test_the_member_feed_is_unavailable_before_anything_is_recorded(client):
    from .conftest import AUTH

    body = client.get("/v1/intelligence/experiments", headers=AUTH).json()

    assert body["provenance"] == "unavailable"
    assert body["data"]["items"] == []


def test_an_unknown_experiment_is_a_not_found(client):
    from .conftest import AUTH

    response = client.get(
        "/v1/intelligence/experiments/00000000-0000-0000-0000-000000000000",
        headers=AUTH,
    )

    assert response.status_code == 404


def test_a_malformed_experiment_id_is_rejected(client):
    from .conftest import AUTH

    response = client.get("/v1/intelligence/experiments/not-a-uuid", headers=AUTH)

    assert response.status_code == 422
    assert "not an experiment identifier" in response.json()["error"]["message"]


def test_an_insufficient_experiment_is_returned_as_unavailable(client, session):
    from .conftest import AUTH

    outcome = _lab(session).run_insider_study(_insider_definition())
    session.commit()

    body = client.get(
        f"/v1/intelligence/experiments/{outcome.experiment.id}", headers=AUTH
    ).json()

    assert body["provenance"] == "unavailable"
    assert body["data"]["status"] == STATUS_INSUFFICIENT
    assert body["data"]["sampleSize"] == 0
