from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cfp_api import __version__
from cfp_api.db import check_db_connection, close_pool, init_pool
from cfp_api.routes import agents, chat, network, rankings, reddit, scorecard, sectors, watchlist
from cfp_api.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize the asyncpg pool on startup; close on shutdown.
    await init_pool(settings.database_url)
    yield
    await close_pool()


app = FastAPI(title="Bellwether API", version=__version__, lifespan=lifespan)

# CORS — Vercel deployments live on different origins. Allow all in dev;
# tighten to specific origins in prod via settings.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(rankings.router)
app.include_router(watchlist.router)
app.include_router(agents.router)
app.include_router(chat.router)
app.include_router(scorecard.router)
app.include_router(sectors.router)
app.include_router(network.router)
app.include_router(reddit.router)


@app.get("/")
async def root() -> dict:
    return {
        "service": "capital-flow-predictor-api",
        "version": __version__,
        "status": "ok",
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/healthz/db")
async def healthz_db():
    ok, detail = await check_db_connection(settings.database_url)
    if not ok:
        return JSONResponse(status_code=503, content={"status": "error", "detail": detail})
    return {"status": "ok"}
