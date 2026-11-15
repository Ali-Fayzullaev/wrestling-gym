#!/usr/bin/env bash
# Dumps the data a restore needs into <out_dir>:
#   public.dump  all data of the app schema (the schema itself comes from supabase/migrations)
#   auth.dump    auth.users and auth.identities: staff rows point at them, passwords stay hashed
#   counts.tsv   rows per table, checked after a restore
# Usage: DATABASE_URL=postgresql://... scripts/backup/dump.sh <out_dir>
set -euo pipefail

out_dir="${1:?usage: dump.sh <out_dir>}"
: "${DATABASE_URL:?set DATABASE_URL}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out_dir"

pg_dump "$DATABASE_URL" --data-only --format=custom --no-owner --no-privileges \
  --schema=public --file="$out_dir/public.dump"
pg_dump "$DATABASE_URL" --data-only --format=custom --no-owner --no-privileges \
  --table=auth.users --table=auth.identities --file="$out_dir/auth.dump"
psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --field-separator=$'\t' \
  --set=ON_ERROR_STOP=1 --file="$here/row-counts.sql" > "$out_dir/counts.tsv"

# Table names and counts only: safe to show in the job log.
cat "$out_dir/counts.tsv"
