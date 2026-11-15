const LADDER = [
  { title: 'Intern', min: 0 },
  { title: 'Junior Engineer', min: 100 },
  { title: 'Senior Engineer', min: 300 },
  { title: 'Staff Engineer', min: 700 },
  { title: 'Principal Engineer', min: 1500 },
] as const

export type Rank = {
  title: string
  min: number
  next: { title: string; min: number } | null
  progress: number
}

export function rankFor(xp: number): Rank {
  let index = 0
  for (let i = 0; i < LADDER.length; i += 1) {
    if (xp >= LADDER[i].min) index = i
  }
  const current = LADDER[index]
  const next = LADDER[index + 1] ?? null
  const progress = next ? Math.min(1, (xp - current.min) / (next.min - current.min)) : 1
  return { title: current.title, min: current.min, next, progress }
}
