import crypto from "node:crypto";
import { db, decryptJson } from "./_lib/auth.js";
import { telegram } from "./_lib/telegram.js";

function authorized(req) {
  const expected = process.env.MEDICATION_CRON_SECRET || "";
  const actual = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  if (!expected || !actual) return false;

  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function localTime(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const hour = parts.find(p => p.type === "hour")?.value;
  const minute = parts.find(p => p.type === "minute")?.value;

  return `${hour}:${minute}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false });
  }

  try {
    const supabase = db();
    const now = new Date();
    const minute = new Date(
      Math.floor(now.getTime() / 60000) * 60000
    ).toISOString();

    const { data: medications, error } = await supabase
      .from("medications")
      .select("id,telegram_id,details_encrypted,schedule_times,timezone")
      .eq("active", true);

    if (error) throw error;

    let sent = 0;

    for (const medication of medications || []) {
      const currentTime = localTime(now, medication.timezone);

      if (!medication.schedule_times.includes(currentTime)) {
        continue;
      }

      // Создаём одну запись на конкретную минуту.
      // Ограничение UNIQUE защищает от повторного создания.
      const { error: insertError } = await supabase
        .from("medication_logs")
        .upsert({
          medication_id: medication.id,
          telegram_id: medication.telegram_id,
          scheduled_for: minute,
          status: "pending"
        }, {
          onConflict: "medication_id,scheduled_for",
          ignoreDuplicates: true
        });

      if (insertError) throw insertError;
    }

    // Обрабатываем ожидающие напоминания.
    for (const medication of medications || []) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("bot_chat_id,bot_started_at")
        .eq("telegram_id", medication.telegram_id)
        .maybeSingle();

      if (profileError) throw profileError;

      // Пока пользователь не запустил бота, отправлять сообщения нельзя.
      if (!profile?.bot_chat_id || !profile?.bot_started_at) {
        continue;
      }

      const { data: logs, error: logsError } = await supabase
        .from("medication_logs")
        .select("*")
        .eq("medication_id", medication.id)
        .eq("status", "pending")
        .lte("scheduled_for", now.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(20);

      if (logsError) throw logsError;

      for (const log of logs || []) {
        const firstSend = !log.reminder_sent_at;
        const snoozeExpired = log.snoozed_until &&
          new Date(log.snoozed_until).getTime() <= now.getTime();

        if (!firstSend && !snoozeExpired) continue;

        const details = decryptJson(medication.details_encrypted);

        const text = [
          "Напоминание о приёме лекарства",
          "",
          `Препарат: <b>${escapeHtml(details.name)}</b>`,
          details.instructions
            ? `Инструкция: ${escapeHtml(details.instructions)}`
            : "",
          "",
          "Отметь, что произошло:"
        ].filter(Boolean).join("\n");

        const message = await telegram("sendMessage", {
          chat_id: profile.bot_chat_id,
          text,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              {
                text: "Приняла",
                callback_data: `taken:${log.id}`
              },
              {
                text: "Отложить на 10 минут",
                callback_data: `snooze:${log.id}`
              }
            ]]
          }
        });

        const { error: updateError } = await supabase
          .from("medication_logs")
          .update({
            reminder_sent_at: new Date().toISOString(),
            snoozed_until: null,
            telegram_message_id: message.message_id
          })
          .eq("id", log.id)
          .eq("status", "pending");

        if (updateError) throw updateError;

        sent++;
      }
    }

    return res.status(200).json({
      ok: true,
      checked: medications?.length || 0,
      sent
    });
  } catch (error) {
    console.error("Medication cron:", error.message);
    return res.status(500).json({
      ok: false,
      error: "REMINDER_PROCESSING_ERROR"
    });
  }
}