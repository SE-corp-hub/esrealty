#!/usr/bin/env bash
# Database tests: builds a fresh database from the baseline on a plain Postgres
# and runs every tests/db/test_*.sql. Uses the usual PG* environment variables
# (PGHOST, PGPORT, PGUSER, PGPASSWORD); the user must be able to create roles
# and databases. Usage: bash tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${DB_NAME:-sea_ci}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
export PGDATABASE="$DB"
psql -v ON_ERROR_STOP=1 -q -f tests/db/00_supabase_stub.sql 2>&1 | grep -v NOTICE || true
psql -v ON_ERROR_STOP=1 -q -f supabase/migrations/0000_baseline.sql > /dev/null
for m in $(ls supabase/migrations/*.sql | grep -v 0000_baseline.sql || true); do
  echo "migration $m"; psql -v ON_ERROR_STOP=1 -q -f "$m" > /dev/null
done
psql -v ON_ERROR_STOP=1 -q -f tests/db/10_fixture.sql > /dev/null
fail=0; total=0
for t in tests/db/test_*.sql; do
  out=$(psql -v ON_ERROR_STOP=1 -q -f "$t" 2>&1) || { echo "ERROR in $t"; echo "$out" | tail -5; fail=1; continue; }
  echo "== $t"; echo "$out" | grep -E "^(PASS|FAIL)|passed$" | grep -v "^PASS" || true
  if echo "$out" | grep -q "^FAIL"; then fail=1; fi
  n=$(echo "$out" | grep -c "^PASS" || true); total=$((total + n))
done
echo "database tests: $total checks passed"
exit $fail
