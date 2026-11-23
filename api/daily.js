import { authenticate, method, encryptJson, decryptJson } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (!method(req, res, req.method === "GET" ? "GET" : "POST")) return;
  const auth = await authenticate(req, res);
  if (!auth) return;

  try {
    if (req.method === "GET") {
      const date = String(req.query.date || new Date().toISOString().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ ok: false, error: "INVALID_DATE" });
      }
      const { data, error } = await auth.supabase
        .from("daily_entries")
        .select("id,entry_date,answers_encrypted,created_at,updated_at")
        .eq("telegram_id", auth.targetId)
        .eq("entry_date", date)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({
        ok: true,
        entry: data ? {
          id: data.id, entry_date: data.entry_date,
          answers: decryptJson(data.answers_encrypted),
          created_at: data.created_at, updated_at: data.updated_at
        } : null
      });
    }

    if (auth.role !== "user") return res.status(403).json({ ok: false, error: "USER_ONLY" });
    const date = String(req.body?.date || "");
    const answers = req.body?.answers;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "INVALID_DATE" });
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return res.status(400).json({ ok: false, error: "INVALID_ANSWERS" });
    }
    if (JSON.stringify(answers).length > 30000) return res.status(413).json({ ok: false, error: "ENTRY_TOO_LARGE" });

    const encrypted = encryptJson(answers);
    const { data, error } = await auth.supabase.from("daily_entries").upsert({
      telegram_id: auth.id,
      entry_date: date,
      answers_encrypted: encrypted,
      updated_at: new Date().toISOString()
    }, { onConflict: "telegram_id,entry_date" })
      .select("id,entry_date,answers_encrypted,created_at,updated_at").single();
    if (error) throw error;
    return res.status(200).json({
      ok: true,
      entry: {
        id: data.id, entry_date: data.entry_date,
        answers: decryptJson(data.answers_encrypted),
        created_at: data.created_at, updated_at: data.updated_at
      }
    });
  } catch (error) {
    console.error("Daily API:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message === "ENCRYPTION_KEY_MISSING_OR_INVALID"
        ? "ENCRYPTION_NOT_CONFIGURED" : "DATABASE_OR_ENCRYPTION_ERROR"
    });
  }
}
