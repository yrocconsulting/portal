-- Quotes read from ProRankTracker screenshots by Claude: which screenshot a quote came from,
-- and when each screenshot was read (so it isn't read twice).
alter table public.report_media
  add column read_at     timestamptz,
  add column read_note   text;            -- e.g. "2 quotes found" or why nothing was used
alter table public.report_quotes
  add column media_id uuid references public.report_media (id) on delete set null;
