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
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerRole =
      (caller.app_metadata?.role as string | undefined) ??
      (caller.user_metadata?.role as string | undefined) ??
      "";

    if (!["responsable_logistique", "admin", "rh"].includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: "Accès refusé — Responsable Logistique, RH ou Admin uniquement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── GET: fetch all buses with their assigned drivers ──
    if (req.method === "GET") {
      const { data: buses, error: busErr } = await supabaseAdmin
        .from("buses")
        .select("id, registration_number, brand, manufacturer, model, total_seats, company_id, status, is_active")
        .order("registration_number", { ascending: true });

      if (busErr) throw busErr;

      const { data: companies } = await supabaseAdmin
        .from("companies")
        .select("id, name, code")
        .order("name");

      // Fetch all chauffeurs (from both employees and users tables)
      const [empRes, usrRes] = await Promise.all([
        supabaseAdmin.from("employees")
          .select("id, first_name, last_name, role, bus_id, license_number, license_expiry, license_category, company_id, station_id, contract_type, hire_date, employee_id, account_status, phone, avatar_url")
          .eq("role", "chauffeur"),
        supabaseAdmin.from("users")
          .select("id, first_name, last_name, role, bus_id, license_number, license_expiry, license_category, company_id, station_id, contract_type, hire_date, employee_id, status, phone, avatar_url")
          .eq("role", "chauffeur"),
      ]);

      const empAuthIds = new Set((empRes.data ?? []).map((e: any) => e.auth_user_id).filter(Boolean));
      const drivers = [
        ...(empRes.data ?? []).map((d: any) => ({ ...d, source_table: "employees", status: d.account_status ?? "pending" })),
        ...(usrRes.data ?? []).filter((u: any) => !empAuthIds.has(u.id)).map((d: any) => ({ ...d, source_table: "users", status: d.status ?? "active" })),
      ];

      const companyName = new Map((companies ?? []).map((c: any) => [c.id, c.name]));
      const busDriversMap = new Map<string, any[]>();
      for (const d of drivers) {
        if (d.bus_id) {
          if (!busDriversMap.has(d.bus_id)) busDriversMap.set(d.bus_id, []);
          busDriversMap.get(d.bus_id)!.push({
            id: d.id,
            first_name: d.first_name,
            last_name: d.last_name,
            full_name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(),
            source_table: d.source_table,
            license_number: d.license_number,
            license_expiry: d.license_expiry,
            license_category: d.license_category,
            company_id: d.company_id,
            company_name: d.company_id ? companyName.get(d.company_id) ?? null : null,
            contract_type: d.contract_type,
            hire_date: d.hire_date,
            employee_id: d.employee_id,
            status: d.status,
            phone: d.phone,
            avatar_url: d.avatar_url,
          });
        }
      }

      const unassignedDrivers = drivers
        .filter((d: any) => !d.bus_id)
        .map((d: any) => ({
          id: d.id,
          first_name: d.first_name,
          last_name: d.last_name,
          full_name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(),
          source_table: d.source_table,
          license_number: d.license_number,
          license_expiry: d.license_expiry,
          license_category: d.license_category,
          company_id: d.company_id,
          company_name: d.company_id ? companyName.get(d.company_id) ?? null : null,
          contract_type: d.contract_type,
          hire_date: d.hire_date,
          employee_id: d.employee_id,
          status: d.status,
          phone: d.phone,
          avatar_url: d.avatar_url,
        }));

      const result = (buses ?? []).map((b: any) => ({
        ...b,
        brand: b.brand ?? b.manufacturer,
        company_name: b.company_id ? companyName.get(b.company_id) ?? null : null,
        drivers: busDriversMap.get(b.id) ?? [],
      }));

      return new Response(
        JSON.stringify({ buses: result, unassignedDrivers }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── POST: create a new chauffeur (syncs to RH employees table) ──
    if (req.method === "POST") {
      const body = await req.json();
      const {
        first_name, last_name, phone, gender, nationality, date_naissance,
        personal_email, professional_email,
        company_id, station_id, hire_date, contract_type, contract_nature,
        salary, daily_rate, cnps_number, children_count, marital_status,
        bus_id, license_number, license_expiry, license_category,
        employee_id, assigned_route_id, avatar_url,
      } = body;

      if (!first_name?.trim()) throw new Error("Le prénom est obligatoire");
      if (!last_name?.trim()) throw new Error("Le nom est obligatoire");
      if (!hire_date) throw new Error("La date d'entrée est obligatoire");
      if (!contract_type) throw new Error("Le type de contrat est obligatoire");

      if (contract_type === "titulaire" && !salary) {
        throw new Error("Le salaire est obligatoire pour un titulaire");
      }
      if (contract_type === "contractuel" && !daily_rate) {
        throw new Error("Le taux journalier est obligatoire pour un chauffeur contractuel");
      }

      let finalEmployeeId = employee_id?.trim() || null;
      if (!finalEmployeeId) {
        const { count } = await supabaseAdmin
          .from("employees")
          .select("id", { count: "exact", head: true });
        finalEmployeeId = `EMP-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, "0")}`;
      }

      const { data: newEmployee, error: insertError } = await supabaseAdmin
        .from("employees")
        .insert({
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          gender: gender || null,
          nationality: nationality?.trim() || null,
          date_naissance: date_naissance || null,
          phone: phone?.trim() || null,
          personal_email: personal_email?.trim() || null,
          professional_email: professional_email?.trim() || null,
          role: "chauffeur",
          company_id: company_id || null,
          station_id: station_id || null,
          hire_date,
          contract_type: contract_type || null,
          contract_nature: contract_nature || null,
          salary: salary ? Number(salary) : null,
          daily_rate: daily_rate ? Number(daily_rate) : null,
          cnps_number: cnps_number?.trim() || null,
          children_count: Number(children_count) || 0,
          marital_status: marital_status || null,
          bus_id: bus_id || null,
          license_number: license_number?.trim() || null,
          license_expiry: license_expiry || null,
          license_category: license_category || null,
          avatar_url: avatar_url?.trim() || null,
          assigned_route_id: assigned_route_id || null,
          employee_id: finalEmployeeId,
          account_status: "pending",
          auth_user_id: null,
          created_by: null,
        })
        .select("id, first_name, last_name, role, employee_id, account_status")
        .single();

      if (insertError) throw new Error(insertError.message ?? JSON.stringify(insertError));

      await supabaseAdmin.from("activity_logs").insert({
        user_id: caller.id,
        target_id: newEmployee.id,
        target_type: "employee",
        action: "driver_created_by_logistique",
        description: `Chauffeur créé : ${first_name} ${last_name} — en attente de compte`,
        new_values: { employee_id: finalEmployeeId, role: "chauffeur", company_id, bus_id },
      }).then();

      return new Response(
        JSON.stringify({ success: true, employee: newEmployee }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── PUT: update a chauffeur (including bus assignment) ──
    if (req.method === "PUT") {
      const body = await req.json();
      const { id, source_table, ...fields } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "ID chauffeur manquant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Determine target table
      let table = "employees";
      if (source_table === "users") {
        table = "users";
      } else {
        const { data: empRow } = await supabaseAdmin
          .from("employees")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (!empRow) table = "users";
      }

      // Only allow safe fields to be updated from logistique
      const allowedFields: Record<string, unknown> = {};
      const safeKeys = [
        "first_name", "last_name", "phone", "gender", "nationality", "date_naissance",
        "personal_email", "professional_email", "company_id", "station_id",
        "hire_date", "contract_type", "contract_nature", "salary", "daily_rate",
        "cnps_number", "children_count", "marital_status",
        "bus_id", "license_number", "license_expiry", "license_category",
        "employee_id", "assigned_route_id", "avatar_url",
      ];
      for (const key of safeKeys) {
        if (key in fields) allowedFields[key] = fields[key];
      }

      const { error } = await supabaseAdmin
        .from(table)
        .update({ ...allowedFields, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;

      await supabaseAdmin.from("activity_logs").insert({
        user_id: caller.id,
        target_id: id,
        target_type: "employee",
        action: "driver_updated_by_logistique",
        description: `Chauffeur mis à jour par logistique`,
        new_values: allowedFields,
      }).then();

      return new Response(
        JSON.stringify({ success: true }),
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
