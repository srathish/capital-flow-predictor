# Terraform IaC

Today Railway is click-ops. This directory is the **starter** for codifying
the env-var surface so prod drift is auditable.

## What's here

- `main.tf` — provider scaffolding (Railway provider, GitHub backend)
- `variables.tf` — declared env vars with sensible defaults
- `terraform.tfvars.example` — copy to `terraform.tfvars` (gitignored) for local plan

## Not here yet

- Actual `terraform apply` against Railway. The Railway TF provider is community
  maintained and changes often; the canonical IaC for Railway is still their
  in-dashboard "Service Variables" panel.
- Vercel resources. Vercel has an official provider; add when staging lands.
- DNS. Cloudflare zones — add when we own a stable apex.

## How to use today

1. `terraform fmt` / `terraform validate` — keeps the file syntactically valid.
2. Treat the files as the source of truth for **what env vars exist** and
   **what their defaults are**, even if the value is set manually in Railway.
3. CI can lint this directory with `tflint` as a checkpoint that nobody
   shipped a new env var without documenting it here.

## Migration plan

When the Railway TF provider stabilizes:
1. Import current services with `terraform import railway_service.api …`
2. Move all secrets to Railway-side env vars referenced from `main.tf` via
   `sensitive = true` variables.
3. Add a GitHub Action `terraform-plan.yml` that runs on PRs touching this dir.
