# Self-Hosting Deepglot

Deepglot can run as a standalone Docker Compose stack with the Next.js app and PostgreSQL on a single host.

## Prerequisites

- Docker 28 or newer
- Docker Compose
- Node.js 22.x (matches the `node:22-bookworm-slim` base image used in the Dockerfile)
- PostgreSQL 16 (Alpine) — provided automatically by `docker-compose.yml`

## Quick start

1. Copy the self-hosting environment file:

   ```bash
   cp .env.selfhost.example .env.selfhost
   ```

2. Generate a strong auth secret and place it in `.env.selfhost`:

   ```bash
   openssl rand -base64 32
   ```

3. Update `POSTGRES_PASSWORD` and keep `DATABASE_URL` plus `DATABASE_URL_UNPOOLED` in sync with it.

4. Build and start the stack:

   ```bash
   docker compose up --build -d
   ```

5. Open [http://localhost:3000](http://localhost:3000).

The app container waits for PostgreSQL, runs `prisma db push`, and then starts `next start`.

## Default behavior

- PostgreSQL data is stored in the `postgres_data` Docker volume.
- The default translation provider is `mock`, which keeps first boot free of external API dependencies.
- OAuth providers stay disabled until their client credentials are set.
- Stripe placeholders allow the app to boot, but billing should be considered inactive until real Stripe keys and price IDs are configured.

## Common operations

View logs:

```bash
docker compose logs -f app
```

Stop the stack:

```bash
docker compose down
```

Stop the stack and remove the PostgreSQL volume:

```bash
docker compose down -v
```

Rebuild after application changes:

```bash
docker compose up --build -d
```

## Email Configuration

Deepglot uses **Cloudflare Email Sending** for transactional emails (password reset, project invitations, word quota alerts, duplicate-subscription operational alerts).

Set these variables in your `.env.selfhost` file (the file loaded by `docker-compose.yml` via `env_file: .env.selfhost`):

```env
CLOUDFLARE_ACCOUNT_ID="your-account-id"
CLOUDFLARE_EMAIL_API_TOKEN="your-email-api-token"
EMAIL_FROM="Deepglot <noreply@yourdomain.com>"

# Optional: receive an alert when a duplicate Stripe subscription is detected
DEEPGLOT_BILLING_ALERT_EMAIL="admin@yourdomain.com"
```

Without email configuration, Deepglot functions normally but transactional emails (password reset, quota notices) will not be sent.

> Word quota alerts (90%/100%) go to the **organization owner's email address** automatically — no additional variable needed. `DEEPGLOT_BILLING_ALERT_EMAIL` is only for Stripe duplicate-subscription operational alerts.

## Production notes

- Set `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the public HTTPS origin before exposing the app.
- Replace the placeholder Stripe keys before using billing features.
- Switch `TRANSLATION_PROVIDER` to `openai` or `deepl` only after the corresponding API key is configured.
- Back up the `postgres_data` volume or move PostgreSQL to managed infrastructure before relying on the instance for production data.
