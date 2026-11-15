"""Apply the database migrations in `db/migrations` that have not run yet.

Run it from the backend directory with the owner connection string in
DATABASE_URL, either in the environment or in backend/.env:

    uv run python -m scripts.migrate
    uv run python -m scripts.migrate --status

DATABASE_URL is the direct connection string from the Neon Console. It can
do anything to the database, so it belongs on your own machine only. Hetu's
API never needs it, and it must never be set on Render or in the frontend.

Applied migrations are recorded in the `hetu_meta` schema. That schema is not
granted to the `authenticated` role, so the Data API cannot reach it.
"""

import argparse
import os
import sys
from pathlib import Path

import psycopg

from app.config import BACKEND_DIR  # loads backend/.env

MIGRATIONS = BACKEND_DIR.parent / "db" / "migrations"

SETUP = """
create schema if not exists hetu_meta;
create table if not exists hetu_meta.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--status", action="store_true", help="List migrations and whether each has run. Change nothing.")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Set DATABASE_URL to the Neon owner connection string, in the environment or backend/.env.")
        return 2

    files = sorted(MIGRATIONS.glob("*.sql"))
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(SETUP)
        applied = {row[0] for row in connection.execute("select name from hetu_meta.migrations")}
        pending = [path for path in files if path.name not in applied]

        for path in files:
            print(f"{'applied' if path.name in applied else 'pending'}  {path.name}")
        if args.status or not pending:
            print("Nothing to apply." if not pending else "")
            return 0

        for path in pending:
            print(f"Applying {path.name}…")
            # Each file runs inside its own begin and commit, so a failure leaves nothing half done.
            connection.execute(path.read_text())
            connection.execute("insert into hetu_meta.migrations (name) values (%s)", [path.name])
            print(f"Applied {path.name}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
