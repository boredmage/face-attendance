"""Password reset: emailed 6-digit codes, and a token version that signs out earlier sessions.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("code_sent_at", sa.DateTime(), nullable=False),
        sa.Column("code_expires_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role", "account_id"),
    )
    op.create_index("ix_password_resets_expires_at", "password_resets", ["expires_at"])
    for table in ("students", "lecturers"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    for table in ("students", "lecturers"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("token_version")
    op.drop_table("password_resets")
