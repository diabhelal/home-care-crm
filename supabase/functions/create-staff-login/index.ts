// create-staff-login: admin-only Edge Function that provisions a real Supabase Auth
// login for a medical_staff row and links them together.
//
// Why this has to be a server-side function, not client JS: creating an auth user
// (or inviting one) requires the service_role key, which bypasses every RLS policy in
// this project. That key must never be sent to, or run in, a browser — it lives only
// in this function's environment (SUPABASE_SERVICE_ROLE_KEY, injected automatically
// by the Supabase platform for every Edge Function; never configured or exposed
// client-side).
//
// verify_jwt is enabled at deploy time, so the platform itself already rejects any
// request without a valid Supabase session before this code runs. That only proves
// "some authenticated user called this" — the explicit is_admin check below is what
// actually restricts this to admins.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  // Client scoped to the caller's own session (not service_role) — used only to verify
  // who is calling and that they are actually an admin. No more privilege than any
  // other authenticated user.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return jsonResponse({ error: "not_authenticated" }, 401);
  }
  if (caller.app_metadata?.is_admin !== true) {
    return jsonResponse({ error: "admin_only" }, 403);
  }

  let body: { staff_id?: number; origin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }
  const staffId = body.staff_id;
  const origin = typeof body.origin === "string" ? body.origin : "";
  if (!staffId || !origin) {
    return jsonResponse({ error: "missing_staff_id_or_origin" }, 400);
  }

  // service_role client — server-side only, never sent to the browser.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: staff, error: staffError } = await admin
    .from("medical_staff")
    .select("id, full_name, email, auth_user_id")
    .eq("id", staffId)
    .single();
  if (staffError || !staff) {
    return jsonResponse({ error: "staff_not_found" }, 404);
  }
  if (!staff.email) {
    return jsonResponse({ error: "staff_missing_email" }, 400);
  }
  if (staff.auth_user_id) {
    return jsonResponse({ error: "staff_already_linked" }, 400);
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    staff.email,
    { redirectTo: `${origin}/employee-login.html` },
  );
  if (inviteError || !invited?.user) {
    return jsonResponse({ error: "invite_failed", detail: inviteError?.message || null }, 400);
  }

  const { error: linkError } = await admin
    .from("medical_staff")
    .update({ auth_user_id: invited.user.id })
    .eq("id", staffId);
  if (linkError) {
    return jsonResponse({ error: "invite_sent_but_link_failed", detail: linkError.message }, 500);
  }

  return jsonResponse({ ok: true });
});
