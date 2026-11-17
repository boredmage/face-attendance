"""Email confirmation: sign-ups wait in pending_registrations until their emailed code is entered.

Existing accounts are untouched: they were created before confirmation existed and keep working.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_registrations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("login_key", sa.String(length=120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("code_sent_at", sa.DateTime(), nullable=False),
        sa.Column("code_expires_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role", "email"),
    )
    op.create_index("ix_pending_registrations_login_key", "pending_registrations", ["login_key"])
    op.create_index("ix_pending_registrations_expires_at", "pending_registrations", ["expires_at"])


def downgrade() -> None:
    op.drop_table("pending_registrations")
