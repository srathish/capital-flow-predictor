from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql://cfp:cfp@localhost:5432/cfp"
    fred_api_key: str = ""
    fmp_api_key: str = ""
    anthropic_api_key: str = ""
    unusual_whales_api_key: str = ""


settings = Settings()
