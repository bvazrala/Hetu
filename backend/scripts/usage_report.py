"""Report how much of the Neon Free plan's storage Hetu uses.

Run it from the backend directory with the owner connection string in
DATABASE_URL, in the environment or backend/.env:

    uv run python -m scripts.usage_report

It reads sizes and row counts with SQL and changes nothing. The sizes are
the database's own measure. Neon also counts history kept for restores, so
the Console's number can be higher; the Console is the authority. Compute
hours are not visible from SQL; see Monitoring and Billing in the Console.
"""

import argparse
import os
import sys

import psycopg

from app.config import BACKEND_DIR  # noqa: F401  loads backend/.env

TABLES = ["conversations", "messages", "learning_states", "workspaces", "profiles"]


def human(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:,.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size} B"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit-gb", type=float, default=1.0, help="Storage allowed by your plan, in GB. Default 1.")
    parser.add_argument("--warn-at", type=float, default=0.8, help="Warn above this share of the limit. Default 0.8.")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Set DATABASE_URL to the Neon owner connection string, in the environment or backend/.env.")
        return 2

    with psycopg.connect(url) as connection:
        total = connection.execute("select pg_database_size(current_database())").fetchone()[0]
        print(f"Database size: {human(total)} of {args.limit_gb:g} GB ({total / (args.limit_gb * 1024**3):.1%})\n")
        print(f"{'table':<18}{'rows':>10}{'size':>12}")
        for table in TABLES:
            rows, size = connection.execute(
                f"select count(*), pg_total_relation_size('public.{table}') from public.{table}"
            ).fetchone()
            print(f"{table:<18}{rows:>10,}{human(size):>12}")
        users = connection.execute("select count(distinct user_id) from public.conversations").fetchone()[0]
        auth = connection.execute(
            "select coalesce(sum(pg_total_relation_size(format('%I.%I', schemaname, tablename))), 0) "
            "from pg_tables where schemaname = 'neon_auth'"
        ).fetchone()[0]
        print(f"\nUsers with saved conversations: {users:,}")
        print(f"Neon Auth tables: {human(auth)}")

    if total > args.warn_at * args.limit_gb * 1024**3:
        print(f"\nWARNING: above {args.warn_at:.0%} of the storage limit. At the limit, writes stop until space is freed.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
