-- 007_price_confirmation.sql  (Phase 6 follow-up)
-- Human-confirmed sourcing prices (spec Section 5 integrity rule).
--
-- Section 5 rules: ALTER only, never DROP; IF NOT EXISTS on column adds;
-- sequential numbering; run by hand in the Supabase SQL Editor. Re-runnable.
--
-- Context: web_fetch returns no usable text on essentially every mainstream
-- retailer product page, so the model-side priceInPage() rail almost never
-- fires and submit_sourcing almost never auto-logs. This column records the
-- second path: a project editor taps "Log this" on an unverified candidate,
-- gets a confirm step, and vouches for the price themselves. The integrity
-- rule is unchanged — nothing is logged as fact without someone (model OR
-- human) confirming it — we're just recording which one did.

alter table public.items
  add column if not exists price_confirmation text
    check (price_confirmation in ('fetch_verified', 'human_confirmed'));

comment on column public.items.price_confirmation is
  'How a sourced price was confirmed. fetch_verified = the model called '
  'submit_sourcing and priceInPage() matched the price on a page it actually '
  'fetched that turn. human_confirmed = a project editor confirmed an '
  'unverified candidate through the "Log this" confirm step. Null for '
  'manually-entered items and anything sourced before this feature.';

-- No RLS change: items policies (003_rls.sql) already gate every column by
-- project role, and no backfill — null is the correct value for existing rows.
