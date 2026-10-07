# Contributing

This guide tells you how to set up the site, check a change, and send it for review.

## Prerequisites

- Node.js 22 and npm
- Docker or Podman, for PostgreSQL
- Git

## Set up a development environment

1. Install the dependencies:

   ```bash
   npm ci
   ```

2. Copy the example configuration file:

   ```bash
   cp .env.example .env.local
   ```

3. In `.env.local`, set `BETTER_AUTH_SECRET` and `PRINTQ_CRON_SECRET` to random values. To make a value, run `openssl rand -hex 32`.
4. Start PostgreSQL:

   ```bash
   docker compose -f deploy/printq/docker-compose.dev.yml up -d
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open http://localhost:3000/printing.

When the server starts, it applies the database migrations. It also adds the printer, placeholder lab hours, and demo data. The `.env.example` file explains each variable.

To run the full site in containers instead, see [Run the site with Docker](docs/printq/DOCKER.md).

### Sanity content

The announcement, event, and executive pages read their content from Sanity. These pages work only with the real `NEXT_PUBLIC_SANITY_PROJECT_ID`. The project ID is public. The CSA executives can give you a write token for `SANITY_API_WRITE_TOKEN`. The Sanity Studio is at `/studio`.

## Check a change

Run these commands before you send a change. The CI runs the same checks on each pull request.

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` runs the unit tests. To also run the database tests, set `PRINTQ_TEST_DATABASE_URL` to a separate database.

> **Warning:** The database tests delete all PrintQ data in the database that `PRINTQ_TEST_DATABASE_URL` names. Don't use your development database.

1. Create the test database:

   ```bash
   docker compose -f deploy/printq/docker-compose.dev.yml exec postgres createdb -U printq printq_test
   ```

2. Apply the migrations to the test database:

   ```bash
   DATABASE_URL=postgres://printq:printq@localhost:5432/printq_test npm run db:migrate
   ```

3. Run the tests:

   ```bash
   PRINTQ_TEST_DATABASE_URL=postgres://printq:printq@localhost:5432/printq_test npm test
   ```

## Change the database schema

PrintQ keeps its tables in the `printq` schema. Drizzle ORM manages the schema.

1. Edit `app/printq/db/schema.ts`.
2. Generate a migration:

   ```bash
   npm run db:generate
   ```

3. Read the SQL file that the command creates in `drizzle/`.
4. Commit the schema change and the migration together.

The server applies new migrations when it starts. Don't edit a migration after it is on `master`.

## Send a change

1. Create a branch from `master`.
2. Make one change for each pull request.
3. Write each commit subject as `type: summary`, for example `fix: show the lab hours in Pacific time`. Use one of these types: `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`.
4. Open a pull request to `master`.
5. Make sure that the CI checks pass.

## Project layout

| Path | Contents |
|---|---|
| `app/(site)/` | The pages and API routes of the site |
| `app/(studio)/` | The Sanity Studio |
| `app/sanity/` | The Sanity schemas and queries |
| `app/printq/` | PrintQ code that is not a route: database, booking rules, Discord bot, G-code reader |
| `drizzle/` | The SQL migrations for PrintQ |
| `scripts/` | Command-line tools: database setup, demo data, Discord command registration |
| `deploy/` | Server configuration for production |
| `docs/printq/` | The PrintQ documentation |

## Configuration

The `.env.example` file lists each variable and tells you where to get its value. Keep secrets only in `.env` or `.env.local`. Git ignores these files.

PostgreSQL stores the settings that staff change in PrintQ, for example lab hours and closures. Staff change these settings on the website or in Discord, not in the environment files.

## Discord commands

The site and PrintQ share one Discord application. To add or update the `/print` and `/printstaff` commands, run:

```bash
npm run discord:register
```

The command shows the changes and does not apply them. To apply the changes, run:

```bash
npm run discord:register -- --apply
```

The script changes only the PrintQ commands. Other commands, such as `/sccroom`, stay the same.

## Write documentation

Write documentation in Simplified Technical English:

- Use one instruction in each step.
- Keep instructions to 20 words or fewer, and other sentences to 25 words or fewer.
- Use the active voice and the present tense.
- Use one name for each thing.
- Put code, commands, and file names in backticks.
