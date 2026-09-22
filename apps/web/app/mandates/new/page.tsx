"use client";

import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";

import { ErrorNotice } from "../../../components/ErrorNotice.tsx";
import { Loading } from "../../../components/Loading.tsx";
import { TransactionAction } from "../../../components/TransactionAction.tsx";
import { listMarkets } from "../../../lib/api.ts";
import { loadProtocolConfig, prepareCreateMandate } from "../../../lib/solana/create-mandate.ts";
import { useWallet } from "../../../lib/solana/wallet-standard.tsx";
import type { ProtocolConfigAccount } from "@mandate/solana";
import type { MarketConfigAccountJson, Row } from "../../../lib/types.ts";

function usdcToRaw(decimal: string): bigint {
  const [whole, frac = ""] = decimal.split(".");
  const paddedFrac = frac.padEnd(6, "0").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(paddedFrac || "0");
}

export default function CreateMandatePage() {
  const { account } = useWallet();
  const [markets, setMarkets] = useState<readonly Row<MarketConfigAccountJson>[] | null>(null);
  const [protocol, setProtocol] = useState<ProtocolConfigAccount | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const [pool, setPool] = useState("");
  const [maxReward, setMaxReward] = useState("1000");
  const [totalEpochs, setTotalEpochs] = useState("72");
  const [epochMinutes, setEpochMinutes] = useState("5");
  const [startInHours, setStartInHours] = useState("6");
  const [biddingWindowHours, setBiddingWindowHours] = useState("3");
  const [maxSpreadBps, setMaxSpreadBps] = useState("400");
  const [depthBandBps, setDepthBandBps] = useState("500");
  const [minBuyDepth, setMinBuyDepth] = useState("5000");
  const [minSellDepth, setMinSellDepth] = useState("5000");
  const [minProviderQuote, setMinProviderQuote] = useState("2000");
  const [minProviderBase, setMinProviderBase] = useState("2000");
  const [probeSize, setProbeSize] = useState("10");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMarkets(), loadProtocolConfig()])
      .then(([m, p]) => {
        if (cancelled) return;
        const enabled = m.data.filter((row) => row.account.enabled);
        setMarkets(enabled);
        setProtocol(p);
        if (enabled[0]) setPool(enabled[0].account.pool);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = useMemo(() => {
    const problems: string[] = [];
    if (!account) problems.push("Connect a wallet to create a mandate.");
    if (!pool) problems.push("Choose an approved market.");
    const epochSeconds = Number(epochMinutes) * 60;
    const epochs = Number(totalEpochs);
    if (protocol) {
      const rewardRaw = usdcToRaw(maxReward || "0");
      if (rewardRaw < protocol.minBudgetRaw || rewardRaw > protocol.maxBudgetRaw) {
        problems.push(
          `Max reward must be between ${(Number(protocol.minBudgetRaw) / 1e6).toString()} and ${(Number(protocol.maxBudgetRaw) / 1e6).toString()} USDC.`,
        );
      }
      if (
        epochSeconds < Number(protocol.minEpochSeconds) ||
        epochSeconds > Number(protocol.maxEpochSeconds)
      ) {
        problems.push(
          `Epoch length must be between ${(Number(protocol.minEpochSeconds) / 60).toString()} and ${(Number(protocol.maxEpochSeconds) / 60).toString()} minutes.`,
        );
      }
      if (!Number.isInteger(epochs) || epochs < 1 || epochs > protocol.maxEpochs) {
        problems.push(
          `Total epochs must be a whole number from 1 to ${String(protocol.maxEpochs)}.`,
        );
      }
      if (epochSeconds * epochs > Number(protocol.maxDurationSeconds)) {
        problems.push(
          "Epoch length × total epochs exceeds the protocol's maximum mandate duration.",
        );
      }
      if (Number(maxSpreadBps) > protocol.maxSpreadBps) {
        problems.push(`Max effective spread cannot exceed ${String(protocol.maxSpreadBps)} bps.`);
      }
      if (Number(depthBandBps) > protocol.maxDepthBandBps) {
        problems.push(`Depth band cannot exceed ${String(protocol.maxDepthBandBps)} bps.`);
      }
      const probeRaw = usdcToRaw(probeSize || "0");
      if (probeRaw < protocol.minProbeQuoteRaw || probeRaw > protocol.maxProbeQuoteRaw) {
        problems.push(
          `Probe size must be between ${(Number(protocol.minProbeQuoteRaw) / 1e6).toString()} and ${(Number(protocol.maxProbeQuoteRaw) / 1e6).toString()} USDC.`,
        );
      }
      if (Number(startInHours) * 3600 < Number(protocol.minStartLeadSeconds)) {
        problems.push(
          `The mandate must start at least ${(Number(protocol.minStartLeadSeconds) / 3600).toString()} hours from now.`,
        );
      }
      if (protocol.pausedNewRisk)
        problems.push(
          "The protocol admin has paused new risk; no mandate can be created right now.",
        );
    }
    if (Number(biddingWindowHours) >= Number(startInHours)) {
      problems.push("Bidding must close before the mandate starts.");
    }
    return problems;
  }, [
    account,
    pool,
    protocol,
    maxReward,
    totalEpochs,
    epochMinutes,
    maxSpreadBps,
    depthBandBps,
    probeSize,
    startInHours,
    biddingWindowHours,
  ]);

  if (error) return <ErrorNotice error={error} />;
  if (!markets || !protocol) return <Loading label="Loading protocol configuration" />;

  return (
    <div className="stack" style={{ maxWidth: "56ch" }}>
      <div>
        <h1>Create a mandate</h1>
        <p className="lede">
          Every value below is fixed permanently once the mandate is created and its USDC reward is
          escrowed. There is no edit instruction — a mistake here can only be corrected by letting
          the mandate run its course (or, before any bid is accepted, cancelling it and getting the
          escrow back).
        </p>
      </div>

      {markets.length === 0 ? (
        <p className="notice warn">No market is approved yet, so a mandate cannot be created.</p>
      ) : (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Market</h2>
            <div className="field">
              <label htmlFor="pool">Approved pool</label>
              <select
                id="pool"
                value={pool}
                onChange={(e) => {
                  setPool(e.target.value);
                }}
              >
                {markets.map((m) => (
                  <option key={m.address} value={m.account.pool}>
                    {m.account.pool}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Reward and schedule</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="maxReward">Maximum reward (USDC)</label>
                <input
                  id="maxReward"
                  inputMode="decimal"
                  value={maxReward}
                  onChange={(e) => {
                    setMaxReward(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="totalEpochs">Total epochs</label>
                <input
                  id="totalEpochs"
                  inputMode="numeric"
                  value={totalEpochs}
                  onChange={(e) => {
                    setTotalEpochs(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="epochMinutes">Epoch length (minutes)</label>
                <input
                  id="epochMinutes"
                  inputMode="numeric"
                  value={epochMinutes}
                  onChange={(e) => {
                    setEpochMinutes(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="startInHours">Starts in (hours from now)</label>
                <input
                  id="startInHours"
                  inputMode="numeric"
                  value={startInHours}
                  onChange={(e) => {
                    setStartInHours(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="biddingWindowHours">Bidding closes in (hours from now)</label>
                <input
                  id="biddingWindowHours"
                  inputMode="numeric"
                  value={biddingWindowHours}
                  onChange={(e) => {
                    setBiddingWindowHours(e.target.value);
                  }}
                />
              </div>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Quality thresholds</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="maxSpreadBps">Max effective spread (bps)</label>
                <input
                  id="maxSpreadBps"
                  inputMode="numeric"
                  value={maxSpreadBps}
                  onChange={(e) => {
                    setMaxSpreadBps(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="depthBandBps">Depth band (bps)</label>
                <input
                  id="depthBandBps"
                  inputMode="numeric"
                  value={depthBandBps}
                  onChange={(e) => {
                    setDepthBandBps(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="minBuyDepth">Min pool buy depth (USDC)</label>
                <input
                  id="minBuyDepth"
                  inputMode="decimal"
                  value={minBuyDepth}
                  onChange={(e) => {
                    setMinBuyDepth(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="minSellDepth">Min pool sell depth (USDC)</label>
                <input
                  id="minSellDepth"
                  inputMode="decimal"
                  value={minSellDepth}
                  onChange={(e) => {
                    setMinSellDepth(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="minProviderQuote">Min provider quote in band (USDC)</label>
                <input
                  id="minProviderQuote"
                  inputMode="decimal"
                  value={minProviderQuote}
                  onChange={(e) => {
                    setMinProviderQuote(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="minProviderBase">Min provider base in band (USDC-eq.)</label>
                <input
                  id="minProviderBase"
                  inputMode="decimal"
                  value={minProviderBase}
                  onChange={(e) => {
                    setMinProviderBase(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="probeSize">Probe size (USDC)</label>
                <input
                  id="probeSize"
                  inputMode="decimal"
                  value={probeSize}
                  onChange={(e) => {
                    setProbeSize(e.target.value);
                  }}
                />
              </div>
            </div>
          </section>

          {errors.length > 0 ? (
            <ul className="notice warn">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          <TransactionAction
            label="Create mandate"
            disabled={errors.length > 0}
            prepare={() => {
              if (!account) throw new Error("Connect a wallet first.");
              const now = Math.floor(Date.now() / 1000);
              return Promise.resolve(
                prepareCreateMandate(protocol, {
                  sponsor: new PublicKey(account.address),
                  pool: new PublicKey(pool),
                  mandateId: BigInt(Date.now()),
                  maxRewardRaw: usdcToRaw(maxReward),
                  biddingEndsAt: BigInt(now + Math.round(Number(biddingWindowHours) * 3600)),
                  startAt: BigInt(now + Math.round(Number(startInHours) * 3600)),
                  epochSeconds: BigInt(Number(epochMinutes) * 60),
                  totalEpochs: Number(totalEpochs),
                  maxEffectiveSpreadBps: Number(maxSpreadBps),
                  depthBandBps: Number(depthBandBps),
                  minPoolBuyDepthQuoteRaw: usdcToRaw(minBuyDepth),
                  minPoolSellDepthQuoteRaw: usdcToRaw(minSellDepth),
                  minProviderQuoteInBandRaw: usdcToRaw(minProviderQuote),
                  minProviderBaseQuoteEqInBandRaw: usdcToRaw(minProviderBase),
                  probeQuoteRaw: usdcToRaw(probeSize),
                }),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
