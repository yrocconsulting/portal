"use client";

import { useActionState, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";
import { saveMyProfile, saveStaffProfile } from "./actions";

type Person = { id: string; email: string; full_name: string | null; job_title: string | null; phone: string | null };

export function ProfileForm({ person, photoUrl, mode }: { person: Person; photoUrl: string | null; mode: "self" | "admin" }) {
  const [state, action, pending] = useActionState(mode === "self" ? saveMyProfile : saveStaffProfile, {});
  // undefined = unchanged, "" = removed, path = new upload
  const [avatarPath, setAvatarPath] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(photoUrl);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return setErr("Use a PNG, JPG, WebP or GIF image.");
    if (f.size > 5 * 1024 * 1024) return setErr("That image is over 5 MB.");
    setUploading(true);
    const ext = f.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${person.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("avatars").upload(path, f, { contentType: f.type });
    setUploading(false);
    if (error) return setErr(error.message);
    setAvatarPath(path);
    setPreview(URL.createObjectURL(f));
  }

  const name = person.full_name || person.email;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={person.id} />
      {avatarPath !== undefined && <input type="hidden" name="avatar_path" value={avatarPath} />}

      <div className="flex items-center gap-4">
        <Avatar name={name} url={preview} size={72} />
        <div className="space-y-1">
          <div className="flex gap-2">
            <button type="button" className="btn-ghost py-1.5 text-xs" disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? "Uploading..." : preview ? "Change photo" : "Upload photo"}
            </button>
            {preview && (
              <button
                type="button"
                className="text-xs text-muted hover:text-red-700"
                onClick={() => {
                  setAvatarPath("");
                  setPreview(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted">Square images look best. PNG, JPG or WebP, up to 5 MB.</p>
          {err && <p className="text-xs text-red-700">{err}</p>}
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="full_name">
            Name
          </label>
          <input id="full_name" name="full_name" defaultValue={person.full_name ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="job_title">
            Job title
          </label>
          <input id="job_title" name="job_title" defaultValue={person.job_title ?? ""} placeholder="e.g. Account Manager" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={person.phone ?? ""} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Email</label>
          <p className="text-sm text-muted">{person.email} (the sign in address; ask an admin to change it)</p>
        </div>
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok && !pending && <p className="text-sm text-green-d">Saved.</p>}
      <button className="btn-green" disabled={pending || uploading}>
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
