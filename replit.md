# Microtask Manager

An AI-powered micro tasks automation manager — a productivity tool for tracking and syncing microtask work across external platforms.

## Stack

- **Backend**: FastAPI (Python 3.11) served on port 5000
- **Frontend**: React + TypeScript + Tailwind CSS, pre-built into `frontend/dist/`
- **Storage**: IndexedDB (client-side browser storage — no server-side database required)
- **Browser sessions**: Playwright/Chromium (headless) for login sessions on external microtask sites

## How to run

The workflow `Start application` starts the server:

```
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000 --reload
```

The FastAPI backend serves the pre-built frontend from `frontend/dist/` at the root URL.

## Backend overview

- `backend/main.py` — FastAPI app entry point; serves the frontend and API routes
- `backend/routers/sync.py` — HTTP proxy for syncing external microtask site data
- `backend/routers/auth_browser.py` — Playwright-based browser session login API
- `backend/services/browser_session.py` — Headless Chromium session management

## Frontend overview

- Built with Vite; source in `frontend/src/`
- To rebuild after frontend changes: `cd frontend && npm run build`
- All app data stored in browser IndexedDB (no backend database needed)

## Notes

- Playwright Chromium is installed at `.cache/ms-playwright/`
- This is a **productivity tool only** — it does not automate task completion or submission on behalf of users
- The `SESSION_SECRET` environment secret is available for use
