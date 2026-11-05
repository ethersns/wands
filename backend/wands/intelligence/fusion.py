"""Signal fusion foundation.

Combines independently calculated research signals into one explainable ranking.
The ranking answers a narrow question — which symbols are worth investigating —
and refuses to answer a wider one. It is not a probability of profit, it does not
size a position, and it cannot place an order: this module has no import path to
the execution or risk packages.

Each component keeps its own source, timing and measurement. A composite score
is a weighted mean over the components that are actually present, and the
coverage is reported alongside it. A symbol with one component and a symbol with
four are not presented as equally well-evidenced.

Market trend and volume anomaly are read from the Phase 3 candle store. Nothing
here re-implements market data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings
from wands.db.models import IntelSignalRow, MarketCandleRow
from wands.intelligence.base import IntelQuality, SignalCategory
from wands.intelligence.institutions import DISCLOSURE_CAVEAT, InstitutionalRadar
from wands.intelligence.signals import saturate
from wands.schemas import CandleInterval

# Weights are a stated editorial choice, not a fitted parameter. Insider
# disclosure is weighted highest because it is a primary filing by a named
# person; the rest are context.
WEIGHTS: dict[str, Decimal] = {
    SignalCategory.INSIDER_PURCHASE_CLUSTER.value: Decimal("0.30"),
    SignalCategory.INSIDER_PURCHASE_VALUE.value: Decimal("0.20"),
    SignalCategory.INSIDER_ACTIVITY_CHANGE.value: Decimal("0.10"),
    SignalCategory.INSIDER_SELLING_CLUSTER.value: Decimal("0.05"),
    SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value: Decimal("0.15"),
    SignalCategory.MARKET_TREND.value: Decimal("0.10"),
    SignalCategory.VOLUME_ANOMALY.value: Decimal("0.10"),
}

TREND_LOOKBACK_BARS = 20
VOLUME_LOOKBACK_BARS = 20
TREND_SATURATION_PCT = Decimal("5")
VOLUME_SATURATION_RATIO = Decimal("1")

FUSION_CAVEAT = (
    "This ranking orders symbols for further research. It is not a probability of "
    "profit, not investment advice, and not a trade instruction. Research signals "
    "cannot trigger execution."
)


@dataclass(frozen=True)
class FusionComponent:
    name: str
    category: str
    measurement: Decimal
    unit: str
    score: Decimal | None
    public_available_at: datetime
    explanation: str
    data_quality: str
    source: str


@dataclass(frozen=True)
class FusionRanking:
    symbol: str
    as_of: datetime
    components: list[FusionComponent]
    composite_score: Decimal | None
    coverage: Decimal
    explanation: str
    data_quality: str
    caveats: list[str] = field(default_factory=list)


class SignalFusion:
    """Builds explainable research rankings from stored signals and candles."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.radar = InstitutionalRadar(session, settings)

    def rank(
        self,
        symbols: list[str],
        *,
        as_of: datetime | None = None,
        cusip_by_symbol: dict[str, str] | None = None,
    ) -> list[FusionRanking]:
        moment = as_of or datetime.now(tz=UTC)
        rankings = [
            self._rank_symbol(symbol, moment, cusip_by_symbol or {})
            for symbol in symbols
        ]
        # Symbols with no evidence at all sort last rather than being dropped:
        # an empty result is information, and hiding it would look like a bug.
        return sorted(
            rankings,
            key=lambda item: (item.composite_score is None, -(item.composite_score or Decimal("0"))),
        )

    # -- internals ---------------------------------------------------------

    def _rank_symbol(
        self,
        symbol: str,
        as_of: datetime,
        cusip_by_symbol: dict[str, str],
    ) -> FusionRanking:
        components: list[FusionComponent] = []
        components.extend(self._insider_components(symbol, as_of))
        components.extend(self._institutional_components(symbol, as_of, cusip_by_symbol))
        components.extend(self._market_components(symbol, as_of))

        caveats = [FUSION_CAVEAT]
        if not cusip_by_symbol.get(symbol):
            caveats.append(
                "No CUSIP-to-symbol mapping is configured, so institutional disclosure "
                "changes are not included for this symbol. They are omitted rather than "
                "approximated."
            )

        scored = [item for item in components if item.score is not None]
        if not scored:
            return FusionRanking(
                symbol=symbol,
                as_of=as_of,
                components=components,
                composite_score=None,
                coverage=Decimal("0"),
                explanation=(
                    f"No research signal is available for {symbol} at "
                    f"{as_of.date().isoformat()}. Nothing is inferred from the absence."
                ),
                data_quality=IntelQuality.UNAVAILABLE.value,
                caveats=caveats,
            )

        total_weight = sum((WEIGHTS.get(item.category, Decimal("0")) for item in scored), Decimal("0"))
        weighted = sum(
            (WEIGHTS.get(item.category, Decimal("0")) * (item.score or Decimal("0")) for item in scored),
            Decimal("0"),
        )
        composite = (weighted / total_weight).quantize(Decimal("0.001")) if total_weight > 0 else None

        quality = (
            IntelQuality.DERIVED
            if all(item.data_quality == IntelQuality.DERIVED.value for item in scored)
            else IntelQuality.INCOMPLETE
        )

        return FusionRanking(
            symbol=symbol,
            as_of=as_of,
            components=components,
            composite_score=composite,
            coverage=total_weight.quantize(Decimal("0.001")),
            explanation=(
                f"{len(scored)} of {len(WEIGHTS)} possible components are present for "
                f"{symbol}. Composite research score {composite} on a 0-100 scale, "
                f"weighted over {total_weight} of 1.000 available weight."
            ),
            data_quality=quality.value,
            caveats=caveats,
        )

    def _insider_components(self, symbol: str, as_of: datetime) -> list[FusionComponent]:
        rows = self.session.scalars(
            select(IntelSignalRow).where(
                IntelSignalRow.symbol == symbol,
                IntelSignalRow.public_available_at <= as_of,
                IntelSignalRow.category.in_(
                    [
                        SignalCategory.INSIDER_PURCHASE_CLUSTER.value,
                        SignalCategory.INSIDER_PURCHASE_VALUE.value,
                        SignalCategory.INSIDER_ACTIVITY_CHANGE.value,
                        SignalCategory.INSIDER_SELLING_CLUSTER.value,
                    ]
                ),
            )
        ).all()

        # The most recent signal per category is the current statement; older
        # ones are history and belong to a backtest, not to a live ranking.
        latest: dict[str, IntelSignalRow] = {}
        for row in rows:
            current = latest.get(row.category)
            if current is None or row.public_available_at > current.public_available_at:
                latest[row.category] = row

        return [
            FusionComponent(
                name=row.category,
                category=row.category,
                measurement=Decimal(row.raw_measurement),
                unit=row.raw_unit,
                score=Decimal(row.score) if row.score is not None else None,
                public_available_at=row.public_available_at,
                explanation=row.explanation,
                data_quality=row.data_quality,
                source="sec_edgar",
            )
            for row in latest.values()
        ]

    def _institutional_components(
        self,
        symbol: str,
        as_of: datetime,
        cusip_by_symbol: dict[str, str],
    ) -> list[FusionComponent]:
        cusip = cusip_by_symbol.get(symbol)
        if not cusip:
            return []

        rows = self.session.scalars(
            select(IntelSignalRow).where(
                IntelSignalRow.category == SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value,
                IntelSignalRow.public_available_at <= as_of,
            )
        ).all()

        matching = [
            row
            for row in rows
            if any(str(event).endswith(f":{cusip}") for event in (row.source_event_ids or []))
        ]
        if not matching:
            return []

        latest = max(matching, key=lambda row: row.public_available_at)
        return [
            FusionComponent(
                name=SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value,
                category=SignalCategory.INSTITUTIONAL_POSITION_CHANGE.value,
                measurement=Decimal(latest.raw_measurement),
                unit=latest.raw_unit,
                score=Decimal(latest.score) if latest.score is not None else None,
                public_available_at=latest.public_available_at,
                explanation=f"{latest.explanation} {DISCLOSURE_CAVEAT}",
                data_quality=latest.data_quality,
                source="sec_edgar_13f",
            )
        ]

    def _market_components(self, symbol: str, as_of: datetime) -> list[FusionComponent]:
        rows = list(
            self.session.scalars(
                select(MarketCandleRow)
                .where(
                    MarketCandleRow.symbol == symbol,
                    MarketCandleRow.interval == CandleInterval.D1.value,
                    MarketCandleRow.open_time <= as_of,
                )
                .order_by(MarketCandleRow.open_time.desc())
                .limit(TREND_LOOKBACK_BARS + 1)
            ).all()
        )
        if len(rows) < TREND_LOOKBACK_BARS + 1:
            return []

        rows.reverse()
        closes = [Decimal(row.close) for row in rows]
        volumes = [Decimal(row.volume) for row in rows]

        components: list[FusionComponent] = []

        first_close = closes[0]
        last_close = closes[-1]
        if first_close > 0:
            trend_pct = ((last_close - first_close) / first_close * Decimal("100")).quantize(
                Decimal("0.0001")
            )
            direction = "up" if trend_pct > 0 else ("down" if trend_pct < 0 else "flat")
            components.append(
                FusionComponent(
                    name=SignalCategory.MARKET_TREND.value,
                    category=SignalCategory.MARKET_TREND.value,
                    measurement=trend_pct,
                    unit="pct_change",
                    score=saturate(abs(trend_pct), TREND_SATURATION_PCT),
                    public_available_at=rows[-1].open_time,
                    explanation=(
                        f"{symbol} closed {direction} {abs(trend_pct)}% over the last "
                        f"{TREND_LOOKBACK_BARS} daily bars, from {first_close} to {last_close}. "
                        "This is a description of past prices, not a forecast."
                    ),
                    data_quality=rows[-1].quality,
                    source=f"market_candles:{rows[-1].provider}",
                )
            )

        prior_volumes = sorted(volumes[:-1])
        if prior_volumes:
            median = prior_volumes[len(prior_volumes) // 2]
            if median > 0:
                ratio = (volumes[-1] / median).quantize(Decimal("0.0001"))
                components.append(
                    FusionComponent(
                        name=SignalCategory.VOLUME_ANOMALY.value,
                        category=SignalCategory.VOLUME_ANOMALY.value,
                        measurement=ratio,
                        unit="ratio_vs_median",
                        score=saturate(max(Decimal("0"), ratio - 1), VOLUME_SATURATION_RATIO),
                        public_available_at=rows[-1].open_time,
                        explanation=(
                            f"Latest daily volume for {symbol} was {ratio}x the median of the "
                            f"preceding {VOLUME_LOOKBACK_BARS} bars. Elevated volume is "
                            "consistent with many explanations and is not directional."
                        ),
                        data_quality=rows[-1].quality,
                        source=f"market_candles:{rows[-1].provider}",
                    )
                )

        return components


__all__ = [
    "FUSION_CAVEAT",
    "FusionComponent",
    "FusionRanking",
    "SignalFusion",
    "WEIGHTS",
]
