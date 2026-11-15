"""Row-level security tests on a real Postgres.

These run the migration in `db/migrations` and then act as two different
signed-in users, and as a guest, with plain SQL. They are skipped unless
HETU_TEST_DATABASE_URL points at a disposable local Postgres where the
connecting role may create roles. Never point it at Neon.

Locally, `auth.user_id()` comes from `db/test/neon_stand_in.sql`, which reads
the `sub` claim the way Neon's documented fallback does. On Neon the Data API
supplies the function after verifying the token. `scripts/check_isolation.py`
covers that path end to end.
"""

import json
import os
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

DATABASE_URL = os.environ.get("HETU_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="HETU_TEST_DATABASE_URL is not set")

ROOT = Path(__file__).resolve().parents[2]
STAND_IN = ROOT / "db" / "test" / "neon_stand_in.sql"
MIGRATIONS = sorted((ROOT / "db" / "migrations").glob("*.sql"))
TABLES = ["messages", "learning_states", "conversations", "workspaces", "profiles"]

ALICE = "user-alice"
BOB = "user-bob"


@pytest.fixture(scope="module")
def database():
    """A fresh database with the stand-in and every migration applied."""
    name = f"hetu_rls_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(DATABASE_URL, autocommit=True) as admin:
        admin.execute(f"create database {name}")
    url = DATABASE_URL.rsplit("/", 1)[0] + f"/{name}"
    try:
        with psycopg.connect(url, autocommit=True) as setup:
            exists = setup.execute("select 1 from pg_roles where rolname = 'authenticated'").fetchone()
            stand_in = STAND_IN.read_text()
            if exists:
                # Roles are cluster-wide, so a second run only needs the schema and function.
                stand_in = "\n".join(line for line in stand_in.splitlines() if not line.startswith("create role"))
            setup.execute(stand_in)
            for migration in MIGRATIONS:
                setup.execute(migration.read_text())
        yield url
    finally:
        with psycopg.connect(DATABASE_URL, autocommit=True) as admin:
            admin.execute(f"drop database if exists {name} with (force)")


class Session:
    """One connection that acts as a given user through the authenticated role."""

    def __init__(self, url: str, user: str | None, role: str = "authenticated"):
        self.connection = psycopg.connect(url, autocommit=True)
        self.connection.execute(f"set role {role}")
        claims = json.dumps({"sub": user, "role": role}) if user else ""
        self.connection.execute("select set_config('request.jwt.claims', %s, false)", [claims])

    def run(self, sql: str, params=()):
        return self.connection.execute(sql, params)

    def rows(self, sql: str, params=()):
        return self.run(sql, params).fetchall()

    def close(self):
        self.connection.close()


@pytest.fixture
def as_user(database):
    sessions = []

    def open_session(user: str | None, role: str = "authenticated") -> Session:
        session = Session(database, user, role)
        sessions.append(session)
        return session

    yield open_session
    for session in sessions:
        session.close()
    with psycopg.connect(database, autocommit=True) as owner:
        for table in TABLES:
            owner.execute(f"delete from public.{table}")


def alice_has_a_conversation(as_user) -> str:
    alice = as_user(ALICE)
    conversation = alice.rows("insert into conversations (title) values ('Parity proofs') returning id")[0][0]
    alice.run(
        "insert into messages (conversation_id, role, content) values (%s, 'student', 'Is my proof right?')",
        [conversation],
    )
    alice.run(
        "insert into learning_states (conversation_id, state) values (%s, %s)",
        [conversation, json.dumps({"topic": "parity"})],
    )
    alice.run("insert into workspaces (problem, draft) values ('Prove it', 'My draft')")
    alice.run("insert into profiles (display_name) values ('Alice')")
    return conversation


def test_a_user_sees_their_own_rows_and_owner_is_set_by_the_server(as_user):
    conversation = alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    assert alice.rows("select id, user_id from conversations") == [(conversation, ALICE)]
    assert alice.rows("select content from messages") == [("Is my proof right?",)]
    assert alice.rows("select draft from workspaces") == [("My draft",)]


@pytest.mark.parametrize("table", TABLES)
def test_another_user_cannot_read_any_of_it(as_user, table):
    alice_has_a_conversation(as_user)
    bob = as_user(BOB)
    assert bob.rows(f"select * from {table}") == []


def test_another_user_cannot_change_or_delete_it(as_user):
    conversation = alice_has_a_conversation(as_user)
    bob = as_user(BOB)

    assert bob.run("update conversations set title = 'mine now' where id = %s", [conversation]).rowcount == 0
    assert bob.run("delete from conversations where id = %s", [conversation]).rowcount == 0
    assert bob.run("delete from messages where conversation_id = %s", [conversation]).rowcount == 0
    assert bob.run("update workspaces set draft = 'gone' where user_id = %s", [ALICE]).rowcount == 0
    assert bob.run("delete from profiles where user_id = %s", [ALICE]).rowcount == 0

    alice = as_user(ALICE)
    assert alice.rows("select title from conversations") == [("Parity proofs",)]
    assert alice.rows("select count(*) from messages") == [(1,)]
    assert alice.rows("select draft from workspaces") == [("My draft",)]


def test_a_user_cannot_write_rows_in_someone_elses_name(as_user):
    bob = as_user(BOB)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        bob.run("insert into conversations (user_id, title) values (%s, 'forged')", [ALICE])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        bob.run("insert into workspaces (user_id, draft) values (%s, 'forged')", [ALICE])


def test_a_user_cannot_add_messages_or_notes_to_someone_elses_conversation(as_user):
    conversation = alice_has_a_conversation(as_user)
    bob = as_user(BOB)
    # Bob's own id on the row passes the policy, but the conversation is not his.
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        bob.run(
            "insert into messages (conversation_id, role, content) values (%s, 'hetu', 'injected')",
            [conversation],
        )
    # Alice's notes already use this key, so the insert fails on that or on the owner check.
    with pytest.raises(psycopg.errors.IntegrityError):
        bob.run("insert into learning_states (conversation_id, state) values (%s, '{}')", [conversation])
    # An upsert would reach Alice's row through the update path, which her policy hides from Bob.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        bob.run(
            "insert into learning_states (conversation_id, state) values (%s, '{}') "
            "on conflict (conversation_id) do update set state = excluded.state",
            [conversation],
        )
    alice = as_user(ALICE)
    assert alice.rows("select count(*) from messages") == [(1,)]
    assert alice.rows("select state ->> 'topic' from learning_states") == [("parity",)]


def test_ownership_cannot_be_handed_over(as_user):
    conversation = alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        alice.run("update conversations set user_id = %s where id = %s", [BOB, conversation])


def test_messages_cannot_be_edited(as_user):
    alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        alice.run("update messages set content = 'rewritten'")


def test_a_guest_has_no_access_at_all(as_user):
    alice_has_a_conversation(as_user)
    guest = as_user(None, role="anonymous")
    for table in TABLES:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            guest.rows(f"select * from {table}")


def test_a_signed_in_role_without_an_identity_sees_nothing(as_user):
    alice_has_a_conversation(as_user)
    nobody = as_user(None)
    for table in TABLES:
        assert nobody.rows(f"select * from {table}") == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        nobody.run("insert into conversations (title) values ('no owner')")


def test_deleting_a_conversation_removes_its_messages_and_notes(as_user):
    conversation = alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    alice.run("delete from conversations where id = %s", [conversation])
    assert alice.rows("select count(*) from messages") == [(0,)]
    assert alice.rows("select count(*) from learning_states") == [(0,)]


def test_a_new_message_marks_the_conversation_as_recently_used(as_user):
    conversation = alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    before = alice.rows("select updated_at from conversations")[0][0]
    alice.run("insert into messages (conversation_id, role, content) values (%s, 'hetu', 'Look at step 2.')", [conversation])
    assert alice.rows("select updated_at from conversations")[0][0] > before


def test_oversized_content_is_rejected(as_user):
    conversation = alice_has_a_conversation(as_user)
    alice = as_user(ALICE)
    with pytest.raises(psycopg.errors.CheckViolation):
        alice.run(
            "insert into messages (conversation_id, role, content) values (%s, 'student', %s)",
            [conversation, "x" * 20001],
        )
