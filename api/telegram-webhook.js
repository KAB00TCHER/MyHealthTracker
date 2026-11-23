import crypto from "node:crypto";
import { db } from "./_lib/auth.js";
import { telegram } from "./_lib/telegram.js";

function validSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const actual = req.headers["x-telegram-bot-api-secret-token"] || "";

  if (!expected || !actual) return false;

  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  if (!validSecret(req)) {
    return res.status(401).json({ ok: false });
  }

  try {
    const update = req.body || {};
    const leraId = String(process.env.LERA_TELEGRAM_ID || "");
    const supabase = db();

    // Команда /start
    if (update.message) {
      const message = update.message;
      const userId = String(message.from?.id || "");

      if (
        userId !== leraId ||
        message.chat?.type !== "private"
      ) {
        return res.status(200).json({ ok: true });
      }

      if (message.text?.startsWith("/start")) {
        const { error } = await supabase
          .from("profiles")
          .upsert({
            telegram_id: userId,
            role: "user",
            bot_chat_id: String(message.chat.id),
            bot_started_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
          }, { onConflict: "telegram_id" });

        if (error) throw error;

        await telegram("sendMessage", {
          chat_id: message.chat.id,
          text:
            "Бот дневника подключён.\n\n" +
            "Здесь будут приходить напоминания о лекарствах. " +
            "Добавить и настроить расписание можно в приложении."
        });
      }

      return res.status(200).json({ ok: true });
    }

    // Нажатия на кнопки напоминаний
    if (update.callback_query) {
      const callback = update.callback_query;
      const userId = String(callback.from?.id || "");
      const chatId = String(callback.message?.chat?.id || "");
      const [action, logId] = String(callback.data || "").split(":");

      if (
        userId !== leraId ||
        !["taken", "snooze"].includes(action) ||
        !/^[0-9a-f-]{36}$/i.test(logId || "")
      ) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Действие недоступно."
        });

        return res.status(200).json({ ok: true });
      }

      const { data: log, error: findError } = await supabase
        .from("medication_logs")
        .select("id,status,telegram_id")
        .eq("id", logId)
        .eq("telegram_id", userId)
        .maybeSingle();

      if (findError) throw findError;

      if (!log || log.status !== "pending") {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Это напоминание уже обработано."
        });

        return res.status(200).json({ ok: true });
      }

      if (action === "taken") {
        const { error } = await supabase
          .from("medication_logs")
          .update({
            status: "taken",
            acted_at: new Date().toISOString(),
            snoozed_until: null
          })
          .eq("id", logId)
          .eq("status", "pending");

        if (error) throw error;

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Приём отмечен."
        });

        await telegram("editMessageText", {
          chat_id: chatId,
          message_id: callback.message.message_id,
          text: "Приём лекарства отмечен."
        });
      }

      if (action === "snooze") {
        const snoozedUntil = new Date(
          Date.now() + 10 * 60 * 1000
        ).toISOString();

        const { error } = await supabase
          .from("medication_logs")
          .update({ snoozed_until: snoozedUntil })
          .eq("id", logId)
          .eq("status", "pending");

        if (error) throw error;

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Напомню через 10 минут."
        });

        await telegram("editMessageText", {
          chat_id: chatId,
          message_id: callback.message.message_id,
          text: "Напоминание отложено на 10 минут."
        });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook:", error.message);

    // Telegram не должен бесконечно повторять неудачный запрос.
    return res.status(200).json({ ok: false });
  }
}