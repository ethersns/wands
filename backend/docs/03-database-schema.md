# Wands — Database Schema

PostgreSQL 16. All timestamps are `timestamptz` stored in UTC. All primary keys
are UUIDv4 unless noted. Money and quantities use `numeric(20, 8)` — never
floats — so that position arithmetic is exact.

## Tables

### `users`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| email | text unique | lowercased on write |
| display_name | text | |
| password_hash | text | argon2/bcrypt hash; null for service-only accounts |
| role | text | `viewer` \| `operator` \| `admin` |
| mfa_enabled | bool | |
| mfa_secret_encrypted | text | Fernet ciphertext of the TOTP secret |
| is_active | bool | |
| created_at / updated_at | timestamptz | |

### `api_keys`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK → users | |
| name | text | operator label |
| key_prefix | text unique | first 8 chars, used for lookup |
| key_hash | text | SHA-256 of the secret half; the secret is never stored |
| role | text | effective role, may be lower than the user's |
| scopes | jsonb | explicit scope list |
| created_at / last_used_at / revoked_at | timestamptz | |

### `audit_events` (append-only)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| at | timestamptz | |
| actor | text | principal subject |
| actor_type | text | `service` \| `user` \| `system` |
| action | text | e.g. `risk.policy.update` |
| target | text | resource identifier |
| outcome | text | `success` \| `denied` \| `error` |
| detail | jsonb | structured context, never secrets |
| request_id | text | correlates with logs |
| ip | text | |

### `engine_state` (singleton, `id = 1`)
| Column | Type | Notes |
| --- | --- | --- |
| id | int PK | always 1 |
| trading_mode | text | `backtest` \| `paper` \| `live` |
| live_trading_enabled | bool | default false |
| trading_paused | bool | default false |
| emergency_stop_engaged | bool | default false |
| emergency_stop_at | timestamptz | |
| emergency_stop_actor | text | |
| version | int | optimistic concurrency |
| updated_at | timestamptz | |

Emergency stop lives here, not in memory, so it survives restarts.

### `risk_policies`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | text | |
| is_active | bool | exactly one active row |
| max_portfolio_exposure_pct | numeric(6,3) | default 80 |
| max_position_exposure_pct | numeric(6,3) | default 5 |
| per_trade_risk_pct | numeric(6,3) | default 0.5 |
| daily_loss_limit_pct | numeric(6,3) | default 2 |
| max_drawdown_pct | numeric(6,3) | default 10 |
| crypto_allocation_cap_pct | numeric(6,3) | default 40 |
| stocks_allocation_cap_pct | numeric(6,3) | default 60 |
| max_quote_age_seconds | int | default 30 |
| duplicate_order_window_seconds | int | default 60 |
| updated_at / updated_by | | |

### `risk_events`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| at | timestamptz | |
| severity | text | `info` \| `warning` \| `critical` |
| category | text | `exposure` \| `drawdown` \| `circuit_breaker` \| `stale_data` \| `duplicate_order` \| `permission` \| `emergency_stop` \| `policy_change` |
| title / detail | text | |
| acknowledged | bool | |
| actor | text | |

### `connections`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| provider | text | `kraken` \| `alpaca` \| `interactive_brokers` |
| label | text | |
| market_type | text | `crypto` \| `stocks` |
| status | text | `connected` \| `degraded` \| `disconnected` \| `not_configured` |
| access | text | `read_only` \| `trading` |
| mode | text | `backtest` \| `paper` \| `live` |
| key_hint | text | last four characters only |
| credentials_encrypted | text | Fernet ciphertext of the credential JSON |
| permissions | jsonb | granted scopes; withdrawals are never requested |
| last_synced_at | timestamptz | |
| error | text | |
| created_at / updated_at | timestamptz | |

### `strategies`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| slug | text unique | |
| name / description | text | |
| category | text | `trend_following` \| `mean_reversion` \| `momentum` \| `grid` \| `market_making` \| `arbitrage` \| `custom` |
| version | text | semver |
| supported_markets | jsonb | |
| deployment | text | `paper_only` \| `paper_and_live` |
| config_schema | jsonb | parameter definitions rendered by the UI |
| created_at / updated_at | timestamptz | |

### `bots`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | text | |
| market_type | text | |
| connection_id | uuid FK → connections | |
| strategy_id | uuid FK → strategies | |
| symbols | jsonb | |
| timeframe | text | |
| mode | text | |
| state | text | `running` \| `paused` \| `stopped` \| `error` |
| allocated_capital | numeric(20,8) | |
| position_size_pct / stop_loss_pct / take_profit_pct | numeric(6,3) | |
| max_open_positions | int | |
| daily_loss_limit_pct | numeric(6,3) | |
| schedule | text | cron expression |
| created_at / last_run_at | timestamptz | |
| last_error | text | |

### `orders`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| client_order_id | text **unique** | idempotency key, client generated |
| connection_id | uuid FK → connections | |
| symbol / market_type | text | |
| side | text | `buy` \| `sell` |
| type | text | `market` \| `limit` \| `stop` \| `stop_limit` |
| status | text | `open` \| `partially_filled` \| `filled` \| `cancelled` \| `rejected` |
| quantity / filled_quantity | numeric(20,8) | |
| limit_price / average_fill_price / fees | numeric(20,8) | |
| mode | text | |
| bot_id / strategy_id | uuid FK, nullable | |
| exchange_confirmation_id | text | |
| reconciliation | text | `matched` \| `pending` \| `mismatch` |
| reject_reason | text | |
| created_at / updated_at | timestamptz | |

The unique constraint on `client_order_id` is the database-level guarantee
against duplicate submission; the gateway also checks it before touching a
broker.

### `fills`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| order_id | uuid FK → orders | |
| symbol / side | text | |
| quantity / price / fees | numeric(20,8) | |
| at | timestamptz | |

### `positions`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| connection_id | uuid FK → connections | |
| symbol / market_type | text | |
| quantity / average_entry_price | numeric(20,8) | |
| realised_pnl / fees_paid | numeric(20,8) | |
| opened_at | timestamptz | |
| strategy_id / bot_id | uuid FK, nullable | |

### `backtests`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| strategy_id | uuid FK → strategies | |
| symbols | jsonb | |
| timeframe | text | |
| period_from / period_to | timestamptz | |
| initial_capital | numeric(20,8) | |
| status | text | `queued` \| `running` \| `completed` \| `failed` |
| metrics / equity_curve / trades / walk_forward | jsonb | |
| created_at / completed_at | timestamptz | |

### `user_settings`
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK → users, unique | |
| base_currency | text | |
| theme | text | |
| two_factor_enabled | bool | |
| notifications | jsonb | |
| retention_days | int | |
| last_backup_at | timestamptz | |

## Indexes

- `orders (connection_id, created_at desc)` — order history.
- `orders (status)` partial on open/partially_filled — reconciliation sweeps.
- `fills (order_id)`.
- `positions (connection_id, symbol)` unique — one net position per symbol.
- `risk_events (at desc)`, `audit_events (at desc)`.
- `api_keys (key_prefix)` unique.

## Migration policy

Alembic, one revision per change, always with a working `downgrade()`.
`tests/test_migrations.py` runs `upgrade head` → `downgrade base` → `upgrade
head` against a throwaway database on every test run, so a broken migration
fails CI rather than production.
