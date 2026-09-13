import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = [
  "responsable_logistique",
  "logistique",
  "rh",
  "admin",
  "gestionnaire",
  "daf",
];

const READ_ONLY_ROLES = ["logistique"];

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return err("Non authentifié", 401);

    const { data: profile } = await admin
      .from("users")
      .select("id, role, company_id")
      .eq("id", caller.id)
      .maybeSingle();

    const callerRole: string = profile?.role ?? caller.app_metadata?.role ?? "";
    const callerCompanyId: string | null = profile?.company_id ?? null;

    if (!ALLOWED_ROLES.includes(callerRole)) {
      return err(
        `Accès refusé — ${ALLOWED_ROLES.filter(r => r !== "daf").join(", ")} uniquement`,
        403,
      );
    }

    const isReadOnly = READ_ONLY_ROLES.includes(callerRole);
    if (isReadOnly && req.method !== "GET") {
      return err("Accès refusé — profil en lecture seule", 403);
    }

    // Gestionnaire scope: must have a company
    const isGestionnaire = callerRole === "gestionnaire";
    if (isGestionnaire && !callerCompanyId) {
      return err("Aucune société associée à votre compte gestionnaire", 403);
    }

    const url = new URL(req.url);
    const singleId = url.searchParams.get("id");

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      // Detail fetch for a single driver
      if (singleId) {
        const { data: emp } = await admin
          .from("employees")
          .select("*")
          .eq("id", singleId)
          .maybeSingle();

        if (emp) {
          if (isGestionnaire && emp.company_id !== callerCompanyId) {
            return err("Accès refusé à ce chauffeur", 403);
          }
          return ok({ driver: { ...emp, source_table: "employees" } });
        }

        const { data: usr } = await admin
          .from("users")
          .select("*")
          .eq("id", singleId)
          .maybeSingle();

        if (usr) {
          if (isGestionnaire && usr.company_id !== callerCompanyId) {
            return err("Accès refusé à ce chauffeur", 403);
          }
          return ok({ driver: { ...usr, source_table: "users" } });
        }

        return err("Chauffeur introuvable", 404);
      }

      // ── List buses with their drivers ────────────────────────────────
      let busQuery = admin
        .from("buses")
        .select(`
          id, registration_number, brand, manufacturer, model,
          total_seats, company_id, status, is_active,
          companies(id, name, code)
        `)
        .eq("is_active", true)
        .order("registration_number");

      if (isGestionnaire) busQuery = busQuery.eq("company_id", callerCompanyId!);

      const { data: busRows, error: busErr } = await busQuery;
      if (busErr) throw busErr;

      // ── Fetch all chauffeurs (from employees table) ─────────────────
      let empQuery = admin
        .from("employees")
        .select(`
          id, first_name, last_name, phone, avatar_url, employee_id,
          company_id, contract_type, hire_date, account_status,
          license_number, license_expiry, license_category,
          bus_id, probation_end_date, probation_treated_at,
          assigned_route_id, contract_nature, employee_status,
          companies(id, name, code, parent_id, is_group),
          routes!employees_assigned_route_id_fkey(id, name)
        `)
        .eq("role", "chauffeur")
        .not("account_status", "eq", "deleted");

      if (isGestionnaire) empQuery = empQuery.eq("company_id", callerCompanyId!);

      const { data: empRows, error: empErr } = await empQuery;
      if (empErr) throw empErr;

      // ── Fetch chauffeurs from users table (legacy) ───────────────────
      let usrQuery = admin
        .from("users")
        .select(`
          id, first_name, last_name, phone, avatar_url, employee_id,
          company_id, contract_type, hire_date, status, employee_status,
          license_number, license_expiry, license_category,
          bus_id,
          companies(id, name, code)
        `)
        .eq("role", "chauffeur")
        .eq("is_active", true);

      if (isGestionnaire) usrQuery = usrQuery.eq("company_id", callerCompanyId!);

      const { data: usrRows, error: usrErr } = await usrQuery;
      if (usrErr) throw usrErr;

      // ── Merge drivers ────────────────────────────────────────────────
      const toDriver = (row: Record<string, unknown>, src: "employees" | "users") => ({
        id:                   row.id,
        first_name:           row.first_name ?? "",
        last_name:            row.last_name ?? "",
        full_name:            `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        source_table:         src,
        license_number:       row.license_number ?? null,
        license_expiry:       row.license_expiry ?? null,
        license_category:     row.license_category ?? null,
        company_id:           row.company_id ?? null,
        company_name:         (row.companies as any)?.name ?? null,
        company_code:         (row.companies as any)?.code ?? null,
        contract_type:        row.contract_type ?? null,
        hire_date:            row.hire_date ?? null,
        employee_id:          row.employee_id ?? null,
        status:               (row.account_status as string) ?? (row.status as string) ?? "actif",
        phone:                row.phone ?? null,
        avatar_url:           row.avatar_url ?? null,
        bus_id:               row.bus_id ?? null,
        probation_end_date:   row.probation_end_date ?? null,
        probation_treated_at: row.probation_treated_at ?? null,
        assigned_route_id:    row.assigned_route_id ?? null,
        assigned_route_name:  (row.routes as any)?.name ?? null,
        contract_nature:      row.contract_nature ?? null,
        employee_status:      row.employee_status ?? null,
        company_parent_id:    (row.companies as any)?.parent_id ?? null,
        company_is_group:     (row.companies as any)?.is_group ?? null,
      });

      // Deduplicate by employee_id first, then by normalized name+phone.
      // employees table takes priority; a users row is only kept if no
      // employees row matches it on employee_id OR (name+phone).
      const empRowsArr = (empRows ?? []) as Record<string, any>[];
      const usrRowsArr = (usrRows ?? []) as Record<string, any>[];

      const normName = (r: Record<string, any>) =>
        `${(r.first_name ?? "").trim().toLowerCase()}|${(r.last_name ?? "").trim().toLowerCase()}`;
      const normPhone = (r: Record<string, any>) => (r.phone ?? "").replace(/\D/g, "");

      const empEmpIds = new Set(
        empRowsArr.map((e) => e.employee_id).filter(Boolean),
      );
      const empNameKeys = new Set(
        empRowsArr
          .filter((e) => normPhone(e))
          .map((e) => `${normName(e)}|${normPhone(e)}`),
      );

      const seenKeys = new Set<string>();
      const allDrivers: ReturnType<typeof toDriver>[] = [];

      for (const e of empRowsArr) {
        const d = toDriver(e, "employees");
        const key = d.id;
        if (!seenKeys.has(key)) { seenKeys.add(key); allDrivers.push(d); }
      }

      for (const u of usrRowsArr) {
        const eid = u.employee_id as string | undefined;
        if (eid && empEmpIds.has(eid)) continue;

        const nameKey = `${normName(u)}|${normPhone(u)}`;
        if (normPhone(u) && empNameKeys.has(nameKey)) continue;

        const d = toDriver(u, "users");
        if (!seenKeys.has(d.id)) { seenKeys.add(d.id); allDrivers.push(d); }
      }

      // ── Group buses with their drivers ───────────────────────────────
      const buses = (busRows ?? []).map((b: any) => ({
        id:                  b.id,
        registration_number: b.registration_number,
        brand:               b.brand ?? null,
        manufacturer:        b.manufacturer ?? null,
        model:               b.model ?? null,
        total_seats:         b.total_seats ?? null,
        company_id:          b.company_id ?? null,
        company_name:        b.companies?.name ?? null,
        status:              b.status ?? null,
        is_active:           b.is_active ?? null,
        drivers:             allDrivers.filter(d => d.bus_id === b.id),
      }));

      const assignedIds = new Set(buses.flatMap((b: any) => b.drivers.map((d: any) => d.id)));
      const unassignedDrivers = allDrivers.filter(d => !assignedIds.has(d.id));

      return ok({ buses, unassignedDrivers });
    }

    // ── POST — create driver (employee record) ────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      // Force company_id for gestionnaire — never trust the client value
      const company_id = isGestionnaire ? callerCompanyId : (body.company_id ?? null);

      // Pre-creation duplicate check: reject if a chauffeur with the same
      // employee_id already exists, or if one with same name+phone exists.
      const normFn = (body.first_name ?? "").trim().toLowerCase();
      const normLn = (body.last_name ?? "").trim().toLowerCase();
      const normPh = (body.phone ?? "").replace(/\D/g, "");

      const dupChecks: Promise<any>[] = [];
      if (body.employee_id) {
        dupChecks.push(
          admin.from("employees").select("id").eq("role", "chauffeur").eq("employee_id", body.employee_id).maybeSingle(),
        );
      }
      if (normPh) {
        dupChecks.push(
          admin.from("employees").select("id").eq("role", "chauffeur").ilike("first_name", body.first_name).ilike("last_name", body.last_name).eq("phone", body.phone).maybeSingle(),
        );
      }

      if (dupChecks.length > 0) {
        const results = await Promise.all(dupChecks);
        if (results.some((r) => r.data)) {
          return err("Un chauffeur avec ces informations existe déjà", 409);
        }
      }

      const { data: newEmp, error: insErr } = await admin
        .from("employees")
        .insert({
          first_name:      body.first_name,
          last_name:       body.last_name,
          phone:           body.phone ?? null,
          gender:          body.gender ?? null,
          nationality:     body.nationality ?? null,
          date_naissance:  body.date_naissance ?? null,
          personal_email:  body.personal_email ?? null,
          professional_email: body.professional_email ?? null,
          company_id,
          station_id:      body.station_id ?? null,
          contract_type:   body.contract_type,
          contract_nature: body.contract_nature ?? null,
          employee_status: body.employee_status ?? null,
          hire_date:       body.hire_date,
          salary:          body.salary ?? null,
          daily_rate:      body.daily_rate ?? null,
          cnps_number:     body.cnps_number ?? null,
          children_count:  body.children_count ?? 0,
          marital_status:  body.marital_status ?? null,
          bus_id:          body.bus_id ?? null,
          license_number:  body.license_number ?? null,
          license_expiry:  body.license_expiry ?? null,
          license_category: body.license_category ?? null,
          employee_id:     body.employee_id ?? null,
          assigned_route_id: body.assigned_route_id ?? null,
          role:            "chauffeur",
          account_status:  "pending",
        })
        .select("id")
        .single();

      if (insErr) throw insErr;
      return ok({ employee: newEmp });
    }

    // ── PUT — update driver ───────────────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();
      const { id, source_table, ...fields } = body;
      if (!id) return err("id est requis");

      const table = source_table === "users" ? "users" : "employees";

      // Security: verify record belongs to gestionnaire's company
      if (isGestionnaire) {
        const { data: existing } = await admin
          .from(table)
          .select("company_id")
          .eq("id", id)
          .maybeSingle();
        if (!existing || existing.company_id !== callerCompanyId) {
          return err("Accès refusé à ce chauffeur", 403);
        }
        // Force company_id to never be changed
        delete fields.company_id;
      }

      // Strip fields that shouldn't be updated directly
      const { company_id: _cid, role: _role, ...updateFields } = fields;

      const { error: updErr } = await admin.from(table).update(updateFields).eq("id", id);
      if (updErr) throw updErr;
      return ok({ success: true });
    }

    // ── PATCH — treat probation ───────────────────────────────────────
    if (req.method === "PATCH") {
      const body = await req.json();
      const { id, source_table } = body;
      if (!id) return err("id est requis");

      const table = source_table === "users" ? "users" : "employees";

      if (isGestionnaire) {
        const { data: existing } = await admin
          .from(table)
          .select("company_id")
          .eq("id", id)
          .maybeSingle();
        if (!existing || existing.company_id !== callerCompanyId) {
          return err("Accès refusé à ce chauffeur", 403);
        }
      }

      const { error: patchErr } = await admin
        .from(table)
        .update({ probation_treated_at: new Date().toISOString() })
        .eq("id", id);
      if (patchErr) throw patchErr;
      return ok({ success: true });
    }

    // ── DELETE — unassign bus ─────────────────────────────────────────
    if (req.method === "DELETE") {
      const body = await req.json();
      const { id, source_table } = body;
      if (!id) return err("id est requis");

      const table = source_table === "users" ? "users" : "employees";

      if (isGestionnaire) {
        const { data: existing } = await admin
          .from(table)
          .select("company_id")
          .eq("id", id)
          .maybeSingle();
        if (!existing || existing.company_id !== callerCompanyId) {
          return err("Accès refusé à ce chauffeur", 403);
        }
      }

      const { error: delErr } = await admin.from(table).update({ bus_id: null }).eq("id", id);
      if (delErr) throw delErr;
      return ok({ success: true });
    }

    return err("Méthode non supportée", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : (e as any)?.message ?? JSON.stringify(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
