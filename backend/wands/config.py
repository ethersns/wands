"""Process configuration.

Every environment variable the engine reads is declared here exactly once, so
there is a single place to audit for secrets and a single place to change a
default. Nothing else in the codebase calls ``os.environ``.
"""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

TradingMode = Literal["backtest", "paper", "live"]


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

    # --- portfolio --------------------------------------------------------
    paper_default_starting_cash: Decimal = Decimal("100000")
    paper_default_currency: str = "USD"
    # Manual FX snapshots, e.g. "EURUSD=1.0850,GBPUSD=1.2700". Rates are stored
    # with a timestamp; nothing is inverted or interpolated at read time.
    fx_rate_overrides: str = ""
    fx_max_age_seconds: int = 86400

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
