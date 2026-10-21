"""
Key member email identities by email_identity (lower-case local part, no "+tag").

Before this, Bob@example.org, bob@example.org and bob+ai@example.org were three members. Each row of
email_identities is moved to the key of its address's identity form. Rows of erased members hold no
address and keep their key; the server still checks it, so the erased address stays blocked.

When two rows name one identity in one organization, the row of the only active member takes the
key and the others keep theirs (they can no longer be found by email, and their data stays). When
several of those members are active, or an erased member's row already holds the key, the merge
needs a person's decision: the migration stops, changes nothing and lists the members concerned.
Resolve those (for example erase or suspend the duplicate in the admin People page with the previous
release) and run it again.
"""

import hashlib
import hmac
import json
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    metadata = sa.MetaData()
    identities = sa.Table("email_identities", metadata, autoload_with=connection)
    members = sa.Table("memberships", metadata, autoload_with=connection)
    rows = connection.execute(
        sa.select(identities.c.id, identities.c.tenant, identities.c.owner, identities.c.data)
    ).all()
    addressed = [row for row in rows if (row.data or {}).get("email")]
    if addressed:
        rekey(connection, identities, members, rows, addressed)
    op.execute("UPDATE transaction_guard SET schema_version = 14 WHERE id = 1")


def rekey(connection, identities, members, rows, addressed):
    from cryptography.fernet import Fernet

    from aift.config import Settings
    from aift.security import email_identity

    settings = Settings.from_environment()
    cipher = Fernet(settings.encryption_key.encode())

    def keyed(scope, value):
        # The same keyed lookup as aift.security.Secrets.keyed, without needing the IP keyring.
        return hmac.new(
            settings.lookup_key.encode(), (scope + "\0" + value).encode(), hashlib.sha256
        ).hexdigest()

    status = {
        (tenant, member_id): (state, data.get("created_at") or "")
        for tenant, member_id, state, data in connection.execute(
            sa.select(members.c.tenant, members.c.id, members.c.status, members.c.data)
        )
    }
    groups = defaultdict(list)
    for row in addressed:
        address = json.loads(cipher.decrypt(row.data["email"].encode()))
        groups[(row.tenant, keyed("email:" + row.tenant, email_identity(address)))].append(row)
    taken = {row.id: row for row in rows}
    moves, conflicts = [], []
    for (tenant, key), group in groups.items():
        states = [status.get((tenant, row.owner), ("missing", "")) for row in group]
        active = [row for row, (state, _) in zip(group, states, strict=True) if state == "active"]
        if len(active) > 1:
            conflicts.append((tenant, "several active members share one email identity", group))
            continue
        chosen = (
            active[0] if active else min(group, key=lambda row: status.get((tenant, row.owner), ("", ""))[1])
        )
        holder = taken.get(key)
        if holder is not None and holder not in group:
            conflicts.append((tenant, "an erased member's row already holds the identity", [holder, *group]))
            continue
        if chosen.id != key:
            if holder is not None:
                # Another row of this group holds the key: it gives way to the chosen row.
                moves.append((holder.id, holder.id + ":merged"))
            moves.append((chosen.id, key))
    if conflicts:
        report = "\n".join(
            f"- organization {tenant}: {reason}; member ids "
            + ", ".join(
                f"{row.owner} ({status.get((tenant, row.owner), ('missing', ''))[0]})" for row in group
            )
            for tenant, reason, group in conflicts
        )
        raise RuntimeError(
            "Migration 0014 stopped without changes. These email identities need a decision before "
            "they can be merged:\n" + report
        )
    for old, new in moves:
        connection.execute(identities.update().where(identities.c.id == old).values(id=new))


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
