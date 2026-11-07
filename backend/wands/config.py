"""Process configuration.

Every environment variable the engine reads is declared here exactly once, so
there is a single place to audit for secrets and a single place to change a
default. Nothing else in the codebase calls ``os.environ``.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

TradingMode = Literal["backtest", "paper", "live"]

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PLACEHOLDER_DOMAINS = ("example.com", "example.org", "example.net")


def _parse_date(value: str, fallback: date) -> date:
    """Parse an ISO date, falling back rather than raising.

    A malformed backfill bound should not stop the engine from booting; it
    should fall back to a documented default that the operator can see.
    """
    try:
        return date.fromisoformat(value.strip())
    except (ValueError, AttributeError):
        return fallback


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="WANDS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- identity ---------------------------------------------------------
    environment: Literal["development", "test", "staging", "production"] = "development"
    service_name: str = "wands-engine"
    version: str = "0.1.0"
    region: str = "self-hosted"

    # --- storage ----------------------------------------------------------
    database_url: str = "postgresql+psycopg://wands:wands@localhost:5432/wands"
    database_pool_size: int = 5
    database_echo: bool = False
    redis_url: str = "redis://localhost:6379/0"

    # --- credentials ------------------------------------------------------
    engine_token: SecretStr | None = None
    encryption_key: SecretStr | None = None
    api_key_pepper: SecretStr | None = None

    # --- trading safety ---------------------------------------------------
    trading_mode: TradingMode = "paper"
    live_trading_enabled: bool = False
    max_account_state_age_seconds: int = 300
    max_spread_pct: float = 1.0

    # --- market data ------------------------------------------------------
    # When false no provider is constructed at all. Tests set this so a suite
    # can never depend on a live venue being reachable.
    market_data_enabled: bool = True
    # Comma-separated. Crypto pairs use BASE/QUOTE; anything else is an equity.
    market_watchlist: str = "BTC/USD,ETH/USD,SOL/USD,XRP/USD,AAPL,MSFT,NVDA,SPY"
    market_refresh_seconds: int = 30
    market_candle_limit: int = 200
    market_data_timeout_seconds: float = 10.0
    market_data_max_retries: int = 3
    market_data_worker_enabled: bool = True

    kraken_base_url: str = "https://api.kraken.com"
    kraken_rate_limit_per_second: float = 2.0

    alpaca_data_key: SecretStr | None = None
    alpaca_data_secret: SecretStr | None = None
    alpaca_data_base_url: str = "https://data.alpaca.markets"
    # ``iex`` is real-time but single-venue; ``sip`` is consolidated and, on a
    # free plan, delayed. Set ``alpaca_data_delayed`` when the account is not
    # entitled to real-time SIP so the data is never labelled live.
    alpaca_data_feed: str = "iex"
    alpaca_data_delayed: bool = False

    # Optional. OpenFIGI resolves CUSIPs without a key at 25 requests a minute;
    # a key raises the ceiling for a larger identifier pilot. It is not a
    # licensed CUSIP master file either way.
    openfigi_api_key: SecretStr | None = None

    # --- portfolio --------------------------------------------------------
    paper_default_starting_cash: Decimal = Decimal("100000")
    paper_default_currency: str = "USD"
    # Manual FX snapshots, e.g. "EURUSD=1.0850,GBPUSD=1.2700". Rates are stored
    # with a timestamp; nothing is inverted or interpolated at read time.
    fx_rate_overrides: str = ""
    fx_max_age_seconds: int = 86400

    # --- intelligence -----------------------------------------------------
    # Research data is read-only and never reaches the order path. Disabling it
    # removes the collectors entirely; the API then reports an empty state
    # rather than inventing filings.
    intelligence_enabled: bool = True
    intelligence_ingest_enabled: bool = False
    intelligence_ingest_interval_seconds: int = 3600
    # SEC fair access requires a descriptive User-Agent identifying the
    # operator. A generic or missing agent is refused, and should be.
    sec_user_agent: str = "wands-research/0.1 (research; contact: ops@example.com)"
    sec_base_url: str = "https://www.sec.gov"
    sec_data_base_url: str = "https://data.sec.gov"
    # SEC asks for no more than 10 requests per second. Half that leaves room
    # for a retry without ever approaching the ceiling.
    sec_rate_limit_per_second: float = 5.0
    sec_timeout_seconds: float = 20.0
    sec_max_retries: int = 3
    # Comma-separated CIKs to poll. Empty means "derive from the equity
    # watchlist", which is the useful default for a small deployment.
    intelligence_insider_ciks: str = ""
    # Comma-separated 13F filer CIKs. Empty means the institutional collector
    # reports that it has nothing to poll rather than guessing at managers.
    intelligence_institution_ciks: str = ""
    intelligence_insider_lookback_days: int = 30
    intelligence_cluster_min_insiders: int = 3
    intelligence_cluster_window_days: int = 30
    intelligence_purchase_value_threshold_usd: Decimal = Decimal("250000")
    intelligence_activity_baseline_days: int = 180
    intelligence_signal_engine_version: str = "1.0"

    # --- intelligence: historical backfill --------------------------------
    # The recent-filings block in the submissions JSON only reaches back a few
    # hundred filings per issuer. Older history lives in the per-issuer archive
    # pages, which is what backfill walks. It is off by default because it is a
    # long, rate-limited crawl rather than a request-time operation.
    intelligence_backfill_enabled: bool = False
    intelligence_backfill_start_date: str = "2015-01-01"
    # Empty means "up to the most recent completed filing".
    intelligence_backfill_end_date: str = ""
    # SEC fair access is the real bound here, not CPU. Two workers at half the
    # published rate stays well inside the ceiling.
    intelligence_backfill_max_workers: int = 2
    intelligence_backfill_batch_size: int = 200
    intelligence_backfill_max_retries: int = 4
    intelligence_backfill_retry_base_seconds: float = 1.0
    intelligence_backfill_retry_max_seconds: float = 60.0

    # --- intelligence: scheduled jobs -------------------------------------
    intelligence_jobs_enabled: bool = False
    # A lease longer than the slowest expected run. A job whose lease expires
    # is treated as interrupted and may be reclaimed by another process.
    intelligence_job_lease_seconds: int = 900
    intelligence_job_max_failures: int = 5
    intelligence_job_poll_seconds: int = 30

    # --- intelligence: signal validation ----------------------------------
    intelligence_validation_horizons: str = "1,5,10,20,60"
    intelligence_validation_benchmark: str = "SPY"
    # Round-trip costs in basis points. Applied to every simulated trade, so a
    # gross edge smaller than the total is reported as a loss.
    intelligence_validation_spread_bps: Decimal = Decimal("5")
    intelligence_validation_commission_bps: Decimal = Decimal("1")
    intelligence_validation_slippage_bps: Decimal = Decimal("5")
    # Fraction of the sample used for in-sample fitting. The remainder is the
    # out-of-sample window and is never used to choose anything.
    intelligence_validation_train_fraction: float = 0.6
    intelligence_validation_min_sample: int = 30
    intelligence_validation_bootstrap_iterations: int = 2000
    intelligence_validation_seed: int = 20240101

    # --- http -------------------------------------------------------------
    allowed_origins: str = ""
    request_timeout_seconds: float = 15.0

    # --- observability ----------------------------------------------------
    log_level: str = "INFO"
    otel_exporter_otlp_endpoint: str | None = None

    @field_validator("log_level")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def _require_real_sec_contact(self) -> Settings:
        """Refuse to collect from SEC without a real operator contact.

        SEC asks automated clients to identify themselves with a working
        address. The shipped default is a placeholder, so enabling collection
        without replacing it would hand them a contact that goes nowhere. This
        validates rather than substitutes: inventing an address would be worse
        than refusing to start.
        """
        if not self.intelligence_ingest_enabled:
            return self

        match = _EMAIL.search(self.sec_user_agent)
        if match is None:
            raise ValueError(
                "WANDS_SEC_USER_AGENT must include a contact email before SEC ingestion "
                "is enabled."
            )
        if match.group(0).lower().endswith(_PLACEHOLDER_DOMAINS):
            raise ValueError(
                "WANDS_SEC_USER_AGENT still carries the placeholder contact. Set it to an "
                "agent string with a real operator address before enabling SEC ingestion."
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def watchlist(self) -> list[str]:
        return [item.strip() for item in self.market_watchlist.split(",") if item.strip()]

    @property
    def backfill_start(self) -> date:
        return _parse_date(self.intelligence_backfill_start_date, date(2015, 1, 1))

    @property
    def backfill_end(self) -> date | None:
        """``None`` means "no upper bound", not "today".

        Pinning the end to the day the process started would make a resumed
        backfill silently skip everything filed since, so the absence of an
        explicit end is carried through as an open interval.
        """
        if not self.intelligence_backfill_end_date.strip():
            return None
        return _parse_date(self.intelligence_backfill_end_date, date.today())

    @property
    def validation_horizons(self) -> list[int]:
        horizons: list[int] = []
        for entry in self.intelligence_validation_horizons.split(","):
            text = entry.strip()
            if not text:
                continue
            try:
                value = int(text)
            except ValueError:
                continue
            if value > 0 and value not in horizons:
                horizons.append(value)
        return sorted(horizons) or [1, 5, 10, 20, 60]

    @property
    def validation_cost_bps(self) -> Decimal:
        """Total round-trip cost charged to every simulated trade."""
        return (
            self.intelligence_validation_spread_bps
            + self.intelligence_validation_commission_bps
            + self.intelligence_validation_slippage_bps
        )

    @property
    def fx_overrides(self) -> dict[tuple[str, str], Decimal]:
        """Parse ``EURUSD=1.0850`` style overrides into ``(base, quote) -> rate``."""
        rates: dict[tuple[str, str], Decimal] = {}
        for entry in self.fx_rate_overrides.split(","):
            text = entry.strip()
            if not text or "=" not in text:
                continue
            pair, _, value = text.partition("=")
            pair = pair.strip().upper().replace("/", "")
            if len(pair) != 6:
                continue
            try:
                rate = Decimal(value.strip())
            except Exception:  # noqa: BLE001, S112 - a malformed override is skipped
                continue
            if rate > 0:
                rates[(pair[:3], pair[3:])] = rate
        return rates

    def require_encryption_key(self) -> str:
        """Return the Fernet key, refusing to run without one outside tests.

        Silently falling back to an unencrypted store would be worse than
        failing to start: the operator would believe credentials are protected.
        """
        if self.encryption_key is None or not self.encryption_key.get_secret_value():
            raise RuntimeError(
                "WANDS_ENCRYPTION_KEY is not set. Broker credentials cannot be stored "
                "safely without it. Generate one with: "
                'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        return self.encryption_key.get_secret_value()

    def require_engine_token(self) -> str:
        if self.engine_token is None or not self.engine_token.get_secret_value():
            raise RuntimeError(
                "WANDS_ENGINE_TOKEN is not set. The engine will not start without a "
                "service credential, because an unauthenticated trading API is unsafe."
            )
        return self.engine_token.get_secret_value()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Used by tests that change the environment between cases."""
    get_settings.cache_clear()
