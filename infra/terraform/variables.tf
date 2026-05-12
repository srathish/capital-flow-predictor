# Declared env vars across the prod + staging stacks.
# Update this file in the SAME commit that adds a new setting in
# `apps/api/src/cfp_api/settings.py` or anywhere in cfp_jobs.

# --- API service ---

variable "api_log_level" {
  description = "Python log level for cfp_api"
  type        = string
  default     = "INFO"
}

variable "api_cors_origins" {
  description = "Comma-separated CORS origins. '*' to allow all (dev only)"
  type        = string
  default     = "https://bellwether.app,https://www.bellwether.app"
}

variable "api_keys" {
  description = "Comma-separated valid API keys. Empty disables auth (dev only)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "rate_limit_default_per_min" {
  description = "Per-identity rate cap on read endpoints (per minute)"
  type        = number
  default     = 120
}

variable "rate_limit_run_per_hour" {
  description = "Per-identity rate cap on ensemble runs + chat (per hour)"
  type        = number
  default     = 30
}

# --- Data ingestion + agents ---

variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "unusual_whales_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "fred_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "langfuse_public_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "langfuse_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

# --- Frontend ---

variable "next_public_api_base_url" {
  description = "API base URL the dashboard talks to"
  type        = string
  default     = "https://api.bellwether.app"
}
