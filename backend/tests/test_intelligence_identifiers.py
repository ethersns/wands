"""Versioned security identifier resolution.

The tests that matter here are the historical ones. A mapping that resolves to
today's ticker when asked about 2016 is the failure mode this module exists to
prevent, so every case below asserts on a date, not just on a symbol.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from wands.intelligence.identifiers import (
    IdentifierMapping,
    IdentifierResolver,
    MappingStatus,
    definition_fingerprint,
    normalize_cusip,
)

CUSIP = "037833100"
OTHER_CUSIP = "594918104"


def _mapping(
    *,
    cusip: str = CUSIP,
    symbol: str = "AAPL",
    effective_from: datetime,
    effective_to: datetime | None = None,
    source: str = "operator_file",
    status: MappingStatus = MappingStatus.VERIFIED,
    is_primary: bool = False,
    issuer_cik: str = "0000320193",
    share_class: str = "",
) -> IdentifierMapping:
    return IdentifierMapping(
        cusip=cusip,
        symbol=symbol,
        effective_from=effective_from,
        effective_to=effective_to,
        issuer_cik=issuer_cik,
        issuer_name="Apple Inc.",
        share_class=share_class,
        source=source,
        verification_status=status,
        confidence=Decimal("100"),
        is_primary=is_primary,
    )


def test_cusip_is_normalised_to_its_eight_character_base():
    # A 13F often omits the check digit. Treating the two forms as different
    # securities would split one holding into two.
    assert normalize_cusip("037833100") == "03783310"
    assert normalize_cusip("03783310") == "03783310"
    assert normalize_cusip(" 037833100 ") == "03783310"
    assert normalize_cusip("") == ""
    assert normalize_cusip("ABC") == ""


def test_a_ticker_change_resolves_to_the_symbol_of_that_date(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(symbol="OLD", effective_from=datetime(2010, 1, 1, tzinfo=UTC)),
            _mapping(symbol="NEW", effective_from=datetime(2020, 1, 1, tzinfo=UTC)),
        ]
    )

    before = resolver.resolve(CUSIP, datetime(2015, 6, 1, tzinfo=UTC))
    after = resolver.resolve(CUSIP, datetime(2024, 6, 1, tzinfo=UTC))

    assert before.symbol == "OLD"
    assert after.symbol == "NEW"
    # The old window must be closed, not merely superseded.
    history = resolver.history(CUSIP)
    assert history[0].effective_to == datetime(2020, 1, 1, tzinfo=UTC)


def test_a_delisted_security_is_unresolved_after_its_window_closes(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(
                symbol="GONE",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                effective_to=datetime(2018, 1, 1, tzinfo=UTC),
            )
        ]
    )

    during = resolver.resolve(CUSIP, datetime(2015, 1, 1, tzinfo=UTC))
    after = resolver.resolve(CUSIP, datetime(2024, 1, 1, tzinfo=UTC))

    assert during.symbol == "GONE"
    assert after.status is MappingStatus.UNRESOLVED
    assert after.symbol is None
    assert after.usable_for_fusion is False
    assert "No mapping window covers this date" in after.reason


def test_a_merger_leaves_the_old_cusip_closed_and_the_new_one_separate(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(
                cusip=CUSIP,
                symbol="ACQUIRED",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                effective_to=datetime(2021, 6, 1, tzinfo=UTC),
            ),
            _mapping(
                cusip=OTHER_CUSIP,
                symbol="ACQUIRER",
                effective_from=datetime(2021, 6, 1, tzinfo=UTC),
            ),
        ]
    )

    old = resolver.resolve(CUSIP, datetime(2022, 1, 1, tzinfo=UTC))
    new = resolver.resolve(OTHER_CUSIP, datetime(2022, 1, 1, tzinfo=UTC))

    # The acquired CUSIP does not silently become the acquirer's ticker.
    assert old.status is MappingStatus.UNRESOLVED
    assert new.symbol == "ACQUIRER"


def test_share_classes_share_an_issuer_but_not_a_symbol(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(
                cusip="084670108",
                symbol="BRK.A",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                is_primary=True,
                share_class="A",
            ),
            _mapping(
                cusip="084670702",
                symbol="BRK.B",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                share_class="B",
            ),
        ]
    )

    class_a = resolver.resolve("084670108", datetime(2020, 1, 1, tzinfo=UTC))
    class_b = resolver.resolve("084670702", datetime(2020, 1, 1, tzinfo=UTC))

    assert class_a.symbol == "BRK.A"
    assert class_b.symbol == "BRK.B"
    assert class_a.mapping.issuer_cik == class_b.mapping.issuer_cik
    assert class_a.mapping.is_primary is True
    assert class_b.mapping.is_primary is False


def test_an_unknown_cusip_is_unresolved_and_excluded_from_fusion(session):
    resolver = IdentifierResolver(session)
    result = resolver.resolve("999999999", datetime(2020, 1, 1, tzinfo=UTC))

    assert result.status is MappingStatus.UNRESOLVED
    assert result.usable_for_fusion is False
    assert "No identifier source covers this CUSIP" in result.reason


def test_conflicting_sources_are_flagged_rather_than_preferred(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(
                symbol="AAA",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                source="vendor_one",
            ),
            _mapping(
                symbol="BBB",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                source="vendor_two",
            ),
        ]
    )

    result = resolver.resolve(CUSIP, datetime(2020, 1, 1, tzinfo=UTC))

    assert result.status is MappingStatus.CONFLICT
    assert result.usable_for_fusion is False
    assert "AAA" in result.reason and "BBB" in result.reason
    # Both claims survive; neither is deleted to make the answer look clean.
    assert len(resolver.history(CUSIP)) == 2


def test_a_provisional_mapping_is_reported_but_not_used_for_fusion(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(
                symbol="PROV",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                status=MappingStatus.PROVISIONAL,
            )
        ]
    )

    result = resolver.resolve(CUSIP, datetime(2020, 1, 1, tzinfo=UTC))

    assert result.is_resolved is True
    assert result.symbol == "PROV"
    assert result.usable_for_fusion is False


def test_a_mapping_without_an_effective_date_does_not_claim_the_past(session):
    import json
    import tempfile
    from pathlib import Path

    from wands.intelligence.identifiers import FileMappingSource

    payload = [{"cusip": CUSIP, "symbol": "AAPL", "observed_at": "2024-01-01"}]
    path = Path(tempfile.mkdtemp()) / "mappings.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    resolver = IdentifierResolver(session)
    resolver.ingest(FileMappingSource(path).fetch(), source="operator_file")

    old = resolver.resolve(CUSIP, datetime(2015, 1, 1, tzinfo=UTC))
    current = resolver.resolve(CUSIP, datetime(2024, 6, 1, tzinfo=UTC))

    # The mapping is observed, not historical, so a 2015 lookup is unresolved
    # rather than confidently wrong.
    assert old.status is MappingStatus.UNRESOLVED
    assert current.symbol == "AAPL"
    assert "observed_at" in current.mapping.notes


def test_reverse_lookup_uses_the_same_window(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(symbol="OLD", effective_from=datetime(2010, 1, 1, tzinfo=UTC)),
            _mapping(symbol="NEW", effective_from=datetime(2020, 1, 1, tzinfo=UTC)),
        ]
    )

    assert resolver.resolve_symbol("OLD", datetime(2015, 1, 1, tzinfo=UTC)).cusip == "03783310"
    assert (
        resolver.resolve_symbol("OLD", datetime(2024, 1, 1, tzinfo=UTC)).status
        is MappingStatus.UNRESOLVED
    )


def test_coverage_counts_unresolved_cusips_separately(session):
    resolver = IdentifierResolver(session)
    resolver.ingest(
        [
            _mapping(symbol="AAA", effective_from=datetime(2010, 1, 1, tzinfo=UTC)),
            _mapping(
                cusip=OTHER_CUSIP,
                symbol="BBB",
                effective_from=datetime(2010, 1, 1, tzinfo=UTC),
                status=MappingStatus.PROVISIONAL,
            ),
        ]
    )

    coverage = resolver.coverage()

    assert coverage["distinctCusips"] == 2
    assert coverage["verifiedCusips"] == 1
    assert coverage["unresolvedCusips"] == 1
    assert coverage["fusionEligible"] == 1


def test_ingesting_the_same_mapping_twice_updates_rather_than_duplicates(session):
    resolver = IdentifierResolver(session)
    mapping = _mapping(symbol="AAA", effective_from=datetime(2010, 1, 1, tzinfo=UTC))

    first = resolver.ingest([mapping])
    second = resolver.ingest([mapping])

    assert first.inserted == 1
    assert second.inserted == 0
    assert second.updated == 1
    assert len(resolver.history(CUSIP)) == 1


def test_re_observing_the_same_claim_does_not_add_a_second_window(session):
    # A collection run re-observes every CUSIP it already knows. Recording that
    # as a new version would fill the history with identical open windows.
    resolver = IdentifierResolver(session)
    resolver.ingest([_mapping(symbol="AAPL", effective_from=datetime(2024, 1, 1, tzinfo=UTC))])

    summary = resolver.ingest(
        [_mapping(symbol="AAPL", effective_from=datetime(2024, 6, 1, tzinfo=UTC))]
    )

    assert summary.inserted == 0
    assert summary.updated == 1
    assert len(resolver.history(CUSIP)) == 1


def test_fingerprint_is_stable_and_order_independent():
    left = _mapping(symbol="AAA", effective_from=datetime(2010, 1, 1, tzinfo=UTC))
    right = _mapping(
        cusip=OTHER_CUSIP, symbol="BBB", effective_from=datetime(2010, 1, 1, tzinfo=UTC)
    )

    assert definition_fingerprint([left, right]) == definition_fingerprint([right, left])
    assert definition_fingerprint([left]) != definition_fingerprint([right])
