import Image from "next/image";
import type { Metadata } from "next";
import { signInWithMicrosoft } from "./actions";
import { EmailForm } from "./email-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image src="/logo-white.png" alt="Yroc Consulting" width={160} height={48} priority />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-bold">Sign in to the portal</h1>
          <p className="mt-1 text-sm text-muted">Yroc Consulting team access only.</p>
          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <form action={signInWithMicrosoft} className="mt-6">
            <input type="hidden" name="next" value={next} />
            <button className="btn-primary w-full py-2.5">
              <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft 365
            </button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <EmailForm next={next} />
        </div>
      </div>
    </main>
  );
}
