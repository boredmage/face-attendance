"""Offline-first lecturer devices: sync columns, devices, refresh tokens, sync ops, tombstones.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15
"""
import uuid

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _add_updated_at(table: str, fill_from: str | None) -> None:
    """Add a NOT NULL updated_at, filled from an existing timestamp column (or now)."""
    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))
    source = fill_from or "CURRENT_TIMESTAMP"
    op.execute(f"UPDATE {table} SET updated_at = {source}")
    with op.batch_alter_table(table) as batch:
        batch.alter_column("updated_at", existing_type=sa.DateTime(), nullable=False)
        batch.create_index(f"ix_{table}_updated_at", ["updated_at"])


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("lecturer_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("app_version", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["lecturer_id"], ["lecturers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_devices_lecturer_id", "devices", ["lecturer_id"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_refresh_tokens_device_id", "refresh_tokens", ["device_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)

    op.create_table(
        "sync_ops",
        sa.Column("op_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("op_id"),
    )
    op.create_index("ix_sync_ops_device_id", "sync_ops", ["device_id"])

    op.create_table(
        "tombstones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lecturer_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["lecturer_id"], ["lecturers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tombstones_lecturer_id", "tombstones", ["lecturer_id"])
    op.create_index("ix_tombstones_deleted_at", "tombstones", ["deleted_at"])

    # students
    with op.batch_alter_table("students") as batch:
        batch.add_column(sa.Column("embedding_model", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("face_image_paths", sa.JSON(), nullable=True))
    _add_updated_at("students", "COALESCE(face_enrolled_at, created_at)")
    _add_updated_at("courses", "created_at")
    _add_updated_at("enrollments", "joined_at")
    _add_updated_at("attendance", "marked_at")

    # class_sessions: device-generated uuid (filled for existing rows), device link, audit columns
    with op.batch_alter_table("class_sessions") as batch:
        batch.add_column(sa.Column("uuid", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("device_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("synced_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("clock_offset_seconds", sa.Float(), nullable=True))
    conn = op.get_bind()
    for (session_id,) in conn.execute(sa.text("SELECT id FROM class_sessions")).fetchall():
        conn.execute(sa.text("UPDATE class_sessions SET uuid = :u WHERE id = :i"),
                     {"u": str(uuid.uuid4()), "i": session_id})
    with op.batch_alter_table("class_sessions") as batch:
        batch.alter_column("uuid", existing_type=sa.String(length=36), nullable=False)
        batch.create_index("ix_class_sessions_uuid", ["uuid"], unique=True)
        batch.create_foreign_key("fk_class_sessions_device_id", "devices", ["device_id"], ["id"],
                                 ondelete="SET NULL")
    _add_updated_at("class_sessions", "COALESCE(ended_at, started_at)")


def downgrade() -> None:
    with op.batch_alter_table("class_sessions") as batch:
        batch.drop_index("ix_class_sessions_updated_at")
        batch.drop_constraint("fk_class_sessions_device_id", type_="foreignkey")
        batch.drop_index("ix_class_sessions_uuid")
        for col in ("updated_at", "clock_offset_seconds", "synced_at", "device_id", "uuid"):
            batch.drop_column(col)
    for table in ("attendance", "enrollments", "courses", "students"):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_updated_at")
            batch.drop_column("updated_at")
    with op.batch_alter_table("students") as batch:
        batch.drop_column("face_image_paths")
        batch.drop_column("embedding_model")
    for table in ("tombstones", "sync_ops", "refresh_tokens", "devices"):
        op.drop_table(table)
