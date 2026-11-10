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
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}
function tokenFor(data, ttl) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttl })).toString("base64url");
  return payload + "." + sign(payload);
}
function readToken(token, purpose) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload,"base64url").toString());
    return data.exp > Date.now() && data.purpose === purpose ? data : null;
  } catch { return null; }
}
function makeSession(user) {
  return tokenFor({ id: user.id, username: user.username, purpose: "admin", mfa: true }, 7*24*60*60*1000);
}
function makePending(user, stage) {
  return tokenFor({ id: user.id, username: user.username, purpose: "pending", stage }, 10*60*1000);
}
function currentUser(req) {
  const user = readToken(cookieValue(req, "hs_admin"), "admin");
  return user && user.mfa === true ? user : null;
}
function currentPending(req) {
  return readToken(cookieValue(req, "hs_admin_pending"), "pending");
}
function requireAdmin(req,res) {
  const user=currentUser(req);
  if(!user){send(res,401,{error:"Please sign in"});return null;}
  return user;
}
function setSession(res, token) {
  res.setHeader("Set-Cookie", [
    "hs_admin="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
    "hs_admin_pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  ]);
}
function setPending(res, token) {
  res.setHeader("Set-Cookie", [
    "hs_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    "hs_admin_pending="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600"
  ]);
}
function clearSessions(res) {
  res.setHeader("Set-Cookie", [
    "hs_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    "hs_admin_pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  ]);
}
function encryptionKey() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return crypto.createHash("sha256").update("HeartSound Media TOTP:" + process.env.SESSION_SECRET).digest();
}
function encryptSecret(secret) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptSecret(value) {
  if (!value) return "";
  const [iv, tag, ciphertext] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += B32[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(input) {
  let bits = 0, value = 0; const out = [];
  for (const char of input.toUpperCase().replace(/=+$/,"").replace(/\s/g,"")) {
    const n = B32.indexOf(char); if (n < 0) throw new Error("Invalid authenticator secret");
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac("sha1",base32Decode(secret)).update(msg).digest();
  const offset = hash[hash.length-1] & 15;
  const binary = ((hash[offset]&127)<<24)|((hash[offset+1]&255)<<16)|((hash[offset+2]&255)<<8)|(hash[offset+3]&255);
  return String(binary % 1000000).padStart(6,"0");
}
function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const now = Date.now();
  for (const drift of [-30000,0,30000]) {
    const expected = Buffer.from(totpCode(secret, now + drift));
    const actual = Buffer.from(String(code));
    if (expected.length === actual.length && crypto.timingSafeEqual(expected,actual)) return true;
  }
  return false;
}
function totpUri(username, secret) {
  const issuer = "HeartSound Media";
  const label = encodeURIComponent(issuer + ":" + username);
  return "otpauth://totp/" + label + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30";
}
module.exports={db,bcrypt,send,currentUser,currentPending,requireAdmin,makeSession,makePending,setSession,setPending,clearSessions,encryptSecret,decryptSecret,newTotpSecret,verifyTotp,totpUri};
