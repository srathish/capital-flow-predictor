# `@cfp/web` — Next.js dashboard

Three views over the Bellwether read API:

- **`/`** — Sector heatmap (rankings from `/v1/rankings` + `/v1/sectors`)
- **`/watchlist`** — Top constituents per top sector with PM rationale (`/v1/watchlist`)
- **`/agents/[ticker]`** — Full 20-agent ensemble snapshot for a ticker (`/v1/agents/{ticker}`)

## Local dev

```bash
# from repo root
pnpm install
cd apps/web
cp .env.example .env.local

# Start the FastAPI separately:
#   make dev                       # in another terminal at repo root
# Then:
pnpm dev                           # http://localhost:3000
```

## Deploy to Vercel

1. Import the GitHub repo in Vercel; select **`apps/web`** as the root directory.
2. Set environment variable **`NEXT_PUBLIC_API_BASE_URL`** to your deployed API URL (e.g. `https://cfp-api.up.railway.app`).
3. Vercel auto-detects Next.js + the `pnpm-workspace.yaml` at repo root. The `vercel.json` here pins the build command to `pnpm --filter @cfp/web...`.

## Stack

- **Next.js 15** app router + React 19
- **Tailwind CSS** + small in-tree shadcn-style primitives (`components/ui/`)
- **TanStack Query** for fetching (cache, retries, suspense-friendly)
- **lucide-react** icons (light usage)

## API contract

Wire types live in [`lib/types.ts`](./lib/types.ts), mirrored from the Pydantic models in `apps/api/src/cfp_api/schemas.py`. Keep them in sync — the API is versioned at `/v1/`, so adding fields is safe; renaming or removing requires bumping to `/v2/`.
