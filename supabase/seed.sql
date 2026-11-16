-- Local development only (never runs against production): invite a test admin and a test member.
insert into public.staff_invites (email, role) values ('admin@yroc.test', 'admin'), ('member@yroc.test', 'member')
on conflict do nothing;
