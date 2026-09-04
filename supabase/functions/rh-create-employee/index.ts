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
    // 1. Authentifier l'appelant
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Vérifier le rôle — rh ou admin autorisés
    const callerRole =
      (caller.app_metadata?.role as string | undefined) ??
      (caller.user_metadata?.role as string | undefined) ??
      "";

    if (!["rh", "admin", "gerant_principal"].includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: "Accès refusé — RH, Admin ou Gérant Principal uniquement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Distinguer CREATE vs UPDATE selon la méthode
    const isUpdate = req.method === "PUT" || req.method === "PATCH";
    const body = await req.json();

    if (isUpdate) {
      const { id, ...fields } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "ID employé manquant pour la mise à jour" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Déterminer la table cible
      const { data: empRow } = await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      if (empRow) {
        const { error } = await supabaseAdmin
          .from("employees")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin
          .from("users")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. CREATE — extraire et valider les champs
    const {
      first_name, last_name, gender, nationality, date_naissance, phone,
      personal_email, professional_email,
      role, company_id, station_id,
      hire_date, contract_type, contract_nature, salary, daily_rate,
      cnps_number, children_count, marital_status,
      bus_id, license_number, license_expiry, license_category,
      employee_id, assigned_route_id, assigned_route_ids, avatar_url,
      technician_type_id,
    } = body;

    if (!first_name?.trim()) throw new Error("Le prénom est obligatoire");
    if (!last_name?.trim())  throw new Error("Le nom est obligatoire");
    if (!role)               throw new Error("Le poste est obligatoire");
    if (!hire_date)          throw new Error("La date d'entrée est obligatoire");
    if (!contract_type)      throw new Error("Le type de contrat est obligatoire");

    if (contract_type === "titulaire" && !salary) {
      throw new Error("Le salaire est obligatoire pour un titulaire");
    }
    if (role === "chauffeur" && contract_type === "contractuel" && !daily_rate) {
      throw new Error("Le taux journalier est obligatoire pour un chauffeur contractuel");
    }

    const REQUIRES_COMPANY = ["chauffeur","agent_reservation","chef_garage","mecanicien","pompiste","gestionnaire"];
    if (REQUIRES_COMPANY.includes(role) && !company_id) {
      throw new Error("La société est obligatoire pour ce poste");
    }
    const REQUIRES_STATION = ["agent_colis","chef_gare"];
    if (REQUIRES_STATION.includes(role) && !station_id) {
      throw new Error("La gare d'affectation est obligatoire pour ce poste");
    }

    // 5. Auto-générer matricule si absent
    let finalEmployeeId = employee_id?.trim() || null;
    if (!finalEmployeeId) {
      const { count } = await supabaseAdmin
        .from("employees")
        .select("id", { count: "exact", head: true });
      finalEmployeeId = `EMP-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, "0")}`;
    }

    // 6. Insérer dans employees (service role = bypass RLS)
    const { data: newEmployee, error: insertError } = await supabaseAdmin
      .from("employees")
      .insert({
        first_name:         first_name.trim(),
        last_name:          last_name.trim(),
        gender:             gender || null,
        nationality:        nationality?.trim() || null,
        date_naissance:     date_naissance || null,
        phone:              phone?.trim() || null,
        personal_email:     personal_email?.trim() || null,
        professional_email: professional_email?.trim() || null,
        role,
        company_id:         company_id || null,
        station_id:         station_id || null,
        hire_date,
        contract_type:      contract_type || null,
        contract_nature:    contract_nature || null,
        salary:             salary ? Number(salary) : null,
        daily_rate:         daily_rate ? Number(daily_rate) : null,
        cnps_number:        cnps_number?.trim() || null,
        children_count:     Number(children_count) || 0,
        marital_status:     marital_status || null,
        bus_id:             bus_id || null,
        license_number:     license_number?.trim() || null,
        license_expiry:     license_expiry || null,
        license_category:   license_category || null,
        avatar_url:         avatar_url?.trim() || null,
        assigned_route_id:  assigned_route_id || null,
        assigned_route_ids: Array.isArray(assigned_route_ids) && assigned_route_ids.length > 0 ? assigned_route_ids : null,
        technician_type_id: role === "mecanicien" && technician_type_id ? technician_type_id : null,
        employee_id:        finalEmployeeId,
        account_status:     "pending",
        auth_user_id:       null,
        created_by:         null,
      })
      .select("id, first_name, last_name, role, employee_id, account_status")
      .single();

    if (insertError) throw new Error(insertError.message ?? insertError.details ?? JSON.stringify(insertError));

    // 7. Journal d'activité
    await supabaseAdmin.from("activity_logs").insert({
      user_id:     caller.id,
      target_id:   newEmployee.id,
      target_type: "employee",
      action:      "employee_created_by_rh",
      description: `Fiche créée : ${first_name} ${last_name} (${role}) — en attente de compte`,
      new_values:  { employee_id: finalEmployeeId, role, company_id },
    }).then(); // fire and forget

    return new Response(
      JSON.stringify({ success: true, employee: newEmployee }),
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
