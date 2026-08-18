import type { Episode } from './types'

// Canon lore — Season 1, ten episodes per organization, sourced from
// content-intake/season-1.json. Titles and story beats are canon; taglines
// and loreOnComplete text are written to be faithful to the source notes.
// ALL-CAPS canon titles (Order of the Realm eps 3-10) are normalized to title
// case here — formatting only, not a content change.
//
// zoneId: canon has no park-zone mapping for episodes (stations are
// in-universe locations, not physical park zones) — assignments below are
// distributed plausibly across existing zones and are PROVISIONAL until the
// park map is calibrated against real station placement.

export const EPISODES: Episode[] = [
  // ---- Rangers of the Kingdom ----
  {
    id: 'rg-01',
    orgId: 'rangers',
    number: 1,
    title: "Aldric's Key",
    tagline: 'Track down Aldric\'s lost key and earn your place among the Rangers.',
    zoneId: 'proving',
    method: 'qr',
    staffCode: 'RANG-101',
    loreOnComplete:
      "Aldric's Key turns warm in your hand as the Rangers welcome you into their ranks — Queston has a new set of eyes in the wild.",
    xp: 40,
  },
  {
    id: 'rg-02',
    orgId: 'rangers',
    number: 2,
    title: "Darish's Arrow",
    tagline: "Follow the flight of Darish's message-arrow and learn what it once warned.",
    zoneId: 'elderwood',
    method: 'qr',
    staffCode: 'RANG-202',
    loreOnComplete:
      "The arrow's story ends where Queston's gates begin — Darish's warning shot still echoes in every Ranger who hears it told.",
    xp: 40,
  },
  {
    id: 'rg-03',
    orgId: 'rangers',
    number: 3,
    title: 'Tune of the Woodlands',
    tagline: "Learn the Rangers' secret signal-tune and craft the instrument that plays it.",
    zoneId: 'hollow',
    method: 'staff',
    staffCode: 'RANG-303',
    loreOnComplete:
      'Your finished instrument sounds the Tune of the Woodlands for the first time — now the whole camp can hear you coming, and going.',
    xp: 40,
  },
  {
    id: 'rg-04',
    orgId: 'rangers',
    number: 4,
    title: "Aldric's Message",
    tagline: 'A signal on the bridge leads to a message Aldric himself once hid.',
    zoneId: 'spire',
    method: 'qr',
    staffCode: 'RANG-404',
    loreOnComplete:
      "Aldric's hand-written message finally reaches daylight, years after the Warden of Queston went silent — and it isn't finished talking yet.",
    xp: 40,
  },
  {
    id: 'rg-05',
    orgId: 'rangers',
    number: 5,
    title: "Ranger's Mettle",
    tagline: 'Prove your bravery and earn the rank of Scout.',
    zoneId: 'proving',
    method: 'staff',
    staffCode: 'RANG-505',
    loreOnComplete:
      "You pass the last test of mettle and a Ranger pins the mark of Scout to your collar — Queston trusts you a little further now.",
    xp: 40,
  },
  {
    id: 'rg-06',
    orgId: 'rangers',
    number: 6,
    title: 'Rumors of Trouble',
    tagline: 'Map the strange markings that might be Brigand scouting signs.',
    zoneId: 'gatehouse',
    method: 'qr',
    staffCode: 'RANG-606',
    loreOnComplete:
      "Your finished map lines up too well with old Brigand sign — the village chief's rumor just became a real worry.",
    xp: 40,
  },
  {
    id: 'rg-07',
    orgId: 'rangers',
    number: 7,
    title: "Shamara's Oath",
    tagline: "Learn how Ranger hero Shamara's sacrifice once saved Queston.",
    zoneId: 'elderwood',
    method: 'staff',
    staffCode: 'RANG-707',
    loreOnComplete:
      "You speak Shamara's oath at the place she gave everything, and for a moment the whole camp goes quiet in her memory.",
    xp: 40,
  },
  {
    id: 'rg-08',
    orgId: 'rangers',
    number: 8,
    title: "Amets' Blade",
    tagline: "Learn the tale of Amets' blade, then forge your own.",
    zoneId: 'forgeworks',
    method: 'qr',
    staffCode: 'RANG-808',
    loreOnComplete:
      "Your own ranger's blade comes together at last, forged in the same spirit as Amets' legendary sword.",
    xp: 40,
  },
  {
    id: 'rg-09',
    orgId: 'rangers',
    number: 9,
    title: 'The Watchers Riddle',
    tagline: "Solve the Watchers' riddle to earn a Ranger's highest trust.",
    zoneId: 'spire',
    method: 'either',
    staffCode: 'RANG-909',
    loreOnComplete:
      'The riddle falls open before you, and the Rangers name you Watcher — few earn the right to stand this watch.',
    xp: 40,
  },
  {
    id: 'rg-10',
    orgId: 'rangers',
    number: 10,
    title: 'The Return of Nordad',
    tagline: "Follow the warnings north to the outpost — and see what's coming.",
    zoneId: 'gatehouse',
    method: 'staff',
    staffCode: 'RANG-999',
    loreOnComplete:
      'From the outpost you see it yourself: banners and smoke on the northern horizon. Nordad has returned, and Queston will need every Ranger it has.',
    xp: 60,
  },

  // ---- Hearers of the Alehiim ----
  {
    id: 'ah-01',
    orgId: 'alehiim',
    number: 1,
    title: 'Hear Us (we hear)',
    tagline: 'Answer the call and be inducted into the Hearers of the Alehiim.',
    zoneId: 'hollow',
    method: 'qr',
    staffCode: 'HEAR-101',
    loreOnComplete:
      "You answer when you're called, and the Hearers answer back — you are one of them now, and the Alehiim always hear their own.",
    xp: 40,
  },
  {
    id: 'ah-02',
    orgId: 'alehiim',
    number: 2,
    title: 'Wisdom Calls',
    tagline: 'Hear the parable of the pearl and craft your own pearl of wisdom.',
    zoneId: 'lake',
    method: 'qr',
    staffCode: 'HEAR-202',
    loreOnComplete:
      "Your finished pearl of wisdom catches the light like the parable promised — some things really are worth selling everything for.",
    xp: 40,
  },
  {
    id: 'ah-03',
    orgId: 'alehiim',
    number: 3,
    title: 'He Finds What is Lost',
    tagline: 'Learn what was lost, and what was found, and craft a pouch to hold it.',
    zoneId: 'hollow',
    method: 'staff',
    staffCode: 'HEAR-303',
    loreOnComplete:
      'You tie off the little pouch, made to keep found things safe — a small, quiet reminder that nothing stays lost forever.',
    xp: 40,
  },
  {
    id: 'ah-04',
    orgId: 'alehiim',
    number: 4,
    title: 'Working Trough',
    tagline: 'Weave something small and learn how the Most High works through broken things.',
    zoneId: 'forgeworks',
    method: 'qr',
    staffCode: 'HEAR-404',
    loreOnComplete:
      'The threads come together in your hands, imperfect and whole at once — exactly the point of the lesson.',
    xp: 40,
  },
  {
    id: 'ah-05',
    orgId: 'alehiim',
    number: 5,
    title: 'Tremblers',
    tagline: "Walk the path of those who trembled at the Most High's word.",
    zoneId: 'lake',
    method: 'staff',
    staffCode: 'HEAR-505',
    loreOnComplete:
      'Your finished piece chimes softly as you walk — and the Hearers welcome you among the Tremblers, those who listen with their whole hearts.',
    xp: 40,
  },
  {
    id: 'ah-06',
    orgId: 'alehiim',
    number: 6,
    title: 'Planted by the Water',
    tagline: 'Follow the ancient carvings to where the Wisetree wood was hidden.',
    zoneId: 'lake',
    method: 'qr',
    staffCode: 'HEAR-606',
    loreOnComplete:
      'The carvings lead true, and the hidden Wisetree wood turns up right where the old story said it would.',
    xp: 40,
  },
  {
    id: 'ah-07',
    orgId: 'alehiim',
    number: 7,
    title: 'Repaired not Discarded',
    tagline: 'Hear the story of the girl who thought she was broken, then mend a piece of clay.',
    zoneId: 'forgeworks',
    method: 'staff',
    staffCode: 'HEAR-707',
    loreOnComplete:
      'The repaired clay is stronger at the seams than it ever was whole — just like the girl in the story, and maybe like you too.',
    xp: 40,
  },
  {
    id: 'ah-08',
    orgId: 'alehiim',
    number: 8,
    title: 'Waiting (hope)',
    tagline: 'Learn why the Alehiim call seeds a picture of hope.',
    zoneId: 'elderwood',
    method: 'qr',
    staffCode: 'HEAR-808',
    loreOnComplete:
      'You plant your seed craft with the rest, one more small hope added to a hollow full of them.',
    xp: 40,
  },
  {
    id: 'ah-09',
    orgId: 'alehiim',
    number: 9,
    title: 'Secret Places',
    tagline: 'Craft the leaf cloak and learn the secret places only a few carry.',
    zoneId: 'elderwood',
    method: 'either',
    staffCode: 'HEAR-909',
    loreOnComplete:
      'The leaf cloak settles over your shoulders, and the Hearers name you among the Hidden — the secret places of the Kingdom are yours to keep now.',
    xp: 40,
  },
  {
    id: 'ah-10',
    orgId: 'alehiim',
    number: 10,
    title: 'Seed of the Wisetree',
    tagline: 'Replant the seed of the Wisetree and call the people home.',
    zoneId: 'elderwood',
    method: 'staff',
    staffCode: 'HEAR-999',
    loreOnComplete:
      'The seed goes back into the earth where it belongs, and somewhere in the hollow, the Alehiim begin to sing the people home.',
    xp: 60,
  },

  // ---- Order of the Realm ----
  {
    id: 'el-01',
    orgId: 'elm',
    number: 1,
    title: 'The Order Begins',
    tagline: "Retrace Ellowyn and Able's first night of adventure — and found the Order.",
    zoneId: 'gatehouse',
    method: 'qr',
    staffCode: 'RLM-101',
    loreOnComplete:
      'The royal messenger meets you at the trail\'s end and makes it official: you are among the first commissioned members of the Order of the Realm.',
    xp: 40,
  },
  {
    id: 'el-02',
    orgId: 'elm',
    number: 2,
    title: 'A Call to Order',
    tagline: 'Prove the Order is worth taking seriously to the Captain of the Guard.',
    zoneId: 'proving',
    method: 'qr',
    staffCode: 'RLM-202',
    loreOnComplete:
      'The mission is done, quietly and well — the Captain of the Guard is amused, intrigued, and just a little impressed.',
    xp: 40,
  },
  {
    id: 'el-03',
    orgId: 'elm',
    number: 3,
    title: 'The Tales of the Order',
    tagline: "Act out the Order's most celebrated deeds — and hear how ordinary they really were.",
    zoneId: 'hollow',
    method: 'staff',
    staffCode: 'RLM-303',
    loreOnComplete:
      "Able's dry commentary undercuts every heroic flourish, but the Order's spirit comes through anyway, embellishments and all.",
    xp: 40,
  },
  {
    id: 'el-04',
    orgId: 'elm',
    number: 4,
    title: 'Voices in the Forest',
    tagline: 'Investigate strange sounds in the forest — and choose what to do with what you find.',
    zoneId: 'elderwood',
    method: 'qr',
    staffCode: 'RLM-404',
    loreOnComplete:
      'Devorah watches quietly from the trees as you make your choice. Whatever you decided, the people of the leaves are one step closer to being known.',
    xp: 40,
  },
  {
    id: 'el-05',
    orgId: 'elm',
    number: 5,
    title: "The King's Eyes",
    tagline: "Navigate the settlement's politics under the king's watchful representative.",
    zoneId: 'gatehouse',
    method: 'staff',
    staffCode: 'RLM-505',
    loreOnComplete:
      "You keep the Order's secrets and your composure both — Ellowyn names you Sworn of the Realm, an oath that has now been tested and held.",
    xp: 40,
  },
  {
    id: 'el-06',
    orgId: 'elm',
    number: 6,
    title: 'The Song of the Stones',
    tagline: 'Translate the ancient carvings hidden beneath a fallen elm.',
    zoneId: 'spire',
    method: 'qr',
    staffCode: 'RLM-606',
    loreOnComplete:
      "Able's translation stops everyone cold: a name carved in ancient stone, a warning of return. Nordad.",
    xp: 40,
  },
  {
    id: 'el-07',
    orgId: 'elm',
    number: 7,
    title: "Able's Trial",
    tagline: "Walk with Able through the hardest choice of his life.",
    zoneId: 'elderwood',
    method: 'staff',
    staffCode: 'RLM-707',
    loreOnComplete:
      'Able turns down the offer that could have changed everything — and tells no one what it cost him.',
    xp: 40,
  },
  {
    id: 'el-08',
    orgId: 'elm',
    number: 8,
    title: "Nordad's Shadow",
    tagline: 'Investigate a brigand camp and find a message meant for the Order.',
    zoneId: 'proving',
    method: 'qr',
    staffCode: 'RLM-808',
    loreOnComplete:
      "A crude carving of a broken elm waits at the camp — Nordad knows about the Order now. Ellowyn refuses to back down.",
    xp: 40,
  },
  {
    id: 'el-09',
    orgId: 'elm',
    number: 9,
    title: "Devorah's Warning",
    tagline: 'Meet Devorah beneath the Story Oak and learn what she has always known.',
    zoneId: 'elderwood',
    method: 'either',
    staffCode: 'RLM-909',
    loreOnComplete:
      'Devorah\'s words leave Ellowyn and Able shaken and steady all at once. The Order names you Guardian of the Realm — you are ready for what comes next.',
    xp: 40,
  },
  {
    id: 'el-10',
    orgId: 'elm',
    number: 10,
    title: 'The Breaking Point',
    tagline: "Stand with Ellowyn as the Order chooses its part in the coming battle.",
    zoneId: 'proving',
    method: 'staff',
    staffCode: 'RLM-999',
    loreOnComplete:
      'Able chooses the Order, chooses Ellowyn, chooses to walk forward anyway. Whatever comes next, the Order of the Realm faces it together.',
    xp: 60,
  },
]

export function episodesFor(orgId: string): Episode[] {
  return EPISODES.filter((e) => e.orgId === orgId).sort((a, b) => a.number - b.number)
}

export function getEpisode(id: string): Episode | undefined {
  return EPISODES.find((e) => e.id === id)
}
