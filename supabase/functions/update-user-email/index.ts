import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Accès refusé — Admin uniquement" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { user_id, new_email } = body;

    if (!user_id || !new_email) {
      return new Response(
        JSON.stringify({ error: "user_id et new_email sont requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = String(new_email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return new Response(
        JSON.stringify({ error: "L'adresse e-mail n'est pas valide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Locate the target: real account (users table) or employee record.
    const { data: targetUser } = await supabaseAdmin
      .from("users")
      .select("id, email, first_name, last_name, role, company_id, station_id, status, is_active, employee_id, phone, license_number, license_expiry, license_category, organization_id")
      .eq("id", user_id)
      .maybeSingle();

    let isEmployeeRecord = false;
    let previousEmail: string | null = null;

    if (targetUser) {
      previousEmail = targetUser.email;
    } else {
      const { data: targetEmployee } = await supabaseAdmin
        .from("employees")
        .select("id, professional_email, personal_email, first_name, last_name, role, company_id, station_id, account_status")
        .eq("id", user_id)
        .maybeSingle();

      if (!targetEmployee) {
        return new Response(
          JSON.stringify({ error: "Utilisateur introuvable" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      isEmployeeRecord = true;
      previousEmail = targetEmployee.professional_email ?? targetEmployee.personal_email;
    }

    if (previousEmail && previousEmail.toLowerCase() === normalizedEmail) {
      return new Response(
        JSON.stringify({ error: "La nouvelle adresse e-mail est identique à l'actuelle" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Uniqueness check across the users table (mirrors auth emails for staff).
    const { data: duplicate } = await supabaseAdmin
      .from("users")
      .select("id")
      .ilike("email", normalizedEmail)
      .neq("id", user_id)
      .maybeSingle();

    if (duplicate) {
      return new Response(
        JSON.stringify({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isEmployeeRecord) {
      // Employee record without an auth account: update the employees table only.
      const { error: empUpdateError } = await supabaseAdmin
        .from("employees")
        .update({ professional_email: normalizedEmail })
        .eq("id", user_id);

      if (empUpdateError) throw empUpdateError;

      await supabaseAdmin.from("activity_logs").insert({
        user_id: caller.id,
        target_id: user_id,
        target_type: "employee",
        action: "email_changed",
        description: `E-mail modifié de ${previousEmail ?? "—"} à ${normalizedEmail}`,
        old_values: { email: previousEmail },
        new_values: { email: normalizedEmail },
      });

      return new Response(
        JSON.stringify({ success: true, user_id, old_email: previousEmail, new_email: normalizedEmail }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Real auth account: update the auth email via the Admin API.
    // GoTrue enforces uniqueness at the auth layer; email_confirm keeps the
    // account immediately usable without a re-confirmation round-trip.
    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      { email: normalizedEmail, email_confirm: true }
    );

    if (authUpdateError) {
      const msg = authUpdateError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("in use")) {
        return new Response(
          JSON.stringify({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw authUpdateError;
    }

    // Keep the users table row in sync with the auth identity.
    const { error: usersUpdateError } = await supabaseAdmin
      .from("users")
      .update({ email: normalizedEmail })
      .eq("id", user_id);

    if (usersUpdateError) throw usersUpdateError;

    await supabaseAdmin.from("activity_logs").insert({
      user_id: caller.id,
      target_id: user_id,
      target_type: "user",
      action: "email_changed",
      description: `E-mail modifié de ${previousEmail ?? "—"} à ${normalizedEmail} pour ${targetUser!.first_name ?? ""} ${targetUser!.last_name ?? ""}`.trim(),
      old_values: { email: previousEmail },
      new_values: { email: normalizedEmail },
    });

    return new Response(
      JSON.stringify({ success: true, user_id, old_email: previousEmail, new_email: normalizedEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
