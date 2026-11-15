export type Role = 'engineer' | 'admin'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type Profile = {
  id: string
  email: string
  full_name: string
  engineering_discipline: string | null
  avatar_url: string | null
  total_xp: number
  current_streak: number
  longest_streak: number
  last_quiz_date: string | null
  created_at: string
}

export type Quiz = {
  id: string
  publish_date: string
  title: string
  topic: string
  difficulty: Difficulty
  xp_reward: number
}

export type Question = {
  id: string
  quiz_id: string
  question_text: string
  code_snippet: string | null
  options: string[]
  sort_order: number
}

export type BreakdownItem = {
  question_id: string
  selected_index: number | null
  correct_option_index: number
  is_correct: boolean
}

export type Badge = {
  slug: string
  name: string
  description: string
}

export type QuizResult = {
  score: number
  total: number
  xp_earned: number
  total_xp: number
  current_streak: number
  longest_streak: number
  breakdown: BreakdownItem[]
  new_badges: Badge[]
}

export type Submission = {
  id: string
  quiz_id: string
  score: number
  xp_earned: number
  detail: BreakdownItem[]
  completed_at: string
}

export type AllowlistEntry = {
  email: string
  role: Role
  invited_at: string
}

export type AdminQuestion = {
  id?: string
  question_text: string
  code_snippet: string | null
  options: string[]
  correct_option_index: number
  sort_order: number
}

export type AdminQuiz = {
  id: string
  publish_date: string
  title: string
  topic: string
  difficulty: Difficulty
  xp_reward: number
  is_active: boolean
  submission_count: number
  questions: AdminQuestion[]
}

export const DISCIPLINES = [
  'Firmware',
  'Hardware',
  'Software',
  'FPGA',
  'Systems',
  'Verification',
  'Mechanical',
] as const
