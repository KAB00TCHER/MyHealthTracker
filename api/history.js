import { authenticate, method, decryptJson } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const auth = await authenticate(req, res);
  if (!auth) return;

  try {
    const from = String(req.query.from || "2000-01-01");
    const to = String(req.query.to || "2100-01-01");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ ok: false, error: "INVALID_DATE_RANGE" });
    }

    const [entriesResult, eventsResult] = await Promise.all([
      auth.supabase.from("daily_entries")
        .select("id,entry_date,answers_encrypted,updated_at")
        .eq("telegram_id", auth.targetId)
        .gte("entry_date", from).lte("entry_date", to)
        .order("entry_date", { ascending: false }).limit(180),
      auth.supabase.from("state_events")
        .select("id,event_type,value,note_encrypted,occurred_at")
        .eq("telegram_id", auth.targetId)
        .gte("occurred_at", `${from}T00:00:00.000Z`)
        .lte("occurred_at", `${to}T23:59:59.999Z`)
        .order("occurred_at", { ascending: false }).limit(500)
    ]);
    if (entriesResult.error) throw entriesResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const entries = (entriesResult.data || []).map(e => ({
      id: e.id, entry_date: e.entry_date,
      answers: decryptJson(e.answers_encrypted), updated_at: e.updated_at
    }));
    const events = (eventsResult.data || []).map(e => ({
      id: e.id, event_type: e.event_type, value: e.value,
      note: e.note_encrypted ? decryptJson(e.note_encrypted) : "",
      occurred_at: e.occurred_at
    }));
    return res.status(200).json({ ok: true, entries, events });
  } catch (error) {
    console.error("History API:", error.message);
    return res.status(500).json({ ok: false, error: "DATABASE_OR_ENCRYPTION_ERROR" });
  }
}
