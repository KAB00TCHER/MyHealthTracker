import {
  authenticate,
  encryptJson,
  decryptJson
} from "./_lib/auth.js";

const validId = /^[0-9a-f-]{36}$/i;
const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validate(body) {
  const name = String(body.name || "").trim();
  const instructions = String(body.instructions || "").trim();
  const times = body.times;
  const timezone = String(body.timezone || "Europe/Moscow");

  if (!name || name.length > 120) {
    throw new Error("INVALID_MEDICATION_NAME");
  }

  if (instructions.length > 300) {
    throw new Error("INVALID_INSTRUCTIONS");
  }

  if (
    !Array.isArray(times) ||
    times.length < 1 ||
    times.length > 6 ||
    times.some(t => typeof t !== "string" || !validTime.test(t))
  ) {
    throw new Error("INVALID_TIMES");
  }

  if (new Set(times).size !== times.length) {
    throw new Error("DUPLICATE_TIMES");
  }

  if (!validTimezone(timezone)) {
    throw new Error("INVALID_TIMEZONE");
  }

  return {
    details_encrypted: encryptJson({ name, instructions }),
    schedule_times: times,
    timezone
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  // Медицинские данные доступны только самому пользователю.
  if (auth.role !== "user") {
    return res.status(403).json({ ok: false, error: "USER_ONLY" });
  }

  try {
    const db = auth.supabase;

  
if (req.method === "GET") {
  const { data: medications, error } = await db
    .from("medications")
    .select("*")
    .eq("telegram_id", auth.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const preparedMedications = (medications || []).map(m => ({
    id: m.id,
    ...decryptJson(m.details_encrypted),
    times: m.schedule_times,
    timezone: m.timezone,
    active: m.active
  }));

  const medicationMap = new Map(
    preparedMedications.map(m => [
      m.id,
      {
        name: m.name,
        timezone: m.timezone
      }
    ])
  );

  const { data: logs, error: logsError } = await db
    .from("medication_logs")
    .select("id,medication_id,scheduled_for,status,reminder_sent_at,snoozed_until,acted_at")
    .eq("telegram_id", auth.id)
    .order("scheduled_for", { ascending: false })
    .limit(100);

  if (logsError) throw logsError;

  const preparedLogs = (logs || []).map(log => {
    const medication = medicationMap.get(log.medication_id);

    return {
      ...log,
      medication_name: medication?.name || "Неизвестный препарат",
      timezone: medication?.timezone || "Europe/Moscow"
    };
  });

  return res.status(200).json({
    ok: true,
    medications: preparedMedications,
    logs: preparedLogs
  });
}


    if (req.method === "POST") {
      const values = validate(req.body || {});

      const { data, error } = await db
        .from("medications")
        .insert({
          telegram_id: auth.id,
          ...values
        })
        .select("id")
        .single();

      if (error) throw error;

      return res.status(201).json({ ok: true, id: data.id });
    }

    const id = String(req.body?.id || "");

    if (!validId.test(id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }

    if (req.method === "DELETE") {
      const { error } = await db
        .from("medications")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("telegram_id", auth.id);

      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    const update = {
      updated_at: new Date().toISOString()
    };

    if (typeof req.body.active === "boolean") {
      update.active = req.body.active;
    }

    if (
      req.body.name !== undefined ||
      req.body.instructions !== undefined ||
      req.body.times !== undefined ||
      req.body.timezone !== undefined
    ) {
      const { data: existing, error } = await db
        .from("medications")
        .select("*")
        .eq("id", id)
        .eq("telegram_id", auth.id)
        .single();

      if (error) throw error;

      const oldDetails = decryptJson(existing.details_encrypted);

      const values = validate({
        name: req.body.name ?? oldDetails.name,
        instructions: req.body.instructions ?? oldDetails.instructions,
        times: req.body.times ?? existing.schedule_times,
        timezone: req.body.timezone ?? existing.timezone
      });

      Object.assign(update, values);
    }

    const { error } = await db
      .from("medications")
      .update(update)
      .eq("id", id)
      .eq("telegram_id", auth.id);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Medications API:", error.message);

    const known = [
      "INVALID_MEDICATION_NAME",
      "INVALID_INSTRUCTIONS",
      "INVALID_TIMES",
      "DUPLICATE_TIMES",
      "INVALID_TIMEZONE"
    ];

    return res.status(400).json({
      ok: false,
      error: known.includes(error.message)
        ? error.message
        : "MEDICATIONS_DATABASE_ERROR"
    });
  }
}