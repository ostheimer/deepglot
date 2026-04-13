# Self-Hosting Deepglot

Deepglot can run as a standalone Docker Compose stack with the Next.js app and PostgreSQL on a single host.

## Prerequisites

- Docker 28 or newer
- Docker Compose

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

## Production notes

- Set `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the public HTTPS origin before exposing the app.
- Replace the placeholder Stripe keys before using billing features.
- Switch `TRANSLATION_PROVIDER` to `openai` or `deepl` only after the corresponding API key is configured.
- Back up the `postgres_data` volume or move PostgreSQL to managed infrastructure before relying on the instance for production data.
