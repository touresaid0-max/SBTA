import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "Non authentifie",
          server_time: new Date().toISOString(),
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user from the JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "Session invalide",
          server_time: new Date().toISOString(),
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const {
      schedule_id,
      counter_id,
      station_id,
      client_timestamp,
      reservations,
    } = body;

    if (!schedule_id) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "schedule_id requis",
          server_time: new Date().toISOString(),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serverNow = new Date();
    const clientTs = client_timestamp ? new Date(client_timestamp) : null;
    const ipAddress = req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") || "unknown";

    // Get schedule departure time
    const { data: schedule, error: schedError } = await supabase
      .from("schedules")
      .select("id, departure_datetime, status, seats_available, is_anticipated, bus_id")
      .eq("id", schedule_id)
      .maybeSingle();

    if (schedError || !schedule) {
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "blocked",
        reason: "Planning introuvable",
      });

      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "Planning introuvable",
          server_time: serverNow.toISOString(),
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const departure = new Date(schedule.departure_datetime);
    const timeDriftSeconds = clientTs
      ? Math.round((clientTs.getTime() - serverNow.getTime()) / 1000)
      : null;

    // Check 1: Departure must be in the future (skip for anticipated departures)
    if (departure <= serverNow && !schedule.is_anticipated) {
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "blocked",
        reason: "Vente impossible : la date de vente doit correspondre a la date systeme serveur. L'heure de depart est passee.",
        metadata: { departure_datetime: schedule.departure_datetime, time_drift_seconds: timeDriftSeconds },
      });

      return new Response(
        JSON.stringify({
          allowed: false,
          reason:
            "Vente impossible : la date de vente doit correspondre a la date systeme serveur.",
          server_time: serverNow.toISOString(),
          departure_time: schedule.departure_datetime,
          time_drift_seconds: timeDriftSeconds,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check 2: Detect significant time drift (> 5 minutes)
    const DRIFT_THRESHOLD_SECONDS = 300;
    let driftWarning = false;
    if (timeDriftSeconds !== null && Math.abs(timeDriftSeconds) > DRIFT_THRESHOLD_SECONDS) {
      driftWarning = true;
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "allowed",
        reason: `Decalage horloge detecte : ${timeDriftSeconds}s`,
        metadata: { departure_datetime: schedule.departure_datetime, time_drift_seconds: timeDriftSeconds, drift_warning: true },
      });
    }

    // Check 3: Schedule must be in a valid selling status
    const sellableStatuses = ["planifie", "en_cours"];
    if (!sellableStatuses.includes(schedule.status)) {
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "blocked",
        reason: `Statut du voyage non vendable : ${schedule.status}`,
        metadata: { schedule_status: schedule.status },
      });

      return new Response(
        JSON.stringify({
          allowed: false,
          reason: `Vente impossible : le voyage est en statut "${schedule.status}"`,
          server_time: serverNow.toISOString(),
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check 4: Available seats
    if (schedule.seats_available <= 0) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "Ce voyage est complet",
          server_time: serverNow.toISOString(),
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If we are also asked to create the reservations, do it server-side
    let createdReservations = null;
    if (reservations && Array.isArray(reservations) && reservations.length > 0) {
      const toInsert = reservations.map((r: any) => ({
        ...r,
        schedule_id,
        status: "confirmee",
        created_at: serverNow.toISOString(),
      }));

      const { data: inserted, error: insertError } = await supabase
        .from("reservations")
        .insert(toInsert)
        .select("id, booking_reference, seat_numbers");

      if (insertError) {
        const isDuplicate = insertError.code === "23505" ||
          insertError.message?.toLowerCase().includes("unique");

        await logAttempt(supabase, {
          user_id: user.id,
          counter_id,
          station_id,
          client_timestamp: clientTs?.toISOString(),
          schedule_id,
          ip_address: ipAddress,
          status: "blocked",
          reason: isDuplicate
            ? "Siege deja vendu par un autre guichet"
            : insertError.message,
          metadata: { error_code: insertError.code },
        });

        return new Response(
          JSON.stringify({
            allowed: false,
            reason: isDuplicate
              ? "Ce siege vient d'etre vendu par un autre guichet. Veuillez choisir un autre siege."
              : insertError.message,
            server_time: serverNow.toISOString(),
            duplicate: isDuplicate,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      createdReservations = inserted;

      // Log successful sale
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "allowed",
        reason: null,
        metadata: {
          reservations_created: inserted?.length,
          time_drift_seconds: timeDriftSeconds,
        },
      });
    } else {
      // Just a validation call - log it
      await logAttempt(supabase, {
        user_id: user.id,
        counter_id,
        station_id,
        client_timestamp: clientTs?.toISOString(),
        schedule_id,
        ip_address: ipAddress,
        status: "allowed",
        reason: null,
        metadata: { validation_only: true, time_drift_seconds: timeDriftSeconds },
      });
    }

    return new Response(
      JSON.stringify({
        allowed: true,
        server_time: serverNow.toISOString(),
        departure_time: schedule.departure_datetime,
        time_drift_seconds: timeDriftSeconds,
        drift_warning: driftWarning,
        reservations: createdReservations,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return new Response(
      JSON.stringify({
        allowed: false,
        reason: message,
        server_time: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function logAttempt(
  supabase: any,
  params: {
    user_id: string;
    counter_id?: string;
    station_id?: string;
    client_timestamp?: string | null;
    schedule_id?: string;
    ip_address?: string;
    status: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("ticket_sale_audit_log").insert({
      user_id: params.user_id,
      counter_id: params.counter_id || null,
      station_id: params.station_id || null,
      server_timestamp: new Date().toISOString(),
      client_timestamp: params.client_timestamp || null,
      time_drift_seconds: params.client_timestamp
        ? Math.round(
            (new Date(params.client_timestamp).getTime() - Date.now()) / 1000,
          )
        : null,
      action: "ticket_sale_validation",
      schedule_id: params.schedule_id || null,
      ip_address: params.ip_address || null,
      status: params.status,
      reason: params.reason || null,
      metadata: params.metadata || null,
    });
  } catch (e) {
    console.error("Failed to log audit entry:", e);
  }
}
