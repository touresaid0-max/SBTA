import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // 1. Vérifier que l'appelant est admin
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerRole =
      (caller.app_metadata?.role as string | undefined) ??
      (caller.user_metadata?.role as string | undefined);

    if (callerRole !== "admin") {
      return new Response(
        JSON.stringify({ error: "Accès refusé — Admin uniquement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { employee_id, email, password, assigned_route_ids } = await req.json();

    if (!employee_id) throw new Error("employee_id requis");
    if (!password) throw new Error("Mot de passe requis");

    // 2. Récupérer l'employé (doit exister et être en attente)
    const { data: employee, error: fetchError } = await supabaseAdmin
      .from("employees")
      .select("*")
      .eq("id", employee_id)
      .eq("account_status", "pending")
      .maybeSingle();

    if (fetchError || !employee) throw new Error("Employé introuvable ou compte déjà créé");

    // 3. Déterminer l'email du compte
    const accountEmail = email || employee.professional_email || employee.personal_email;
    if (!accountEmail) throw new Error("Email requis pour créer le compte");

    // 4. Créer le compte Auth Supabase — ou adopter un compte orphelin existant
    let authUid: string;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: accountEmail,
      password,
      email_confirm: true,
      app_metadata: {
        role: employee.role,
        provider: "email",
        providers: ["email"],
      },
      user_metadata: {
        employee_id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role: employee.role,
      },
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("in use")) {
        // Email already exists in Auth — check if it's an orphan (no public.users row)
        // Use the fast RPC lookup instead of paginating through all auth users
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("get_auth_user_id_by_email", { p_email: accountEmail });
        let existingUser: { id: string } | null = null;
        if (!rpcError && rpcData && rpcData.length > 0) {
          existingUser = { id: rpcData[0].id as string };
        }

        if (existingUser) {
          // Check for an existing profile — refuse if the orphan already has one
          const { data: existingProfile } = await supabaseAdmin
            .from("users")
            .select("id")
            .eq("id", existingUser.id)
            .maybeSingle();

          if (existingProfile) {
            throw new Error("Cette adresse e-mail est déjà utilisée par un autre compte");
          }

          // Adopt the orphan: update password + metadata
          const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
            password,
            email_confirm: true,
            app_metadata: {
              role: employee.role,
              provider: "email",
              providers: ["email"],
            },
            user_metadata: {
              employee_id: employee.id,
              first_name: employee.first_name,
              last_name: employee.last_name,
              role: employee.role,
            },
          });
          if (updateAuthError) throw updateAuthError;
          authUid = existingUser.id;
        } else {
          throw new Error(authError.message);
        }
      } else {
        throw new Error(authError.message);
      }
    } else {
      authUid = authData.user.id;
    }

    // 5. Insérer le profil dans users (nécessaire pour fetchProfile et toute la session auth)
    const fullName = `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim();

    const { error: usersInsertError } = await supabaseAdmin.from("users").insert({
      id:            authUid,
      email:         accountEmail,
      full_name:     fullName,
      first_name:    employee.first_name,
      last_name:     employee.last_name,
      phone:         employee.phone ?? null,
      role:          employee.role,
      company_id:    employee.company_id ?? null,
      station_id:    employee.station_id ?? null,
      employee_id:   employee.employee_id ?? null,
      gender:        employee.gender ?? null,
      hire_date:     employee.hire_date ?? null,
      contract_type: employee.contract_type ?? null,
      salary:        employee.salary ?? null,
      daily_rate:    employee.daily_rate ?? null,
      cnps_number:   employee.cnps_number ?? null,
      children_count:  employee.children_count ?? 0,
      marital_status:  employee.marital_status ?? null,
      bus_id:          employee.bus_id ?? null,
      license_number:  employee.license_number ?? null,
      license_expiry:  employee.license_expiry ?? null,
      license_category: employee.license_category ?? null,
      assigned_route_id: employee.assigned_route_id ?? null,
      avatar_url:    employee.avatar_url ?? null,
      status:        "active",
      is_active:     true,
      is_self_registered: false,
      created_by:    caller.id,
    });

    if (usersInsertError) {
      // Rollback : supprimer le compte Auth si l'insert échoue
      await supabaseAdmin.auth.admin.deleteUser(authUid);
      throw new Error(usersInsertError.message ?? usersInsertError.details ?? JSON.stringify(usersInsertError));
    }

    // 6. Lier le compte Auth à l'employé et passer en actif
    const { error: updateError } = await supabaseAdmin
      .from("employees")
      .update({
        auth_user_id:       authUid,
        account_status:     "active",
        account_created_at: new Date().toISOString(),
        account_created_by: caller.id,
        professional_email: accountEmail,
        updated_at:         new Date().toISOString(),
        ...(assigned_route_ids !== undefined ? { assigned_route_ids: Array.isArray(assigned_route_ids) && assigned_route_ids.length > 0 ? assigned_route_ids : [] } : {}),
      })
      .eq("id", employee_id);

    if (updateError) {
      // Rollback complet
      await supabaseAdmin.from("users").delete().eq("id", authUid);
      await supabaseAdmin.auth.admin.deleteUser(authUid);
      throw updateError;
    }

    // 7. Logger
    await supabaseAdmin.from("activity_logs").insert({
      user_id:     caller.id,
      target_id:   employee_id,
      target_type: "employee",
      action:      "account_created_by_admin",
      description: `Compte créé pour ${employee.first_name} ${employee.last_name} (${employee.role}) — Email : ${accountEmail}`,
      new_values:  { email: accountEmail, auth_user_id: authUid },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Compte créé pour ${employee.first_name} ${employee.last_name}`,
        auth_uid: authUid,
      }),
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
