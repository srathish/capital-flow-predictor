"""Settings for the UW WebSocket subscriber. Env vars are validated at
startup so the container fails loudly rather than no-oping silently."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    unusual_whales_api_key: str
    uw_socket_url: str = "wss://api.unusualwhales.com/socket"
    uw_socket_channels: str = "flow_alerts,option_trades,gex,market_tide,trading_halts"
    uw_news_poll_seconds: int = 60
    log_level: str = "INFO"

    @property
    def channels(self) -> list[str]:
        return [c.strip() for c in self.uw_socket_channels.split(",") if c.strip()]


settings = Settings()  # type: ignore[call-arg]
