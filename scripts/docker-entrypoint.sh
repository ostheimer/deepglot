#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required."
  exit 1
fi

echo "Waiting for PostgreSQL..."
until node -e "const { Client } = require('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL }); client.connect().then(() => client.end()).then(() => process.exit(0)).catch(() => process.exit(1));" >/dev/null 2>&1; do
  sleep 2
done

echo "Applying Prisma schema..."
npx prisma db push

exec npm run start
