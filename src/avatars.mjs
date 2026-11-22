// Avatars children can pick. The cast matches the design canvas; the rest are fun
// non-human options for children who would rather not pick a person.
export const CAST = ['bolu', 'amira', 'ada', 'tobi', 'mei', 'leo', 'priya', 'sam'];
export const CREATURES = ['fox', 'owl', 'turtle', 'robot', 'dragon', 'rocket', 'cat', 'panda', 'lion', 'octopus'];
export const AVATARS = [...CAST, ...CREATURES];
export const CAR_COLORS = ['#FFB800', '#FF4D2E', '#2E9BFF', '#52D52E', '#FF6FB5', '#1FC2B4', '#6B55F0'];
export function isAvatar(id) { return AVATARS.includes(id); }
