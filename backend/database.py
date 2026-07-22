"""
Database configuration and session management.

Production  : PostgreSQL via DATABASE_URL environment variable (Render-managed).
Local dev   : SQLite fallback when DATABASE_URL is not set.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    # Render (and some other PaaS) may supply a legacy postgres:// URI.
    # SQLAlchemy 1.4+ requires the postgresql:// scheme.
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,   # reconnect on stale connections
        pool_recycle=300,     # recycle connections every 5 min
    )
else:
    # ── Local development: SQLite ──────────────────────────────────────────────
    _SQLITE_URL = "sqlite:///./microtask_manager.db"
    engine = create_engine(
        _SQLITE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a database session and closes it after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
