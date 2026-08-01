// Rules suite for the chat lane, the manager roll and the park roll-up. Runs
// against the Firestore emulator, so the staff cases are reachable (staff/{uid}
// is unwritable by any client in prod, and managers/{uid} likewise).
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  updateDoc,
} from 'firebase/firestore'

const GUEST = 'guest-uid-1'
const OTHER = 'guest-uid-2'
const STAFF = 'staff-uid-1'
// A real manager holds TWO hand-provisioned docs — staff AND managers — because
// the console's front door is the staff gate and a managers row on its own opens
// nothing. Seeded that way below so the manager cases assert the real shape.
const MANAGER = 'manager-uid-1'

const env = await initializeTestEnvironment({
  projectId: 'qa-mobile-rules-test',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: readFileSync('/home/user/qa-mobile/firestore.rules', 'utf8'),
  },
})

// Real email/password-shaped identities. `isRealUser()` refuses anonymous, so
// every context must carry a non-anonymous sign_in_provider.
const asGuest = env.authenticatedContext(GUEST, { firebase: { sign_in_provider: 'password' } })
const asOther = env.authenticatedContext(OTHER, { firebase: { sign_in_provider: 'password' } })
const asStaff = env.authenticatedContext(STAFF, { firebase: { sign_in_provider: 'password' } })
const asManager = env.authenticatedContext(MANAGER, { firebase: { sign_in_provider: 'password' } })
const asAnon = env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } })

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'staff', STAFF), { name: 'Warden Aldous', role: 'warden' })
  // The manager, provisioned the way a real one is: both docs, by hand.
  await setDoc(doc(db, 'staff', MANAGER), { name: 'Warden Perrin', role: 'warden' })
  await setDoc(doc(db, 'managers', MANAGER), { uid: MANAGER, name: 'Perrin' })
  // The park roll-up as the booth console writes it — written whole, one doc.
  await setDoc(doc(db, 'parkStatus', 'current'), {
    id: 'current',
    writtenAt: 1,
    writtenBy: STAFF,
    tableVersion: 1,
    counts: { live: 20, silent: 1 },
    exceptions: [
      {
        stationNo: 15,
        placeId: 'st-15',
        name: "Maker's Cave",
        condition: 'silent',
        lastHeartbeatAt: 1,
      },
    ],
  })
  await setDoc(doc(db, 'sos', 'call-1'), {
    id: 'call-1',
    userId: GUEST,
    kind: 'chat',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
  })
  await setDoc(doc(db, 'sos', 'call-demo'), {
    id: 'call-demo',
    userId: 'demo-cast-1',
    kind: 'chat',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
  })
  // A line already on the record, for the immutability + read cases.
  await setDoc(doc(db, 'sos', 'call-1', 'messages', 'm0'), {
    id: 'm0',
    sosId: 'call-1',
    from: 'warden',
    authorName: 'Warden Aldous',
    body: 'The bridge is open.',
    createdAt: 1,
  })
})

const line = (over = {}) => ({
  id: 'mX',
  sosId: 'call-1',
  from: 'guest',
  authorName: 'A guest',
  body: 'Where is the nearest privy?',
  createdAt: 2,
  ...over,
})

const results = []
async function check(name, expect, fn) {
  try {
    await (expect === 'allow' ? assertSucceeds(fn()) : assertFails(fn()))
    results.push([true, name])
  } catch (err) {
    results.push([false, `${name} — ${err.message?.slice(0, 120)}`])
  }
}

const msgs = (ctx, callId = 'call-1') =>
  collection(ctx.firestore(), 'sos', callId, 'messages')
const msg = (ctx, id, callId = 'call-1') =>
  doc(ctx.firestore(), 'sos', callId, 'messages', id)

// ── read ────────────────────────────────────────────────────────────────────
await check('owner reads own thread', 'allow', () => getDocs(msgs(asGuest)))
await check('staff reads any thread', 'allow', () => getDocs(msgs(asStaff)))
await check('stranger cannot read the thread', 'deny', () => getDocs(msgs(asOther)))
await check('anonymous cannot read the thread', 'deny', () => getDocs(msgs(asAnon)))
await check('owner reads a single line', 'allow', () => getDoc(msg(asGuest, 'm0')))
await check('stranger cannot read a single line', 'deny', () => getDoc(msg(asOther, 'm0')))

// ── create: the `from` spoofing case, which is the whole point ───────────────
await check('owner posts as guest', 'allow', () => setDoc(msg(asGuest, 'm1'), line()))
await check('staff posts as warden', 'allow', () =>
  setDoc(msg(asStaff, 'm2'), line({ from: 'warden', authorName: 'Warden Aldous' }))
)
await check('GUEST CANNOT POST AS WARDEN', 'deny', () =>
  setDoc(msg(asGuest, 'm3'), line({ from: 'warden', authorName: 'Warden Aldous' }))
)
await check('stranger cannot post into the thread', 'deny', () =>
  setDoc(msg(asOther, 'm4'), line())
)
await check('anonymous cannot post', 'deny', () => setDoc(msg(asAnon, 'm5'), line()))
await check('staff cannot post as guest', 'deny', () => setDoc(msg(asStaff, 'm6'), line()))

// ── create: shape ───────────────────────────────────────────────────────────
await check('sosId must match the parent', 'deny', () =>
  setDoc(msg(asGuest, 'm7'), line({ sosId: 'call-demo' }))
)
await check('empty body refused', 'deny', () => setDoc(msg(asGuest, 'm8'), line({ body: '' })))
await check('oversized body refused', 'deny', () =>
  setDoc(msg(asGuest, 'm9'), line({ body: 'x'.repeat(2001) }))
)
await check('2000-char body accepted', 'allow', () =>
  setDoc(msg(asGuest, 'm10'), line({ body: 'x'.repeat(2000) }))
)
await check('non-string body refused', 'deny', () => setDoc(msg(asGuest, 'm11'), line({ body: 5 })))
await check('missing createdAt refused', 'deny', () =>
  setDoc(msg(asGuest, 'm12'), { id: 'm12', sosId: 'call-1', from: 'guest', body: 'hi' })
)
await check('unknown `from` refused', 'deny', () =>
  setDoc(msg(asGuest, 'm13'), line({ from: 'admin' }))
)

// ── the parent call: userId is immutable ────────────────────────────────────
//
// The messages ACL above derives ENTIRELY from sos/{id}.userId via call(), and
// so does the push sender's choice of recipient. If the owner can rewrite that
// field, every guarantee in this file is one updateDoc away from belonging to
// somebody else. These cases exist because the suite originally never wrote to
// a parent sos document at all, and 33/33 green said nothing about it.
const sos = (ctx, id) => doc(ctx.firestore(), 'sos', id)

await check('owner may still stand down their own call', 'allow', () =>
  updateDoc(sos(asGuest, 'call-1'), { status: 'resolved', updatedAt: 9 })
)
await check('OWNER CANNOT REASSIGN A CALL TO ANOTHER GUEST', 'deny', () =>
  updateDoc(sos(asGuest, 'call-1'), { userId: OTHER })
)
await check('OWNER CANNOT RENAME A CALL TO A demo- ID', 'deny', () =>
  updateDoc(sos(asGuest, 'call-1'), { userId: 'demo-anything' })
)
await check('staff cannot reassign a call either', 'deny', () =>
  updateDoc(sos(asStaff, 'call-1'), { userId: OTHER })
)
await check('staff may still dispatch against a call', 'allow', () =>
  updateDoc(sos(asStaff, 'call-1'), { status: 'acknowledged', responder: 'Warden Aldous' })
)
await check('stranger cannot touch the call', 'deny', () =>
  updateDoc(sos(asOther, 'call-1'), { status: 'resolved' })
)

// ── replyBy attributes work to a named employee ─────────────────────────────
//
// The manager card's counters ride on this document, and the guest is a
// legitimate writer of it — their own messages stamp lastMessage* here, which
// is how the board badges without reading a thread. So the ability to write the
// document had to stop short of the one field that credits a person. Both
// shapes are covered because the client writes the DOTTED path, and a rule that
// only caught the whole-map form would let the real write straight through.
await check('a guest may still stamp their own message onto the call', 'allow', () =>
  updateDoc(sos(asGuest, 'call-1'), {
    lastMessageAt: 10,
    lastMessageFrom: 'guest',
    lastMessagePreview: 'is the bridge safe',
    updatedAt: 10,
    messageCount: 1,
  })
)
await check('A GUEST CANNOT INFLATE A WARDEN TALLY', 'deny', () =>
  updateDoc(sos(asGuest, 'call-1'), { replyBy: { [STAFF]: 99 } })
)
await check('A GUEST CANNOT INFLATE A TALLY BY FIELD PATH EITHER', 'deny', () =>
  updateDoc(sos(asGuest, 'call-1'), { [`replyBy.${STAFF}`]: 99 })
)
await check('staff may credit their own reply', 'allow', () =>
  updateDoc(sos(asStaff, 'call-1'), {
    lastMessageAt: 11,
    lastMessageFrom: 'warden',
    updatedAt: 11,
    wardenReplies: 1,
    [`replyBy.${STAFF}`]: 1,
  })
)

// ── every rendered field is type-checked, because a line is write-once ──────
await check('object authorName refused', 'deny', () =>
  setDoc(msg(asGuest, 'm14'), line({ authorName: { toxic: true } }))
)
await check('missing authorName refused', 'deny', () =>
  setDoc(msg(asGuest, 'm15'), {
    id: 'm15',
    sosId: 'call-1',
    from: 'guest',
    body: 'no name on this one',
    createdAt: 2,
  })
)
await check('empty authorName refused', 'deny', () =>
  setDoc(msg(asGuest, 'm16'), line({ authorName: '' }))
)
await check('oversized authorName refused', 'deny', () =>
  setDoc(msg(asGuest, 'm17'), line({ authorName: 'x'.repeat(61) }))
)
await check('non-string id refused', 'deny', () => setDoc(msg(asGuest, 'm18'), line({ id: 7 })))
// The cap is a backstop, not a trap: nothing limits an adventurer's name at
// signup, so `sendMessage` clamps to exactly this length before writing. A
// 60-char name must therefore still get through.
await check('60-char authorName accepted', 'allow', () =>
  setDoc(msg(asGuest, 'm19'), line({ authorName: 'x'.repeat(60) }))
)

// ── written once ────────────────────────────────────────────────────────────
await check('owner cannot edit a line', 'deny', () =>
  updateDoc(msg(asGuest, 'm0'), { body: 'edited' })
)
await check('STAFF CANNOT EDIT A LINE', 'deny', () =>
  updateDoc(msg(asStaff, 'm0'), { body: 'edited' })
)
await check('owner cannot delete a line', 'deny', () => deleteDoc(msg(asGuest, 'm0')))
await check('staff cannot delete a line', 'deny', () => deleteDoc(msg(asStaff, 'm0')))

// ── demo cast parity with the sos block above it ────────────────────────────
await check('real user reaches a demo thread', 'allow', () => getDocs(msgs(asOther, 'call-demo')))
await check('anonymous cannot reach a demo thread', 'deny', () =>
  getDocs(msgs(asAnon, 'call-demo'))
)

// ── pushTokens ──────────────────────────────────────────────────────────────
const tok = (ctx, id) => doc(ctx.firestore(), 'pushTokens', id)
await check('owner files own token', 'allow', () =>
  setDoc(tok(asGuest, 't-guest'), { token: 'abc', userId: GUEST, staff: false })
)
await check('cannot file a token under another uid', 'deny', () =>
  setDoc(tok(asOther, 't-spoof'), { token: 'abc', userId: GUEST, staff: false })
)
await check('owner reads own token row', 'allow', () => getDoc(tok(asGuest, 't-guest')))
await check('stranger cannot read another token row', 'deny', () => getDoc(tok(asOther, 't-guest')))
await check('stranger cannot delete another token row', 'deny', () =>
  deleteDoc(tok(asOther, 't-guest'))
)
await check('owner deletes own token row', 'allow', () => deleteDoc(tok(asGuest, 't-guest')))
await check('anonymous cannot file a token', 'deny', () =>
  setDoc(tok(asAnon, 't-anon'), { token: 'abc', userId: 'anon-uid', staff: true })
)
// The `staff: true` claim is deliberately NOT refused here — the rules do not
// adjudicate it, the SENDER does, against staff/{uid}. This asserts that split
// is real, so nobody later "fixes" the rule and assumes the check moved.
await check('a guest MAY claim staff:true (sender re-checks it)', 'allow', () =>
  setDoc(tok(asGuest, 't-claim'), { token: 'abc', userId: GUEST, staff: true })
)

// ── managers: the grant cannot be self-issued ───────────────────────────────
//
// The Manager's tab is drawn off managers/{uid}, and the entire value of the
// collection is that the only route onto it is a human typing a document into
// the Firebase console. The write cases below are the load-bearing half, for the
// same reason the staff roster's would be: if any client can file its own row,
// the roll is not an allowlist at all, it is a claim.
const mgr = (ctx, uid) => doc(ctx.firestore(), 'managers', uid)

await check('manager reads own manager row', 'allow', () => getDoc(mgr(asManager, MANAGER)))
await check('guest cannot read a manager row', 'deny', () => getDoc(mgr(asGuest, MANAGER)))
await check('STAFF CANNOT READ ANOTHER USER MANAGER ROW', 'deny', () =>
  getDoc(mgr(asStaff, MANAGER))
)
await check('anonymous cannot read a manager row', 'deny', () => getDoc(mgr(asAnon, MANAGER)))
await check('anonymous cannot read even its own manager row', 'deny', () =>
  getDoc(mgr(asAnon, 'anon-uid'))
)
await check('A GUEST CANNOT GRANT THEMSELVES MANAGER', 'deny', () =>
  setDoc(mgr(asGuest, GUEST), { uid: GUEST, name: 'Me' })
)
await check('STAFF CANNOT GRANT THEMSELVES MANAGER', 'deny', () =>
  setDoc(mgr(asStaff, STAFF), { uid: STAFF, name: 'Aldous' })
)
await check('staff cannot grant manager to anybody else', 'deny', () =>
  setDoc(mgr(asStaff, OTHER), { uid: OTHER })
)
await check('a manager cannot rewrite their own row', 'deny', () =>
  updateDoc(mgr(asManager, MANAGER), { name: 'Elevated' })
)
await check('a manager cannot delete their own row', 'deny', () =>
  deleteDoc(mgr(asManager, MANAGER))
)

// Holding a staff doc confers NOTHING here, and the assertion has to look past
// the verdict to prove it. The rule lets anybody read their OWN row, so a staff
// account reading managers/{own uid} is an ALLOW — it simply comes back empty.
// Same distinction the readme draws about a 404 in the REST matrix: the grant is
// the DOCUMENT, not the permission to ask for it, so a case that only checked
// "was it refused" would read this as a manager.
await check('a staff doc alone does not confer a manager doc', 'allow', async () => {
  const snap = await getDoc(mgr(asStaff, STAFF))
  if (snap.exists()) throw new Error(`${STAFF} came with a managers row it was never given`)
  return snap
})
// ...and the seeded manager really does hold both docs, or every case above is
// asserting against a fiction.
await check('the manager also holds a staff doc', 'allow', async () => {
  const snap = await getDoc(doc(asManager.firestore(), 'staff', MANAGER))
  if (!snap.exists()) throw new Error('the manager was seeded without a staff doc')
  return snap
})

// ── parkStatus: staff both ways, closed to guests ───────────────────────────
//
// One rolled-up document, written whole by whichever console is holding the LoRa
// hub on USB — the only machine in the park that can hear a plinth stop
// answering. Staff on BOTH sides is the point: a guest has no business reading
// which stations stand unattended, and a guest who could WRITE it could mark a
// dead plinth healthy and hide it from the person whose job is to go and fix it.
const park = (ctx, id = 'current') => doc(ctx.firestore(), 'parkStatus', id)
const roll = (over = {}) => ({
  id: 'current',
  writtenAt: 2,
  writtenBy: STAFF,
  tableVersion: 1,
  counts: { live: 21 },
  exceptions: [],
  ...over,
})

await check('staff reads the park roll-up', 'allow', () => getDoc(park(asStaff)))
await check('staff writes the park roll-up', 'allow', () => setDoc(park(asStaff), roll()))
// The Manager's tab reaches this on the staff doc it is provisioned alongside,
// not on the managers row — no rule in the file reads the managers collection.
await check('a manager reads the roll-up on their staff doc', 'allow', () => getDoc(park(asManager)))
await check('guest cannot read the park roll-up', 'deny', () => getDoc(park(asGuest)))
await check('A GUEST CANNOT MARK A DEAD PLINTH HEALTHY', 'deny', () =>
  setDoc(park(asGuest), roll())
)
await check('guest cannot delete the park roll-up', 'deny', () => deleteDoc(park(asGuest)))
await check('anonymous cannot read the park roll-up', 'deny', () => getDoc(park(asAnon)))
await check('anonymous cannot write the park roll-up', 'deny', () => setDoc(park(asAnon), roll()))

// Absence is not a refusal. The manager view has to tell "the park has never
// reported" apart from "you may not ask" — parkStatusFreshness renders one as a
// waiting park and the other would be a lie about a permission — so this case
// asserts the rule PASSES on a document that is not there, and looks at the
// snapshot to say so rather than at the verdict alone.
await check('staff read of a roll-up that does not exist is an ALLOW', 'allow', async () => {
  const snap = await getDoc(park(asStaff, 'no-such-roll-up'))
  if (snap.exists()) throw new Error('the fixture leaked a document into parkStatus')
  return snap
})

await env.cleanup()

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
