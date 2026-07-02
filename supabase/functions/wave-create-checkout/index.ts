import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WAVE_API = "https://api.wave.com/v1/checkout/sessions";

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
      .select("api_key, api_secret, is_active, checkout_enabled, mode")
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

    // Wave n'accepte que des URL https valides pour success_url / error_url.
    // Le retour dans l'app WebView est géré côté app (intent:// au lancement),
    // pas via ces URL — y mettre un intent:// provoque « Request invalid » (400).
    const base = String(origin).replace(/\/+$/, "");
    const successHttps = `${base}/sbtamobile/ticket/${booking.id}?wave=success`;
    const errorHttps = `${base}/sbtamobile/payment?wave=error`;

    const payload = {
      amount: String(amount),
      currency: "XOF",
      success_url: successHttps,
      error_url: errorHttps,
      client_reference: booking.booking_ref,
    };
    const bodyStr = JSON.stringify(payload);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${settings.api_key.trim()}`,
      "Content-Type": "application/json",
    };

    const apiSecret = settings.api_secret?.trim();
    if (apiSecret) {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = await hmacHex(apiSecret, ts + bodyStr);
      headers["Wave-Signature"] = `t=${ts},v1=${sig}`;
    }

    const waveResp = await fetch(WAVE_API, {
      method: "POST",
      headers,
      body: bodyStr,
    });

    const rawText = await waveResp.text();
    let session: Record<string, any> | null = null;
    try { session = rawText ? JSON.parse(rawText) : null; } catch { session = null; }

    if (!waveResp.ok || !session?.wave_launch_url) {
      console.error("Wave checkout error", waveResp.status, rawText);
      const errObj = session?.error ?? session;
      const detail =
        (errObj && (errObj.message || errObj.error_message || errObj.code || errObj.error_code)) ||
        rawText ||
        `HTTP ${waveResp.status}`;
      return json(
        { error: `Wave (${waveResp.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}` },
        502,
      );
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
