# Microtask Manager

A professional, cross-platform productivity dashboard for managing work across multiple microtask websites from a single interface.

> ⚠️ **This tool is a productivity organizer only.** It does NOT automate, submit, or falsely complete any tasks. All task completions require explicit user confirmation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy ORM |
| Database | SQLite (local file: `microtask_manager.db`) |
| Encryption | Fernet symmetric encryption (cryptography library) |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Browser nav | Playwright (navigation only) |

---

## Project Structure

```
microtask-manager/
├── backend/
│   ├── main.py              # FastAPI app, static file serving
│   ├── database.py          # SQLite engine + session
│   ├── models.py            # SQLAlchemy ORM models
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── security.py          # Fernet credential encryption
│   ├── routers/
│   │   ├── websites.py      # Website + folder CRUD
│   │   ├── credentials.py   # Encrypted credential management
│   │   ├── tasks.py         # Task CRUD + status management
│   │   ├── reports.py       # Stats, charts, CSV/Excel export
│   │   ├── notifications.py # Notification CRUD
│   │   ├── settings.py      # App settings, backup/restore
│   │   └── browser.py       # URL navigation helper
│   ├── services/
│   │   └── activity.py      # Activity log writer
│   └── plugins/
│       ├── base.py          # BaseAdapter abstract class
│       ├── registry.py      # Plugin registry
│       └── adapters/
│           └── generic.py   # Generic URL navigator (default)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Dashboard, Tasks, Websites, Reports, Settings, Notifications
│   │   ├── components/      # Layout, Sidebar, Modal, Badge, StatCard, EmptyState, ConfirmDialog
│   │   ├── api/client.ts    # Axios API client + TypeScript types
│   │   └── hooks/           # useSettings hook
│   ├── dist/                # Built frontend (served by FastAPI)
│   └── vite.config.ts       # Vite config with /api proxy
├── backups/                 # Auto-created on backup
├── microtask_manager.db     # SQLite database (auto-created)
├── .encryption.key          # Fernet encryption key (auto-created, keep secret)
└── replit.md
```

---

## How to Run

### Production (default workflow)
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000 --reload
```
The FastAPI backend serves the pre-built React frontend at port 5000.

### Development (hot-reload both)
```bash
# Terminal 1 — backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend (proxies /api to :8000)
cd frontend && npm run dev
```

### Rebuild frontend
```bash
cd frontend && npm run build
```

---

## Key Features

1. **Dashboard** — earnings, task counts, 14-day charts, recent activity
2. **Website Manager** — add sites with login/dashboard URLs, organize into folders, enable/disable
3. **Credential Manager** — encrypted password storage, one-click copy, reveal on demand
4. **Task Manager** — create/edit tasks with category, status, reward tracking; search/filter/sort
5. **Reports** — 30-day earnings trend, breakdown by website and category, CSV + Excel export
6. **Notifications** — read/unread management, badge count in sidebar
7. **Settings** — database backup/restore, plugin list, security info, settings JSON export
8. **Plugin Architecture** — add new site adapters in `backend/plugins/adapters/`, register in `backend/plugins/registry.py`

---

## Security Notes

- Credentials are encrypted with **Fernet** before storing in SQLite
- The encryption key lives in `.encryption.key` — never commit or share this file
- All data is stored **locally** — no external services or cloud databases
- Password reveal requires an explicit API call; passwords are never returned in list endpoints

---

## Adding a Website Plugin

1. Create `backend/plugins/adapters/mysite.py` extending `BaseAdapter`
2. Set `plugin_id`, `plugin_name`, `plugin_description` class attributes
3. Implement `navigate_to_login(page)` and `navigate_to_dashboard(page)`
4. Import and register it in `backend/plugins/registry.py`

---

## User Preferences

- Dark UI by default
- Local SQLite database only (no external DB)
- All credential encryption is automatic — no user configuration needed
