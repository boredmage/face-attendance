"""Bring the database schema up to date with Alembic (run on start-up and by the seed script).

Databases created before migrations existed (by the old `create_all()` start-up) have the
tables but no `alembic_version`; they are stamped at the baseline revision first.
"""
import logging
import os

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from .database import engine

log = logging.getLogger(__name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = "0001"


def _config() -> Config:
    cfg = Config(os.path.join(_BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(_BACKEND_DIR, "migrations"))
    return cfg


def upgrade_db() -> None:
    cfg = _config()
    with engine.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        cfg.attributes["connection"] = connection
        if "alembic_version" not in tables and "students" in tables:
            log.info("existing database without migrations: stamping baseline %s", BASELINE)
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
