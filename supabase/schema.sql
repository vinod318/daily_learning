-- Daily Learning — Supabase schema, RLS, and grading RPC.
-- Run this whole file in the Supabase SQL Editor (postgres role).
-- Safe to re-run: objects are replaced, seed rows use ON CONFLICT.
--
-- Organization clock is Asia/Kolkata. Change the helper if the floor
-- works in another timezone.
--
-- After this script:
--   insert into public.allowed_engineers (email, role)
--   values ('you@company.com', 'admin');
--
-- Leave Auth > Signups enabled. This script rejects every email that
-- is not on allowed_engineers. Disabling signups in the dashboard
-- would also block legitimate first-time setup.
-- Recommended Auth setting: turn OFF "Confirm email" for a private
-- allowlist, or set Site URL to
-- https://vinod318.github.io/daily_learning

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.allowed_engineers (
  email text primary key,
  role text not null default 'engineer' check (role in ('engineer', 'admin')),
  invited_at timestamptz not null default now(),
  constraint allowed_engineers_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  engineering_discipline text,
  avatar_url text,
  total_xp integer not null default 0 check (total_xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_quiz_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null unique,
  title text not null,
  topic text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  xp_reward integer not null default 100 check (xp_reward > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_text text not null,
  code_snippet text,
  options jsonb not null,
  -- Hidden from the browser. Column privileges below refuse SELECT.
  -- Grading happens only inside submit_daily_quiz.
  correct_option_index integer not null check (correct_option_index >= 0),
  sort_order integer not null default 0
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  score integer not null check (score >= 0),
  xp_earned integer not null check (xp_earned >= 0),
  detail jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  unique (user_id, quiz_id)
);

create table if not exists public.badges (
  slug text primary key,
  name text not null,
  description text not null
);

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_slug text not null references public.badges (slug),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_slug)
);

create index if not exists profiles_total_xp_idx on public.profiles (total_xp desc, current_streak desc);
create index if not exists questions_quiz_idx on public.questions (quiz_id, sort_order);
create index if not exists submissions_user_idx on public.submissions (user_id, completed_at desc);

comment on column public.questions.correct_option_index is
  'Server-only. Authenticated clients have no SELECT privilege on this column.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.org_today()
returns date
language sql
stable
as $$
  select (timezone('Asia/Kolkata', now()))::date;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.allowed_engineers a on a.email = p.email
    where p.id = auth.uid()
      and a.role = 'admin'
  );
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select a.role
      from public.profiles p
      join public.allowed_engineers a on a.email = p.email
      where p.id = auth.uid()
    ),
    'engineer'
  );
$$;

revoke all on function public.org_today() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.current_role() from public;
grant execute on function public.org_today() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_allowlist_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create or replace function public.prevent_self_allowlist_removal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and email = lower(old.email)
  ) then
    raise exception 'You cannot remove your own allowlist entry';
  end if;
  return old;
end;
$$;

create or replace function public.validate_question()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(new.options) <> 'array' or jsonb_array_length(new.options) < 2 then
    raise exception 'A question needs at least two options';
  end if;
  if new.correct_option_index >= jsonb_array_length(new.options) then
    raise exception 'correct_option_index is out of range';
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_stats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Profile identity cannot be changed';
  end if;

  if new.avatar_url is not null
     and new.avatar_url <> ''
     and new.avatar_url !~ '^https://' then
    raise exception 'Avatar URL must start with https://';
  end if;

  if char_length(new.full_name) > 80 then
    raise exception 'Name is too long';
  end if;

  if coalesce(current_setting('app.allow_stat_update', true), '') is distinct from 'on' then
    if new.total_xp is distinct from old.total_xp
       or new.current_streak is distinct from old.current_streak
       or new.longest_streak is distinct from old.longest_streak
       or new.last_quiz_date is distinct from old.last_quiz_date then
      raise exception 'Score, XP, and streak are updated only by submit_daily_quiz';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_allowlist_email on public.allowed_engineers;
create trigger normalize_allowlist_email
  before insert or update on public.allowed_engineers
  for each row execute function public.normalize_allowlist_email();

drop trigger if exists prevent_self_allowlist_removal on public.allowed_engineers;
create trigger prevent_self_allowlist_removal
  before delete on public.allowed_engineers
  for each row execute function public.prevent_self_allowlist_removal();

drop trigger if exists validate_question on public.questions;
create trigger validate_question
  before insert or update on public.questions
  for each row execute function public.validate_question();

drop trigger if exists protect_profile_stats on public.profiles;
create trigger protect_profile_stats
  before update on public.profiles
  for each row execute function public.protect_profile_stats();

-- Signup gate. Signups stay enabled in the dashboard; this trigger is the lock.
create or replace function public.enforce_engineer_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or not exists (
    select 1
    from public.allowed_engineers
    where email = lower(new.email)
  ) then
    raise exception 'This email is not on the organization allowlist'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_engineer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, engineering_discipline)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'engineering_discipline', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists enforce_engineer_allowlist on auth.users;
create trigger enforce_engineer_allowlist
  before insert on auth.users
  for each row execute function public.enforce_engineer_allowlist();

drop trigger if exists handle_new_engineer on auth.users;
create trigger handle_new_engineer
  after insert on auth.users
  for each row execute function public.handle_new_engineer();

-- ---------------------------------------------------------------------------
-- submit_daily_quiz
--
-- XP: base = xp_reward * correct / total   (integer division)
--     bonus = base * min(streak - 1, 10) * 5 / 100
--     A 4-day streak adds 15%. The bonus caps at 50% on day 11.
-- Streak: +1 when last_quiz_date was yesterday, else reset to 1.
-- Only today's quiz (org_today) can be submitted, and only once.
-- ---------------------------------------------------------------------------

create or replace function public.submit_daily_quiz(p_quiz_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  quiz public.quizzes%rowtype;
  prof public.profiles%rowtype;
  question record;
  selected integer;
  picked text;
  is_correct boolean;
  total_count integer := 0;
  correct_count integer := 0;
  new_streak integer;
  base_xp integer;
  bonus_xp integer;
  earned integer;
  breakdown jsonb := '[]'::jsonb;
  awarded jsonb := '[]'::jsonb;
  badge_row public.badges%rowtype;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'p_answers must be a JSON array';
  end if;

  select * into quiz from public.quizzes where id = p_quiz_id for update;
  if not found or not quiz.is_active then
    raise exception 'Quiz not found';
  end if;

  if quiz.publish_date <> public.org_today() then
    raise exception 'Only today''s quiz can be submitted';
  end if;

  select * into prof from public.profiles where id = uid for update;
  if not found then
    raise exception 'Engineer profile is missing';
  end if;

  if exists (
    select 1 from public.submissions where user_id = uid and quiz_id = p_quiz_id
  ) then
    raise exception 'You have already submitted this quiz';
  end if;

  for question in
    select id, correct_option_index
    from public.questions
    where quiz_id = p_quiz_id
    order by sort_order, id
  loop
    total_count := total_count + 1;
    selected := null;

    select elem ->> 'selected_index'
      into picked
    from jsonb_array_elements(p_answers) elem
    where elem ->> 'question_id' = question.id::text
    limit 1;

    if picked is not null and picked ~ '^-?[0-9]+$' then
      selected := picked::integer;
    end if;

    is_correct := selected is not null and selected = question.correct_option_index;
    if is_correct then
      correct_count := correct_count + 1;
    end if;

    breakdown := breakdown || jsonb_build_array(
      jsonb_build_object(
        'question_id', question.id,
        'selected_index', selected,
        'correct_option_index', question.correct_option_index,
        'is_correct', is_correct
      )
    );
  end loop;

  if total_count = 0 then
    raise exception 'This quiz has no questions';
  end if;

  if prof.last_quiz_date = public.org_today() - 1 then
    new_streak := prof.current_streak + 1;
  else
    new_streak := 1;
  end if;

  base_xp := (quiz.xp_reward * correct_count) / total_count;
  bonus_xp := (base_xp * least(greatest(new_streak - 1, 0), 10) * 5) / 100;
  earned := base_xp + bonus_xp;

  begin
    insert into public.submissions (user_id, quiz_id, score, xp_earned, detail)
    values (uid, p_quiz_id, correct_count, earned, breakdown);
  exception
    when unique_violation then
      raise exception 'You have already submitted this quiz';
  end;

  perform set_config('app.allow_stat_update', 'on', true);

  update public.profiles
  set total_xp = total_xp + earned,
      current_streak = new_streak,
      longest_streak = greatest(longest_streak, new_streak),
      last_quiz_date = public.org_today()
  where id = uid
  returning * into prof;

  for badge_row in
    select b.*
    from public.badges b
    where (
        (b.slug = 'first_blood' and (select count(*) from public.submissions where user_id = uid) = 1)
        or (b.slug = 'perfect_score' and correct_count = total_count)
        or (b.slug = 'streak_7' and new_streak >= 7)
        or (b.slug = 'ironman_30' and new_streak >= 30)
      )
      and not exists (
        select 1
        from public.user_badges ub
        where ub.user_id = uid
          and ub.badge_slug = b.slug
      )
  loop
    insert into public.user_badges (user_id, badge_slug)
    values (uid, badge_row.slug);
    awarded := awarded || jsonb_build_array(
      jsonb_build_object(
        'slug', badge_row.slug,
        'name', badge_row.name,
        'description', badge_row.description
      )
    );
  end loop;

  return jsonb_build_object(
    'score', correct_count,
    'total', total_count,
    'xp_earned', earned,
    'total_xp', prof.total_xp,
    'current_streak', prof.current_streak,
    'longest_streak', prof.longest_streak,
    'breakdown', breakdown,
    'new_badges', awarded
  );
end;
$$;

revoke all on function public.submit_daily_quiz(uuid, jsonb) from public;
grant execute on function public.submit_daily_quiz(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs. The anon key can call these; is_admin() is the gate.
-- correct_option_index never leaves the database except through these.
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_engineer(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := lower(btrim(coalesce(p_email, '')));
  clean_role text := lower(btrim(coalesce(p_role, 'engineer')));
  row_out public.allowed_engineers%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if clean_role not in ('engineer', 'admin') then
    raise exception 'Role must be engineer or admin';
  end if;

  insert into public.allowed_engineers (email, role)
  values (clean, clean_role)
  on conflict (email) do update set role = excluded.role
  returning * into row_out;

  return jsonb_build_object(
    'email', row_out.email,
    'role', row_out.role,
    'invited_at', row_out.invited_at
  );
end;
$$;

create or replace function public.admin_remove_engineer(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and email = clean) then
    raise exception 'You cannot remove your own allowlist entry';
  end if;
  delete from public.allowed_engineers where email = clean;
end;
$$;

create or replace function public.admin_list_engineers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only';
  end if;
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('email', email, 'role', role, 'invited_at', invited_at)
        order by invited_at desc
      )
      from public.allowed_engineers
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_list_quizzes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only';
  end if;

  return coalesce(
    (
      select jsonb_agg(quiz_row order by publish_date desc)
      from (
        select
          z.publish_date,
          jsonb_build_object(
            'id', z.id,
            'publish_date', z.publish_date,
            'title', z.title,
            'topic', z.topic,
            'difficulty', z.difficulty,
            'xp_reward', z.xp_reward,
            'is_active', z.is_active,
            'submission_count', (
              select count(*) from public.submissions s where s.quiz_id = z.id
            ),
            'questions', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', q.id,
                    'question_text', q.question_text,
                    'code_snippet', q.code_snippet,
                    'options', q.options,
                    'correct_option_index', q.correct_option_index,
                    'sort_order', q.sort_order
                  )
                  order by q.sort_order, q.id
                )
                from public.questions q
                where q.quiz_id = z.id
              ),
              '[]'::jsonb
            )
          ) as quiz_row
        from public.quizzes z
      ) listed
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_publish_quiz(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quiz_date date;
  quiz_row public.quizzes%rowtype;
  question jsonb;
  idx integer := 0;
  option_count integer;
  correct_index integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  begin
    quiz_date := (payload ->> 'publish_date')::date;
  exception
    when others then
      raise exception 'publish_date must be YYYY-MM-DD';
  end;

  if payload ->> 'title' is null or btrim(payload ->> 'title') = '' then
    raise exception 'Title is required';
  end if;
  if payload ->> 'topic' is null or btrim(payload ->> 'topic') = '' then
    raise exception 'Topic is required';
  end if;
  if coalesce(payload ->> 'difficulty', '') not in ('easy', 'medium', 'hard') then
    raise exception 'Difficulty must be easy, medium, or hard';
  end if;
  if coalesce((payload ->> 'xp_reward')::integer, 0) <= 0 then
    raise exception 'xp_reward must be a positive integer';
  end if;
  if jsonb_typeof(payload -> 'questions') is distinct from 'array'
     or jsonb_array_length(payload -> 'questions') < 1 then
    raise exception 'Add at least one question';
  end if;

  for question in select value from jsonb_array_elements(payload -> 'questions')
  loop
    if coalesce(question ->> 'question_text', '') = '' then
      raise exception 'Every question needs text';
    end if;
    if jsonb_typeof(question -> 'options') is distinct from 'array'
       or jsonb_array_length(question -> 'options') < 2 then
      raise exception 'Every question needs at least two options';
    end if;
    option_count := jsonb_array_length(question -> 'options');
    correct_index := coalesce((question ->> 'correct_option_index')::integer, -1);
    if correct_index < 0 or correct_index >= option_count then
      raise exception 'Mark a correct option for every question';
    end if;
  end loop;

  select * into quiz_row from public.quizzes where publish_date = quiz_date;
  if found then
    if exists (select 1 from public.submissions where quiz_id = quiz_row.id) then
      raise exception 'Engineers have already taken the quiz on that date';
    end if;
    update public.quizzes
    set title = btrim(payload ->> 'title'),
        topic = btrim(payload ->> 'topic'),
        difficulty = payload ->> 'difficulty',
        xp_reward = (payload ->> 'xp_reward')::integer,
        is_active = coalesce((payload ->> 'is_active')::boolean, true)
    where id = quiz_row.id
    returning * into quiz_row;
    delete from public.questions where quiz_id = quiz_row.id;
  else
    insert into public.quizzes (publish_date, title, topic, difficulty, xp_reward, is_active)
    values (
      quiz_date,
      btrim(payload ->> 'title'),
      btrim(payload ->> 'topic'),
      payload ->> 'difficulty',
      (payload ->> 'xp_reward')::integer,
      coalesce((payload ->> 'is_active')::boolean, true)
    )
    returning * into quiz_row;
  end if;

  for question in select value from jsonb_array_elements(payload -> 'questions')
  loop
    insert into public.questions (
      quiz_id,
      question_text,
      code_snippet,
      options,
      correct_option_index,
      sort_order
    )
    values (
      quiz_row.id,
      btrim(question ->> 'question_text'),
      nullif(btrim(coalesce(question ->> 'code_snippet', '')), ''),
      question -> 'options',
      (question ->> 'correct_option_index')::integer,
      idx
    );
    idx := idx + 1;
  end loop;

  return jsonb_build_object('id', quiz_row.id, 'publish_date', quiz_row.publish_date);
end;
$$;

revoke all on function public.admin_add_engineer(text, text) from public;
revoke all on function public.admin_remove_engineer(text) from public;
revoke all on function public.admin_list_engineers() from public;
revoke all on function public.admin_list_quizzes() from public;
revoke all on function public.admin_publish_quiz(jsonb) from public;
grant execute on function public.admin_add_engineer(text, text) to authenticated;
grant execute on function public.admin_remove_engineer(text) to authenticated;
grant execute on function public.admin_list_engineers() to authenticated;
grant execute on function public.admin_list_quizzes() to authenticated;
grant execute on function public.admin_publish_quiz(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.allowed_engineers enable row level security;
alter table public.profiles enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.submissions enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

drop policy if exists allowed_admin_all on public.allowed_engineers;
create policy allowed_admin_all on public.allowed_engineers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists quizzes_read_active on public.quizzes;
create policy quizzes_read_active on public.quizzes
  for select to authenticated
  using (is_active and publish_date <= public.org_today());

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists questions_read_active on public.questions;
create policy questions_read_active on public.questions
  for select to authenticated
  using (
    exists (
      select 1
      from public.quizzes z
      where z.id = questions.quiz_id
        and z.is_active
        and z.publish_date <= public.org_today()
    )
  );

drop policy if exists questions_admin_write on public.questions;
create policy questions_admin_write on public.questions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists submissions_read_own on public.submissions;
create policy submissions_read_own on public.submissions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges
  for select to authenticated
  using (true);

drop policy if exists user_badges_read on public.user_badges;
create policy user_badges_read on public.user_badges
  for select to authenticated
  using (true);

-- Strip default Supabase grants, then put back only what the client may do.
revoke all on table public.allowed_engineers from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.quizzes from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;
revoke all on table public.badges from anon, authenticated;
revoke all on table public.user_badges from anon, authenticated;

grant select, insert, update, delete on table public.allowed_engineers to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.quizzes to authenticated;
-- No SELECT on correct_option_index. Insert/update/delete still exist for the
-- admin policies, but the app writes questions through admin_publish_quiz.
grant select (
  id,
  quiz_id,
  question_text,
  code_snippet,
  options,
  sort_order
) on table public.questions to authenticated;
grant insert, update, delete on table public.questions to authenticated;
grant select on table public.submissions to authenticated;
grant select on table public.badges to authenticated;
grant select on table public.user_badges to authenticated;

-- Realtime leaderboard. Refetch on any profile change.
do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

insert into public.badges (slug, name, description) values
  ('first_blood', 'First Blood', 'Complete your first daily quiz'),
  ('perfect_score', '100% Accuracy', 'Answer every question correctly in a daily quiz'),
  ('streak_7', '7-Day Streak', 'Complete the daily quiz seven days in a row'),
  ('ironman_30', '30-Day Ironman', 'Complete the daily quiz thirty days in a row')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

do $$
declare
  qid uuid;
  today date := public.org_today();
begin
  insert into public.quizzes (publish_date, title, topic, difficulty, xp_reward)
  values (today, 'Arduino Peripherals: GPIO, Interrupts, ADC, Timers', 'Arduino', 'medium', 120)
  on conflict (publish_date) do nothing;

  select id into qid from public.quizzes where publish_date = today;
  if qid is null or exists (select 1 from public.questions where quiz_id = qid) then
    return;
  end if;

  insert into public.questions (quiz_id, question_text, code_snippet, options, correct_option_index, sort_order)
  values
  (
    qid,
    'A button on an Uno sits between pin 2 and GND. You want a solid HIGH while it is open, and LOW while it is pressed. Which setup is right?',
    null,
    jsonb_build_array(
      'pinMode(2, INPUT) and a pull-down to 5 V, so the open button reads HIGH',
      'pinMode(2, INPUT_PULLUP), button to GND. Open reads HIGH, pressed reads LOW',
      'pinMode(2, OUTPUT) and digitalWrite(2, HIGH), so the pin powers the button',
      'pinMode(2, INPUT) with nothing else, because an unconnected AVR pin rests HIGH'
    ),
    1,
    0
  ),
  (
    qid,
    'Pin 9 drives an LED to GND. What is the resistor doing in this circuit?',
    $code$void setup() {
  pinMode(9, OUTPUT);
}
void loop() {
  digitalWrite(9, HIGH);
}$code$,
    jsonb_build_array(
      'It raises the pin voltage from 3.3 V to 5 V',
      'It limits LED current so the pin stays inside its source rating',
      'INPUT_PULLUP only takes effect when a series resistor is fitted',
      'analogWrite needs the resistor to form the PWM duty cycle'
    ),
    1,
    1
  ),
  (
    qid,
    'Why is pressed volatile, and why does the ISR only set a flag?',
    $code$volatile bool pressed = false;

void isr() {
  pressed = true;
}

void setup() {
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), isr, FALLING);
}$code$,
    jsonb_build_array(
      'volatile writes the flag to EEPROM. The ISR should also update the display before returning',
      'volatile forces a real memory access. Long work in the ISR delays every other interrupt and breaks timing',
      'volatile makes pin 2 interrupt-capable. The ISR should call delay(20) to debounce',
      'The flag can be a local in setup(). loop() will still see it'
    ),
    1,
    2
  ),
  (
    qid,
    'On the Uno, external interrupts are pins 2 and 3. What does FALLING mean here, and why is delay(20) inside the ISR a bad debounce?',
    null,
    jsonb_build_array(
      'FALLING means the pin is held low. delay() in the ISR is the usual debounce',
      'FALLING is the high-to-low edge. delay() blocks the ISR, so millis() stalls and other interrupts wait',
      'FALLING fires once per second. delay() is required or the flag is missed',
      'FALLING means the ADC conversion finished. delay() flushes the sample'
    ),
    1,
    3
  ),
  (
    qid,
    'Default analogRead on an Uno is 10-bit against a 5 V reference. The wiper of a pot returns 512. About what voltage is on the pin?',
    null,
    jsonb_build_array(
      'About 2.5 V, because 512/1023 of 5 V',
      '512 mV, because each count is 1 mV',
      '5 V, because a mid-scale count means the ADC has saturated',
      '3.3 V, because the Uno ADC reference is fixed at 3.3 V'
    ),
    0,
    4
  ),
  (
    qid,
    'You call analogReference(INTERNAL) on an Uno (about 1.1 V) while 5 V is still wired to the AREF pin. What is the failure?',
    null,
    jsonb_build_array(
      'Nothing. INTERNAL disconnects the AREF pin',
      'The internal reference fights the external source on AREF, which can damage the MCU',
      'analogRead switches to 12-bit results',
      'Only A0 can be read until you call analogReference(DEFAULT)'
    ),
    1,
    5
  ),
  (
    qid,
    'millis() overflows back to 0 after about 49.7 days. Why is this elapsed-time check still valid across that overflow?',
    $code$uint32_t start = millis();
if (millis() - start >= 1000) {
  // one second has elapsed
}$code$,
    jsonb_build_array(
      'It is not valid. The board must be reset before day 50',
      'uint32_t subtraction wraps modulo 2^32, so the difference stays correct across the overflow',
      'millis() is signed, so the gap goes negative and the compare still passes',
      'Timer0 pauses at the overflow until loop() restarts it'
    ),
    1,
    6
  ),
  (
    qid,
    'You want a precise 1 kHz tick, and the sketch also uses the Servo library. On the Uno, Servo claims Timer1. Which choice avoids the clash?',
    null,
    jsonb_build_array(
      'Use Timer1 compare-match for the tick and Servo together. They share the timer cleanly',
      'Keep Servo on Timer1. Build the tick with millis() or Timer2',
      'Bit-bang the servo with delayMicroseconds() in loop() so Timer1 stays free and loop() stays responsive',
      'analogWrite on pin 9 does not use a timer, so Timer1 is always free'
    ),
    1,
    7
  );
end $$;
