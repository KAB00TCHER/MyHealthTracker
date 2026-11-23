import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function db() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("SERVER_CONFIG_MISSING");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function verifyTelegramData(initData) {
  if (!initData || typeof initData !== "string") throw new Error("NO_INIT_DATA");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error("INVALID_HASH");

  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN || "")
    .digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  const received = Buffer.from(receivedHash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");
  if (received.length !== calculated.length || !crypto.timingSafeEqual(received, calculated)) {
    throw new Error("INVALID_SIGNATURE");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) {
    throw new Error("EXPIRED_AUTH");
  }

  const user = JSON.parse(params.get("user") || "null");
  if (!user?.id) throw new Error("NO_USER");
  return user;
}

export async function authenticate(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const user = verifyTelegramData(req.headers["x-telegram-init-data"]);
    const id = String(user.id);
    const leraId = String(process.env.LERA_TELEGRAM_ID || "");
    const adminId = String(process.env.ADMIN_TELEGRAM_ID || "");
    if (!leraId || !adminId || leraId === adminId) throw new Error("SERVER_CONFIG_MISSING");

    const role = id === leraId ? "user" : id === adminId ? "admin" : null;
    if (!role) {
      res.status(403).json({ ok: false, error: "ACCESS_DENIED" });
      return null;
    }

    const supabase = db();
    const { error } = await supabase.from("profiles").upsert({
      telegram_id: id,
      role,
      last_seen: new Date().toISOString()
    }, { onConflict: "telegram_id" });
    if (error) throw error;

    return {
      supabase, id, role,
      firstName: user.first_name || "Пользователь",
      targetId: role === "admin" ? leraId : id
    };
  } catch (error) {
    console.error("Authentication error:", error.message);
    const status = error.message === "SERVER_CONFIG_MISSING" ? 500 : 401;
    res.status(status).json({
      ok: false,
      error: status === 500 ? "SERVER_CONFIG_MISSING" : "AUTHENTICATION_FAILED"
    });
    return null;
  }
}

export function method(req, res, allowed) {
  if (req.method !== allowed) {
    res.setHeader("Allow", allowed);
    res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    return false;
  }
  return true;
}

function encryptionKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY_MISSING_OR_INVALID");
  return key;
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);
  return {
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

export function decryptJson(envelope) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== "A256GCM") {
    throw new Error("INVALID_ENCRYPTED_DATA");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plain);
}
