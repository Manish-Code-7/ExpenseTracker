-- =====================================================================
--  Integrity guards + recurring detection
--  Run AFTER neon/migrations/0000_init.sql
--
--  These were triggers/functions in the Supabase schema. The only change is
--  that user ids are `text` (Better Auth) rather than `uuid` (auth.users),
--  and detect_my_recurring_patterns() is gone — Neon has no auth.uid(), so
--  the app passes the id and the tRPC procedure guarantees whose it is.
-- =====================================================================

-- A subcategory may not itself have children (max depth = 2).
create or replace function public.categories_depth_guard()
returns trigger language plpgsql as $$
begin
  if new.parent_category_id is not null then
    if exists (
      select 1 from public.categories p
      where p.id = new.parent_category_id and p.parent_category_id is not null
    ) then
      raise exception 'Subcategories cannot be nested more than one level deep';
    end if;
    if new.parent_category_id = new.id then
      raise exception 'A category cannot be its own parent';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists categories_depth_guard on public.categories;
create trigger categories_depth_guard
  before insert or update on public.categories
  for each row execute function public.categories_depth_guard();

-- A chat message must belong to one of the same user's sessions.
create or replace function public.chat_messages_ownership_guard()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.chat_sessions s
    where s.id = new.session_id and s.user_id = new.user_id
  ) then
    raise exception 'chat message must belong to one of your own chat sessions';
  end if;
  return new;
end $$;

drop trigger if exists chat_messages_ownership on public.chat_messages;
create trigger chat_messages_ownership
  before insert or update on public.chat_messages
  for each row execute function public.chat_messages_ownership_guard();

-- The stored key the recurring identity index needs as an ON CONFLICT target.
alter table public.recurring_patterns
  add column if not exists subcat_key uuid
  generated always as (coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

create unique index if not exists recurring_patterns_identity
  on public.recurring_patterns (user_id, category_id, subcat_key, account_id, note_key);

-- Normalised note fingerprint used to group occurrences.
create or replace function public.note_key(p_note text)
returns text language sql immutable as $$
  select coalesce(nullif(regexp_replace(lower(btrim(p_note)), '[^a-z0-9]+', '', 'g'), ''), '')
$$;

-- ---------------------------------------------------------------------
--  Recurring detection
--
--  NOTE: rewritten during the Neon migration from the columns it fills and
--  the behaviour the UI documents ("at least three similar expenses on the
--  same category and payment method, spaced evenly apart"), because the
--  original Supabase version was lost. Verify against your own data before
--  trusting the confidence scores.
--
--  Groups a user's expenses by (category, subcategory, method, note
--  fingerprint), keeps groups seen >= p_min_occurrences times, and scores how
--  evenly spaced they are.
-- ---------------------------------------------------------------------
create or replace function public.detect_recurring_patterns(
  p_user_id text,
  p_min_occurrences int default 3
) returns int language plpgsql as $$
declare
  v_count int;
begin
  with occurrences as (
    select
      e.user_id,
      e.category_id,
      e.subcategory_id,
      e.source_account_id as account_id,
      public.note_key(coalesce(e.merchant, e.description)) as note_key,
      e.amount,
      e.date,
      coalesce(e.merchant, e.description) as note,
      lag(e.date) over w as prev_date
    from public.transactions e
    where e.user_id = p_user_id
      and e.type = 'EXPENSE'
      and e.source_account_id is not null
    window w as (
      partition by e.category_id, e.subcategory_id, e.source_account_id,
                   public.note_key(coalesce(e.merchant, e.description))
      order by e.date
    )
  ),
  gaps as (
    select *, (date - prev_date)::numeric as gap_days
    from occurrences
  ),
  grouped as (
    select
      user_id, category_id, subcategory_id, account_id, note_key,
      count(*)                         as occurrence_count,
      avg(amount)                      as average_amount,
      max(date)                        as last_detected_date,
      avg(gap_days) filter (where gap_days is not null)    as avg_gap,
      stddev_pop(gap_days) filter (where gap_days is not null) as gap_stddev,
      (array_agg(note order by date desc) filter (where note is not null))[1] as sample_note
    from gaps
    group by user_id, category_id, subcategory_id, account_id, note_key
    having count(*) >= p_min_occurrences
       and avg(gap_days) filter (where gap_days is not null) between 3 and 400
  ),
  scored as (
    select
      *,
      -- Regularity: 1 when gaps are identical, decaying as they scatter.
      greatest(0, 1 - coalesce(gap_stddev, 0) / nullif(avg_gap, 0)) as regularity,
      case
        when avg_gap < 11  then 'weekly'
        when avg_gap < 200 then 'monthly'
        else 'yearly'
      end::public.recurrence_frequency as frequency
    from grouped
  )
  insert into public.recurring_patterns as rp (
    user_id, category_id, subcategory_id, account_id,
    merchant_or_note_pattern, note_key, average_amount, frequency,
    avg_interval_days, occurrence_count, confidence_score,
    last_detected_date, next_due_date
  )
  select
    user_id, category_id, subcategory_id, account_id,
    sample_note, note_key,
    round(average_amount, 2),
    frequency,
    round(avg_gap)::int,
    occurrence_count,
    -- More sightings and tighter spacing both raise confidence; capped at 1.
    least(0.999, round(
      (regularity * 0.7 + least(occurrence_count, 6) / 6.0 * 0.3)::numeric, 3
    )),
    last_detected_date,
    last_detected_date + round(avg_gap)::int
  from scored
  on conflict (user_id, category_id, subcat_key, account_id, note_key)
  do update set
    average_amount     = excluded.average_amount,
    frequency          = excluded.frequency,
    avg_interval_days  = excluded.avg_interval_days,
    occurrence_count   = excluded.occurrence_count,
    confidence_score   = excluded.confidence_score,
    last_detected_date = excluded.last_detected_date,
    next_due_date      = excluded.next_due_date,
    merchant_or_note_pattern = excluded.merchant_or_note_pattern,
    updated_at         = now()
  -- A pattern the user already judged keeps that judgement.
  where rp.is_confirmed = false and rp.is_dismissed = false;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

/** Every user — for a scheduled job. */
create or replace function public.detect_recurring_patterns_all()
returns int language plpgsql as $$
declare v_total int := 0; v_user text;
begin
  for v_user in select distinct user_id from public.transactions loop
    v_total := v_total + public.detect_recurring_patterns(v_user);
  end loop;
  return v_total;
end $$;
