import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WAVE_API = "https://api.wave.com/v1/checkout/sessions";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { bookingId, origin } = await req.json().catch(() => ({}));
    if (!bookingId || !origin) return json({ error: "Paramètres manquants." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Non autorisé." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: settings } = await admin
      .from("wave_settings")
      .select("api_key, is_active, checkout_enabled, mode")
      .eq("id", 1)
      .maybeSingle();

    if (!settings || !settings.is_active || !settings.checkout_enabled || !settings.api_key?.trim()) {
      return json({ error: "Le paiement Wave n'est pas encore disponible." }, 400);
    }

    const { data: booking } = await admin
      .from("mobile_bookings")
      .select("id, user_id, booking_ref, total, payment_status, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) return json({ error: "Réservation introuvable." }, 404);
    if (booking.user_id !== user.id) return json({ error: "Accès refusé." }, 403);

    const amount = Math.round(Number(booking.total));
    if (!amount || amount <= 0) return json({ error: "Montant invalide." }, 400);

    const base = String(origin).replace(/\/+$/, "");
    const waveResp = await fetch(WAVE_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.api_key.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: String(amount),
        currency: "XOF",
        success_url: `${base}/sbtamobile/ticket/${booking.id}?wave=success`,
        error_url: `${base}/sbtamobile/payment?wave=error`,
        client_reference: booking.booking_ref,
      }),
    });

    const session = await waveResp.json().catch(() => null);
    if (!waveResp.ok || !session?.wave_launch_url) {
      console.error("Wave checkout error", waveResp.status, session);
      return json({ error: "Impossible de créer la session de paiement Wave." }, 502);
    }

    await admin
      .from("mobile_bookings")
      .update({
        payment_method: "wave",
        payment_status: "pending",
        wave_session_id: session.id ?? null,
        wave_checkout_status: "PENDING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    return json({ launchUrl: session.wave_launch_url, sessionId: session.id });
  } catch (err) {
    console.error("wave-create-checkout exception", err);
    return json({ error: "Erreur serveur." }, 500);
  }
});
