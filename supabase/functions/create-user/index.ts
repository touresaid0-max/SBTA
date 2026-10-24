import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPERATIONAL_ROLES = [
  "chauffeur", "guichetier", "chef_garage", "mecanicien",
  "planificateur", "pompiste", "chef_gare", "gestionnaire", "agent_colis",
];

const REQUIRES_STATION = ["agent_colis", "chef_gare"];

function isAlreadyRegisteredError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("already") || m.includes("registered") || m.includes("exists") || m.includes("in use") || m.includes("has already been taken");
}

// Fast lookup of an existing auth user by email via a SECURITY DEFINER RPC.
// Avoids paginating through auth.users which is slow and unreliable at scale.
async function findAuthUserByEmail(client: ReturnType<typeof createClient>, email: string): Promise<{ id: string } | null> {
  const { data, error } = await client.rpc("get_auth_user_id_by_email", { p_email: email });
  if (error || !data || data.length === 0) return null;
  return { id: data[0].id as string };
}

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
    const {
      email,
      password,
      first_name,
      last_name,
      phone,
      role,
      company_id,
      assigned_company_ids,
      station_id,
      employee_id,
      license_number,
      license_expiry,
      license_category,
      technician_type_id,
      colis_direction,
      assigned_route_ids,
      send_invitation,
      assistance_gp,
      tpe_pos_enabled,
      tpe_mode,
    } = body;

    if (!role) {
      return new Response(
        JSON.stringify({ error: "Le rôle est obligatoire" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (OPERATIONAL_ROLES.includes(role) && !company_id) {
      return new Response(
        JSON.stringify({ error: "La société est obligatoire pour ce poste" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (REQUIRES_STATION.includes(role) && !station_id) {
      return new Response(
        JSON.stringify({ error: "La gare d'affectation est obligatoire pour ce poste" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (role === "client") {
      return new Response(
        JSON.stringify({ error: "Les clients s'inscrivent via le portail public" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let authUserId: string;
    let invitationToken: string | null = null;

    if (send_invitation) {
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { first_name, last_name, role },
        redirectTo: `${Deno.env.get("APP_URL")}/accept-invitation`,
      });
      if (inviteError) {
        if (isAlreadyRegisteredError(inviteError.message)) {
          const existing = await findAuthUserByEmail(supabaseAdmin, email);
          if (existing) {
            const { data: existingProfile } = await supabaseAdmin
              .from("users")
              .select("id")
              .eq("id", existing.id)
              .maybeSingle();
            if (existingProfile) {
              return new Response(
                JSON.stringify({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            await supabaseAdmin.auth.admin.updateUserById(existing.id, {
              email_confirm: true,
              app_metadata: { role, provider: "email", providers: ["email"] },
              user_metadata: { first_name, last_name, role },
            });
            authUserId = existing.id;
            invitationToken = crypto.randomUUID();
          } else {
            throw new Error(inviteError.message);
          }
        } else {
          throw new Error(inviteError.message);
        }
      } else {
        authUserId = inviteData.user.id;
        invitationToken = crypto.randomUUID();
      }
    } else {
      const { data: authData, error: authError2 } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role, provider: "email", providers: ["email"] },
        user_metadata: { first_name, last_name, role },
      });
      if (authError2) {
        if (isAlreadyRegisteredError(authError2.message)) {
          const existing = await findAuthUserByEmail(supabaseAdmin, email);
          if (existing) {
            const { data: existingProfile } = await supabaseAdmin
              .from("users")
              .select("id")
              .eq("id", existing.id)
              .maybeSingle();
            if (existingProfile) {
              return new Response(
                JSON.stringify({ error: "Cette adresse e-mail est déjà utilisée par un autre compte" }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            await supabaseAdmin.auth.admin.updateUserById(existing.id, {
              password,
              email_confirm: true,
              app_metadata: { role, provider: "email", providers: ["email"] },
              user_metadata: { first_name, last_name, role },
            });
            authUserId = existing.id;
          } else {
            throw new Error(authError2.message);
          }
        } else {
          throw new Error(authError2.message);
        }
      } else {
        authUserId = authData.user.id;
      }
    }

    const fullName = `${first_name ?? ""} ${last_name ?? ""}`.trim() || email;

    const profileData: Record<string, unknown> = {
      id: authUserId,
      email,
      full_name: fullName,
      first_name,
      last_name,
      phone: phone || null,
      role,
      company_id: OPERATIONAL_ROLES.includes(role) ? (company_id || null) : null,
      station_id: station_id || null,
      employee_id: employee_id || null,
      status: send_invitation ? "pending_confirmation" : "active",
      is_active: !send_invitation,
      assistance_gp: role === "gerant_principal" && assistance_gp === true,
      is_self_registered: false,
      tpe_pos_enabled: role === "bagagiste" && tpe_pos_enabled === true,
      tpe_mode: role === "bagagiste" && tpe_pos_enabled === true ? (tpe_mode === "avec_guichet" ? "avec_guichet" : "sans_guichet") : "sans_guichet",
      created_by: caller.id,
      invitation_token: invitationToken,
      invitation_expires_at: invitationToken
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null,
    };

    if (role === "chauffeur") {
      profileData.license_number = license_number || null;
      profileData.license_expiry = license_expiry || null;
      profileData.license_category = license_category || null;
    }

    if (role === "mecanicien" && technician_type_id) {
      profileData.technician_type_id = technician_type_id;
    }

    if (role === "agent_colis" && Array.isArray(colis_direction)) {
      profileData.colis_direction = colis_direction;
    }

    const { error: profileError } = await supabaseAdmin.from("users").insert(profileData);
    if (profileError) {
      // Only rollback the auth account if we actually created it (not an adopted orphan)
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw new Error(profileError.message ?? profileError.details ?? JSON.stringify(profileError));
    }

    await supabaseAdmin.from("activity_logs").insert({
      user_id: caller.id,
      target_id: authUserId,
      target_type: "user",
      action: send_invitation ? "user_invited" : "user_created",
      description: `${send_invitation ? "Invitation envoyée" : "Utilisateur créé"} : ${first_name} ${last_name} (${role})`,
      new_values: { email, role, company_id: profileData.company_id, station_id: profileData.station_id },
    });

    // If guichetier, save assigned_route_ids to employees (triggers counter_routes sync)
    if (role === "guichetier" && Array.isArray(assigned_route_ids)) {
      const { error: routeError } = await supabaseAdmin
        .from("employees")
        .update({ assigned_route_ids, updated_at: new Date().toISOString() })
        .or(`id.eq.${employee_id},auth_user_id.eq.${authUserId}`);
      if (routeError) throw new Error(routeError.message);
    }

    // If comptable, save multi-company assignments using service role (bypasses RLS)
    if (role === "comptable" && Array.isArray(assigned_company_ids) && assigned_company_ids.length > 0) {
      const rows = assigned_company_ids.map((cid: string) => ({ user_id: authUserId, company_id: cid }));
      const { error: ccError } = await supabaseAdmin
        .from("comptable_companies")
        .upsert(rows, { onConflict: "user_id,company_id" });
      if (ccError) {
        console.error("Failed to save comptable company assignments:", ccError.message);
      }
    }

    // Notify all RH users about the new employee (created via trigger)
    try {
      const { data: rhUsers } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("role", "rh")
        .eq("status", "active");
      if (rhUsers && rhUsers.length > 0) {
        const notifContent = `Nouvel employé créé par l'Admin : ${first_name ?? ""} ${last_name ?? ""} (${role})${send_invitation ? " — invitation envoyée" : ""}`;
        const messages = rhUsers.map((rh) => ({
          sender_id: caller.id,
          receiver_id: rh.id,
          content: notifContent,
          is_read: false,
        }));
        await supabaseAdmin.from("admin_chat_messages").insert(messages);
      }
    } catch (_notifErr) {
      // Notification is best-effort; don't fail the user creation
    }

    return new Response(
      JSON.stringify({ success: true, user_id: authUserId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
