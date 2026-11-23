// Seed content so a fresh Folio has something to read.
// Every seeded author's password is "reader".

const crypto = require('crypto');

const AUTHORS = [
  { username: 'marguerite', name: 'Marguerite Vale', bio: 'Keeper of a small lighthouse and a large notebook.' },
  { username: 'theo', name: 'Theo Okafor', bio: 'Bakes bread at 4am. Writes about it at 5.' },
  { username: 'ines', name: 'Inés Robles', bio: 'Botanist. Talks to ferns, mostly listens.' },
  { username: 'august', name: 'August Lindqvist', bio: 'Night-train enthusiast. Collector of timetables.' },
  { username: 'pip', name: 'Pip Harrow', bio: 'Third-year apprentice cartographer. Maps of places that might exist.' },
  { username: 'guest', name: 'A Guest Reader', bio: 'Just browsing the stacks.' },
];

// [author, hoursAgo, text]
const POSTS = [
  ['marguerite', 140, 'The fog came in before supper and never left. I lit the lamp an hour early and watched it carve a white road out over the water. Somewhere out there a fishing boat answered with its horn, two long, one short — the old way of saying thank you.'],
  ['theo', 138, 'First loaf of the season with the new rye starter. It rose like it had somewhere to be. Crumb was open, crust crackled as it cooled — the bread was singing, as my grandmother used to say.'],
  ['ines', 130, 'Found a maidenhair fern growing in the crack of a retaining wall downtown. No soil to speak of, just persistence and the drip from a broken gutter. I have been thinking about it all day.'],
  ['august', 120, 'The 22:40 to the coast has a dining car with brass lamps and a waiter who calls everyone "traveller." I ordered tea I did not want simply to be called traveller again.'],
  ['pip', 117, 'Today I drew a river that bends three times around the same hill, as though it could not decide whether to leave. My teacher says rivers do not do that. I have seen people do it.'],
  ['marguerite', 100, 'A gull has taken to sitting on the gallery rail every morning at six. I have named him Admiral. He has not agreed to this.'],
  ['theo', 96, 'Note to self: never open the oven to check on a soufflé, never interrupt a friend mid-story, never fold the dough before it tells you it is ready.'],
  ['ines', 76, 'Spent the morning cataloguing mosses with a hand lens. At ten times magnification a patch of green becomes a forest, and the forest has weather.'],
  ['august', 72, 'Missed my connection at a junction with one bench, one lamp, and one vending machine selling only oranges. Ate two oranges. Watched the signal turn green for a train that wasn’t mine. Strangely, a perfect evening.'],
  ['pip', 52, 'Question for the shelf: if you could add one place to any map — real or not — what would it be? I would add a small island that only appears at low tide, with a single tree and a postbox.'],
  ['marguerite', 49, 'Storm last night. The lens turned and turned and the rain came sideways and I wrote letters to no one by lamplight. In the morning the sea was flat as a plate, pretending nothing had happened.'],
  ['theo', 30, 'Someone left a note in the bakery tip jar: "For the cardamom buns. They made my mother laugh." I have read it eleven times.'],
  ['ines', 26, 'The first frost came for the basil. I knew it would. I still went out in my coat with a flashlight and said sorry.'],
  ['august', 8, 'There is a particular silence when a sleeper train stops at a border in the middle of the night. Nobody speaks. Somebody in the next compartment turns a page.'],
  ['pip', 5, 'Finished my first full map today. Every street named, every bridge counted. Then I added a door in the old city wall that leads nowhere. Every good map needs one secret.'],
  ['marguerite', 2, 'Admiral brought a friend this morning. I am now keeping two gulls on the payroll.'],
];

// [postIndex, author, text]
const NOTES = [
  [0, 'august', 'Two long, one short. I will remember that.'],
  [1, 'ines', 'Singing bread! I believe it.'],
  [4, 'marguerite', 'People and rivers both. Keep drawing it the way you saw it.'],
  [4, 'theo', 'Your teacher has never met my uncle.'],
  [9, 'august', 'A railway halt in the middle of a lake, reachable only by rowboat.'],
  [9, 'ines', 'A valley where the ferns grow taller than houses.'],
  [9, 'marguerite', 'A second lighthouse, so mine would have someone to talk to.'],
  [11, 'pip', 'This made my whole day.'],
  [12, 'theo', 'The basil knows you tried.'],
  [15, 'august', 'Has Admiral been informed of the new hire?'],
];

const DOGEARS = [[0, 3], [3, 2], [4, 4], [9, 5], [11, 5], [13, 2], [14, 3], [15, 3]];

module.exports = function seed(hashPassword) {
  const now = Date.now();
  const rid = () => crypto.randomBytes(8).toString('hex');
  const users = AUTHORS.map((a, i) => ({
    id: rid(),
    ...a,
    password: hashPassword('reader'),
    joined: new Date(now - (200 - i) * 3600e3).toISOString(),
    following: [],
  }));
  const byName = Object.fromEntries(users.map((u) => [u.username, u]));
  users.forEach((u) => {
    u.following = users.filter((o) => o !== u && o.username !== 'guest').map((o) => o.id);
  });
  const posts = POSTS.map(([author, hoursAgo, text]) => ({
    id: rid(),
    authorId: byName[author].id,
    text,
    created: new Date(now - hoursAgo * 3600e3).toISOString(),
    dogears: [],
    notes: [],
  }));
  NOTES.forEach(([pi, author, text], k) => {
    const created = new Date(new Date(posts[pi].created).getTime() + (k + 1) * 900e3);
    posts[pi].notes.push({ id: rid(), authorId: byName[author].id, text, created: created.toISOString() });
  });
  DOGEARS.forEach(([pi, n]) => {
    posts[pi].dogears = users.slice(0, n).map((u) => u.id);
  });
  return { users, posts, sessions: {} };
};
