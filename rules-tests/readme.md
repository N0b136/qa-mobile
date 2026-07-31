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

33 cases over `sos/{id}/messages/{msgId}` and `pushTokens/{tokenId}`:

- **read** — owner yes, staff yes, a stranger no, anonymous no
- **`from` spoofing** — the case the whole block exists for. A guest posting
  `from: 'warden'` into their own thread would produce an official-looking answer
  in park livery from nobody at all. Asserted refused, both directions.
- **shape** — `sosId` must match the parent, body must be a non-empty string
  under 2000 chars, `createdAt` must be present
- **written once** — neither the guest NOR staff may edit or delete a line
- **demo cast parity** with the `sos` block above it
- **`pushTokens`** — owner-scoped both sides, anonymous refused

One case asserts something that looks like a hole and is not: a guest **may**
write `staff: true` on their own token row. The rules do not adjudicate that
claim — the push sender does, against `staff/{uid}`, before it will deliver
anything to that device. The case is there so nobody later "tightens" the rule
believing the check lives here.
