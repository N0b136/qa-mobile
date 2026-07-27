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
