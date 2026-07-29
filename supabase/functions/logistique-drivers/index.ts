import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Roles allowed to access the drivers endpoint
const ALLOWED_ROLES = [
  "responsable_logistique",
  "rh",
  "admin",
  "gestionnaire",
  "daf",
];

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

    // Get caller profile to determine role and company
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("id, role, company_id")
      .eq("id", caller.id)
      .maybeSingle();

    // Also check JWT app_metadata role as fallback
    const jwtRole = caller.app_metadata?.role ?? callerProfile?.role;
    const companyId = callerProfile?.company_id ?? null;

    if (!jwtRole || !ALLOWED_ROLES.includes(jwtRole)) {
      return new Response(
        JSON.stringify({
          error: `Accès refusé — ${ALLOWED_ROLES.join(", ")} uniquement`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/logistique-drivers", "");

    // GET: list drivers (chauffeurs) filtered by company for gestionnaire
    if (req.method === "GET") {
      let query = supabaseAdmin
        .from("users")
        .select(`
          id, email, full_name, first_name, last_name, phone, role,
          company_id, is_active, status, avatar_url, employee_id,
          bus_id, license_number, license_expiry, license_category,
          driver_license_number, driver_license_expiry,
          driver_total_hours, driver_avg_rating, driver_total_reviews,
          companies!inner(id, name, code),
          buses(id, registration_number, model, brand)
        `)
        .eq("role", "chauffeur");

      // Gestionnaire only sees drivers from their own company
      if (jwtRole === "gestionnaire") {
        if (!companyId) {
          return new Response(
            JSON.stringify({ error: "Aucune société associée à votre compte" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        query = query.eq("company_id", companyId);
      }

      const { data: drivers, error: driversError } = await query;

      if (driversError) throw driversError;

      return new Response(
        JSON.stringify({ drivers: drivers ?? [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST: assign driver to bus
    if (req.method === "POST") {
      const body = await req.json();
      const { driver_id, bus_id } = body;

      if (!driver_id || !bus_id) {
        return new Response(
          JSON.stringify({ error: "driver_id et bus_id sont requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch the bus to verify it belongs to the gestionnaire's company
      const { data: bus } = await supabaseAdmin
        .from("buses")
        .select("id, company_id")
        .eq("id", bus_id)
        .maybeSingle();

      if (!bus) {
        return new Response(
          JSON.stringify({ error: "Bus introuvable" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (jwtRole === "gestionnaire" && bus.company_id !== companyId) {
        return new Response(
          JSON.stringify({ error: "Ce bus n'appartient pas à votre société" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch the driver to verify they belong to the gestionnaire's company
      const { data: driver } = await supabaseAdmin
        .from("users")
        .select("id, company_id, role")
        .eq("id", driver_id)
        .maybeSingle();

      if (!driver || driver.role !== "chauffeur") {
        return new Response(
          JSON.stringify({ error: "Chauffeur introuvable" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (jwtRole === "gestionnaire" && driver.company_id !== companyId) {
        return new Response(
          JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Assign: update the driver's bus_id
      const { error: assignError } = await supabaseAdmin
        .from("users")
        .update({ bus_id })
        .eq("id", driver_id);

      if (assignError) throw assignError;

      return new Response(
        JSON.stringify({ success: true, driver_id, bus_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE: unassign driver from bus
    if (req.method === "DELETE") {
      const body = await req.json();
      const { driver_id } = body;

      if (!driver_id) {
        return new Response(
          JSON.stringify({ error: "driver_id est requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: driver } = await supabaseAdmin
        .from("users")
        .select("id, company_id, role, bus_id")
        .eq("id", driver_id)
        .maybeSingle();

      if (!driver || driver.role !== "chauffeur") {
        return new Response(
          JSON.stringify({ error: "Chauffeur introuvable" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (jwtRole === "gestionnaire" && driver.company_id !== companyId) {
        return new Response(
          JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: unassignError } = await supabaseAdmin
        .from("users")
        .update({ bus_id: null })
        .eq("id", driver_id);

      if (unassignError) throw unassignError;

      return new Response(
        JSON.stringify({ success: true, driver_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Méthode non supportée" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
