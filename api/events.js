import { authenticate, method, encryptJson, decryptJson } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (!method(req, res, req.method === "GET" ? "GET" : "POST")) return;
  const auth = await authenticate(req, res);
  if (!auth) return;

  try {
    if (req.method === "GET") {
      const from = String(req.query.from || new Date(Date.now() - 7 * 86400000).toISOString());
      const to = String(req.query.to || new Date(Date.now() + 86400000).toISOString());
      const { data, error } = await auth.supabase.from("state_events")
        .select("id,event_type,value,note_encrypted,occurred_at,created_at")
        .eq("telegram_id", auth.targetId)
        .gte("occurred_at", from).lte("occurred_at", to)
        .order("occurred_at", { ascending: false }).limit(300);
      if (error) throw error;
      return res.status(200).json({
        ok: true,
        events: (data || []).map(e => ({
          id: e.id, event_type: e.event_type, value: e.value,
          note: e.note_encrypted ? decryptJson(e.note_encrypted) : "",
          occurred_at: e.occurred_at, created_at: e.created_at
        }))
      });
    }

    if (auth.role !== "user") return res.status(403).json({ ok: false, error: "USER_ONLY" });
    const { event_type, value, note } = req.body || {};
    const allowed = ["anxiety", "mood", "energy", "irritability", "other"];
    if (!allowed.includes(event_type)) return res.status(400).json({ ok: false, error: "INVALID_EVENT_TYPE" });
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10)) {
      return res.status(400).json({ ok: false, error: "INVALID_VALUE" });
    }
    if (typeof (note ?? "") !== "string" || (note ?? "").length > 2000) {
      return res.status(400).json({ ok: false, error: "INVALID_NOTE" });
    }

    const occurredAt = req.body?.occurred_at || new Date().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) return res.status(400).json({ ok: false, error: "INVALID_TIME" });

    const encryptedNote = encryptJson(note ?? "");
    const { data, error } = await auth.supabase.from("state_events").insert({
      telegram_id: auth.id,
      event_type,
      value: value ?? null,
      note_encrypted: encryptedNote,
      occurred_at: occurredAt
    }).select("id,event_type,value,note_encrypted,occurred_at").single();
    if (error) throw error;
    return res.status(201).json({
      ok: true,
      event: {
        id: data.id, event_type: data.event_type, value: data.value,
        note: decryptJson(data.note_encrypted), occurred_at: data.occurred_at
      }
    });
  } catch (error) {
    console.error("Events API:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message === "ENCRYPTION_KEY_MISSING_OR_INVALID"
        ? "ENCRYPTION_NOT_CONFIGURED" : "DATABASE_OR_ENCRYPTION_ERROR"
    });
  }
}
