# Plan — the booth's refused writes, the part that is still open

Follow-up spec. Self-contained; assumes no prior conversation.

Read `CLAUDE.md` first — its **Gotchas & failure contracts** section is binding, and two entries
there came out of the failed attempts recorded below.

---

## What is already fixed (do not redo)

`services/flagService.ts` `claimFlagDoc` used to end:

```ts
} catch { return { ok: false, reason: 'unavailable' } }
```

so a Firestore **refusal** and a **network failure** were the same value, and every caller treated
that value as "keep it on this machine's rack" and returned `{ ok: true }`. A bind the server threw
out looked identical to one that synced.

Now `claimFlagDoc` classifies the error `code` and returns a distinct `'refused'`, and four call
sites act on it — **`registerFlag`, `attachTag`, `releaseFlag`, `completeFlag`**. Those four are
correct *because every write in them happens after the check*, so the copy's "repeat it, nothing was
saved" is literally true. That work was driven against 15 stubbed transactions and a same-tick race
200/200, and an offline booth was confirmed to still bind normally with the SDK blocked.

**Unchanged and still soft:** `bindFlag`. It falls through to `'unavailable'` exactly as before.

---

## The open problem

`bindFlag` writes through **four separate local services before the flag claim ever reaches the
server**:

```
enrolWalkUp → createWalkUp   (mints walk-${shortCode(8)})
            → createParty
            → createBooking
redeem                        (spends a Quest Experience)
claimFlagDoc                  ← the server first gets a say HERE
```

A refusal at the last step leaves the first four standing. The panel leaves the form filled in, so
submitting it again mints a **second** record, party, booking and Passage for the same family —
because `redeem`'s idempotency is per `(guest, order, episode)` and the retry has a *different*
minted guest id. There is an honest comment marking this at `bindFlag` in the source.

### Three fixes were attempted and all three failed. Do not repeat them.

1. **Copy that names the forbidden gesture.** A skeptic measured the toast: ~400 characters, ~21
   seconds of reading, in a 3.5 s window, with the critical clause second. Words are not a control.
2. **Adopt the minted holder in the panel** so a retry reuses the first id. It worked, then wrote
   `headcount: 1` for a family of five on the retry — `createWalkUp` deliberately does not store the
   headcount and a walk-up party has one member — and `assignmentTable()` broadcast `partySize: 1`
   to every plinth over LoRa. It was also in-memory only, lost on reload, "Change" and "Start again".
3. **An auth pre-flight before `enrolWalkUp`.** This one is the instructive failure. It tested
   `hasRealAuth()`, which reads `currentUser` — but **a rules refusal comes back on a perfectly
   valid signed-in token.** A Guide dropped from `staff/{uid}` passes every auth check and is
   refused every write, so the gate opened on exactly the case it was built for. It closed a door
   that was already shut: the signed-out case minted nothing anyway.

**What all three share:** they try to *recover from* or *predict* the split, instead of removing it.

---

## What would actually fix it

The enrolment and the claim have to be **one unit that either all happens or none of it does.**
Two shapes are worth costing; pick one deliberately.

**A. Prove the write right first, on a cheap object.** Before minting anything, attempt a real
staff-authorised write the rules gate identically — the flag claim itself against a reserved
placeholder, or a scratch doc under a staff-only path — and refuse the enrolment if it is thrown
out. This is a genuine write, so unlike an auth check it tests what actually matters. It is still
TOCTOU: a token lapsing between probe and claim leaves the split reachable, so it narrows the window
rather than closing it. Cheap; partial.

**B. Make enrolment reversible.** Have `enrolWalkUp` return an undo, and run it when the claim
refuses: delete the walk-up record, the party and the booking, and un-spend the use. This closes the
case completely, and the cost is that `passService` needs an un-redeem that is currently deliberately
absent — uses are immutable by design, which is what makes the union merge safe. **Do not weaken
that invariant casually**; a reversal that a phone can also perform is a refund primitive, and the
ledger's whole value is that a spend cannot be erased. Scope it as staff-only, same-session,
same-transaction, and think hard about what a partially-applied undo leaves behind.

There is also the do-nothing option, and it is defensible: the failure needs a session that dies or
a roster change mid-shift, the money lost is one Passage, and the marker comment tells the next
reader exactly what happens. If the park runs for a season without hitting it, that is the answer.

---

## Verification any attempt must pass

The four checks that killed the previous three attempts, in the order they killed them:

1. **The double sale.** With `flags` writes refused but the session signed in — the real case, a uid
   dropped from `staff/{uid}` — enrol a walk-up, tap Bind, then tap Bind again. Count `ql:users`,
   `ql:parties`, `ql:bookings:*`, `ql:passUses:*`. Two of anything is a fail.
2. **The offline booth still works.** With Firebase unreachable, a walk-up must enrol and bind
   normally, locally. **Blocking a working booth is worse than the bug** — a park with dead wifi
   still has guests at the counter.
3. **The headcount survives.** Drive a family of five through every bind and rebind path reachable
   and assert the written `flag.headcount` is 5 each time. `assignmentTable()` broadcasts it as
   `partySize` to every station, so an understated count is wrong *on the wire*, not just on screen.
4. **No comment claims a guarantee the code lacks.** Every previous round left one behind.

Drive it, do not argue it — every finding above came from a driven browser or a stubbed transaction,
and none from reading. Note that the Firestore SDK round-trip is not verifiable in this sandbox
(headless Chromium gets `ERR_CONNECTION_RESET` through the agent proxy); stub the transaction layer
and say plainly what remains unproven.

---

## Related, found while auditing — same bug, other collections

A refusal is swallowed and a human is left waiting on a verdict in these places too. None is fixed.

| Where | What the operator sees |
|---|---|
| `partyService.createParty` | a party whose invite code exists on one phone and that nobody can join |
| `partyService.joinParty` | "No party answers to that code" — wrong cause, so the guest retypes a correct code forever |
| `partyService.leaveParty` | their phone shows them out; the cloud roster still has them |
| `consoleService.sendWord` | a count with no reason, and `count` increments before `batch.commit()`, so a mid-loop throw reports 0 even when earlier batches landed |
| `announcementService.postAnnouncement` | a notice standing on the poster's own board that reached nobody in the park |
| `announcementService` scheduled sends | a scheduled send no other tab will ever fire |

Genuine fire-and-forget write-throughs — `pushPresence`, `pushLeg`, `pushFlag`, `pushProgress`,
`pushPassUses`, `pushBooking`, `pushNotification`, `pushSos`, `pushGuestProfile` — are **not** in
this list and should stay soft. Local-first is the design there and nobody is waiting on them.
