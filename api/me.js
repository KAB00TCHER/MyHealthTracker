import { authenticate, method } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  const auth = await authenticate(req, res);
  if (!auth) return;
  return res.status(200).json({
    ok: true,
    user: { id: auth.id, firstName: auth.firstName, role: auth.role }
  });
}
