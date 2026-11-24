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
  previous_xp integer;
  speed_bonus integer := 0;
  quick boolean := false;
  started timestamptz;
  breakdown jsonb := '[]'::jsonb;
  awarded jsonb := '[]'::jsonb;
  attempt jsonb := '[]'::jsonb;
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

  if quiz.publish_date > public.org_today() then
    raise exception 'That quiz is not open yet';
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

  if prof.last_quiz_date = public.org_today() then
    new_streak := prof.current_streak;
  elsif prof.last_quiz_date = public.org_today() - 1 then
    new_streak := prof.current_streak + 1;
  else
    new_streak := 1;
  end if;

  base_xp := correct_count;
  bonus_xp := 0;

  select started_at into started
  from public.quiz_starts
  where user_id = uid and quiz_id = p_quiz_id;

  if found and correct_count > 0 and clock_timestamp() - started <= interval '4 minutes' then
    quick := true;
  end if;

  earned := correct_count;
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
        or (b.slug = 'quick_draw' and quick)
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

  for badge_row in
    select b.*
    from public.badges b
    where (b.slug = 'first_blood' and (select count(*) from public.submissions where user_id = uid) = 1)
      or (b.slug = 'perfect_score' and correct_count = total_count)
      or (b.slug = 'streak_7' and new_streak >= 7)
      or (b.slug = 'ironman_30' and new_streak >= 30)
      or (b.slug = 'quick_draw' and quick)
    order by b.name
  loop
    attempt := attempt || jsonb_build_array(
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
    'new_badges', awarded,
    'attempt_badges', attempt
  );
end;
$$;



insert into public.user_badges (user_id, badge_slug)
select distinct s.user_id, 'first_blood'
from public.submissions s
on conflict do nothing;

insert into public.user_badges (user_id, badge_slug)
select distinct s.user_id, 'perfect_score'
from public.submissions s
where s.score > 0
  and s.score = (select count(*) from public.questions q where q.quiz_id = s.quiz_id)
on conflict do nothing;

insert into public.user_badges (user_id, badge_slug)
select distinct s.user_id, 'quick_draw'
from public.submissions s
join public.quiz_starts st on st.user_id = s.user_id and st.quiz_id = s.quiz_id
where s.score > 0
  and s.completed_at - st.started_at <= interval '4 minutes'
on conflict do nothing;

select p.full_name, ub.badge_slug
from public.user_badges ub
join public.profiles p on p.id = ub.user_id
order by p.full_name, ub.badge_slug;
