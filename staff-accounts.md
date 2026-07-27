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

## Removing a staff member

Delete their `staff/{uid}` document. That revokes every staff power immediately
— the rules stop matching on the next request, with no deploy. Deleting the
Firebase Auth user as well stops them signing in at all.

## What a staff account can and cannot do

**Can:** read the whole calls board and dispatch or resolve any call; send word
to any guest, party or order; create, fire and cancel scheduled sends; read the
guest directory.

**Cannot:** read any guest's `accounts` doc (nobody but the guest can — that is
the only place an email is stored), read a guest's bookings, or alter anyone's
progress or party membership.

## If a guest signs in to the console

They authenticate fine — it is one shared Firebase Auth user pool — and are then
turned away at the gate with *"That account is not on the guild roll."* The
session is dropped straight away. They are granted nothing in the meantime,
because the rules never consulted the gate in the first place.
