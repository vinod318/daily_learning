-- Learning layer. Idempotent. Stays inside the free tier:
-- one small table, no storage, no edge functions, no extra realtime.

alter table public.questions add column if not exists concept text;
alter table public.questions add column if not exists explanation text;

comment on column public.questions.explanation is
  'Shown only after submit_daily_quiz. Clients have no SELECT privilege on this column.';

create table if not exists public.quiz_starts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  primary key (user_id, quiz_id)
);

insert into public.badges (slug, name, description) values
  ('quick_draw', 'Quick Draw', 'Finish today''s quiz within 4 minutes with at least one correct answer')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

create or replace function public.rank_title(p_xp integer)
returns text
language sql
immutable
as $$
  select case
    when p_xp >= 1500 then 'Principal Engineer'
    when p_xp >= 700 then 'Staff Engineer'
    when p_xp >= 300 then 'Senior Engineer'
    when p_xp >= 100 then 'Junior Engineer'
    else 'Intern'
  end;
$$;

revoke all on function public.rank_title(integer) from public;
grant execute on function public.rank_title(integer) to authenticated;

create or replace function public.start_daily_quiz(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  started timestamptz;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1 from public.quizzes
    where id = p_quiz_id
      and is_active
      and publish_date = public.org_today()
  ) then
    raise exception 'Only today''s quiz can be started';
  end if;

  if exists (
    select 1 from public.submissions where user_id = uid and quiz_id = p_quiz_id
  ) then
    raise exception 'You have already submitted this quiz';
  end if;

  insert into public.quiz_starts (user_id, quiz_id)
  values (uid, p_quiz_id)
  on conflict (user_id, quiz_id) do nothing;

  select started_at into started
  from public.quiz_starts
  where user_id = uid and quiz_id = p_quiz_id;

  return jsonb_build_object('started_at', started);
end;
$$;

revoke all on function public.start_daily_quiz(uuid) from public;
grant execute on function public.start_daily_quiz(uuid) to authenticated;

create or replace function public.floor_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mine integer;
  above integer;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  select total_xp into mine from public.profiles where id = uid;
  select min(total_xp) into above from public.profiles where total_xp > coalesce(mine, 0);

  return jsonb_build_object(
    'finished_today', (
      select count(*)
      from public.submissions s
      where (timezone('Asia/Kolkata', s.completed_at))::date = public.org_today()
    ),
    'engineers', (select count(*) from public.profiles),
    'your_place', 1 + (
      select count(*) from public.profiles where total_xp > coalesce(mine, 0)
    ),
    'gap_above', coalesce(above - coalesce(mine, 0), 0)
  );
end;
$$;

revoke all on function public.floor_pulse() from public;
grant execute on function public.floor_pulse() to authenticated;

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
  speed_bonus integer := 0;
  earned integer;
  previous_xp integer;
  started timestamptz;
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
    select id, correct_option_index, question_text, explanation, concept
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
        'is_correct', is_correct,
        'question_text', question.question_text,
        'explanation', question.explanation,
        'concept', question.concept
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

  select started_at into started
  from public.quiz_starts
  where user_id = uid and quiz_id = p_quiz_id;

  if found and correct_count > 0 and clock_timestamp() - started <= interval '4 minutes' then
    speed_bonus := least(24, base_xp / 5);
  end if;

  earned := base_xp + bonus_xp + speed_bonus;
  previous_xp := prof.total_xp;

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
        or (b.slug = 'quick_draw' and speed_bonus > 0)
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
    'speed_bonus', speed_bonus,
    'previous_xp', previous_xp,
    'total_xp', prof.total_xp,
    'current_streak', prof.current_streak,
    'longest_streak', prof.longest_streak,
    'rank_up', case
      when public.rank_title(previous_xp) is distinct from public.rank_title(prof.total_xp)
        then public.rank_title(prof.total_xp)
      else null
    end,
    'breakdown', breakdown,
    'new_badges', awarded
  );
end;
$$;

revoke all on function public.submit_daily_quiz(uuid, jsonb) from public;
grant execute on function public.submit_daily_quiz(uuid, jsonb) to authenticated;

-- Teach the Arduino set. Explanations stay server-side until a submission stores them.
update public.questions set concept = 'GPIO', explanation = $exp$
INPUT_PULLUP turns on the pin's internal resistor to VCC. An open switch leaves the pin high. Pressing it shorts the pin to ground, so it reads LOW. A bare INPUT floats and picks up noise. Driving the pin OUTPUT HIGH into a switch to ground shorts the pin when the button is pressed.
$exp$
where question_text like 'A button on an Uno%';

update public.questions set concept = 'GPIO', explanation = $exp$
An AVR pin should source well under its absolute maximum, about 20 mA. The resistor sets the LED current: (pin voltage minus the LED forward drop) divided by R. Without it the LED is close to a short and the pin overheats.
$exp$
where question_text like 'Pin 9 drives an LED%';

update public.questions set concept = 'Interrupts', explanation = $exp$
The compiler may keep a global in a register if it never sees a write in loop(). The ISR writes it from outside that view. volatile forces a real load each check. Keep the ISR to a flag: delay() or Serial inside it blocks every other interrupt, including the Timer0 tick that advances millis().
$exp$
where question_text like 'Why is pressed volatile%';

update public.questions set concept = 'Interrupts', explanation = $exp$
FALLING fires on the high-to-low edge, not while the pin sits low. delay() inside the ISR holds the CPU in interrupt context, so the millis timer cannot run and the clock stalls. Debounce later in loop() with a timestamp.
$exp$
where question_text like 'On the Uno, external interrupts%';

update public.questions set concept = 'ADC', explanation = $exp$
The Uno ADC is 10-bit: counts run from 0 to 1023. The default reference is the 5 V rail. 512 / 1023 × 5 V is about 2.50 V. It is not a 1 mV-per-count converter, and the default reference is not 3.3 V.
$exp$
where question_text like 'Default analogRead on an Uno%';

update public.questions set concept = 'ADC', explanation = $exp$
analogReference(INTERNAL) connects the about 1.1 V bandgap to the ADC reference. Five volts still wired to AREF fights that internal source. The datasheet says not to put an external voltage on AREF while the internal reference is selected. That fight can damage the MCU.
$exp$
where question_text like 'You call analogReference(INTERNAL)%';

update public.questions set concept = 'Timers', explanation = $exp$
millis() is a uint32_t and wraps after 2^32 milliseconds, about 49.7 days. Unsigned subtraction is modulo 2^32, so a later timestamp minus an earlier one stays correct across the wrap, as long as the gap you measure is shorter than one full cycle.
$exp$
where question_text like 'millis() overflows%';

update public.questions set concept = 'Timers', explanation = $exp$
On the Uno the Servo library claims Timer1, which is also the PWM timer for pins 9 and 10. A 1 kHz tick can use millis() (Timer0 is already running) or Timer2. Bit-banging the servo with delayMicroseconds() blocks loop() for every pulse.
$exp$
where question_text like 'You want a precise 1 kHz tick%';

-- Existing reviews should teach too. Rebuild stored detail from the questions.
update public.submissions s
set detail = coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'question_id', q.id,
      'selected_index', item -> 'selected_index',
      'correct_option_index', q.correct_option_index,
      'is_correct', coalesce((item ->> 'is_correct')::boolean, false),
      'question_text', q.question_text,
      'explanation', q.explanation,
      'concept', q.concept
    )
    order by q.sort_order, q.id
  )
  from jsonb_array_elements(s.detail) item
  join public.questions q on q.id = (item ->> 'question_id')::uuid
), '[]'::jsonb);

alter table public.quiz_starts enable row level security;
drop policy if exists quiz_starts_read_own on public.quiz_starts;
create policy quiz_starts_read_own on public.quiz_starts
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.quiz_starts from anon, authenticated;
grant select on table public.quiz_starts to authenticated;

revoke all on table public.questions from anon, authenticated;
grant select (
  id,
  quiz_id,
  question_text,
  code_snippet,
  options,
  sort_order,
  concept
) on table public.questions to authenticated;
grant insert, update, delete on table public.questions to authenticated;
