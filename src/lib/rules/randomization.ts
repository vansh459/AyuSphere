/**
 * Randomization engine (T10.2, D-027) — deterministic permuted-block
 * allocation. Trials carry an arms config ([{name, ratio}]); each block is
 * every arm repeated 2×ratio times, shuffled by a PRNG seeded from
 * (seedKey, blockIndex), so allocation is reproducible per trial and exactly
 * balanced within every block. Open-label MVP: no allocation concealment or
 * blinding is claimed (stated in D-027).
 */
import { z } from "zod";

export type ArmConfig = { name: string; ratio: number };

export const DEFAULT_ARMS: ArmConfig[] = [
  { name: "Intervention", ratio: 1 },
  { name: "Control", ratio: 1 },
];

export const armsSchema = z
  .array(
    z.object({
      name: z.string().min(1).max(40),
      ratio: z.number().int().min(1).max(9),
    }),
  )
  .min(1, "at least one arm")
  .max(6, "at most six arms")
  .refine(
    (arms) => new Set(arms.map((a) => a.name.toLowerCase())).size === arms.length,
    { message: "arm names must be unique" },
  );

/** stored arms config → validated arms; legacy/empty configs fall back */
export function parseArms(raw: unknown): ArmConfig[] {
  const parsed = armsSchema.safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : DEFAULT_ARMS;
}

/** FNV-1a — string seed key → uint32 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blockSize(arms: ArmConfig[]): number {
  return 2 * arms.reduce((sum, a) => sum + a.ratio, 0);
}

export type Allocation = {
  arm: string;
  blockIndex: number;
  positionInBlock: number;
  blockSize: number;
};

/**
 * Allocates the arm for the trial's Nth enrolment (0-based sequence).
 * Deterministic: the same (arms, sequence, seedKey) always yields the same
 * arm — seedKey is the trial id in production, injectable in tests.
 */
export function assignArm(
  arms: ArmConfig[],
  sequence: number,
  seedKey: string,
): Allocation {
  if (sequence < 0 || !Number.isInteger(sequence)) {
    throw new Error("enrolment sequence must be a non-negative integer");
  }
  const size = blockSize(arms);
  const blockIndex = Math.floor(sequence / size);
  const positionInBlock = sequence % size;

  const block: string[] = arms.flatMap((a) =>
    Array<string>(2 * a.ratio).fill(a.name),
  );
  // Fisher–Yates with the per-(trial, block) seeded PRNG
  const rng = mulberry32(fnv1a(`${seedKey}:${blockIndex}`));
  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [block[i], block[j]] = [block[j], block[i]];
  }

  return { arm: block[positionInBlock], blockIndex, positionInBlock, blockSize: size };
}
