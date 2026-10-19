"""mined cards (Cyber Miner extension)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-16 10:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('minedcard',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('session_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
    sa.Column('site', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('source_title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('word', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('anki_note_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['project_id'], ['project.id'], ),
    sa.ForeignKeyConstraint(['session_id'], ['session.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('minedcard', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_minedcard_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_minedcard_project_id'), ['project_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('minedcard', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_minedcard_project_id'))
        batch_op.drop_index(batch_op.f('ix_minedcard_created_at'))

    op.drop_table('minedcard')
