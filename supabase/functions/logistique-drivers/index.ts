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

    if (!["responsable_logistique", "admin", "rh", "gestionnaire"].includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: "Accès refusé — Responsable Logistique, RH, Admin ou Gestionnaire uniquement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pour le gestionnaire : restreindre aux bus/chauffeurs de SA société (groupe + filiales).
    // callerCompanyIds = null signifie « aucune restriction » (admin / rh / responsable_logistique).
    let callerCompanyIds: string[] | null = null;
    let callerOwnCompanyId: string | null = null;
    if (callerRole === "gestionnaire") {
      const { data: callerProfile } = await supabaseAdmin
        .from("users")
        .select("company_id")
        .eq("id", caller.id)
        .maybeSingle();
      callerOwnCompanyId = callerProfile?.company_id ?? null;
      if (!callerOwnCompanyId) {
        return new Response(
          JSON.stringify({ error: "Aucune société rattachée à votre compte gestionnaire" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: allCompanies } = await supabaseAdmin
        .from("companies")
        .select("id, name, parent_id, is_group");
      const companiesList = allCompanies ?? [];
      const selected = companiesList.find((c: any) => c.id === callerOwnCompanyId);
      if (selected?.is_group) {
        callerCompanyIds = [callerOwnCompanyId, ...companiesList
          .filter((c: any) => c.parent_id === callerOwnCompanyId)
          .map((c: any) => c.id)];
      } else {
        callerCompanyIds = [callerOwnCompanyId];
      }
    }

    // ── GET: fetch a single chauffeur's full detail (?id=…) or all buses with drivers ──
    if (req.method === "GET") {
      const url = new URL(req.url);
      const detailId = url.searchParams.get("id");

      if (detailId) {
        // Service-role fetch bypasses employees SELECT RLS (admin/rh/daf only),
        // which otherwise returns empty for gestionnaire/responsable_logistique
        // and leaves the edit form blank.
        let source: "employees" | "users" = "employees";
        let data: any = null;

        const { data: emp } = await supabaseAdmin
          .from("employees")
          .select("*")
          .eq("id", detailId)
          .maybeSingle();
        if (emp) {
          data = emp;
          source = "employees";
        } else {
          const { data: usr } = await supabaseAdmin
            .from("users")
            .select("*")
            .eq("id", detailId)
            .maybeSingle();
          if (usr) { data = usr; source = "users"; }
        }

        if (!data) {
          return new Response(
            JSON.stringify({ error: "Chauffeur introuvable" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Respect company scope for gestionnaire.
        if (callerCompanyIds && (!data.company_id || !callerCompanyIds.includes(data.company_id))) {
          return new Response(
            JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const normalized = {
          ...data,
          source_table: source,
          professional_email: data.professional_email ?? data.email ?? null,
          status: source === "employees" ? (data.account_status ?? "pending") : (data.status ?? "active"),
        };

        return new Response(
          JSON.stringify({ driver: normalized }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let busesQuery = supabaseAdmin
        .from("buses")
        .select("id, registration_number, brand, manufacturer, model, total_seats, company_id, status, is_active")
        .order("registration_number", { ascending: true });
      if (callerCompanyIds) busesQuery = busesQuery.in("company_id", callerCompanyIds);
      const { data: buses, error: busErr } = await busesQuery;

      if (busErr) throw busErr;

      let companiesQuery = supabaseAdmin
        .from("companies")
        .select("id, name, code")
        .order("name");
      if (callerCompanyIds) companiesQuery = companiesQuery.in("id", callerCompanyIds);
      const { data: companies } = await companiesQuery;

      // Fetch all chauffeurs (from both employees and users tables)
      const empQueryBase = supabaseAdmin.from("employees")
        .select("id, first_name, last_name, role, bus_id, license_number, license_expiry, license_category, company_id, station_id, contract_type, hire_date, employee_id, account_status, phone, avatar_url, probation_end_date, probation_treated_at")
        .eq("role", "chauffeur");
      const usrQueryBase = supabaseAdmin.from("users")
        .select("id, first_name, last_name, role, bus_id, license_number, license_expiry, license_category, company_id, station_id, contract_type, hire_date, employee_id, status, phone, avatar_url")
        .eq("role", "chauffeur");

      const [empRes, usrRes] = await Promise.all([
        callerCompanyIds ? empQueryBase.in("company_id", callerCompanyIds) : empQueryBase,
        callerCompanyIds ? usrQueryBase.in("company_id", callerCompanyIds) : usrQueryBase,
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
            probation_end_date: d.probation_end_date ?? null,
            probation_treated_at: d.probation_treated_at ?? null,
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
          probation_end_date: d.probation_end_date ?? null,
          probation_treated_at: d.probation_treated_at ?? null,
        }));

      // Filtrer les chauffeurs non affectés par le périmètre société (déjà fait côté requête,
      // mais on garde une garantie pour les drivers dont company_id serait null mais rattachés
      // à un bus hors périmètre — déjà exclus via la requête buses).
      const scopedUnassigned = callerCompanyIds
        ? unassignedDrivers.filter((d: any) => d.company_id && callerCompanyIds.includes(d.company_id))
        : unassignedDrivers;

      const result = (buses ?? []).map((b: any) => ({
        ...b,
        brand: b.brand ?? b.manufacturer,
        company_name: b.company_id ? companyName.get(b.company_id) ?? null : null,
        drivers: busDriversMap.get(b.id) ?? [],
      }));

      return new Response(
        JSON.stringify({ buses: result, unassignedDrivers: scopedUnassigned, scopedToCompany: !!callerCompanyIds }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── POST: create a new chauffeur (syncs to RH employees table) ──
    if (req.method === "POST") {
      const body = await req.json();
      const {
        first_name, last_name, phone, gender, nationality, date_naissance,
        personal_email, professional_email,
        company_id: bodyCompanyId, station_id, hire_date, contract_type, contract_nature,
        salary, daily_rate, cnps_number, children_count, marital_status,
        bus_id, license_number, license_expiry, license_category,
        employee_id, assigned_route_id, avatar_url,
      } = body;

      // Le gestionnaire ne peut créer des chauffeurs que pour SA propre société.
      const company_id = callerOwnCompanyId ?? bodyCompanyId;

      if (!first_name?.trim()) throw new Error("Le prénom est obligatoire");
      if (!last_name?.trim()) throw new Error("Le nom est obligatoire");
      if (!hire_date) throw new Error("La date d'entrée est obligatoire");
      if (!contract_type) throw new Error("Le type de contrat est obligatoire");
      if (!company_id) throw new Error("La société est obligatoire");

      // Vérifier que le bus affecté appartient au périmètre du gestionnaire
      if (bus_id && callerCompanyIds) {
        const { data: busRow } = await supabaseAdmin
          .from("buses").select("company_id").eq("id", bus_id).maybeSingle();
        if (!busRow || !callerCompanyIds.includes(busRow.company_id)) {
          return new Response(
            JSON.stringify({ error: "Ce bus n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

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

      // Période d'essai : 3 mois à compter de la date d'embauche
      const probationEndDate = hire_date
        ? new Date(new Date(hire_date).setMonth(new Date(hire_date).getMonth() + 3))
            .toISOString().slice(0, 10)
        : null;

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
          probation_end_date: probationEndDate,
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
          .select("id, company_id")
          .eq("id", id)
          .maybeSingle();
        if (!empRow) {
          table = "users";
        } else if (callerCompanyIds && (!empRow.company_id || !callerCompanyIds.includes(empRow.company_id))) {
          return new Response(
            JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      if (table === "users" && callerCompanyIds) {
        const { data: usrRow } = await supabaseAdmin
          .from("users").select("company_id").eq("id", id).maybeSingle();
        if (!usrRow || !usrRow.company_id || !callerCompanyIds.includes(usrRow.company_id)) {
          return new Response(
            JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
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

      // Le gestionnaire ne peut pas changer la société d'un chauffeur.
      if (callerCompanyIds && "company_id" in allowedFields) {
        const newCid = allowedFields.company_id as string | null;
        if (newCid && !callerCompanyIds.includes(newCid)) {
          return new Response(
            JSON.stringify({ error: "Vous ne pouvez pas réaffecter ce chauffeur à une autre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Le bus affecté doit appartenir au périmètre du gestionnaire.
      if (callerCompanyIds && "bus_id" in allowedFields && allowedFields.bus_id) {
        const { data: busRow } = await supabaseAdmin
          .from("buses").select("company_id").eq("id", allowedFields.bus_id).maybeSingle();
        if (!busRow || !callerCompanyIds.includes(busRow.company_id)) {
          return new Response(
            JSON.stringify({ error: "Ce bus n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Si la date d'embauche change, recalculer la fin de période d'essai
      if ("hire_date" in allowedFields && allowedFields.hire_date) {
        const hd = new Date(allowedFields.hire_date as string);
        allowedFields.probation_end_date = new Date(hd.setMonth(hd.getMonth() + 3))
          .toISOString().slice(0, 10);
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

    // ── PATCH: marquer la période d'essai comme traitée ──
    if (req.method === "PATCH") {
      const body = await req.json();
      const { id, source_table } = body;
      if (!id) {
        return new Response(
          JSON.stringify({ error: "ID chauffeur manquant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let table = "employees";
      if (source_table === "users") {
        table = "users";
      } else {
        const { data: empRow } = await supabaseAdmin
          .from("employees")
          .select("id, company_id")
          .eq("id", id)
          .maybeSingle();
        if (!empRow) {
          table = "users";
        } else if (callerCompanyIds && (!empRow.company_id || !callerCompanyIds.includes(empRow.company_id))) {
          return new Response(
            JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      if (table === "users" && callerCompanyIds) {
        const { data: usrRow } = await supabaseAdmin
          .from("users").select("company_id").eq("id", id).maybeSingle();
        if (!usrRow || !usrRow.company_id || !callerCompanyIds.includes(usrRow.company_id)) {
          return new Response(
            JSON.stringify({ error: "Ce chauffeur n'appartient pas à votre société" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from(table)
        .update({
          probation_treated_at: now,
          probation_treated_by: caller.id,
          updated_at: now,
        })
        .eq("id", id);

      if (error) throw error;

      await supabaseAdmin.from("activity_logs").insert({
        user_id: caller.id,
        target_id: id,
        target_type: "employee",
        action: "probation_treated_by_logistique",
        description: `Période d'essai traitée par le Responsable Logistique`,
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
