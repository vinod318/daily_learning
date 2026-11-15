export function Flame({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.2 2.2c.3 2.4-.4 4.1-1.6 5.4 1.7-.2 3.2-1.3 3.8-2.6 1.6 1.5 3.6 3.8 3.6 7.2A6.8 6.8 0 1 1 8 8.4c.7 1.3 1.8 2.2 2.4 2.6-.2-2.6.6-6.2 1.8-8.8Z"
      />
    </svg>
  )
}

const PATHS: Record<string, string> = {
  first_blood: 'M4 16 12 4l8 12H4Zm8-2.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z',
  perfect_score: 'M12 3 14.4 8.6 20.5 9.2 16 13.3 17.3 19.3 12 16.2 6.7 19.3 8 13.3 3.5 9.2 9.6 8.6 12 3Z',
  streak_7: 'M7 16c0-4 2.2-6 5-9 2.8 3 5 5 5 9a5 5 0 0 1-10 0Z',
  ironman_30: 'M4 14.5 12 4l8 10.5v5H4v-5Zm8-1.2 3.2 3.2H8.8L12 13.3Z',
}

export function BadgeMark({ slug, earned }: { slug: string; earned: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-8 w-8 ${earned ? 'text-brass' : 'text-line'}`} aria-hidden="true">
      <path fill="currentColor" d={PATHS[slug] ?? PATHS.first_blood} />
    </svg>
  )
}
