// Game names are built only from these curated lists, so nothing a child types can
// ever appear on a public board. Stored as "adjective-animal-number" indices.
export const ADJECTIVES = [
  'Speedy', 'Sunny', 'Brave', 'Clever', 'Happy', 'Lucky', 'Mighty', 'Jolly', 'Zippy', 'Bouncy',
  'Sparkly', 'Cosmic', 'Golden', 'Silver', 'Rapid', 'Turbo', 'Bright', 'Calm', 'Cheery', 'Daring',
  'Dizzy', 'Fizzy', 'Fluffy', 'Gentle', 'Giant', 'Glowing', 'Groovy', 'Kind', 'Magic', 'Merry',
  'Nimble', 'Plucky', 'Quick', 'Rainbow', 'Rocket', 'Shiny', 'Smiley', 'Snappy', 'Starry', 'Super',
  'Swift', 'Thunder', 'Tiny', 'Wise', 'Witty', 'Zesty', 'Breezy', 'Comet', 'Electric', 'Lively'
];
export const ANIMALS = [
  'Otter', 'Panda', 'Tiger', 'Koala', 'Falcon', 'Dolphin', 'Penguin', 'Rabbit', 'Lion', 'Zebra',
  'Giraffe', 'Hippo', 'Turtle', 'Owl', 'Fox', 'Badger', 'Hedgehog', 'Squirrel', 'Beaver', 'Llama',
  'Camel', 'Cheetah', 'Elephant', 'Flamingo', 'Gecko', 'Hawk', 'Jaguar', 'Kangaroo', 'Lemur', 'Meerkat',
  'Narwhal', 'Octopus', 'Parrot', 'Puffin', 'Quokka', 'Raccoon', 'Seal', 'Toucan', 'Walrus', 'Yak',
  'Bison', 'Crab', 'Duck', 'Eagle', 'Frog', 'Goat', 'Heron', 'Ibis', 'Moose', 'Robin'
];

const CODE = /^(\d{1,3})-(\d{1,3})-(\d{2})$/;

export function isGameNameCode(code) {
  const m = CODE.exec(String(code || ''));
  return !!m && Number(m[1]) < ADJECTIVES.length && Number(m[2]) < ANIMALS.length;
}

export function renderGameName(code) {
  if (!isGameNameCode(code)) return 'Bridge Driver';
  const [, a, n, d] = CODE.exec(code);
  return `${ADJECTIVES[Number(a)]} ${ANIMALS[Number(n)]} ${d}`;
}

// Small seeded generator so suggestions are reproducible in tests.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function suggestGameNames(count = 3, seed = (Math.random() * 2 ** 31) | 0) {
  const rnd = mulberry32(seed);
  const out = new Map();
  while (out.size < count) {
    const a = Math.floor(rnd() * ADJECTIVES.length);
    const n = Math.floor(rnd() * ANIMALS.length);
    const d = String(10 + Math.floor(rnd() * 90));
    const code = `${a}-${n}-${d}`;
    out.set(code, { code, name: renderGameName(code) });
  }
  return [...out.values()];
}
