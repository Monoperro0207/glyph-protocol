# 07 · Resilient tool updates

What happens when a tool your agent already depends on ships a **new card** —
including a malicious one — while the agent is running?

This example runs the whole lifecycle end to end. The same function backs both
the runnable demo and the test, so **what you see narrated is exactly what the
test asserts.**

```bash
pnpm --filter 07-resilient-update demo   # narrated walkthrough
pnpm --filter 07-resilient-update test   # the assertions behind it
```

## The lifecycle

```
 v1 approved & pinned ──> provider ships breaking v2
        │                          │
        │                          ▼
        │                 ┌──────────────────┐
   live call() ──────────>│ fail-to-last-     │   workflow never blocks:
        │                 │ known-good: serve │   it keeps running on the
        │                 │ the stable pin v1 │   last signed, approved card
        │                 └──────────────────┘
        │                          │
        │                          ▼
        │                 ┌──────────────────┐
        │                 │ quarantine: v2    │   the unaudited card is never
        │                 │ parked in the     │   executed and never pinned
        │                 │ audit queue       │   on arrival
        │                 └──────────────────┘
        │                          │
        ▼                          ▼
  autonomous audit  ───>  AutoPromotionPolicy decides
  (signature, diff)              │
                ┌────────────────┼─────────────────┐
                ▼                ▼                  ▼
        default policy:    operator policy:    tampered card:
        promote nothing    promote audited     never promoted,
        (await human)      breaking update     even fully permissive
```

## The guarantees it demonstrates

1. **fail-to-last-known-good** — a call issued while the update is in flight
   returns normally, served by the last stable pin. The update never blocks the
   workflow. _This is strictly safer than skipping the gate: the agent keeps
   running on code it already verified._
2. **quarantine** — the new card is parked in a pending-audit queue. It is never
   executed and never pinned on arrival; the tool stays governed by `v1`.
3. **autonomous audit** — the queued card is re-verified (signature + diff
   classification) on its own. In this demo we `await client.processAudits()`
   for determinism; in production `client.startAuditRunner()` runs the same pass
   on a background interval while the workflow keeps going.
4. **policy-gated promotion** — promotion happens only if the audited card
   satisfies the operator's `AutoPromotionPolicy`. The **default promotes
   nothing** — every update waits for an explicit `approveCard()`. Here the
   operator opts in to audited breaking changes (`{ allowBreaking: true }`).
5. **tamper rejection** — a forged/altered card fails signature verification and
   is **never promoted, no matter how permissive the policy is.** The gate holds.

## Deeper layer: runtime receipt verification

Beyond promotion, `secureMode` adds a second line of defense at call time: every
response carries a signed `CallReceipt`, and while an update is pending the
**stable pin** governs receipt verification. If a server actually swapped to the
new card, its receipt's `glyphId` won't match the pinned card and the output is
rejected — so an unaudited card's result can never reach the caller. See
`packages/client/src/index.ts` (`verifyReceipt`) and `client.test.ts`.
