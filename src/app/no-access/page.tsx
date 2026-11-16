import { createClient } from "@/lib/supabase/server";

export default async function NoAccess() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-bold">No access yet</h1>
        <p className="mt-2 text-sm text-muted">
          {data.user?.email ? <>You are signed in as <b className="text-ink">{data.user.email}</b>, but </> : "This account "}
          has not been invited to the Yroc Portal. Ask an admin to invite this email address, then sign in again.
        </p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button className="btn-ghost w-full">Sign out</button>
        </form>
      </div>
    </main>
  );
}
