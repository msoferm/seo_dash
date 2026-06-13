import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "חסרים VITE_SUPABASE_URL ו/או VITE_SUPABASE_ANON_KEY ב-.env.local. " +
    "העתק את frontend/.env.example ל-frontend/.env.local ומלא ערכים."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Invoke an Edge Function. Returns the parsed JSON body. */
export async function invokeFn<T = any>(name: string, body: any = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // supabase-js wraps non-2xx responses in FunctionsHttpError with the raw Response on `context`.
    // Read the body to get the real server error message instead of the generic "non-2xx status code".
    const ctx = (error as any).context;
    if (ctx && typeof ctx.text === "function") {
      try {
        const text = await ctx.text();
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.error || parsed.message || text);
        } catch {
          throw new Error(text || error.message);
        }
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message);
  }
  return data as T;
}

/** Invoke a function with FormData (for file upload). */
export async function invokeFnFormData(name: string, formData: FormData, query: Record<string, string> = {}): Promise<any> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("לא מאומת");
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: formData,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
