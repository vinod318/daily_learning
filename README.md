# Daily Learning

Gamified daily engineering quiz. The site is a static Vite app on GitHub Pages. Supabase holds accounts, quizzes, and grades. Unauthenticated visitors only get the sign-in screen. Row Level Security keeps every other read and write behind a signed-in engineer, and the correct answer never ships to the browser until `submit_daily_quiz` grades the attempt.

Live URL, once Pages is pointed at `gh-pages`:

https://vinod318.github.io/daily_learning/

Repository: https://github.com/vinod318/daily_learning

## Layout

```
.github/workflows/deploy.yml   build + publish to the gh-pages branch
public/                        favicon and .nojekyll
src/                           React app
supabase/schema.sql            tables, RLS, triggers, RPCs, seed quiz
.env.example                   local client env (no secrets committed)
```

Vite `base` is `/daily_learning/`, which matches the Pages project URL.

## 1. Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** and run `supabase/schema.sql` from top to bottom.
3. Insert yourself as the first admin. Use the same email you will sign up with:

```sql
insert into public.allowed_engineers (email, role)
values ('you@company.com', 'admin');
```

4. **Authentication → Providers → Email**: leave signups **enabled**. The `enforce_engineer_allowlist` trigger rejects every address that is not on `allowed_engineers`. Turning signups off in the dashboard also blocks legitimate first-time setup.
5. For a private floor, turn **Confirm email** off so the first sign-up returns a session immediately. If you leave confirmation on, set **Site URL** and the redirect allow list to `https://vinod318.github.io/daily_learning`.
6. Copy **Project URL** and the **anon public** key from **Project Settings → API**. Do not put the service-role key in the frontend or in a `VITE_` variable. The anon key is safe only because RLS and column privileges are on.

The script seeds four badges and one quiz for today (Asia/Kolkata). Re-running it will not duplicate that quiz's questions.

## 2. GitHub

Repository: `vinod318/daily_learning` (public so GitHub Pages works on a free account). The app data stays private through Supabase.

1. **Settings → Secrets and variables → Actions**. Add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. **Settings → Actions → General → Workflow permissions**: Read and write. The workflow pushes the `gh-pages` branch.
3. Push to `main`. The workflow builds with those secrets and publishes `dist` to `gh-pages`.
4. **Settings → Pages → Build and deployment**: Deploy from branch `gh-pages`, folder `/ (root)`.
5. Open https://vinod318.github.io/daily_learning/

A missing secret still produces a site. The sign-in screen explains that the build has no Supabase config. Add the secrets and re-run the workflow.

## 3. Local

```bash
cp .env.example .env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

The dev server uses the same base path: http://localhost:5173/daily_learning/

## Access model

| Who | What they can do |
| --- | --- |
| Anonymous | Sign in, or create an account if the email is allowlisted. No quiz, board, or profile reads. |
| Engineer | Read active quizzes whose `publish_date` is today or earlier. Read question text, code, and options. Not `correct_option_index`. Insert nothing into submissions directly. Call `submit_daily_quiz` once per quiz. Read the org leaderboard and badge shelf. Update only their own name, discipline, and https avatar URL. |
| Admin | Everything an engineer can do, plus allowlist edits and `admin_publish_quiz`. Future quizzes are visible only through the admin RPCs. |

`submit_daily_quiz` grades on the server, applies XP and the streak, and awards badges.

- Each correct answer awards 1 XP. Streak and speed do not add XP.
- Explanations are not readable from the questions table. They are written into the engineer's own submission after grading, then shown as field notes.
- Streak increments when `last_quiz_date` was yesterday on the Asia/Kolkata calendar. A second quiz on the same day keeps the streak. A gap resets it to 1.
- Any active quiz dated today or earlier can be submitted once. The `(user_id, quiz_id)` unique key makes a second attempt fail.
- XP, streak, and `last_quiz_date` cannot be patched from the client. A profile trigger rejects those columns unless the grading function set the transaction flag.

Ranks, from total XP: Intern (0), Junior Engineer (15), Senior Engineer (40), Staff Engineer (90), Principal Engineer (160). One correct answer is 1 XP.

Badges: First Blood, 100% Accuracy, 7-Day Streak, 30-Day Ironman.

## Checklist

- [ ] Supabase project created
- [ ] `supabase/schema.sql` ran without errors
- [ ] Your email inserted into `allowed_engineers` as `admin`
- [ ] Email signups left on; confirmation set the way you want
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` saved as Actions secrets
- [ ] Actions workflow permission is read and write
- [ ] `main` pushed and the Deploy workflow is green
- [ ] Pages source is the `gh-pages` branch, `/ (root)`
- [ ] Sign-in screen loads at https://vinod318.github.io/daily_learning/
- [ ] First-time setup with the admin email, then open Today, the board, and Admin
