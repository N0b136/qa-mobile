# Rules tests

```
cd rules-tests
npm install     # ~700 packages, mostly firebase-tools; needs Java for the emulator
npm test
```

Reads `../firestore.rules` and exercises it against the Firestore emulator.
Nothing here touches the live project.

## Why it is its own package

`firebase-tools` is a very large dependency and none of it is needed to build or
run the app. Kept out of `questland/package.json`, an ordinary `npm install`
stays the same size it was, and this suite is installed only by somebody who is
about to change the rules.

## Why the emulator instead of the REST matrix

The REST matrix (`scratchpad/rules-*.mjs`) drives the LIVE project with real
signed-in accounts, which is the right tool for confirming what is deployed —
but it cannot reach a single staff case. `staff/{uid}` is unwritable by every
client by design, so a test account cannot be put on the roster from a script;
somebody has to add the document by hand in the Firebase console first.

Under the emulator, `withSecurityRulesDisabled` seeds the roster directly, so
"staff may post as a Warden" and "a guest may NOT" are both actually asserted
rather than reasoned about. That pair is the point of the whole suite.

Two habits carried over from the REST matrix are still worth keeping in mind
when reading results **there**, and are why they are not needed here: a 404 is an
ALLOW (the rule passed, the document is simply absent), and a 5xx is not a
verdict at all. The emulator answers with an explicit allow/deny, so neither
ambiguity arises.

## What it covers

44 cases over `sos/{id}`, `sos/{id}/messages/{msgId}` and `pushTokens/{tokenId}`:

- **read** — owner yes, staff yes, a stranger no, anonymous no
- **`from` spoofing** — the case the whole block exists for. A guest posting
  `from: 'warden'` into their own thread would produce an official-looking answer
  in park livery from nobody at all. Asserted refused, both directions.
- **the parent call's `userId` is immutable** — see below
- **shape** — `sosId` must match the parent; `body` a non-empty string under
  2000 chars; `authorName` a string of 1..60; `id` a string; `createdAt` present
- **written once** — neither the guest NOR staff may edit or delete a line
- **demo cast parity** with the `sos` block above it
- **`pushTokens`** — owner-scoped both sides, anonymous refused

### The parent-document cases exist because their absence hid a real hole

The first version of this suite had 33 cases and never wrote to a `sos`
document at all — only to the subcollection under it. It was green, and the
`sos` update rule was letting the owner of a call rewrite its `userId` to
anybody's uid.

That is not a defect confined to one document. The messages ACL derives
*entirely* from `sos/{id}.userId` through `call()`, and the push sender reads
the same field to decide whose phone to wake — so a guest could raise their own
call, write what they liked into its thread, hand the call to a stranger, and
have the next Warden reply banner that stranger's lock screen with a transcript
they never wrote. Setting it to a `demo-` id instead made the whole thread
world-readable.

The lesson generalises: **when a rule derives from another document's field,
test writes to that field.** A subcollection suite that never touches its parent
is asserting the easy half.

One case asserts something that looks like a hole and is not: a guest **may**
write `staff: true` on their own token row. The rules do not adjudicate that
claim — the push sender does, against `staff/{uid}`, before it will deliver
anything to that device. The case is there so nobody later "tightens" the rule
believing the check lives here.
