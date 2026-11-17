-- Staff profiles: job title, phone and photo. People edit their own; admins can edit anyone's.

alter table public.staff
  add column job_title   text,
  add column phone       text,
  add column avatar_path text;   -- object path in the private "avatars" bucket

-- Self-service update that can't touch role or access.
create or replace function public.update_my_profile(p_name text, p_title text, p_phone text, p_avatar text)
returns void
language sql security definer set search_path = public as $$
  update public.staff
     set full_name   = nullif(trim(p_name), ''),
         job_title   = nullif(trim(p_title), ''),
         phone       = nullif(trim(p_phone), ''),
         avatar_path = case
                         when p_avatar is null then avatar_path            -- unchanged
                         when p_avatar = '' then null                      -- removed
                         when p_avatar like auth.uid()::text || '/%' then p_avatar
                         else avatar_path
                       end
   where id = auth.uid() and active;
$$;
revoke execute on function public.update_my_profile(text, text, text, text) from anon;

-- Photos: private bucket, images up to 5 MB. Staff can see everyone's; people manage their own folder,
-- admins anyone's.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_staff());
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_staff()
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
