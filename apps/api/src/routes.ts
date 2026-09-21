import {
  getEvidence,
  getMandate,
  getMarketByPool,
  getPositionSet,
  latestMarketResult,
  listAttestations,
  listBids,
  listEpochResults,
  listMandates,
  listMarkets,
  type JsonRecord,
  type Row,
} from "@mandate/db";
import {
  claimableRaw,
  sponsorWithdrawableRaw,
  unresolvedRewardRaw,
  vaultBalanceRaw,
  type AccountingState,
} from "@mandate/domain";
import { PrestocksApiError } from "@mandate/prestocks";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiDeps } from "./deps.ts";
import { HttpError, address, amountPair, envelope, epochIndex, limit, text } from "./http.ts";

const asRow = (r: Row): { address: string; asOfSlot: string; account: JsonRecord } => ({
  address: r.address,
  asOfSlot: r.slot,
  account: r.data,
});

const big = (v: unknown): bigint =>
  BigInt(typeof v === "string" || typeof v === "number" ? v : "0");

/** Accounting view derived from the stored counters with the same pure functions the program's tests use. */
function accountingOf(d: JsonRecord): Record<string, unknown> {
  const s: AccountingState = {
    maxRewardRaw: big(d["maxRewardRaw"]),
    acceptedRewardRaw: big(d["acceptedRewardRaw"]),
    totalEpochs: Number(d["totalEpochs"]),
    finalizedEpochs: Number(d["finalizedEpochs"]),
    compliantEpochs: Number(d["compliantEpochs"]),
    noncompliantEpochs: Number(d["noncompliantEpochs"]),
    unavailableEpochs: Number(d["unavailableEpochs"]),
    earnedRewardRaw: big(d["earnedRewardRaw"]),
    forfeitedRewardRaw: big(d["forfeitedRewardRaw"]),
    claimedRewardRaw: big(d["claimedRewardRaw"]),
    sponsorWithdrawnRaw: big(d["sponsorWithdrawnRaw"]),
  };
  const pair = (v: bigint) => amountPair(v.toString());
  try {
    return {
      deposited: pair(s.maxRewardRaw),
      accepted: pair(s.acceptedRewardRaw),
      earned: pair(s.earnedRewardRaw),
      forfeited: pair(s.forfeitedRewardRaw),
      unresolved: pair(unresolvedRewardRaw(s)),
      claimed: pair(s.claimedRewardRaw),
      claimableByProvider: pair(claimableRaw(s)),
      sponsorWithdrawn: pair(s.sponsorWithdrawnRaw),
      withdrawableBySponsor: pair(sponsorWithdrawableRaw(s)),
      expectedVault: pair(vaultBalanceRaw(s)),
    };
  } catch {
    return { error: "stored counters are inconsistent; see reconciliation" };
  }
}

async function requireMandate(deps: ApiDeps, pubkey: string): Promise<Row> {
  const row = await getMandate(deps.db, pubkey);
  if (!row) throw new HttpError(404, "mandate_not_found", `no indexed mandate ${pubkey}`);
  return row;
}

/** Group attestations by exact agreement, so a reader sees at a glance whether observers matched. */
function agreement(rows: Row[]): {
  groups: { evidenceHash: string; payloadHash: string; observers: string[] }[];
  unanimous: boolean;
} {
  const groups = new Map<
    string,
    { evidenceHash: string; payloadHash: string; observers: string[] }
  >();
  for (const r of rows) {
    const d = r.data;
    const key = JSON.stringify([
      d["payloadHash"],
      d["evidenceHash"],
      d["observedSlot"],
      d["observedUnixTs"],
      d["metrics"],
    ]);
    const g = groups.get(key) ?? {
      evidenceHash: text(d["evidenceHash"]),
      payloadHash: text(d["payloadHash"]),
      observers: [],
    };
    g.observers.push(text(d["observer"]));
    groups.set(key, g);
  }
  return { groups: [...groups.values()], unanimous: groups.size <= 1 };
}

export function registerReadRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { db } = deps;

  app.get("/v1/meta", async () => ({
    ...(await envelope(deps, { usdcMint: deps.config.usdcMint })),
  }));

  app.get("/v1/markets", async () => {
    const rows = await listMarkets(db);
    return envelope(deps, rows.map(asRow));
  });

  app.get("/v1/markets/:pool/quality", async (req) => {
    const { pool } = z.object({ pool: address }).parse(req.params);
    const market = await getMarketByPool(db, pool);
    if (!market)
      throw new HttpError(404, "market_not_found", `pool ${pool} is not an approved market`);
    const latest = await latestMarketResult(db, market.address);
    return envelope(deps, {
      pool,
      market: asRow(market),
      // The metrics are the attested, reproducible measurement of the whole pool plus the provider's registered
      // positions for one epoch. Aggregate pool metrics are not the provider's contribution: they are separate fields.
      latestAttestedEpoch: latest
        ? {
            mandate: latest.data["mandate"],
            epochIndex: latest.data["epochIndex"],
            outcome: latest.data["outcome"],
            observedUnixTs: latest.data["observedUnixTs"],
            observedSlot: latest.data["observedSlot"],
            evidenceHash: latest.data["evidenceHash"],
            payloadHash: latest.data["payloadHash"],
            aggregatePool: {
              effectiveSpreadBps: (latest.data["metrics"] as JsonRecord)["effectiveSpreadBps"],
              buyDepthQuoteRaw: (latest.data["metrics"] as JsonRecord)["poolBuyDepthQuoteRaw"],
              sellDepthQuoteRaw: (latest.data["metrics"] as JsonRecord)["poolSellDepthQuoteRaw"],
            },
            providerContribution: {
              quoteInBandRaw: (latest.data["metrics"] as JsonRecord)["providerQuoteInBandRaw"],
              baseQuoteEqInBandRaw: (latest.data["metrics"] as JsonRecord)[
                "providerBaseQuoteEqInBandRaw"
              ],
            },
          }
        : null,
      note: latest
        ? null
        : "no epoch has been attested on this market yet; the API never fabricates a quality figure",
    });
  });

  const listQuery = z.object({
    status: z
      .enum(["Bidding", "Awarded", "Active", "AwaitingFinalization", "Closed", "Cancelled"])
      .optional(),
    provider: address.optional(),
    sponsor: address.optional(),
    market: address.optional(),
    after: address.optional(),
    limit,
  });
  app.get("/v1/mandates", async (req) => {
    const q = listQuery.parse(req.query);
    const rows = await listMandates(db, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.provider ? { provider: q.provider } : {}),
      ...(q.sponsor ? { sponsor: q.sponsor } : {}),
      ...(q.market ? { market: q.market } : {}),
      ...(q.after ? { after: q.after } : {}),
      limit: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return envelope(deps, {
      mandates: page.map(asRow),
      nextAfter: rows.length > q.limit ? (page.at(-1)?.address ?? null) : null,
    });
  });

  app.get("/v1/mandates/:pubkey", async (req) => {
    const { pubkey } = z.object({ pubkey: address }).parse(req.params);
    const mandate = await requireMandate(deps, pubkey);
    const [positionSet, recon] = await Promise.all([
      getPositionSet(db, pubkey),
      db.query<{
        ok: boolean;
        checked_at: Date;
        expected_raw: string;
        actual_raw: string | null;
        findings: unknown;
      }>(
        "SELECT ok, checked_at, expected_raw, actual_raw, findings FROM vault_reconciliations WHERE mandate = $1",
        [pubkey],
      ),
    ]);
    const r = recon.rows[0];
    return envelope(deps, {
      ...asRow(mandate),
      accounting: accountingOf(mandate.data),
      positionSet: positionSet ? asRow(positionSet) : null,
      vaultReconciliation: r
        ? {
            ok: r.ok,
            checkedAt: new Date(r.checked_at).toISOString(),
            expectedRaw: r.expected_raw,
            actualRaw: r.actual_raw,
            findings: r.findings,
          }
        : null,
    });
  });

  app.get("/v1/mandates/:pubkey/bids", async (req) => {
    const { pubkey } = z.object({ pubkey: address }).parse(req.params);
    await requireMandate(deps, pubkey);
    return envelope(deps, (await listBids(db, pubkey)).map(asRow));
  });

  app.get("/v1/mandates/:pubkey/epochs", async (req) => {
    const { pubkey } = z.object({ pubkey: address }).parse(req.params);
    const mandate = await requireMandate(deps, pubkey);
    const [results, attestations] = await Promise.all([
      listEpochResults(db, pubkey),
      listAttestations(db, pubkey),
    ]);
    const total = Number(mandate.data["totalEpochs"]);
    const byEpoch = new Map<number, { result: Row | null; attestations: Row[] }>();
    for (let i = 0; i < total; i++) byEpoch.set(i, { result: null, attestations: [] });
    for (const r of results) {
      const e = byEpoch.get(Number(r.data["epochIndex"]));
      if (e) e.result = r;
    }
    for (const a of attestations) byEpoch.get(Number(a.data["epochIndex"]))?.attestations.push(a);
    return envelope(deps, {
      totalEpochs: total,
      epochs: [...byEpoch].map(([epoch, e]) => ({
        epoch,
        // "Pending" until an EpochResult exists on chain. Nothing is inferred from attestations alone.
        outcome: e.result ? e.result.data["outcome"] : "Pending",
        result: e.result ? asRow(e.result) : null,
        attestationCount: e.attestations.length,
      })),
    });
  });

  app.get("/v1/mandates/:pubkey/evidence/:epoch", async (req) => {
    const params = z.object({ pubkey: address, epoch: epochIndex }).parse(req.params);
    const mandate = await requireMandate(deps, params.pubkey);
    const [results, attestations, positionSet] = await Promise.all([
      listEpochResults(db, params.pubkey),
      listAttestations(db, params.pubkey, params.epoch),
      getPositionSet(db, params.pubkey),
    ]);
    const result = results.find((r) => Number(r.data["epochIndex"]) === params.epoch) ?? null;
    if (!result && attestations.length === 0)
      throw new HttpError(
        404,
        "evidence_not_found",
        `no attestation or result for epoch ${params.epoch}`,
      );
    const evidenceHash = text((result ?? attestations[0])?.data["evidenceHash"]);
    const record = await getEvidence(db, evidenceHash);
    const market = await db.query<{ data: JsonRecord }>(
      "SELECT data FROM markets WHERE address = $1",
      [text(mandate.data["marketConfig"])],
    );
    const m = market.rows[0]?.data;
    const base = deps.config.evidencePublicBaseUrl;
    return envelope(deps, {
      epoch: params.epoch,
      outcome: result ? result.data["outcome"] : "Pending",
      result: result ? asRow(result) : null,
      attestations: attestations.map(asRow),
      agreement: agreement(attestations),
      evidence: record
        ? {
            evidenceHash,
            payloadHash: record["payload_hash"],
            snapshotSha256: record["snapshot_sha256"],
            algorithmVersion: record["algorithm_version"],
            algorithmSourceCommit: record["source_commit"],
            lockfileSha256: record["lockfile_sha256"],
            observedSlot: record["observed_slot"],
            observedUnixTs: record["observed_unix_ts"],
            snapshotUrl: base
              ? `${base.replace(/\/$/, "")}/${evidenceHash}`
              : (record["storage_uri"] ?? null),
          }
        : {
            evidenceHash,
            note: "the evidence bundle has not been registered with this API; the on-chain hashes above still stand",
          },
      // Everything a third party needs to recompute the measurement offline and compare hashes.
      howToReproduce: {
        statement:
          "Replay the recorded snapshot through the deterministic measurement engine (packages/meteora, replayPool) with these parameters at the recorded source commit. The payload hash and metrics must match the attestations exactly.",
        parameters: {
          pool: m ? m["pool"] : null,
          baseMint: m ? m["baseMint"] : null,
          quoteMint: m ? m["quoteMint"] : null,
          provider: mandate.data["provider"],
          positions: positionSet ? positionSet.data["positions"] : null,
          probeQuoteRaw: mandate.data["probeQuoteRaw"],
          depthBandBps: mandate.data["depthBandBps"],
          algorithmVersion: mandate.data["algorithmVersion"],
        },
        expected: {
          payloadHash: (result ?? attestations[0])?.data["payloadHash"] ?? null,
          evidenceHash,
          metrics: (result ?? attestations[0])?.data["metrics"] ?? null,
        },
      },
    });
  });

  app.get("/v1/provider/:wallet/mandates", async (req) => {
    const { wallet } = z.object({ wallet: address }).parse(req.params);
    const q = z.object({ limit, after: address.optional() }).parse(req.query);
    const rows = await listMandates(db, {
      provider: wallet,
      ...(q.after ? { after: q.after } : {}),
      limit: q.limit,
    });
    return envelope(
      deps,
      rows.map((r) => ({ ...asRow(r), accounting: accountingOf(r.data) })),
    );
  });

  app.get("/v1/prestocks", async () => {
    try {
      const snapshot = await deps.prestocks.getSnapshot();
      return {
        data: snapshot.assets,
        meta: {
          source: "prestocks-public-api",
          sourceUrl: snapshot.sourceUrl,
          fetchedAt: snapshot.fetchedAt.toISOString(),
          note: "external data; on-chain mint inspection is a separate, mandatory approval step",
        },
      };
    } catch (error) {
      if (error instanceof PrestocksApiError)
        throw new HttpError(503, "prestocks_unavailable", error.message);
      throw error;
    }
  });
}
