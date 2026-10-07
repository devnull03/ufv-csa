# CSA website

The website of the Computing Student Association (CSA) at the University of the Fraser Valley: [csa.ufv.ca](https://csa.ufv.ca). It includes PrintQ, the booking system for the CSA 3D printer, at `/printing`.

The site uses Next.js 15, Sanity, and PostgreSQL. DevelopsS15 started it on 2024-03-06.

## Run the site on your computer

You need Docker or Podman.

1. Copy the example configuration file:

   ```bash
   cp .env.example .env
   ```

2. In `.env`, set `BETTER_AUTH_SECRET` and `PRINTQ_CRON_SECRET` to random values. To make a value, run `openssl rand -hex 32`.
3. Start the site and the database:

   ```bash
   docker compose up --build
   ```

4. Open http://localhost:3000/printing.

PrintQ starts in demo mode, with demo accounts and no Discord connection. The pages that come from Sanity work only with the real `NEXT_PUBLIC_SANITY_PROJECT_ID`.

## More information

- To set up a development environment and send a change, see [Contributing](CONTRIBUTING.md).
- For PrintQ, see the [PrintQ documentation](docs/printq/README.md).
