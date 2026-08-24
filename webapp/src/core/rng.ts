/** 确定性伪随机数（mulberry32）——同一个 seed 必须重现同一张地图 */
export interface Rng {
  (): number
  int(maxExclusive: number): number
  range(lo: number, hi: number): number
  pick<T>(items: readonly T[]): T
  /** 均值 0、标准差 1 的正态分布（Box–Muller） */
  gauss(): number
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = next as Rng
  rng.int = (maxExclusive) => Math.floor(next() * maxExclusive)
  rng.range = (lo, hi) => lo + next() * (hi - lo)
  rng.pick = (items) => items[Math.floor(next() * items.length)]
  rng.gauss = () => {
    // next() 可能为 0，取对数前抬一下
    const u = 1 - next()
    const v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return rng
}
