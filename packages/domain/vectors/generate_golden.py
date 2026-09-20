#!/usr/bin/env python3
"""Independent oracle for Mandate settlement math.

This is a THIRD implementation (Python, arbitrary-precision integers) used only to produce
golden vectors. Both `@mandate/domain` (TypeScript) and `mandate-core` (Rust) must reproduce
every expectation here exactly. It deliberately shares no code or structure with either.

    python3 generate_golden.py            # rewrite golden.json
    python3 generate_golden.py --check    # fail if golden.json is stale

All amounts and timestamps are emitted as decimal strings; small counters as JSON numbers.
"""
import json
import sys
from pathlib import Path

U32 = 2**32 - 1
U64 = 2**64 - 1
I64_MAX = 2**63 - 1
I64_MIN = -(2**63)

# Defaults mirror docs/TECHNICAL_SPEC.md section 5.1 and 5.2.
BOUNDS = dict(min_epoch_seconds=60, max_epoch_seconds=3600, max_duration_seconds=30 * 86400, max_epochs=2016)
PROTOCOL = dict(
    min_budget_raw=1_000, max_budget_raw=10**12,
    min_epoch_seconds=60, max_epoch_seconds=3600, max_duration_seconds=30 * 86400, max_epochs=2016,
    max_spread_bps=1000, max_depth_band_bps=2000,
    min_probe_quote_raw=1_000_000, max_probe_quote_raw=1_000_000_000,
    min_start_lead_seconds=600, position_lock_buffer_seconds=300, min_setup_window_seconds=600,
    unavailable_recovery_seconds=3600,
)


def s(x):
    return str(x)


def u64_ok(x):
    return 0 <= x <= U64


# ---------------------------------------------------------------- checked math
def math_case(op, a, b, c=None):
    a, b = int(a), int(b)
    c = None if c is None else int(c)
    if op == "add":
        r = a + b
        err = None if u64_ok(r) else "ArithmeticOverflow"
    elif op == "sub":
        r = a - b
        err = None if u64_ok(r) else "ArithmeticOverflow"
    elif op == "mul":
        r = a * b
        err = None if u64_ok(r) else "ArithmeticOverflow"
    elif op == "div":
        if b == 0:
            r, err = None, "DivisionByZero"
        else:
            r, err = a // b, None
    elif op == "ceil_div":
        if b == 0:
            r, err = None, "DivisionByZero"
        else:
            r, err = -(-a // b), None
    elif op == "mul_div_floor":
        if c == 0:
            r, err = None, "DivisionByZero"
        else:
            r = (a * b) // c
            err = None if u64_ok(r) else "ArithmeticOverflow"
    elif op == "mul_div_ceil":
        if c == 0:
            r, err = None, "DivisionByZero"
        else:
            r = -(-(a * b) // c)
            err = None if u64_ok(r) else "ArithmeticOverflow"
    else:
        raise ValueError(op)
    case = {"op": op, "a": s(a), "b": s(b)}
    if c is not None:
        case["c"] = s(c)
    case["expect"] = {"err": err} if err else {"ok": s(r)}
    return case


def checked_math():
    cases = []
    for a, b in [(0, 0), (1, 2), (U64, 0), (U64, 1), (U64 - 1, 1), (2**63, 2**63), (10, 20)]:
        cases.append(math_case("add", a, b))
    for a, b in [(5, 5), (5, 6), (0, 1), (U64, U64), (U64, 0), (1, 0)]:
        cases.append(math_case("sub", a, b))
    for a, b in [(0, U64), (1, U64), (2, U64), (2**32, 2**32), (2**32 - 1, 2**32 + 1), (U64, 1), (3, 7)]:
        cases.append(math_case("mul", a, b))
    for a, b in [(0, 1), (7, 2), (U64, 1), (U64, U64), (1, 0), (U64, 3)]:
        cases.append(math_case("div", a, b))
    for a, b in [(0, 1), (7, 2), (8, 2), (U64, 2), (1, U64), (1, 0), (U64, U64)]:
        cases.append(math_case("ceil_div", a, b))
    # spread-shaped and adversarial wide products
    mdiv = [
        (0, 5, 3), (10, 10_000, 3), (2 * 5_000_000, 10_000, 10_000_000), (U64, U64, U64), (U64, 2, 3),
        (U64, U64, 1), (U64, 10_000, 1), (2**63, 2, 1), (2**63, 2, 2), (1, 1, 0),
        (123_456_789_012, 987_654_321_098, 555_555_555_555), (U64 - 1, U64 - 1, U64),
    ]
    for a, b, c in mdiv:
        cases.append(math_case("mul_div_floor", a, b, c))
        cases.append(math_case("mul_div_ceil", a, b, c))
    return cases


# ---------------------------------------------------------------- reward split
def split(reward, epochs):
    if epochs == 0:
        return None
    return reward // epochs, reward % epochs


def reward_split_cases():
    pairs = [
        (1, 1), (1, 2), (5, 7), (7, 7), (8, 7), (13, 7), (1_000_000, 1), (1_000_000, 3), (1_000_000, 288),
        (U64, 1), (U64, 2), (U64, 2016), (U64 - 1, 2016), (2016, 2016), (2015, 2016), (2017, 2016),
        (10, 4), (99_999_999, 72), (0, 5),
    ]
    out = []
    for reward, n in pairs:
        base, extra = split(reward, n)
        rewards = None
        if n <= 12:
            rewards = [s(base + (extra if i == n - 1 else 0)) for i in range(n)]
        indices = sorted({0, max(n - 2, 0), n - 1, n})
        sampled = []
        for i in indices:
            if i >= n:
                sampled.append({"index": i, "expect": {"err": "EpochOutOfRange"}})
            else:
                sampled.append({"index": i, "expect": {"ok": s(base + (extra if i == n - 1 else 0))}})
        # conservation: (n-1)*base + (base+extra) == reward, computed independently
        assert (n - 1) * base + base + extra == reward
        out.append({
            "reward": s(reward), "epochs": n, "base": s(base), "extra": s(extra),
            "all_epoch_rewards": rewards, "sampled": sampled,
        })
    out.append({"reward": "10", "epochs": 0, "expect": {"err": "DivisionByZero"}})
    return out


# ---------------------------------------------------------------- schedule
def schedule_case(start, duration, epoch):
    b = BOUNDS
    err = None
    total = end = None
    if epoch < b["min_epoch_seconds"] or epoch > b["max_epoch_seconds"]:
        err = "InvalidEpochLength"
    elif duration <= 0 or duration > b["max_duration_seconds"] or start <= 0:
        err = "InvalidTiming"
    elif duration % epoch != 0:
        err = "InvalidEpochLength"
    else:
        total = duration // epoch
        if total > b["max_epochs"]:
            err = "TooManyEpochs"
        else:
            end = start + epoch * total
            if end > I64_MAX:
                err = "ArithmeticOverflow"
    case = {"start_at": s(start), "duration_seconds": s(duration), "epoch_seconds": s(epoch)}
    case["expect"] = {"err": err} if err else {"ok": {"total_epochs": total, "end_at": s(end)}}
    return case


def schedule_cases():
    cases = []
    T = 1_800_000_000
    for start, duration, epoch in [
        (T, 6 * 3600, 300), (T, 3600, 3600), (T, 60, 60), (T, 2016 * 60, 60), (T, 2017 * 60, 60),
        (T, 30 * 86400, 3600), (T, 30 * 86400 + 3600, 3600), (T, 6 * 3600, 59), (T, 6 * 3600, 3601),
        (T, 6 * 3600, 0), (T, 1000, 300), (T, 0, 300), (T, -300, 300), (0, 3600, 300), (-5, 3600, 300),
        (I64_MAX - 100, 3600, 300), (I64_MAX - 3600, 3600, 300), (I64_MAX - 3599, 3600, 300),
        (T, 7 * 86400, 300), (T, 7 * 86400, 60),
    ]:
        cases.append(schedule_case(start, duration, epoch))
    return cases


# ---------------------------------------------------------------- epoch position / bounds
def position_case(start, epoch, total, ts):
    end = start + epoch * total
    if ts < start:
        exp = {"kind": "NotStarted"}
    elif ts >= end:
        exp = {"kind": "Ended"}
    else:
        exp = {"kind": "Epoch", "index": (ts - start) // epoch}
    return {"start_at": s(start), "epoch_seconds": s(epoch), "total_epochs": total, "ts": s(ts), "expect": exp}


def bounds_case(start, epoch, total, i, recovery):
    if i >= total:
        return {"start_at": s(start), "epoch_seconds": s(epoch), "total_epochs": total, "index": i,
                "recovery_seconds": s(recovery), "expect": {"err": "EpochOutOfRange"}}
    es = start + i * epoch
    ee = es + epoch
    return {"start_at": s(start), "epoch_seconds": s(epoch), "total_epochs": total, "index": i,
            "recovery_seconds": s(recovery),
            "expect": {"ok": {"epoch_start": s(es), "epoch_end": s(ee), "recovery_deadline": s(ee + recovery)}}}


def timing_cases():
    T, E, N = 1_800_000_000, 300, 72
    end = T + E * N
    positions = [position_case(T, E, N, ts) for ts in [
        T - 1000, T - 1, T, T + 1, T + E - 1, T + E, T + E + 1, T + 35 * E, end - E, end - 1, end, end + 1, end + 10**6,
    ]]
    positions.append(position_case(T, 60, 1, T + 59))
    positions.append(position_case(T, 60, 1, T + 60))
    bnds = [bounds_case(T, E, N, i, 3600) for i in (0, 1, 35, N - 1, N, N + 5)]
    bnds.append(bounds_case(T, 3600, 1, 0, 0))
    return {"positions": positions, "bounds": bnds}


# ---------------------------------------------------------------- compliance
NAMES = ["SpreadTooWide", "PoolBuyDepthTooLow", "PoolSellDepthTooLow", "ProviderQuoteInBandTooLow", "ProviderBaseInBandTooLow"]


def compliance_case(th, m):
    fails = []
    if m[0] > th[0]:
        fails.append(NAMES[0])
    if m[1] < th[1]:
        fails.append(NAMES[1])
    if m[2] < th[2]:
        fails.append(NAMES[2])
    if m[3] < th[3]:
        fails.append(NAMES[3])
    if m[4] < th[4]:
        fails.append(NAMES[4])
    return {
        "thresholds": {"max_effective_spread_bps": th[0], "min_pool_buy_depth_quote_raw": s(th[1]),
                       "min_pool_sell_depth_quote_raw": s(th[2]), "min_provider_quote_in_band_raw": s(th[3]),
                       "min_provider_base_quote_eq_in_band_raw": s(th[4])},
        "metrics": {"effective_spread_bps": m[0], "pool_buy_depth_quote_raw": s(m[1]), "pool_sell_depth_quote_raw": s(m[2]),
                    "provider_quote_in_band_raw": s(m[3]), "provider_base_quote_eq_in_band_raw": s(m[4])},
        "expect": {"compliant": not fails, "failures": fails},
    }


def compliance_cases():
    th = (100, 8_000_000_000, 7_000_000_000, 5_000_000_000, 4_000_000_000)
    good = [100, 8_000_000_000, 7_000_000_000, 5_000_000_000, 4_000_000_000]  # exact equality everywhere
    cases = [compliance_case(th, good)]
    cases.append(compliance_case(th, [99, 9 * 10**9, 8 * 10**9, 6 * 10**9, 5 * 10**9]))  # comfortably passing
    for k in range(5):  # one unit beyond the threshold on exactly one metric
        m = list(good)
        m[k] = m[k] + 1 if k == 0 else m[k] - 1
        cases.append(compliance_case(th, m))
    for k in range(5):  # one unit inside the threshold on exactly one metric
        m = list(good)
        m[k] = m[k] - 1 if k == 0 else m[k] + 1
        cases.append(compliance_case(th, m))
    cases.append(compliance_case(th, [10_000, 0, 0, 0, 0]))  # everything fails
    cases.append(compliance_case(th, [U32, 0, U64, U64, 0]))
    cases.append(compliance_case((U32, U64, U64, U64, U64), [U32, U64, U64, U64, U64]))  # max-value equality
    cases.append(compliance_case((U32, U64, U64, U64, U64), [U32, U64 - 1, U64, U64, U64]))
    cases.append(compliance_case((0, 0, 0, 0, 0), [0, 0, 0, 0, 0]))  # all-zero thresholds are a pure predicate
    cases.append(compliance_case((0, 0, 0, 0, 0), [1, 0, 0, 0, 0]))
    return cases


# ---------------------------------------------------------------- accounting scenarios
class Sim:
    def __init__(self, M, R, N):
        self.M, self.R, self.N = M, R, N
        self.base, self.extra = R // N, R % N
        self.finalized_epochs = set()
        self.compliant = self.noncompliant = self.unavailable = 0
        self.earned = self.forfeited = self.claimed = self.withdrawn = 0

    def reward_of(self, i):
        return self.base + (self.extra if i == self.N - 1 else 0)

    def all_resolved(self):
        return len(self.finalized_epochs) == self.N

    def claimable(self):
        return self.earned - self.claimed

    def unresolved(self):
        return self.R - self.earned - self.forfeited

    def sponsor_withdrawable(self):
        avail = (self.M - self.R) + ((self.R - self.earned) if self.all_resolved() else 0)
        return avail - self.withdrawn

    def vault(self):
        return self.M - self.claimed - self.withdrawn

    def snapshot(self):
        # independent invariant checks (raised, never emitted, if broken)
        assert self.earned + self.forfeited + self.unresolved() == self.R
        assert self.claimed <= self.earned <= self.R <= self.M
        assert self.withdrawn <= self.M - self.claimed
        assert self.vault() >= self.claimable() + self.unresolved()
        return {
            "finalized_epochs": len(self.finalized_epochs), "compliant_epochs": self.compliant,
            "noncompliant_epochs": self.noncompliant, "unavailable_epochs": self.unavailable,
            "earned_reward_raw": s(self.earned), "forfeited_reward_raw": s(self.forfeited),
            "claimed_reward_raw": s(self.claimed), "sponsor_withdrawn_raw": s(self.withdrawn),
            "claimable_raw": s(self.claimable()), "unresolved_raw": s(self.unresolved()),
            "sponsor_withdrawable_raw": s(self.sponsor_withdrawable()), "vault_balance_raw": s(self.vault()),
            "all_epochs_resolved": self.all_resolved(),
        }


def scenario(name, M, R, N, ops):
    sim = Sim(M, R, N)
    steps = []
    for op in ops:
        kind = op[0]
        step = {"op": kind}
        err = None
        if kind == "finalize":
            _, idx, outcome = op
            step.update({"index": idx, "outcome": outcome})
            if idx >= N:
                err = "EpochOutOfRange"
            elif len(sim.finalized_epochs) == N or idx in sim.finalized_epochs:
                err = "EpochAlreadyFinalized"
            else:
                sim.finalized_epochs.add(idx)
                if outcome == "Compliant":
                    sim.compliant += 1
                    sim.earned += sim.reward_of(idx)
                elif outcome == "NonCompliant":
                    sim.noncompliant += 1
                    sim.forfeited += sim.reward_of(idx)
                else:
                    sim.unavailable += 1
                    sim.forfeited += sim.reward_of(idx)
        elif kind == "claim":
            _, amount = op
            step["amount"] = "all" if amount == "all" else s(amount)
            avail = sim.claimable()
            amt = avail if amount == "all" else amount
            if amt == 0 or avail == 0:
                err = "NothingToClaim"
            elif amt > avail:
                err = "ClaimExceedsEarned"
            else:
                sim.claimed += amt
        elif kind == "withdraw":
            _, amount = op
            step["amount"] = "all" if amount == "all" else s(amount)
            avail = sim.sponsor_withdrawable()
            amt = avail if amount == "all" else amount
            if amt == 0 or avail == 0:
                err = "NothingToWithdraw"
            elif amt > avail:
                err = "WithdrawExceedsAvailable"
            else:
                sim.withdrawn += amt
        step["expect"] = {"err": err} if err else {"ok": True}
        step["after"] = sim.snapshot()
        steps.append(step)
    return {"name": name, "max_reward_raw": s(M), "accepted_reward_raw": s(R), "total_epochs": N, "steps": steps}


def accounting_scenarios():
    C, NC, UN = "Compliant", "NonCompliant", "Unavailable"
    sc = []
    sc.append(scenario("all compliant, remainder to last epoch, claims in parts", 100, 10, 4, [
        ("withdraw", "all"),  # award surplus available immediately
        ("finalize", 0, C), ("claim", 2), ("claim", 1), ("finalize", 1, C), ("finalize", 3, C), ("claim", "all"),
        ("withdraw", "all"), ("finalize", 2, C), ("claim", "all"), ("claim", "all"), ("withdraw", "all"), ("finalize", 0, C),
    ]))
    sc.append(scenario("final epoch noncompliant forfeits its remainder", 1000, 1000, 3, [
        ("finalize", 0, C), ("finalize", 1, C), ("finalize", 2, NC),
        ("withdraw", "all"), ("claim", "all"), ("withdraw", "all"),
    ]))
    sc.append(scenario("sponsor cannot take forfeited funds until every epoch resolves", 500, 500, 5, [
        ("finalize", 0, NC), ("finalize", 1, NC), ("withdraw", 1), ("finalize", 2, UN), ("finalize", 4, C),
        ("withdraw", "all"), ("finalize", 3, C), ("withdraw", 1), ("claim", 200), ("withdraw", "all"),
        ("claim", "all"), ("withdraw", 1),
    ]))
    sc.append(scenario("single epoch mandate", 7, 7, 1, [("claim", "all"), ("finalize", 0, C), ("claim", 8), ("claim", 7), ("withdraw", "all")]))
    sc.append(scenario("single epoch unavailable refunds sponsor", 7, 5, 1, [("withdraw", "all"), ("finalize", 0, UN), ("claim", "all"), ("withdraw", "all"), ("withdraw", "all")]))
    sc.append(scenario("out of range and out of order finalization", 90, 90, 9, [
        ("finalize", 9, C), ("finalize", 8, C), ("finalize", 0, NC), ("finalize", 8, C), ("claim", 10), ("claim", 5),
    ]))
    sc.append(scenario("surplus withdrawn in pieces", 1_000_000, 300_000, 6, [
        ("withdraw", 400_000), ("withdraw", 300_001), ("withdraw", 300_000), ("withdraw", 1), ("finalize", 0, C), ("claim", 50_000),
    ]))
    sc.append(scenario("max u64 values", U64, U64, 2016, [
        ("finalize", 2015, C), ("claim", "all"), ("finalize", 0, C), ("claim", "all"), ("withdraw", "all"),
    ]))
    sc.append(scenario("max funding, tiny accepted reward", U64, 2016, 2016, [
        ("withdraw", "all"), ("finalize", 5, C), ("claim", "all"), ("withdraw", "all"),
    ]))
    # every epoch finalized in mixed order, compliant fully: conservation end state
    order = [3, 0, 2, 1]
    sc.append(scenario("fully compliant out of order", 12, 11, 4, [("finalize", i, C) for i in order] + [("claim", "all"), ("withdraw", "all")]))
    return sc


# ---------------------------------------------------------------- validation
def create_case(name, p, now=1_800_000_000, **kw):
    """Reference validator: returns the first-failing rule per group in a fixed order."""
    prm = dict(
        max_reward_raw=1_000_000_000, bidding_ends_at=now + 3600, start_at=now + 7200,
        duration_seconds=6 * 3600, epoch_seconds=300, max_effective_spread_bps=400, depth_band_bps=500,
        min_pool_buy_depth_quote_raw=8_000_000_000, min_pool_sell_depth_quote_raw=8_000_000_000,
        min_provider_quote_in_band_raw=5_000_000_000, min_provider_base_quote_eq_in_band_raw=5_000_000_000,
        probe_quote_raw=10_000_000,
    )
    prm.update(kw)
    errs = []
    P = p
    # schedule
    e, d, st = prm["epoch_seconds"], prm["duration_seconds"], prm["start_at"]
    total = None
    if e < P["min_epoch_seconds"] or e > P["max_epoch_seconds"]:
        errs.append("InvalidEpochLength")
    elif d <= 0 or d > P["max_duration_seconds"]:
        errs.append("InvalidTiming")
    elif d % e != 0:
        errs.append("InvalidEpochLength")
    else:
        total = d // e
        if total > P["max_epochs"]:
            errs.append("TooManyEpochs")
    # timing relations
    lock_at = st - P["position_lock_buffer_seconds"]
    if prm["bidding_ends_at"] <= now:
        errs.append("InvalidTiming")
    if st < now + P["min_start_lead_seconds"]:
        errs.append("InvalidTiming")
    if prm["bidding_ends_at"] >= lock_at - P["min_setup_window_seconds"]:
        errs.append("InvalidTiming")
    if total is not None and st > 0 and total <= P["max_epochs"] and st + e * total > I64_MAX:
        errs.append("ArithmeticOverflow")
    # budget
    mr = prm["max_reward_raw"]
    if mr < P["min_budget_raw"] or mr > P["max_budget_raw"] or (total is not None and mr < total):
        errs.append("InvalidBudget")
    # thresholds
    if not (1 <= prm["max_effective_spread_bps"] <= P["max_spread_bps"]):
        errs.append("InvalidThreshold")
    if not (1 <= prm["depth_band_bps"] <= P["max_depth_band_bps"]):
        errs.append("InvalidThreshold")
    for k in ("min_pool_buy_depth_quote_raw", "min_pool_sell_depth_quote_raw", "min_provider_quote_in_band_raw", "min_provider_base_quote_eq_in_band_raw"):
        if prm[k] <= 0:
            errs.append("InvalidThreshold")
    if not (P["min_probe_quote_raw"] <= prm["probe_quote_raw"] <= P["max_probe_quote_raw"]):
        errs.append("InvalidThreshold")
    out = {k: (v if k in ("max_effective_spread_bps", "depth_band_bps") else s(v)) for k, v in prm.items()}
    return {"name": name, "now": s(now), "params": out, "expect": {"errors": sorted(set(errs))}}


def bid_case(name, reward, valid_until, max_reward, now, total_epochs, acceptance_cutoff):
    errs = []
    if reward <= 0 or reward > max_reward or reward < total_epochs:
        errs.append("InvalidBudget")
    if valid_until < now:
        errs.append("BidExpired")
    elif valid_until > acceptance_cutoff:
        errs.append("InvalidTiming")
    return {"name": name, "requested_reward_raw": s(reward), "valid_until": s(valid_until), "max_reward_raw": s(max_reward),
            "now": s(now), "total_epochs": total_epochs, "acceptance_cutoff": s(acceptance_cutoff), "expect": {"errors": sorted(set(errs))}}


def validation_cases():
    now = 1_800_000_000
    creates = [
        create_case("valid baseline", PROTOCOL),
        create_case("epoch too short", PROTOCOL, epoch_seconds=59),
        create_case("epoch too long", PROTOCOL, epoch_seconds=3601),
        create_case("duration not a multiple", PROTOCOL, duration_seconds=6 * 3600 + 1),
        create_case("duration zero", PROTOCOL, duration_seconds=0),
        create_case("duration beyond 30 days", PROTOCOL, duration_seconds=31 * 86400),
        create_case("too many epochs", PROTOCOL, duration_seconds=2017 * 60, epoch_seconds=60),
        create_case("exactly max epochs", PROTOCOL, duration_seconds=2016 * 60, epoch_seconds=60),
        create_case("bidding already closed", PROTOCOL, bidding_ends_at=now),
        create_case("start too soon", PROTOCOL, start_at=now + 599, bidding_ends_at=now + 10),
        create_case("bidding ends too close to lock", PROTOCOL, bidding_ends_at=now + 7200 - 300 - 600),
        create_case("bidding ends just early enough", PROTOCOL, bidding_ends_at=now + 7200 - 300 - 601),
        create_case("budget below minimum", PROTOCOL, max_reward_raw=999),
        create_case("budget above maximum", PROTOCOL, max_reward_raw=10**12 + 1),
        create_case("budget at maximum", PROTOCOL, max_reward_raw=10**12),
        create_case("budget below epoch count", PROTOCOL, max_reward_raw=1_000, duration_seconds=6 * 3600, epoch_seconds=60),
        create_case("spread zero", PROTOCOL, max_effective_spread_bps=0),
        create_case("spread above protocol max", PROTOCOL, max_effective_spread_bps=1001),
        create_case("band zero", PROTOCOL, depth_band_bps=0),
        create_case("band above protocol max", PROTOCOL, depth_band_bps=2001),
        create_case("zero buy depth", PROTOCOL, min_pool_buy_depth_quote_raw=0),
        create_case("zero provider base", PROTOCOL, min_provider_base_quote_eq_in_band_raw=0),
        create_case("probe below minimum", PROTOCOL, probe_quote_raw=999_999),
        create_case("probe above maximum", PROTOCOL, probe_quote_raw=1_000_000_001),
        create_case("multiple problems reported in order", PROTOCOL, epoch_seconds=10, max_reward_raw=1, max_effective_spread_bps=0),
    ]
    bids = [
        bid_case("valid bid", 500_000, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("zero reward", 0, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("above max", 1_000_001, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("at max", 1_000_000, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("below epoch count", 71, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("exactly epoch count", 72, now + 5000, 1_000_000, now, 72, now + 6000),
        bid_case("already expired", 500_000, now - 1, 1_000_000, now, 72, now + 6000),
        bid_case("expires exactly now", 500_000, now, 1_000_000, now, 72, now + 6000),
        bid_case("valid until beyond cutoff", 500_000, now + 6001, 1_000_000, now, 72, now + 6000),
        bid_case("valid until exactly cutoff", 500_000, now + 6000, 1_000_000, now, 72, now + 6000),
    ]
    return {"protocol": {k: s(v) if k not in ("max_spread_bps", "max_depth_band_bps", "max_epochs") else v for k, v in PROTOCOL.items()},
            "create_mandate": creates, "bid": bids}


def build():
    return {
        "schema": "mandate-golden-vectors",
        "version": 1,
        "notes": "Generated by generate_golden.py, an independent Python oracle. Do not edit by hand.",
        "checked_math": checked_math(),
        "reward_split": reward_split_cases(),
        "schedule": schedule_cases(),
        "timing": timing_cases(),
        "compliance": compliance_cases(),
        "accounting": accounting_scenarios(),
        "validation": validation_cases(),
    }


if __name__ == "__main__":
    out = Path(__file__).with_name("golden.json")
    text = json.dumps(build(), indent=1, sort_keys=False) + "\n"
    if "--check" in sys.argv:
        if not out.exists() or out.read_text() != text:
            print("golden.json is stale: run generate_golden.py", file=sys.stderr)
            sys.exit(1)
        print("golden.json is up to date")
    else:
        out.write_text(text)
        print(f"wrote {out} ({len(text)} bytes)")
