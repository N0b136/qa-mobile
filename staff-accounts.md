# Staff accounts for the Back Office console

The console at `/console` no longer trusts a locally-picked persona. Whoever
opens it signs in with a real Firebase account, and only an account carrying a
`staff/{uid}` document gets in.

That document is the entire authorisation model. The Firestore rules gate every
staff power on it — seeing the whole calls board, sending word to another guest,
scheduling anything — and **no client may write to the `staff` collection**, so
nobody can promote themselves. Staff are provisioned by hand, by you.

## Creating a staff member

Two steps in the Firebase console, both in project **qa-mobile-36a9c**.

**1. Create the login.** Authentication → Users → *Add user*. Enter the guild
email and a password (6 characters minimum). Copy the **User UID** it shows in
the table afterwards — you need it for step 2.

**2. Put them on the roll.** Firestore Database → *Start collection* `staff` (or
open it if it exists) → *Add document*, with the **Document ID set to that exact
UID**. Fields:

| Field       | Type   | Value                                             |
|-------------|--------|---------------------------------------------------|
| `name`      | string | `Warden Aldous` — shown in the header and stamped on every dispatch |
| `role`      | string | `warden` or `guide`                               |
| `personaId` | string | *optional* — `warden-aldous`, `warden-maera`, `guide-wren`, `guide-bram`. Borrows that persona's glyph and blurb from `src/content/staff.ts`. Anything else, or omitted, falls back to a shield for Wardens and a life-buoy for Guides. |

Repeat per staff member. The four canon personas are only presentation; the
account and its `staff` doc are the real identity.

## Signing in with Google, and moving an account across

The console takes **either** a guild email and password **or** a Google account.
Both land on the same check — does `staff/{uid}` exist — so the provider proves
who you are and the roll decides what that gets you. Adding Google changed no
rule and no permission.

**One-time project setting, before any of this works.** Firebase OAuth refuses
to run on a domain that is not on its allowlist, and email/password never needed
one — so the console has been serving from an unlisted domain all along without
noticing. In the Firebase console: **Authentication → Settings → Authorised
domains**, add **`n0b136.github.io`** (and any custom domain the console is
served from). Without it, Google sign-in fails with `auth/unauthorized-domain`;
the gate reports that in plain words and the password form still works.

**Why bother.** The QAios vault keys its own roster by a Google uid. Someone
signing into the console with a password and into the vault with Google is two
identities in one Firebase project, and neither app can tell they are the same
person. One Google account everywhere ends that.

**Moving somebody across.** A Google account is a *different* Firebase user from
that person's password account, with a different uid — the two cannot be merged
after the fact. So the move is: put the Google uid on the roll, then retire the
password account.

1. Have them open the console and press **Sign in with Google**.
2. They will be refused — no `staff` doc yet — and the gate shows them their
   **uid**. Have them send it to you. (It is their own identifier, shown only to
   them; nothing is granted by seeing it.)
3. Firestore Database → `staff` → *Add document*, **Document ID set to that
   uid**, same `name` / `role` / `personaId` fields as above. If they hold a
   `managers` doc, add one under the new uid too — a manager needs both.
4. Have them sign in with Google again. They are in.
5. Once they have signed in successfully, delete the old password user under
   Authentication → Users, and its old `staff` (and `managers`) document.

**Do step 5 last, and only after step 4 has actually worked.** The password form
is still there on purpose: until every account has been moved, it is the way
back in for anyone whose Google uid is not yet on the roll. Nobody can lock
themselves out by trying Google early — an unknown account is simply refused,
exactly like any stranger, and the session is dropped.

The password form comes out of the gate on the day the last account is moved.

## Installing the console on a home screen

The Back Office installs as **its own app**, separate from the guest app, with
its own icon — a gold Warden's shield on slate, rather than the gemstone Q.

Open **`/console.html`** (for the Pages deploy, `https://n0b136.github.io/qa-mobile/console.html`)
and install from there:

- **Android / desktop Chrome or Edge** — the install control appears in the
  address bar, or under the browser menu as *Install Questland Back Office*.
- **iPhone / iPad** — Safari only: *Share* → *Add to Home Screen*. Chrome on iOS
  cannot install web apps.

The plain `/console` address still works and now forwards to `console.html`, so
old bookmarks are fine. Install from `console.html` specifically, though:
an app's identity comes from the manifest the page links, so installing while
inside the guest app would install the *guest* app under a Back Office name.

One caution: both apps share the same browser storage, because they are the same
site. A device signed in to the console holds a staff Firebase session, which is
not the session the guest app expects — so keep staff devices and guest devices
separate rather than installing both on one phone.

## Removing a staff member

Delete their `staff/{uid}` document. That revokes every staff power immediately
— the rules stop matching on the next request, with no deploy. Deleting the
Firebase Auth user as well stops them signing in at all.

## What a staff account can and cannot do

**Can:** read the whole calls board and dispatch or resolve any call; send word
to any guest, party or order; create, fire and cancel scheduled sends; read the
guest directory; watch the stations board (who is checked in where).

**Cannot:** read any guest's `accounts` doc (nobody but the guest can — that is
the only place an email is stored), read a guest's bookings, or alter anyone's
progress, party membership or station check-ins. Presence is written by the
guest's own device only — even staff cannot place somebody at a station.

## If a guest signs in to the console

They authenticate fine — it is one shared Firebase Auth user pool — and are then
turned away at the gate with *"That account is not on the guild roll."* The
session is dropped straight away. They are granted nothing in the meantime,
because the rules never consulted the gate in the first place.
