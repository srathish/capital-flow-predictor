from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Same Postgres the API + jobs share. Set as a linked Railway variable.
    database_url: str = "postgresql://cfp:cfp@localhost:5432/cfp"

    # Discord user token (NOT a bot token). Pull from web client devtools:
    # Network tab → any request → Authorization header. Keep this secret;
    # exposure = full account access. Empty disables the listener (the
    # process exits cleanly with a log line).
    discord_user_token: str = ""

    # If empty, mirrors every channel the account can see. If set, only
    # captures channels listed in the discord_sources table. The recommended
    # rollout is: start permissive, watch what shows up, then tighten.
    use_source_allowlist: bool = True

    # Drop messages older than this many seconds at insert time. Discord can
    # replay events on reconnect; this stops us double-inserting ancient
    # backlog if the gateway gets chatty. 6h covers normal reconnect storms
    # without losing any same-day plays.
    max_message_age_seconds: int = 6 * 3600

    log_level: str = "INFO"


settings = Settings()
