export interface RandomSource {
  next(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  fork(label: string): RandomSource;
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) {
      throw new Error("Invalid random integer range");
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(this.next() * span);
  }

  fork(label: string): RandomSource {
    return new SeededRandom(`${this.state}:${label}`);
  }
}

export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
