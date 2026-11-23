
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

function verifyTelegramData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error("NO_INIT_DATA");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error("INVALID_HASH");
  }

  const data = [];

  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      data.push(`${key}=${value}`);
    }
  }

  data.sort();

  const dataCheckString = data.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const received = Buffer.from(receivedHash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");

  if (
    received.length !== calculated.length ||
    !crypto.timingSafeEqual(received, calculated)
  ) {
    throw new Error("INVALID_SIGNATURE");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(authDate) ||
    authDate > now + 60 ||
    now - authDate > 86400
  ) {
    throw new Error("EXPIRED_AUTH");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("NO_USER");
  }

  return JSON.parse(userRaw);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  try {
    const initData = req.headers["x-telegram-init-data"];

    const user = verifyTelegramData(initData);

    const telegramId = String(user.id);

    const leraId = process.env.LERA_TELEGRAM_ID;
    const adminId = process.env.ADMIN_TELEGRAM_ID;

    let role;

    if (telegramId === leraId) {
      role = "user";
    } else if (telegramId === adminId) {
      role = "admin";
    } else {
      return res.status(403).json({
        ok: false,
        error: "ACCESS_DENIED"
      });
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          telegram_id: telegramId,
          role,
          last_seen: new Date().toISOString()
        },
        {
          onConflict: "telegram_id"
        }
      );

    if (error) {
      console.error("Supabase error:", error.message);

      return res.status(500).json({
        ok: false,
        error: "DATABASE_ERROR"
      });
    }

    return res.status(200).json({
      ok: true,
      user: {
        id: telegramId,
        firstName: user.first_name || "Пользователь",
        role
      }
    });

  } catch (error) {
    console.error("Authentication error:", error.message);

    return res.status(401).json({
      ok: false,
      error: "AUTHENTICATION_FAILED"
    });
  }
}
