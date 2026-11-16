#!/usr/bin/env bash
# Restores a dump made by dump.sh into a database that already has the schema from
# supabase/migrations and no data (a new Supabase project after `supabase db push`, or a local
# `supabase db reset --no-seed`). Then compares rows per table with counts.tsv and fails on any
# difference.
# Usage: DATABASE_URL=postgresql://... scripts/backup/restore.sh <dump_dir>
set -euo pipefail

dump_dir="${1:?usage: restore.sh <dump_dir>}"
: "${DATABASE_URL:?set DATABASE_URL}"
here="$(cd "$(dirname "$0")" && pwd)"

# One transaction: a failed restore leaves the database as it was. Replica mode skips foreign-key
# and append-only triggers while rows arrive in any order; Supabase lets the postgres role SET it
# inside a session (not as a connection option).
{
  echo "set session_replication_role = replica;"
  cat "$here/prepare-restore.sql"
  pg_restore --data-only --no-owner --no-privileges --file=- "$dump_dir/auth.dump"
  pg_restore --data-only --no-owner --no-privileges --file=- "$dump_dir/public.dump"
} | psql "$DATABASE_URL" --no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 > /dev/null

actual="$(mktemp)"
trap 'rm -f "$actual"' EXIT
psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --field-separator=$'\t' \
  --set=ON_ERROR_STOP=1 --file="$here/row-counts.sql" > "$actual"

# Table names only, never counts: the job log of a public repository is public.
mismatched="$(awk -F '\t' '
  NR == FNR { expected[$1] = $2; next }
  { restored[$1] = $2 }
  END {
    for (t in expected) if (!(t in restored) || expected[t] != restored[t]) print t
    for (t in restored) if (!(t in expected)) print t
  }' "$dump_dir/counts.tsv" "$actual" | sort)"
if [ -z "$mismatched" ]; then
  echo "Restore verified: every table has the same number of rows as in the backup."
else
  echo "Restore differs from the backup in these tables:" >&2
  echo "$mismatched" >&2
  exit 1
fi
