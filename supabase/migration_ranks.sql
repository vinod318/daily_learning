create or replace function public.rank_title(p_xp integer)
returns text
language sql
immutable
as $$
  select case
    when p_xp >= 160 then 'Principal Engineer'
    when p_xp >= 90 then 'Staff Engineer'
    when p_xp >= 40 then 'Senior Engineer'
    when p_xp >= 15 then 'Junior Engineer'
    else 'Intern'
  end;
$$;
