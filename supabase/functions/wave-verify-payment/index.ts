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
      .select("api_key, api_secret, is_active")
      .eq("id", 1)
      .maybeSingle();

    const apiKey = settings?.api_key?.trim();
    if (!settings?.is_active || !apiKey) {
      // Wave indisponible : on laisse le statut en attente (le webhook pourra confirmer).
      return json({ status: "pending" });
    }

    // L'API Wave exige une signature de requête (Wave-Signature) même en lecture.
    // Pour un GET (corps vide), la charge signée est simplement le timestamp.
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    const apiSecret = settings.api_secret?.trim();
    if (apiSecret) {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = await hmacHex(apiSecret, ts);
      headers["Wave-Signature"] = `t=${ts},v1=${sig}`;
    }

    const waveResp = await fetch(
      `https://api.wave.com/v1/checkout/sessions/${encodeURIComponent(booking.wave_session_id)}`,
      { headers },
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

    // Une tentative de paiement a échoué (solde insuffisant, refus, etc.) :
    // Wave renseigne alors last_payment_error. On considère cela comme un échec.
    const hasPaymentError =
      !!session.last_payment_error &&
      Object.keys(session.last_payment_error).length > 0;

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

    // Échec avéré : annulé par le client, session expirée, ou tentative refusée
    // (solde insuffisant, paiement refusé, etc.). Dans tous ces cas, le paiement
    // n'a PAS abouti : on ne conserve aucun billet provisoire. La réservation en
    // attente n'est qu'un jeton créé avant paiement — on la supprime pour qu'aucun
    // ticket n'existe. Les billets provisoires ne concernent que les paiements
    // réussis en attente de planification côté chef de gare.
    if (paymentStatus === "cancelled" || checkoutStatus === "expired" || hasPaymentError) {
      // Suppression sécurisée : uniquement une réservation encore provisoire et
      // impayée (jamais un billet payé ou confirmé).
      await admin
        .from("mobile_bookings")
        .delete()
        .eq("id", booking.id)
        .eq("status", "provisional")
        .eq("payment_status", "pending");

      return json({ status: "failed", reason: reasonFrom(session) });
    }

    // Toujours en cours (processing / open) : le client peut re-solliciter.
    return json({ status: "pending" });
  } catch (err) {
    console.error("wave-verify-payment exception", err);
    return json({ error: "Erreur serveur." }, 500);
  }
});
