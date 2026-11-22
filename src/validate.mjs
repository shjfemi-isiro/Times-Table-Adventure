import { z } from 'zod';
import { AVATARS, CAR_COLORS } from './avatars.mjs';
import { isGameNameCode } from './gamenames.mjs';
import { PURPOSES } from './policy.mjs';

export const BANDS = ['little', 'builders', 'masters'];
export const BRIDGES = ['tower', 'golden-gate', 'london', 'third-mainland', '6th-october'];

// First names: letters (any script), spaces, hyphens, apostrophes. No digits, no
// links, no emoji. Kept only for the private family board.
const FIRST_NAME = /^[\p{L}][\p{L}\p{M}' -]{0,19}$/u;

export const familySchema = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/).transform(s => s.toUpperCase()),
}).strict();

export const childCreateSchema = z.object({
  avatarId: z.enum(AVATARS),
  ageBand: z.enum(BANDS),
  gameNameCode: z.string().refine(isGameNameCode, 'Pick one of the suggested game names'),
  displayMode: z.enum(['avatar', 'first_name', 'game_name']).default('avatar'),
  firstName: z.string().trim().regex(FIRST_NAME, 'Letters only, up to 20').optional(),
  carColor: z.enum(CAR_COLORS).optional(),
}).strict().refine(v => v.displayMode !== 'first_name' || !!v.firstName, { message: 'Add a first name or pick another option', path: ['firstName'] });

export const childUpdateSchema = z.object({
  avatarId: z.enum(AVATARS).optional(),
  ageBand: z.enum(BANDS).optional(),
  gameNameCode: z.string().refine(isGameNameCode).optional(),
  displayMode: z.enum(['avatar', 'first_name', 'game_name']).optional(),
  firstName: z.string().trim().regex(FIRST_NAME).nullable().optional(),
  carColor: z.enum(CAR_COLORS).optional(),
}).strict();

export const consentSchema = z.object({
  purpose: z.enum(PURPOSES),
  granted: z.boolean(),
  childId: z.string().uuid().optional(),
}).strict();

export const deviceSchema = z.object({ label: z.string().trim().min(1).max(40) }).strict();

const item = z.object({
  a: z.number().int().min(0).max(12),
  b: z.number().int().min(0).max(12),
  ok: z.boolean(),
  firstTry: z.boolean(),
  ms: z.number().int().min(0).max(600_000),
  help: z.number().int().min(0).max(3).default(0),
}).strict();

export const sessionSchema = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  bridge: z.enum(BRIDGES),
  ageBand: z.enum(BANDS),
  stars: z.number().int().min(0).max(3),
  items: z.array(item).min(1).max(40),
}).strict().refine(s => Date.parse(s.endedAt) >= Date.parse(s.startedAt), { message: 'ends before it starts', path: ['endedAt'] })
  .refine(s => Date.parse(s.endedAt) - Date.parse(s.startedAt) <= 2 * 3600_000, { message: 'session too long', path: ['endedAt'] });

export const syncSchema = z.object({ sessions: z.array(sessionSchema).min(1).max(20) }).strict();

export const complaintSchema = z.object({
  category: z.enum(['privacy', 'child_safety', 'accessibility', 'other']),
  message: z.string().trim().min(5).max(2000),
}).strict();
