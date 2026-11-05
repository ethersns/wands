"""Portfolio accounting.

The rules this module enforces:

* **Decimal everywhere.** Money never touches a float until it is serialised.
* **Cash comes from the ledger.** A deposit is not profit, and a fill is not a
  balance change that can be applied twice.
* **Reserved capital is not spendable.** Buying power is ``cash - reserved``.
* **Unknown is not zero.** If a price or an FX rate is missing, the position's
  value is ``None`` and the account is marked unverified. The risk engine then
  refuses to size an order against it.
* **Paper and broker-confirmed positions are labelled.** A simulated position
  never masquerades as a venue position.

The service owns cash, the ledger and equity snapshots. Position rows are owned
by the execution gateway, which is the only code path that can produce a fill.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from wands.config import Settings, get_settings
from wands.db.models import (
    AccountBalanceRow,
    ConnectionRow,
    EquitySnapshotRow,
    PaperAccountRow,
    PortfolioLedgerRow,
    PositionRow,
)
from wands.errors import BadRequest, Conflict, NotFound
from wands.logging import get_logger
from wands.marketdata.service import MarketDataService, QuoteView, as_utc
from wands.marketdata.symbols import quote_currency
from wands.portfolio.fx import FxConverter
from wands.portfolio.money import HUNDRED, ZERO, money, pct_of, to_decimal
from wands.schemas import MarketType
from wands.security.audit import record_for_principal
from wands.security.auth import Principal

logger = get_logger(__name__)

# Ledger kinds that move cash. Reservations are commitments, not movements.
CASH_KINDS: tuple[str, ...] = (
    "initialisation",
    "deposit",
    "withdrawal",
    "fill",
    "fee",
    "transfer",
)

PAPER_SOURCE = "paper_simulated"
BROKER_SOURCE = "broker_confirmed"


@dataclass(frozen=True)
class PositionValuation:
    id: str
    connection_id: str
    symbol: str
    market_type: MarketType
    quantity: Decimal
    average_entry_price: Decimal
    last_price: Decimal | None
    market_value: Decimal | None
    unrealised_pnl: Decimal | None
    unrealised_pnl_pct: Decimal | None
    realised_pnl: Decimal
    fees_paid: Decimal
    source: str
    price_quality: str
    price_as_of: datetime | None
    price_age_seconds: float | None
    price_stale: bool
    opened_at: datetime
    strategy_id: str | None = None
    bot_id: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class AccountValuation:
    connection_id: str
    label: str
    provider: str
    market_type: MarketType
    mode: str
    access: str
    permissions: list[str]
    last_synced_at: datetime | None
    base_currency: str
    cash: Decimal | None
    reserved: Decimal | None
    buying_power: Decimal | None
    positions_value: Decimal | None
    equity: Decimal | None
    realised_pnl: Decimal | None
    unrealised_pnl: Decimal | None
    fees_paid: Decimal | None
    day_pnl: Decimal | None
    day_pnl_pct: Decimal | None
    drawdown_pct: Decimal | None
    positions: list[PositionValuation]
    provenance: str
    source: str
    verified: bool
    account_state_age_seconds: float | None
    as_of: datetime
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PortfolioValuation:
    base_currency: str
    total_equity: Decimal | None
    cash: Decimal | None
    buying_power: Decimal | None
    day_pnl: Decimal | None
    day_pnl_pct: Decimal | None
    realised_pnl: Decimal | None
    unrealised_pnl: Decimal | None
    fees_paid: Decimal | None
    open_positions: int
    equity_curve: list[tuple[datetime, Decimal]]
    allocation: list[tuple[str, str, Decimal, Decimal]]
    by_market: dict[str, tuple[Decimal | None, Decimal | None]]
    accounts: list[AccountValuation]
    positions: list[PositionValuation]
    provenance: str
    verified: bool
    as_of: datetime
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class VerificationResult:
    connection_id: str
    ok: bool
    expected_cash: Decimal | None
    stored_cash: Decimal | None
    difference: Decimal | None
    checked_at: datetime
    detail: str


class PortfolioService:
    def __init__(
        self,
        session: Session,
        *,
        market_data: MarketDataService | None = None,
        settings: Settings | None = None,
        clock=lambda: datetime.now(tz=UTC),
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self._clock = clock
        self.market_data = market_data or MarketDataService(
            session, settings=self.settings, clock=clock
        )
        self.fx = FxConverter(session, settings=self.settings, clock=clock)

    # -- paper account lifecycle ------------------------------------------

    def initialise_paper_account(
        self,
        connection_id: str,
        *,
        starting_cash: Decimal | None = None,
        currency: str | None = None,
        principal: Principal | None = None,
        reset: bool = False,
        request_id: str | None = None,
        ip: str | None = None,
    ) -> PaperAccountRow:
        connection = self._connection(connection_id)
        if connection.mode != "paper":
            raise BadRequest(
                "Only a paper connection can host a paper account. Live connections are "
                "never initialised with simulated cash."
            )

        existing = self.session.scalar(
            select(PaperAccountRow).where(PaperAccountRow.connection_id == connection.id)
        )
        if existing is not None and not reset:
            raise Conflict(
                "This connection already has a paper account. Use reset to reinitialise it."
            )

        cash = money(
            starting_cash
            if starting_cash is not None
            else self.settings.paper_default_starting_cash
        )
        if cash <= ZERO:
            raise BadRequest("Starting cash must be positive.")

        code = (currency or self.settings.paper_default_currency).upper()
        if len(code) != 3 or not code.isalpha():
            raise BadRequest("The account currency must be a three-letter ISO code.")

        now = self._clock()
        actor = principal.subject if principal is not None else "system"

        if existing is None:
            paper = PaperAccountRow(
                connection_id=connection.id,
                base_currency=code,
                starting_cash=cash,
                status="active",
                provenance=PAPER_SOURCE,
                initialised_at=now,
                initialised_by=actor,
            )
            self.session.add(paper)
            self.session.flush()
        else:
            paper = existing
            paper.base_currency = code
            paper.starting_cash = cash
            paper.status = "active"
            paper.reset_at = now
            paper.reset_by = actor
            for position in self.session.scalars(
                select(PositionRow).where(PositionRow.connection_id == connection.id)
            ).all():
                self.session.delete(position)
            self.session.flush()

        balance = self._balance_row(connection.id, code, create=True)
        assert balance is not None
        balance.cash = cash
        balance.reserved = ZERO
        balance.source = PAPER_SOURCE
        balance.updated_at = now

        reference = f"{'reset' if existing is not None else 'init'}:{uuid.uuid4().hex}"
        self.session.add(
            PortfolioLedgerRow(
                connection_id=connection.id,
                at=now,
                kind="initialisation",
                amount=cash,
                currency=code,
                reference=reference,
                source=PAPER_SOURCE,
                detail={
                    "startingCash": str(cash),
                    "currency": code,
                    "reset": existing is not None,
                    "provenance": PAPER_SOURCE,
                },
            )
        )

        if principal is not None:
            record_for_principal(
                self.session,
                principal,
                action="paper.account.reset" if existing is not None else "paper.account.init",
                target=str(connection.id),
                detail={
                    "startingCash": str(cash),
                    "currency": code,
                    "provenance": PAPER_SOURCE,
                },
                request_id=request_id,
                ip=ip,
            )

        self.session.flush()
        logger.info(
            "paper account initialised",
            extra={
                "event": "portfolio.paper.init",
                "context": {
                    "connectionId": str(connection.id),
                    "startingCash": str(cash),
                    "currency": code,
                    "reset": existing is not None,
                },
            },
        )
        return paper

    def paper_account(self, connection_id: str) -> PaperAccountRow | None:
        connection = self._connection(connection_id)
        return self.session.scalar(
            select(PaperAccountRow).where(PaperAccountRow.connection_id == connection.id)
        )

    # -- cash movements ----------------------------------------------------

    def record_fill(
        self,
        connection_id: str,
        *,
        order_id: str,
        symbol: str,
        side: str,
        quantity: Decimal,
        price: Decimal,
        fees: Decimal,
        reference: str | None = None,
    ) -> Decimal | None:
        """Apply a fill's cash effect exactly once.

        Returns the net cash delta, or ``None`` when the account has no balance
        row (a paper account was never initialised) or the fill was already
        applied. Position rows are updated by the gateway, not here.
        """
        connection = self._connection(connection_id)
        balance = self._balance_row(connection.id, None, create=False)
        if balance is None:
            logger.warning(
                "fill without a paper balance",
                extra={
                    "event": "portfolio.fill.unfunded",
                    "context": {"connectionId": str(connection.id), "orderId": order_id},
                },
            )
            return None

        qty = to_decimal(quantity, default=ZERO) or ZERO
        px = to_decimal(price, default=ZERO) or ZERO
        fee = to_decimal(fees, default=ZERO) or ZERO
        gross = money(qty * px)

        base_reference = reference or f"fill:{order_id}:{uuid.uuid4().hex[:8]}"
        trade_reference = f"{base_reference}:trade"
        fee_reference = f"{base_reference}:fee"

        if self._ledger_exists(connection.id, trade_reference):
            return None

        now = self._clock()
        signed_gross = -gross if side == "buy" else gross
        self.session.add(
            PortfolioLedgerRow(
                connection_id=connection.id,
                at=now,
                kind="fill",
                amount=signed_gross,
                currency=balance.currency,
                reference=trade_reference,
                source=balance.source,
                detail={
                    "orderId": order_id,
                    "symbol": symbol,
                    "side": side,
                    "quantity": str(qty),
                    "price": str(px),
                },
            )
        )
        if fee > ZERO:
            self.session.add(
                PortfolioLedgerRow(
                    connection_id=connection.id,
                    at=now,
                    kind="fee",
                    amount=-fee,
                    currency=balance.currency,
                    reference=fee_reference,
                    source=balance.source,
                    detail={"orderId": order_id, "symbol": symbol},
                )
            )

        delta = signed_gross - fee
        balance.cash = money(Decimal(balance.cash) + delta)
        balance.updated_at = now
        self.session.flush()
        return delta

    def record_cash_movement(
        self,
        connection_id: str,
        *,
        kind: str,
        amount: Decimal,
        reference: str,
        currency: str | None = None,
        detail: dict | None = None,
    ) -> Decimal | None:
        """Deposits, withdrawals and transfers.

        A deposit increases cash and is *not* profit: performance is computed
        from the ledger, so the two can never be confused.
        """
        if kind not in ("deposit", "withdrawal", "transfer"):
            raise BadRequest(f"{kind!r} is not a cash movement kind.")

        connection = self._connection(connection_id)
        balance = self._balance_row(connection.id, currency, create=False)
        if balance is None:
            raise BadRequest("This account has no balance row. Initialise it first.")

        value = money(amount)
        if value <= ZERO:
            raise BadRequest("A cash movement must be positive.")
        if self._ledger_exists(connection.id, reference):
            return None

        signed = -value if kind == "withdrawal" else value
        if kind == "withdrawal" and Decimal(balance.cash) - Decimal(balance.reserved) < value:
            raise BadRequest("The withdrawal exceeds available buying power.")

        now = self._clock()
        self.session.add(
            PortfolioLedgerRow(
                connection_id=connection.id,
                at=now,
                kind=kind,
                amount=signed,
                currency=balance.currency,
                reference=reference,
                source=balance.source,
                detail=detail or {},
            )
        )
        balance.cash = money(Decimal(balance.cash) + signed)
        balance.updated_at = now
        self.session.flush()
        return signed

    def reserve(self, connection_id: str, amount: Decimal, *, reference: str) -> bool:
        connection = self._connection(connection_id)
        balance = self._balance_row(connection.id, None, create=False)
        if balance is None:
            return False
        value = money(amount)
        if value <= ZERO:
            return False
        if self._ledger_exists(connection.id, f"reserve:{reference}"):
            return True
        if Decimal(balance.cash) - Decimal(balance.reserved) < value:
            return False

        balance.reserved = money(Decimal(balance.reserved) + value)
        balance.updated_at = self._clock()
        self.session.add(
            PortfolioLedgerRow(
                connection_id=connection.id,
                at=self._clock(),
                kind="reservation",
                amount=value,
                currency=balance.currency,
                reference=f"reserve:{reference}",
                source=balance.source,
                detail={"reserved": str(value)},
            )
        )
        self.session.flush()
        return True

    def release(self, connection_id: str, *, reference: str) -> bool:
        connection = self._connection(connection_id)
        balance = self._balance_row(connection.id, None, create=False)
        if balance is None:
            return False
        reservation = self.session.scalar(
            select(PortfolioLedgerRow).where(
                PortfolioLedgerRow.connection_id == connection.id,
                PortfolioLedgerRow.reference == f"reserve:{reference}",
            )
        )
        if reservation is None:
            return False
        if self._ledger_exists(connection.id, f"release:{reference}"):
            return True

        value = Decimal(reservation.amount)
        balance.reserved = max(ZERO, money(Decimal(balance.reserved) - value))
        balance.updated_at = self._clock()
        self.session.add(
            PortfolioLedgerRow(
                connection_id=connection.id,
                at=self._clock(),
                kind="release",
                amount=-value,
                currency=balance.currency,
                reference=f"release:{reference}",
                source=balance.source,
                detail={"released": str(value)},
            )
        )
        self.session.flush()
        return True

    def sync_order_reservation(
        self,
        connection_id: str,
        *,
        order_id: str,
        side: str,
        unfilled_quantity: Decimal,
        price: Decimal | None,
    ) -> None:
        """Keep reserved capital equal to one order's unfilled notional.

        Called after every fill. Releasing the previous reservation before
        reserving the new remainder is what stops a partially filled order from
        reserving its full notional twice.
        """
        connection = self._connection(connection_id)
        prefix = f"order:{order_id}:"
        reservations = self.session.scalars(
            select(PortfolioLedgerRow).where(
                PortfolioLedgerRow.connection_id == connection.id,
                PortfolioLedgerRow.kind == "reservation",
                PortfolioLedgerRow.reference.like(f"reserve:{prefix}%"),
            )
        ).all()
        for row in reservations:
            self.release(str(connection.id), reference=row.reference.removeprefix("reserve:"))

        if side != "buy" or price is None:
            return
        remaining = to_decimal(unfilled_quantity, default=ZERO) or ZERO
        if remaining <= ZERO:
            return
        self.reserve(
            str(connection.id),
            remaining * price,
            reference=f"{prefix}{remaining}",
        )

    # -- valuation ---------------------------------------------------------

    def state(self, connection_id: str) -> AccountValuation:
        connection = self._connection(connection_id)
        now = self._clock()

        paper = self.session.scalar(
            select(PaperAccountRow).where(PaperAccountRow.connection_id == connection.id)
        )
        base_currency = paper.base_currency if paper is not None else "USD"
        balance = self._balance_row(connection.id, base_currency, create=False)

        positions = self.session.scalars(
            select(PositionRow).where(PositionRow.connection_id == connection.id)
        ).all()
        valuations = [self._value_position(row, base_currency, now) for row in positions]

        warnings: list[str] = []
        cash = Decimal(balance.cash) if balance is not None else None
        reserved = Decimal(balance.reserved) if balance is not None else None
        buying_power = (
            money(cash - reserved) if cash is not None and reserved is not None else None
        )

        if balance is None:
            warnings.append(
                "No paper account has been initialised for this connection, so cash and "
                "equity are unknown, not zero."
            )

        if valuations and all(item.market_value is not None for item in valuations):
            positions_value: Decimal | None = money(
                sum((item.market_value or ZERO) for item in valuations)
            )
        elif valuations:
            positions_value = None
            warnings.append(
                "At least one position has no trustworthy price, so the portfolio value is "
                "unknown."
            )
        else:
            positions_value = ZERO

        equity = (
            money(cash + positions_value)
            if cash is not None and positions_value is not None
            else None
        )

        realised = self._sum_optional([item.realised_pnl for item in valuations])
        unrealised = (
            self._sum_optional([item.unrealised_pnl for item in valuations])
            if valuations and all(item.unrealised_pnl is not None for item in valuations)
            else (ZERO if not valuations else None)
        )
        fees = self._sum_optional([item.fees_paid for item in valuations]) or ZERO

        day_pnl, day_pnl_pct = self._day_pnl(connection.id, equity, now)
        drawdown = self._drawdown(connection.id, equity)

        verified = (
            balance is not None
            and equity is not None
            and all(item.market_value is not None for item in valuations)
        )
        if not verified and balance is not None:
            warnings.append(
                "Portfolio state is unverified. The risk engine will not size an order "
                "against it."
            )

        age = None
        if balance is not None:
            updated = as_utc(balance.updated_at)
            if updated is not None:
                age = max(0.0, (now - updated).total_seconds())

        return AccountValuation(
            connection_id=str(connection.id),
            label=connection.label,
            provider=connection.provider,
            market_type=MarketType(connection.market_type),
            mode=connection.mode,
            access=connection.access,
            permissions=list(connection.permissions or []),
            last_synced_at=(
                as_utc(connection.last_synced_at)
                or (as_utc(balance.updated_at) if balance is not None else None)
            ),
            base_currency=base_currency,
            cash=cash,
            reserved=reserved,
            buying_power=buying_power,
            positions_value=positions_value,
            equity=equity,
            realised_pnl=realised,
            unrealised_pnl=unrealised,
            fees_paid=fees,
            day_pnl=day_pnl,
            day_pnl_pct=day_pnl_pct,
            drawdown_pct=drawdown,
            positions=valuations,
            provenance="live" if verified else "unavailable",
            source=PAPER_SOURCE if paper is not None else BROKER_SOURCE,
            verified=verified,
            account_state_age_seconds=age,
            as_of=now,
            warnings=warnings,
        )

    def aggregate(self) -> PortfolioValuation:
        now = self._clock()
        connections = self.session.scalars(
            select(ConnectionRow).order_by(ConnectionRow.created_at)
        ).all()
        accounts = [self.state(str(connection.id)) for connection in connections]

        warnings: list[str] = []
        for account in accounts:
            warnings.extend(account.warnings)

        if not accounts:
            warnings.append(
                "No broker or exchange connection is configured. Balances, equity and P&L "
                "are unknown, not zero."
            )

        def total(values: list[Decimal | None]) -> Decimal | None:
            if not values:
                return None
            if any(value is None for value in values):
                return None
            return money(sum((value or ZERO) for value in values))

        total_equity = total([account.equity for account in accounts])
        cash = total([account.cash for account in accounts])
        buying_power = total([account.buying_power for account in accounts])
        realised = total([account.realised_pnl for account in accounts])
        unrealised = total([account.unrealised_pnl for account in accounts])
        fees = total([account.fees_paid for account in accounts])
        day_pnl = total([account.day_pnl for account in accounts])

        day_pnl_pct = None
        if day_pnl is not None and total_equity is not None:
            opening = total_equity - day_pnl
            day_pnl_pct = pct_of(day_pnl, opening)

        positions = [item for account in accounts for item in account.positions]

        by_market: dict[str, tuple[Decimal | None, Decimal | None]] = {}
        for market in (MarketType.CRYPTO, MarketType.STOCKS):
            market_positions = [item for item in positions if item.market_type is market]
            if market_positions and all(item.market_value is not None for item in market_positions):
                value: Decimal | None = money(
                    sum((item.market_value or ZERO) for item in market_positions)
                )
            elif market_positions:
                value = None
            else:
                value = ZERO
            by_market[str(market)] = (value, pct_of(value, total_equity))

        allocation: list[tuple[str, str, Decimal, Decimal]] = []
        for item in positions:
            if item.market_value is None:
                continue
            allocation.append(
                (
                    item.symbol,
                    item.symbol,
                    item.market_value,
                    pct_of(item.market_value, total_equity) or ZERO,
                )
            )
        if cash is not None and cash > ZERO:
            allocation.append(("cash", "Cash", cash, pct_of(cash, total_equity) or ZERO))

        verified = bool(accounts) and all(account.verified for account in accounts)
        provenance = "live" if verified else "unavailable"

        return PortfolioValuation(
            base_currency=accounts[0].base_currency if accounts else "USD",
            total_equity=total_equity,
            cash=cash,
            buying_power=buying_power,
            day_pnl=day_pnl,
            day_pnl_pct=day_pnl_pct,
            realised_pnl=realised,
            unrealised_pnl=unrealised,
            fees_paid=fees,
            open_positions=len(positions),
            equity_curve=self.equity_curve(),
            allocation=allocation,
            by_market=by_market,
            accounts=accounts,
            positions=positions,
            provenance=provenance,
            verified=verified,
            as_of=now,
            warnings=warnings,
        )

    # -- snapshots and verification ---------------------------------------

    def snapshot_equity(self, connection_id: str) -> EquitySnapshotRow | None:
        state = self.state(connection_id)
        if state.equity is None or state.cash is None or state.positions_value is None:
            return None

        at = self._clock().replace(microsecond=0)
        existing = self.session.scalar(
            select(EquitySnapshotRow).where(
                EquitySnapshotRow.connection_id == uuid.UUID(state.connection_id),
                EquitySnapshotRow.at == at,
            )
        )
        if existing is not None:
            existing.equity = state.equity
            existing.cash = state.cash
            existing.positions_value = state.positions_value
            existing.source = state.source
            self.session.flush()
            return existing

        row = EquitySnapshotRow(
            connection_id=uuid.UUID(state.connection_id),
            at=at,
            equity=state.equity,
            cash=state.cash,
            positions_value=state.positions_value,
            source=state.source,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def equity_curve(self, limit: int = 500) -> list[tuple[datetime, Decimal]]:
        rows = self.session.scalars(
            select(EquitySnapshotRow)
            .order_by(EquitySnapshotRow.at.desc())
            .limit(max(1, min(limit, 5000)))
        ).all()
        grouped: dict[datetime, Decimal] = {}
        for row in rows:
            at = as_utc(row.at)
            if at is None:
                continue
            grouped[at] = grouped.get(at, ZERO) + Decimal(row.equity)
        return sorted(grouped.items())

    def verify(self, connection_id: str) -> VerificationResult:
        connection = self._connection(connection_id)
        balance = self._balance_row(connection.id, None, create=False)
        now = self._clock()

        if balance is None:
            return VerificationResult(
                connection_id=str(connection.id),
                ok=False,
                expected_cash=None,
                stored_cash=None,
                difference=None,
                checked_at=now,
                detail="No balance row exists for this account.",
            )

        rows = self.session.scalars(
            select(PortfolioLedgerRow).where(
                PortfolioLedgerRow.connection_id == connection.id,
                PortfolioLedgerRow.kind.in_(CASH_KINDS),
            )
        ).all()
        expected = money(sum((Decimal(row.amount) for row in rows), ZERO))
        stored = money(Decimal(balance.cash))
        difference = money(expected - stored)

        return VerificationResult(
            connection_id=str(connection.id),
            ok=difference == ZERO,
            expected_cash=expected,
            stored_cash=stored,
            difference=difference,
            checked_at=now,
            detail=(
                "Cash matches the ledger."
                if difference == ZERO
                else f"Cash differs from the ledger by {difference}."
            ),
        )

    def ledger(self, connection_id: str, limit: int = 200) -> list[PortfolioLedgerRow]:
        connection = self._connection(connection_id)
        return list(
            self.session.scalars(
                select(PortfolioLedgerRow)
                .where(PortfolioLedgerRow.connection_id == connection.id)
                .order_by(PortfolioLedgerRow.at.desc())
                .limit(max(1, min(limit, 1000)))
            ).all()
        )

    # -- internals ---------------------------------------------------------

    def _connection(self, connection_id: str) -> ConnectionRow:
        try:
            parsed = uuid.UUID(str(connection_id))
        except (ValueError, AttributeError) as exc:
            raise NotFound(f"Unknown account {connection_id!r}.") from exc
        connection = self.session.get(ConnectionRow, parsed)
        if connection is None:
            raise NotFound(f"Unknown account {connection_id!r}.")
        return connection

    def _balance_row(
        self, connection_id: uuid.UUID, currency: str | None, *, create: bool
    ) -> AccountBalanceRow | None:
        query = select(AccountBalanceRow).where(AccountBalanceRow.connection_id == connection_id)
        if currency is not None:
            query = query.where(AccountBalanceRow.currency == currency)
        row = self.session.scalar(query.order_by(AccountBalanceRow.updated_at.desc()).limit(1))
        if row is not None or not create:
            return row

        code = (currency or self.settings.paper_default_currency).upper()
        row = AccountBalanceRow(
            connection_id=connection_id,
            currency=code,
            cash=ZERO,
            reserved=ZERO,
            source=PAPER_SOURCE,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def _ledger_exists(self, connection_id: uuid.UUID, reference: str) -> bool:
        return (
            self.session.scalar(
                select(PortfolioLedgerRow.id)
                .where(
                    PortfolioLedgerRow.connection_id == connection_id,
                    PortfolioLedgerRow.reference == reference,
                )
                .limit(1)
            )
            is not None
        )

    def _value_position(
        self, row: PositionRow, base_currency: str, now: datetime
    ) -> PositionValuation:
        market = MarketType(row.market_type)
        quote: QuoteView | None = self.market_data.latest_quote(row.symbol, market)

        price: Decimal | None = None
        quality = "unavailable"
        as_of: datetime | None = None
        age: float | None = None
        stale = True
        warnings: list[str] = []

        if quote is not None:
            price = quote.mid if quote.mid is not None else quote.last
            quality = str(quote.quality)
            as_of = quote.as_of
            age = quote.age_seconds
            stale = quote.stale
            warnings.extend(quote.warnings)
        else:
            warnings.append(
                f"No quote is stored for {row.symbol}, so its value is unknown."
            )

        position_currency = quote_currency(row.symbol, market)
        quantity = Decimal(row.quantity)
        average = Decimal(row.average_entry_price)

        market_value: Decimal | None = None
        unrealised: Decimal | None = None
        unrealised_pct: Decimal | None = None

        if price is not None:
            market_value = self.fx.convert(quantity * price, position_currency, base_currency)
            unrealised = self.fx.convert(
                (price - average) * quantity, position_currency, base_currency
            )
            if average > ZERO:
                unrealised_pct = pct_of(price - average, average)
            if market_value is None:
                warnings.append(
                    f"No FX rate is stored for {position_currency}/{base_currency}, so "
                    f"{row.symbol} cannot be valued in {base_currency}."
                )

        realised = self.fx.convert(Decimal(row.realised_pnl), position_currency, base_currency)
        fees = self.fx.convert(Decimal(row.fees_paid), position_currency, base_currency)

        return PositionValuation(
            id=str(row.id),
            connection_id=str(row.connection_id) if row.connection_id else "",
            symbol=row.symbol,
            market_type=market,
            quantity=quantity,
            average_entry_price=average,
            last_price=price,
            market_value=market_value,
            unrealised_pnl=unrealised,
            unrealised_pnl_pct=unrealised_pct,
            realised_pnl=realised if realised is not None else ZERO,
            fees_paid=fees if fees is not None else ZERO,
            source=row.source or PAPER_SOURCE,
            price_quality=quality,
            price_as_of=as_of,
            price_age_seconds=age,
            price_stale=stale,
            opened_at=as_utc(row.opened_at) or now,
            strategy_id=str(row.strategy_id) if row.strategy_id else None,
            bot_id=str(row.bot_id) if row.bot_id else None,
            warnings=tuple(warnings),
        )

    def _day_pnl(
        self, connection_id: uuid.UUID, equity: Decimal | None, now: datetime
    ) -> tuple[Decimal | None, Decimal | None]:
        if equity is None:
            return None, None
        start_of_day = datetime.combine(now.date(), time.min, tzinfo=UTC)
        opening = self.session.scalar(
            select(EquitySnapshotRow)
            .where(
                EquitySnapshotRow.connection_id == connection_id,
                EquitySnapshotRow.at < start_of_day,
            )
            .order_by(EquitySnapshotRow.at.desc())
            .limit(1)
        )
        if opening is None:
            opening = self.session.scalar(
                select(EquitySnapshotRow)
                .where(
                    EquitySnapshotRow.connection_id == connection_id,
                    EquitySnapshotRow.at >= start_of_day,
                )
                .order_by(EquitySnapshotRow.at.asc())
                .limit(1)
            )
        if opening is None:
            return None, None

        base = Decimal(opening.equity)
        # External cash flows are not performance. A deposit raises equity and
        # must not read as profit; a withdrawal lowers it and must not read as a
        # loss. Fills and fees stay in, because they are trading outcomes.
        opening_at = as_utc(opening.at)
        conditions = [
            PortfolioLedgerRow.connection_id == connection_id,
            PortfolioLedgerRow.kind.in_(("deposit", "withdrawal", "transfer")),
        ]
        if opening_at is not None:
            conditions.append(PortfolioLedgerRow.at > opening_at)
        flows = self.session.scalars(select(PortfolioLedgerRow).where(*conditions)).all()
        net_flow = money(sum((Decimal(row.amount) for row in flows), ZERO))
        delta = money(equity - base - net_flow)
        return delta, pct_of(delta, base)

    def _drawdown(self, connection_id: uuid.UUID, equity: Decimal | None) -> Decimal | None:
        if equity is None:
            return None
        peak = self.session.scalar(
            select(EquitySnapshotRow.equity)
            .where(EquitySnapshotRow.connection_id == connection_id)
            .order_by(EquitySnapshotRow.equity.desc())
            .limit(1)
        )
        if peak is None:
            return None
        peak_value = Decimal(peak)
        if peak_value <= ZERO:
            return None
        drawdown = (peak_value - equity) / peak_value * HUNDRED
        return drawdown if drawdown > ZERO else ZERO

    @staticmethod
    def _sum_optional(values: list[Decimal | None]) -> Decimal | None:
        if not values:
            return ZERO
        if any(value is None for value in values):
            return None
        return money(sum((value or ZERO) for value in values))
