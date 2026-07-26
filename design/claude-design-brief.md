# Claude Design starting prompt — Questland Adventures

Paste the following into Claude Design as the starting prompt.

---

Design a touch-first mobile web app UI at 375x812 (portrait, installable PWA) for "Questland Adventures" — guests of a real-world fantasy adventure park use it to run quests inside the park, book visits, and get help.

**Tone:** bright family fantasy — warm, colorful, storybook. Parchment background #F7EDD8, warm brown ink text #43301C, gold primary buttons #E8A23D (gradient to #C9822A, chunky 3D press feel), rounded corners 14-20px, soft warm shadows. Display font: Baloo 2 (or similar friendly rounded); body: Nunito. Readable by a 9-year-old, charming to adults. Fantasy flourish never beats usability.

**Organization accent colors:** Order of the Emberforge — ember orange #D9622B; Sylvan Wardens — forest green #3E7C4F; Arcanum of the Silver Star — arcane purple #7B5EA7.

**Frame:** top bar (crest logo left, notification bell with unread badge right) + bottom nav with 5 tabs: Home, Map, Quests, Book, More.

**Screens (priority order):**
1. Welcome -> sign in / create account -> onboarding (adventurer name + emoji-avatar grid).
2. Home dashboard: greeting with avatar + adventurer level ring, three per-organization quest progress cards, "next visit" booking card, horizontally scrolling upcoming-events carousel.
3. Illustrated park map (storybook style, 7 zones: Gatehouse Plaza, Merchant's Hollow, the Forgeworks, the Elderwood, Lake Lumen, the Astral Spire, Proving Grounds) with tappable points of interest opening a bottom sheet, a player position pin, and a floating SOS button.
4. Quests hub: 3 organization cards showing rank + progress; org detail is a vertical 10-episode winding trail with completed / current / locked states and rank-checkpoint badges; episode bottom sheet with "Scan QR" and "Enter staff code" actions; a rank-up celebration moment.
5. Booking: 3 tier cards (day pass / hero package / family charter), date + arrival window + party size steppers, add-ons, simulated checkout, confirmation with booking code, my-bookings list.
6. Notification center: event / booking-reminder / lore-message types, distinct icons.
7. Help, tiered: big reassuring emergency SOS flow (sends location to park rangers; status timeline sent -> acknowledged -> help on the way; phone call button) versus lighter "quest help" (hints + chat with a quest guide).
8. Fellowship (party): invite code share, member progress list.
9. System states: empty states, offline banner, push-permission ask moment.

**Moments to make special:** episode completion (lore reveal card), rank-up celebration, booking confirmation, SOS "a ranger is on the way" reassurance.

**Accessibility:** 4.5:1 contrast, 44px touch targets, primary actions in thumb reach.
