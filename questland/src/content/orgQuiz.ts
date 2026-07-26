/**
 * Organization Quiz — matches a new guest to their best-fit starting organization.
 *
 * Scoring: tally the winning org across the guest's six answers (highest count wins).
 * Themes are canon; the UI handles ties and offers a manual "choose for myself" override.
 * Voice: warm, ceremonious Guide reading the guest's character through their choices.
 */

export type OrgId = 'rangers' | 'alehiim' | 'elm'

export interface OrgQuizOption {
  text: string
  org: OrgId
  theme: string
}

export interface OrgQuizQuestion {
  id: string
  prompt: string
  options: OrgQuizOption[]
}

export const ORG_THEMES: Record<OrgId, string[]> = {
  rangers: ['Nature', 'Courage', 'Survival'],
  alehiim: ['Hope', 'Faith', 'Healing'],
  elm: ['Integrity', 'Adventure', 'Intrigue'],
}

export const ORG_QUIZ: OrgQuizQuestion[] = [
  {
    id: 'q1',
    prompt: 'You find yourself at a crossroads in unfamiliar lands. Which calls to you most?',
    options: [
      { text: 'The forest paths, where the land speaks its own language', org: 'rangers', theme: 'Nature' },
      { text: 'Pressing onward, trusting better days lie ahead', org: 'alehiim', theme: 'Hope' },
      { text: 'The mountain ridge. Steep, but the view from above will be worth it', org: 'elm', theme: 'Adventure' },
    ],
  },
  {
    id: 'q2',
    prompt: 'A mistake has cost someone dearly. How do you respond?',
    options: [
      { text: 'You have faith they will mend, and believe in their strength', org: 'alehiim', theme: 'Faith' },
      { text: 'You face them plainly and make what amends you can', org: 'rangers', theme: 'Courage' },
      { text: 'You own the error fully, no excuses or deflection', org: 'elm', theme: 'Integrity' },
    ],
  },
  {
    id: 'q3',
    prompt: 'A merchant offers you three paths through bandit country. Which do you choose?',
    options: [
      { text: 'The one nobody suspects, where secrets run deep', org: 'elm', theme: 'Intrigue' },
      { text: 'The well-traveled road where healers keep watch', org: 'alehiim', theme: 'Healing' },
      { text: 'The hidden route only locals know—difficult but safe', org: 'rangers', theme: 'Survival' },
    ],
  },
  {
    id: 'q4',
    prompt: 'You read signs most do not. What do you trust most?',
    options: [
      { text: 'The patterns others miss, the threads nobody else sees', org: 'elm', theme: 'Intrigue' },
      { text: 'The pull of something vast and good you cannot name', org: 'alehiim', theme: 'Faith' },
      { text: 'The way animals move, how plants bend, what the earth tells you', org: 'rangers', theme: 'Nature' },
    ],
  },
  {
    id: 'q5',
    prompt: 'Your companion doubts the mission will succeed. What do you offer?',
    options: [
      { text: 'We will find the way. Light breaks through every shadow', org: 'alehiim', theme: 'Hope' },
      { text: 'I gave my word. That is enough', org: 'elm', theme: 'Integrity' },
      { text: 'We have the means and the cunning to endure', org: 'rangers', theme: 'Survival' },
    ],
  },
  {
    id: 'q6',
    prompt: 'Resources are thin. Where do you focus your effort?',
    options: [
      { text: 'Standing watch, so others can rest', org: 'rangers', theme: 'Courage' },
      { text: 'Mapping what lies beyond the next ridge', org: 'elm', theme: 'Adventure' },
      { text: 'Tending to wounds and broken spirits', org: 'alehiim', theme: 'Healing' },
    ],
  },
]
