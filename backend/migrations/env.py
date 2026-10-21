"""Alembic environment: uses the app's DATABASE_URL and models."""
from alembic import context
from sqlalchemy import engine_from_config, pool

from app import models  # noqa: F401  (registers the tables on Base.metadata)
from app.config import settings
from app.database import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, render_as_batch=True,
                      literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = config.attributes.get("connection")
    if connectable is not None:
        _run(connectable)
        return
    engine = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.",
                                poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run(connection)


def _run(connection) -> None:
    # render_as_batch: SQLite can only ALTER tables by copying them
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
