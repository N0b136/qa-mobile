// Rules suite for the chat lane. Runs against the Firestore emulator, so the
// staff cases are reachable (staff/{uid} is unwritable by any client in prod).
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
const asAnon = env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } })

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'staff', STAFF), { name: 'Warden Aldous', role: 'warden' })
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

await env.cleanup()

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
