const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const bcrypt = require("bcryptjs");

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}
function send(res, status, data) {
  res.status(status).setHeader("Cache-Control", "no-store").json(data);
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  const part = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(value).digest("base64url");
}
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, username: user.username, exp: Date.now() + 7*24*60*60*1000 })).toString("base64url");
  return payload + "." + sign(payload);
}
function currentUser(req) {
  if (!process.env.SESSION_SECRET) return null;
  const token = cookieValue(req, "hs_admin");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload,"base64url").toString());
    return user.exp > Date.now() ? user : null;
  } catch { return null; }
}
function requireAdmin(req,res) {
  const user=currentUser(req);
  if(!user){send(res,401,{error:"Please sign in"});return null;}
  return user;
}
function setSession(res, token) {
  res.setHeader("Set-Cookie", "hs_admin="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800");
}
module.exports={db,bcrypt,send,currentUser,requireAdmin,makeSession,setSession};
