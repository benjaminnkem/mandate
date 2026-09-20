# Mandate — Codex MCP and Skills Setup

This file is intentionally tool-oriented. Run the commands only after checking current installation documentation for the local Codex version.

## 1. Required/recommended tools

### Solana Developer MCP

Official endpoint:

```text
https://mcp.solana.com/mcp
```

Suggested Codex registration discovered in official docs:

```bash
codex mcp add solana-mcp --url https://mcp.solana.com/mcp
```

Use it for:

- current Solana documentation search;
- current SDK patterns;
- transaction/account debugging;
- program guidance;
- `program_autofixer`/current equivalent where useful.

Do not let the MCP blindly rewrite settlement-critical code. Review every change.

### Official Solana developer skill

Official repository:

```text
https://github.com/solana-foundation/solana-dev-skill
```

Suggested installation:

```bash
npx skills add https://github.com/solana-foundation/solana-dev-skill
```

Read the installed skill before beginning program/client work.

### Surfpool

Install the current Surfpool CLI following official docs:

```text
https://docs.surfpool.run/
```

Surfpool can expose MCP capabilities via the current equivalent of:

```bash
surfpool mcp
```

Use it for mainnet-fork inspection/testing, not as a production RPC.

### GitHub MCP / connector

Useful for:

- reading current sponsor SDK repos/examples;
- opening exact source code at pinned commits;
- creating/reviewing PRs;
- checking CI failures.

Do not copy code from unrelated hackathon submissions. Competitor repositories are research evidence, not a code source.

---

## 2. Direct documentation and data sources

Beyond the MCP servers, keep these authoritative sources open while working:

```text
https://prestocks.com/api/prestocks
https://prestocks.com/
https://hackathons.solana.com/hackathons/stocklana
```

### Helpful optional skills

If available in the engineering environment:

- PostgreSQL/Prisma migration skill;
- security/audit skill for Anchor/Rust;
- Playwright browser testing skill;
- GitHub Actions/CI skill.

No skill should be allowed to introduce fake data into production runtime paths.

---

## 3. Venue and sponsor tooling

### Meteora documentation MCP

Official endpoint:

```text
https://docs.meteora.ag/mcp
```

Suggested Codex registration:

```bash
codex mcp add meteora-docs --url https://docs.meteora.ag/mcp
```

Also make the LLM index available:

```text
https://docs.meteora.ag/llms.txt
```

The docs MCP exposes a Meteora skill/resource. Use it before implementing:

- DLMM pool reads/quotes/positions;
- DAMM v2 state/quotes/positions;
- DBC config/launch/migration, only if pursuing the optional DBC phase.

### Clawpump — only after eligibility gate

Remote launchpad MCP:

```text
https://clawpump.tech/api/mcp
```

Agent MCP package can be run using the current Clawpump instructions. During research, docs showed patterns similar to:

```bash
npx @clawpump/agents --claude
```

For Codex/generic MCP clients, configure it as a stdio server with `CLAWPUMP_API_KEY` in the environment rather than putting the key in prompts or committed configuration.

Before installing into the production workflow:

- read current Clawpump docs;
- confirm `/pump-pairs` eligibility;
- confirm wallet/creator custody semantics;
- confirm which operations are non-idempotent;
- confirm exact Stocklana bounty requirements.

If any of those fails, keep the Clawpump package out of the critical path.

---

## 4. Documentation discipline for Codex

At the beginning of **every staged build prompt**, Codex should:

1. read `AGENTS.md`, `docs/PRD.md`, `docs/TECHNICAL_SPEC.md` and the current step;
2. search current official docs for external APIs touched in that step;
3. state any documentation conflict before coding;
4. pin dependency versions in lockfiles;
5. record key external assumptions in `docs/adr/` as ADRs when material;
6. run relevant tests before ending the step;
7. summarize exactly what changed and what remains intentionally incomplete.

### Do not allow Codex to

- invent an endpoint because a docs page was unavailable;
- silently substitute a competing sponsor/product;
- claim a mainnet transaction was executed when it was simulated/forked;
- use an old deprecated SDK without documenting why;
- put secrets in source, screenshots, prompts, CI logs or sample `.env` values;
- use `number` for exact token settlement amounts;
- bypass onchain validation because “the frontend already checks it.”

---

## 5. Recommended local command hygiene

Create a project-local `docs/research/` directory and save dated notes such as:

```text
docs/research/2026-09-20-prestocks-api.md
docs/research/2026-09-20-token2022-mint-inspection.md
docs/research/2026-09-20-meteora-pool-selection.md
docs/research/2026-09-20-clawpump-eligibility.md
```

Every note should include:

- source URL;
- checked timestamp;
- exact conclusion used by code;
- unresolved uncertainty;
- whether the source is normative or merely informative.

This makes later agent sessions much less likely to hallucinate old assumptions.

