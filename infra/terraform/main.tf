# Bellwether infra — starter scaffolding.
# Not currently applied; the file documents what *would* be configured.

terraform {
  required_version = ">= 1.6"

  # When ready: backend "s3" or "gcs" for shared state. Local-only for now.
  # backend "s3" {
  #   bucket = "bellwether-tf-state"
  #   key    = "prod/terraform.tfstate"
  #   region = "us-east-1"
  # }

  required_providers {
    # Vercel official provider — used for the dashboard's prod + staging projects.
    vercel = {
      source  = "vercel/vercel"
      version = "~> 1.13"
    }
  }
}

provider "vercel" {
  # api_token is read from VERCEL_API_TOKEN env at plan/apply time.
}

# The Railway side of the deployment is intentionally not modeled yet —
# the community provider is volatile. Tracked as a todo in README.md.
