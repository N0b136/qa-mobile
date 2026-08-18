import type { BookingTier, AddOn } from './types'

// Canon lore — sourced from content-intake/ticketing.json ("QA Revenue
// Model.docx"). Four ticket categories: single-day (individual), single-day
// (group), Citizen of Questia membership (monthly recurring), and birthday
// packages (flat-fee event bookings).

export const TIERS: BookingTier[] = [
  // ---- Single-Day Admission — Individual ----
  {
    id: 'adventurer',
    category: 'day',
    name: 'Adventurer Pass',
    tagline: 'Basic Access — one Quest Experience.',
    icon: 'backpack',
    priceAdult: 25,
    priceChild: 25,
    // "1 Quest Experience" — one episode, on the booked day only. The
    // passage carries that one quest however many guests it was booked for.
    pass: { validFor: 'day', quests: 1, per: 'day' },
    perks: [
      'Access to Village of Queston',
      '1 Quest Experience',
      'Ages 3 & under free with a paying adult',
    ],
  },
  {
    id: 'hero',
    category: 'day',
    name: 'Hero Pass',
    tagline: 'All-Access — every Quest Experience, all day.',
    icon: 'swords',
    priceAdult: 35,
    priceChild: 35,
    featured: true,
    // "Full-day access ... ALL THREE Quest Experiences" — unlimited for the day.
    pass: { validFor: 'day', quests: null, per: 'day' },
    perks: [
      'Full-day access to Village of Queston',
      'ALL THREE Quest Experiences',
      'Ages 3 & under free with a paying adult',
    ],
  },

  // ---- Single-Day Admission — Group ----
  {
    id: 'group-adventurer',
    category: 'day-group',
    name: 'Group Adventurer Pass',
    tagline: 'Bring the crew — one Quest Experience each.',
    icon: 'users',
    flatPrice: 90,
    maxParty: 6,
    perPersonOver: { included: 6, price: 5 },
    // Group rate on the Adventurer terms: one Quest Experience, that day,
    // walking in everyone the group covers.
    pass: { validFor: 'day', quests: 1, per: 'day' },
    perks: [
      'Admission for up to 6 guests',
      'Village of Queston access + 1 Quest Experience',
      '+$5 per additional guest',
      'Groups of 10+: call for a discounted day rate',
    ],
  },
  {
    id: 'group-hero',
    category: 'day-group',
    name: 'Group Hero Pass',
    tagline: 'Bring the crew — full access, all day.',
    icon: 'shield',
    flatPrice: 125,
    maxParty: 6,
    perPersonOver: { included: 6, price: 5 },
    // Group rate on the Hero terms: all three quests, all day.
    pass: { validFor: 'day', quests: null, per: 'day' },
    perks: [
      'Admission for up to 6 guests',
      'Full-day access to Village of Queston',
      'ALL THREE Quest Experiences',
      '+$5 per additional guest',
      'Groups of 10+: call for a discounted day rate',
    ],
  },

  // ---- Citizen of Questia Membership (recurring, monthly) ----
  {
    id: 'membership-adventurer',
    category: 'membership',
    name: 'Adventurer Membership',
    tagline: 'One visit a week, all season long.',
    icon: 'badge',
    monthly: true,
    flatPrice: 30,
    // "One visit per week ... 1 Quest Experience per visit" — the allowance
    // refreshes weekly and the membership runs a month from its start date.
    pass: { validFor: 'month', quests: 1, per: 'week' },
    perks: [
      'One visit per week',
      'Village of Queston access',
      '1 Quest Experience per visit',
      'Two guest passes per month',
    ],
  },
  {
    id: 'membership-hero',
    category: 'membership',
    name: 'Hero Membership',
    tagline: 'Unlimited visits, unlimited quests.',
    icon: 'badge-check',
    monthly: true,
    flatPrice: 35,
    // "Unlimited visits, unlimited access to ALL 3 Quests", all month.
    pass: { validFor: 'month', quests: null, per: 'month' },
    perks: [
      'Unlimited visits',
      'Unlimited access to ALL 3 Quests',
      'Two guest passes per month',
      'Discounts on select experiences and merchandise',
      'Early access to Night Quests',
      'Early access to Holiday Adventures',
      'Early access to the End-of-Year Raid',
      'Early ticket access to special events',
    ],
  },
  {
    id: 'membership-family',
    category: 'membership',
    name: 'Family Hero Membership',
    tagline: 'Unlimited visits for the whole crew.',
    icon: 'users-round',
    monthly: true,
    flatPrice: 45,
    maxParty: 6,
    perPersonOver: { included: 6, price: 5 },
    // Unlimited, all month, for the whole household.
    pass: { validFor: 'month', quests: null, per: 'month' },
    perks: [
      'Unlimited visits for up to 6 family members',
      'Unlimited access to ALL 3 Quests',
      '+$5 per additional family member, per month',
      'Two guest passes per month',
      'Discounts on select experiences and merchandise',
      'Early access to Night Quests, Holiday Adventures & the End-of-Year Raid',
      'Early ticket access to special events',
    ],
  },

  // ---- Birthday Packages (flat fee, per event) ----
  {
    id: 'birthday-adventurer',
    category: 'birthday',
    name: 'Adventurer Birthday Package',
    tagline: 'A full quest-party celebration.',
    icon: 'cake',
    flatPrice: 350,
    // "Exclusive 1h Quest Lane Reservation" — one Quest Experience for the
    // party, on the day of the celebration.
    pass: { validFor: 'day', quests: 1, per: 'day' },
    perks: [
      'Up to 15 children (plus adults)',
      'Exclusive 1-hour Quest Lane reservation',
      '2-hour party room in the Village of Queston',
      '1 large pizza + 2L beverage per 5 questers',
      'Plates, cups & napkins included',
    ],
  },
  {
    id: 'birthday-hero',
    category: 'birthday',
    name: 'Hero Birthday Package',
    tagline: 'The full hero treatment.',
    icon: 'party-popper',
    flatPrice: 450,
    // Everything in the Adventurer package: one Quest Experience for the
    // party, on the day of the celebration.
    pass: { validFor: 'day', quests: 1, per: 'day' },
    perks: [
      'Everything in the Adventurer package',
      "Birthday child's choice: custom Blacksmith Sword or Hero Cape",
      'Exclusive Questia character meet & greet',
      'Guest favors: Questia badge + 1-day return admission ticket',
    ],
  },
]

export const ADD_ONS: AddOn[] = [
  {
    id: 'feast',
    name: 'Feast of the Realms',
    price: 18,
    icon: 'utensils',
    blurb: 'A legendary meal: roasted game, fresh bread, enchanted honeycakes, and cider that tastes like starlight.',
  },
  {
    id: 'gear',
    name: 'Enchanted Gear Rental',
    price: 12,
    icon: 'wand-sparkles',
    blurb: 'Cloak, lantern, and boots made for wandering—they\'ve carried a thousand heroes and never complained.',
  },
  {
    id: 'chronicle',
    name: 'Chronicle Photo Pack',
    price: 15,
    icon: 'camera',
    blurb: 'Professional portraits and candid moments bound into a keepsake chronicle you\'ll treasure for years.',
  },
]

export const ARRIVAL_SLOTS = ['09:00', '11:00', '13:00'] as const

/**
 * True when the tier is a Citizen of Questia membership (`category:
 * 'membership'` — membership-adventurer / -hero / -family). The category
 * field is the predicate, never the display name: copy gets rewritten,
 * categories are the revenue model.
 */
export function isMembershipTier(tierId: string): boolean {
  return TIERS.find((t) => t.id === tierId)?.category === 'membership'
}
