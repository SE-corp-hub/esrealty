#!/usr/bin/env bash
# Backup round trip (tools/backup.js, roadmap D1): export the test database the way the nightly job
# exports the live one, restore it into a second database built from supabase/migrations, and check
# that every table has the same rows. Uses the same PG* variables as tests/db/run.sh, after it.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${DB_NAME:-sea_ci}"
DST="${SRC}_restore"
WORK="$(mktemp -d)"
export BACKUP_PASSPHRASE="test-passphrase-not-secret"
node tests/backup_roundtrip_node.js export "$SRC" "$WORK/b.bin"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DST" -c "create database $DST"
PGDATABASE="$DST" psql -v ON_ERROR_STOP=1 -q -f tests/db/00_supabase_stub.sql > /dev/null 2>&1 || true
PGDATABASE="$DST" psql -v ON_ERROR_STOP=1 -q -f supabase/migrations/0000_baseline.sql > /dev/null
for m in $(ls supabase/migrations/*.sql | grep -v 0000_baseline.sql); do PGDATABASE="$DST" psql -v ON_ERROR_STOP=1 -q -f "$m" > /dev/null 2>&1; done
# A fresh database has the sign-up trigger's rows and seeded settings; empty every table first.
PGDATABASE="$DST" psql -v ON_ERROR_STOP=1 -q -c "set client_min_messages = warning; set session_replication_role = replica; do \$\$ declare r record; begin for r in select tablename from pg_tables where schemaname = 'public' loop execute format('truncate public.%I cascade', r.tablename); end loop; truncate auth.users cascade; end \$\$;" > /dev/null
node tools/backup.js restore "$WORK/b.bin" --sql "$WORK/restore.sql" > /dev/null
PGDATABASE="$DST" psql -v ON_ERROR_STOP=1 -q -f "$WORK/restore.sql" > /dev/null
node tests/backup_roundtrip_node.js compare "$SRC" "$DST"
rm -rf "$WORK"
