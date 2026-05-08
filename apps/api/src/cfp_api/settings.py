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

    @property
    def cors_origins(self) -> list[str]:
        if self.cors_origins_raw.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]


settings = Settings()
