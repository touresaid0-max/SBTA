import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmsPayload {
  parcel_id: string;
  recipient_phone: string;
  message: string;
  sms_type: "CREATED" | "ARRIVED";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await anonClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { parcel_id, recipient_phone, message, sms_type } =
      (await req.json()) as SmsPayload;

    if (!parcel_id || !recipient_phone || !message || !sms_type) {
      return new Response(
        JSON.stringify({
          error:
            "parcel_id, recipient_phone, message, and sms_type are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Anti-duplicate: check if a SENT log already exists for this parcel + type
    const { data: existing } = await supabase
      .from("sms_logs")
      .select("id")
      .eq("parcel_id", parcel_id)
      .eq("sms_type", sms_type)
      .eq("status", "SENT")
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          message: "SMS already sent",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Look up the parcel's origin station to get per-station SMS config ──
    const { data: parcel } = await supabase
      .from("parcels")
      .select("origin_station_id")
      .eq("id", parcel_id)
      .maybeSingle();

    let stationId: string | null = null;
    let stationApiKey: string | null = null;

    if (parcel?.origin_station_id) {
      stationId = parcel.origin_station_id;
      const { data: station } = await supabase
        .from("stations")
        .select("sms_api_key, sms_credit")
        .eq("id", stationId)
        .maybeSingle();

      if (station?.sms_api_key) {
        stationApiKey = station.sms_api_key;
      }
    }

    // Insert a PENDING log entry with station_id
    const { data: logEntry, error: logErr } = await supabase
      .from("sms_logs")
      .insert({
        parcel_id,
        recipient_phone,
        message,
        sms_type,
        provider: "EMISMS",
        status: "PENDING",
        created_by: user.id,
        station_id: stationId,
      })
      .select("id")
      .single();

    if (logErr) {
      console.error("[send-parcel-sms] Log insert error:", logErr);
      return new Response(
        JSON.stringify({
          error: "Failed to create SMS log",
          detail: logErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const logId = logEntry.id;

    // ── EMISMS API ──
    // Use station-specific API key if available, otherwise fall back to global env var
    const apiUrl =
      Deno.env.get("API_URL_EMISMS") ?? "https://app.emisms.com/sms/api";
    const apiKey = stationApiKey ?? Deno.env.get("API_KEY_EMISMS");
    const senderId = Deno.env.get("SENDER_ID") ?? "SBTA";

    let apiResponse: Record<string, unknown> = {};
    let sent = false;

    if (apiKey) {
      try {
        const url = new URL(apiUrl);
        url.searchParams.set("action", "send-sms");
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("to", recipient_phone);
        url.searchParams.set("from", senderId);
        url.searchParams.set("sms", message);

        console.log(
          `[send-parcel-sms] Calling EMISMS: to=${recipient_phone}, from=${senderId}, station=${stationId ?? "global"}`
        );

        const resp = await fetch(url.toString(), { method: "GET" });
        const responseText = await resp.text();
        console.log(`[send-parcel-sms] EMISMS raw response: ${responseText}`);

        try {
          apiResponse = JSON.parse(responseText);
        } catch {
          apiResponse = { raw: responseText, http_status: resp.status };
        }

        // Determine success from response body
        const respCode = String(
          apiResponse.code ??
            apiResponse.status_code ??
            apiResponse.status ??
            ""
        );
        const respMsg = String(apiResponse.message ?? "").toLowerCase();

        // Known success indicators
        const isSuccess =
          respCode === "ok" ||
          respCode === "0" ||
          respCode === "100" ||
          respCode === "1000" ||
          respCode === "1" ||
          respMsg.includes("success") ||
          respMsg.includes("sent") ||
          respMsg.includes("queued");

        // Known error indicators
        const isError =
          respMsg.includes("invalid") ||
          respMsg.includes("error") ||
          respMsg.includes("fail") ||
          respMsg.includes("insufficient") ||
          respMsg.includes("denied");

        if (resp.ok && (isSuccess || !isError)) {
          sent = true;
        } else {
          sent = false;
        }
      } catch (fetchErr) {
        console.error("[send-parcel-sms] EMISMS API call failed:", fetchErr);
        apiResponse = { error: String(fetchErr) };
        sent = false;
      }
    } else {
      console.log(
        `[send-parcel-sms] No API key configured (station=${stationId ?? "none"}, global not set). SMS not sent to ${recipient_phone}`
      );
      apiResponse = { info: "No API key configured" };
      sent = false;
    }

    // Update log with result
    const finalStatus = sent ? "SENT" : "FAILED";
    await supabase
      .from("sms_logs")
      .update({
        status: finalStatus,
        response_api: apiResponse,
        sent_at: sent ? new Date().toISOString() : null,
      })
      .eq("id", logId);

    // ── Decrement station SMS credit on successful send ──
    if (sent && stationId) {
      await supabase.rpc("decrement_station_sms_credit", {
        p_station_id: stationId,
      });
    }

    return new Response(
      JSON.stringify({
        success: sent,
        status: finalStatus,
        log_id: logId,
        api_response: apiResponse,
        station_id: stationId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[send-parcel-sms] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
