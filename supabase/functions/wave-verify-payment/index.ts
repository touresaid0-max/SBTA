import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Traduit un statut / code d'erreur Wave en message clair pour l'utilisateur.
function reasonFrom(session: Record<string, any>): string {
  const err = session?.last_payment_error ?? {};
  const code = String(err.code ?? err.error_code ?? "").toLowerCase();
  const paymentStatus = String(session?.payment_status ?? "").toLowerCase();
  const checkoutStatus = String(session?.checkout_status ?? "").toLowerCase();

  const byCode: Record<string, string> = {
    "insufficient-funds": "Solde insuffisant sur le compte Wave.",
    "insufficient_funds": "Solde insuffisant sur le compte Wave.",
    "payment-declined": "Le paiement a été refusé.",
    "payment-cancelled": "Paiement annulé par le client.",
    "payer-not-found": "Compte Wave introuvable.",
    "risk-check-failed": "Paiement bloqué pour raison de sécurité.",
    "transaction-expired": "La transaction a expiré.",
  };
  if (code && byCode[code]) return byCode[code];
  if (err.message && typeof err.message === "string") return err.message;

  if (checkoutStatus === "expired") return "La session de paiement a expiré. Veuillez relancer le paiement.";
  if (paymentStatus === "cancelled") return "Paiement annulé par le client.";
  return "Le paiement Wave n'a pas abouti. Veuillez réessayer.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { bookingId } = await req.json().catch(() => ({}));
    if (!bookingId) return json({ error: "Paramètre manquant." }, 400);

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

    const { data: booking } = await admin
      .from("mobile_bookings")
      .select("id, user_id, payment_status, wave_session_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) return json({ error: "Réservation introuvable." }, 404);
    if (booking.user_id !== user.id) return json({ error: "Accès refusé." }, 403);

    // Déjà réglé (par ce chemin ou par le webhook Wave) : rien à revérifier.
    if (booking.payment_status === "paid") return json({ status: "paid" });

    if (!booking.wave_session_id) {
      return json({ status: "failed", reason: "Session de paiement Wave introuvable." });
    }

    const { data: settings } = await admin
      .from("wave_settings")
      .select("api_key, is_active")
      .eq("id", 1)
      .maybeSingle();

    const apiKey = settings?.api_key?.trim();
    if (!settings?.is_active || !apiKey) {
      // Wave indisponible : on laisse le statut en attente (le webhook pourra confirmer).
      return json({ status: "pending" });
    }

    const waveResp = await fetch(
      `https://api.wave.com/v1/checkout/sessions/${encodeURIComponent(booking.wave_session_id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    const rawText = await waveResp.text();
    let session: Record<string, any> | null = null;
    try { session = rawText ? JSON.parse(rawText) : null; } catch { session = null; }

    if (!waveResp.ok || !session) {
      console.error("wave-verify-payment: session fetch failed", waveResp.status, rawText);
      // Erreur transitoire : on reste en attente pour laisser le webhook confirmer.
      return json({ status: "pending" });
    }

    const paymentStatus = String(session.payment_status ?? "").toLowerCase();
    const checkoutStatus = String(session.checkout_status ?? "").toLowerCase();

    // Succès : Wave confirme le paiement.
    if (paymentStatus === "succeeded") {
      await admin
        .from("mobile_bookings")
        .update({
          payment_status: "paid",
          wave_checkout_status: "PAID",
          wave_transaction_ref: session.transaction_id ?? null,
          payment_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      await admin.rpc("sbta_confirm_pending_mobile_booking", { p_booking_id: booking.id });
      return json({ status: "paid" });
    }

    // Échec avéré : annulé par le client ou session expirée.
    if (paymentStatus === "cancelled" || checkoutStatus === "expired") {
      await admin
        .from("mobile_bookings")
        .update({
          payment_status: "failed",
          wave_checkout_status: "FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      return json({ status: "failed", reason: reasonFrom(session) });
    }

    // Toujours en cours (processing / open) : le client peut re-solliciter.
    return json({ status: "pending" });
  } catch (err) {
    console.error("wave-verify-payment exception", err);
    return json({ error: "Erreur serveur." }, 500);
  }
});
