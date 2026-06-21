import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Wave-Signature",
};

const PAID_EVENTS = [
  "checkout.session.completed",
  "merchant.payment_received",
  "b2b.payment_received",
];
const FAILED_EVENTS = [
  "checkout.session.payment_failed",
  "b2b.payment_failed",
];

function parseSignature(header: string): { t: string; sigs: string[] } {
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k === "t") t = v;
    if (k === "v1") sigs.push(v);
  }
  return { t, sigs };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const rawBody = await req.text();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: settings } = await admin
      .from("wave_settings")
      .select("signing_secret")
      .eq("id", 1)
      .maybeSingle();

    const secret = settings?.signing_secret?.trim();
    if (!secret) {
      console.error("wave-webhook: signing secret not configured");
      return new Response(JSON.stringify({ error: "not configured" }), { status: 400, headers: corsHeaders });
    }

    const sigHeader = req.headers.get("Wave-Signature") ?? "";
    const { t, sigs } = parseSignature(sigHeader);
    if (!t || sigs.length === 0) {
      return new Response(JSON.stringify({ error: "missing signature" }), { status: 401, headers: corsHeaders });
    }
    const expected = await hmacHex(secret, `${t}.${rawBody}`);
    if (!sigs.includes(expected)) {
      return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: corsHeaders });
    }

    const event = JSON.parse(rawBody);
    const type: string = event.type ?? "";
    const data = event.data ?? {};
    const sessionId: string | null = data.id ?? data.checkout_session_id ?? null;
    const clientRef: string | null = data.client_reference ?? null;
    const transactionId: string | null = data.transaction_id ?? data.id ?? null;

    if (!PAID_EVENTS.includes(type) && !FAILED_EVENTS.includes(type)) {
      return new Response(JSON.stringify({ received: true, ignored: type }), { status: 200, headers: corsHeaders });
    }

    let query = admin.from("mobile_bookings").select("id, status, payment_status").limit(1);
    if (sessionId) query = query.eq("wave_session_id", sessionId);
    else if (clientRef) query = query.eq("booking_ref", clientRef);
    else return new Response(JSON.stringify({ error: "no reference" }), { status: 200, headers: corsHeaders });

    const { data: rows } = await query;
    const booking = rows?.[0];
    if (!booking) {
      console.error("wave-webhook: booking not found", { sessionId, clientRef });
      return new Response(JSON.stringify({ received: true, notFound: true }), { status: 200, headers: corsHeaders });
    }

    if (PAID_EVENTS.includes(type)) {
      await admin
        .from("mobile_bookings")
        .update({
          payment_status: "paid",
          wave_checkout_status: "PAID",
          wave_transaction_ref: transactionId,
          payment_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      await admin.rpc("sbta_confirm_pending_mobile_booking", { p_booking_id: booking.id });
    } else {
      await admin
        .from("mobile_bookings")
        .update({
          payment_status: "failed",
          wave_checkout_status: "FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("wave-webhook exception", err);
    return new Response(JSON.stringify({ error: "server error" }), { status: 500, headers: corsHeaders });
  }
});
