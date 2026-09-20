# ADR 0003: Database and queue

- Status: accepted
- Date: 2026-09-20

## Decision

- **PostgreSQL** is the read model. **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`) rather than Prisma: SQL-first migrations that are easy to review, no code-generation step or query engine binary, and precise control over `numeric`/`bigint` columns. All USDC/raw token amounts are stored as `numeric(39,0)` (or `bigint` where bounded) and handled as `bigint` in TypeScript; never `number`.
- **Redis + BullMQ** for the scheduler queue. Job keys follow TECHNICAL_SPEC section 14 (`observe:<mandate>:<epoch>:<observer>` etc.) and every job is idempotent.
- Chain accounts, events and signatures overwrite derived DB state, never the reverse. A destructive rebuild from chain plus the evidence store must always be possible (Prompt 11 proves it).

## Consequences

The schema lands in Prompt 11. Until then `packages/db` is a shell and no service touches a database.
