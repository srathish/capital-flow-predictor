from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://cfp:cfp@localhost:5432/cfp"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    log_level: str = "INFO"

    # CORS origins for the dashboard. Default is permissive ("*") for local dev.
    # In production set to a comma-separated list, e.g. "https://app.example.vercel.app".
    cors_origins_raw: str = "*"

    # Comma-separated API keys. Empty => auth disabled (dev).
    api_keys_raw: str = ""

    # Rate limits (per identity = api_key or IP).
    rate_limit_enabled: bool = True
    rate_limit_default_per_min: int = 120
    rate_limit_run_per_hour: int = 30

    # Freshness thresholds for /v1/health/detailed (hours since latest row).
    health_stale_hours_prices: int = 36       # daily ingest; weekend gap ≤ 72h
    health_stale_hours_signals: int = 48      # agent runs; once-daily cadence
    health_stale_hours_news: int = 12

    @property
    def cors_origins(self) -> list[str]:
        if self.cors_origins_raw.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]

    @property
    def api_keys(self) -> list[str]:
        return [k.strip() for k in self.api_keys_raw.split(",") if k.strip()]


settings = Settings()
