// Reproduces `firebase deploy`'s codebase analysis: load the compiled entry
// point and see which functions it discovers.
//
// This exists because of a real failure. `import { logger } from
// 'firebase-functions'` loads the root barrel, which eagerly pulls in the
// Realtime Database provider -> firebase-admin/database ->
// @firebase/database-compat -> @firebase/app. That last one is an OPTIONAL
// peer dependency, so npm is right not to install it, and the require throws
// MODULE_NOT_FOUND during analysis — before a single function is examined.
// tsc is perfectly happy with it, so only actually loading the bundle catches it.
import { spawnSync } from 'node:child_process'

const EXPECTED = ['onSosMessage', 'onRadioDrop']

const res = spawnSync(
  process.execPath,
  ['-e', "const m=require('./lib/index.js');console.log(Object.keys(m).join(','))"],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      // The deploy sets these; without them the storage trigger cannot resolve
      // its default bucket and throws for an unrelated reason.
      GCLOUD_PROJECT: 'qa-mobile-36a9c',
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'qa-mobile-36a9c',
        storageBucket: 'qa-mobile-36a9c.firebasestorage.app',
      }),
    },
  }
)

let fails = 0
const check = (name, ok, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
}

check('codebase loads without throwing', res.status === 0, res.status === 0 ? '' : (res.stderr || '').split('\n').slice(0, 6).join(' | '))

const found = (res.stdout || '').trim().split(',').filter(Boolean)
for (const fn of EXPECTED) check(`discovers ${fn}`, found.includes(fn))
check('exports nothing unexpected', found.every((f) => EXPECTED.includes(f)), found.join(','))

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`)
process.exit(fails ? 1 : 0)
