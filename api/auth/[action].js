const {
  db,bcrypt,send,currentUser,currentPending,makeSession,makePending,setSession,setPending,clearSessions,
  encryptSecret,decryptSecret,newTotpSecret,verifyTotp,totpUri
}=require("../../lib/publishing");

async function startEnrollment(res, sql, user) {
  let secret = user.totp_secret ? decryptSecret(user.totp_secret) : "";
  if (!secret) {
    secret = newTotpSecret();
    await sql`UPDATE admin_users SET totp_secret=${encryptSecret(secret)}, totp_enabled=FALSE, updated_at=NOW() WHERE id=${user.id}`;
  }
  setPending(res,makePending(user,"enroll"));
  return {requiresEnrollment:true,otpauthUri:totpUri(user.username,secret),manualKey:secret};
}

module.exports=async function handler(req,res){
  const action=req.query.action;
  try{
    if(action==="setup-status" && req.method==="GET"){
      const sql=db(); const rows=await sql`SELECT COUNT(*)::int AS count FROM admin_users`;
      return send(res,200,{needsSetup:rows[0].count===0});
    }
    if(action==="me" && req.method==="GET"){
      const user=currentUser(req); return send(res,200,{authenticated:!!user,user:user?{username:user.username}:null});
    }
    if(action==="logout" && req.method==="POST"){
      clearSessions(res); return send(res,200,{ok:true});
    }
    if(action==="setup" && req.method==="POST"){
      if(!process.env.ADMIN_SETUP_TOKEN || req.headers["x-setup-token"]!==process.env.ADMIN_SETUP_TOKEN) return send(res,403,{error:"Setup token is invalid"});
      if(!process.env.SESSION_SECRET) return send(res,500,{error:"SESSION_SECRET is not configured"});
      const {username,password}=req.body||{};
      if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username||"") || typeof password!=="string" || password.length<12) return send(res,400,{error:"Use a 3–40 character username and a password of at least 12 characters"});
      const sql=db(); const rows=await sql`SELECT COUNT(*)::int AS count FROM admin_users`;
      if(rows[0].count>0) return send(res,409,{error:"An administrator account already exists"});
      const hash=await bcrypt.hash(password,12), secret=newTotpSecret();
      const inserted=await sql`INSERT INTO admin_users(username,password_hash,totp_secret,totp_enabled) VALUES(${username},${hash},${encryptSecret(secret)},FALSE) RETURNING id,username`;
      setPending(res,makePending(inserted[0],"enroll"));
      return send(res,201,{ok:true,requiresEnrollment:true,otpauthUri:totpUri(inserted[0].username,secret),manualKey:secret});
    }
    if(action==="login" && req.method==="POST"){
      const {username,password}=req.body||{};
      if(typeof username!=="string" || typeof password!=="string") return send(res,400,{error:"Enter your username and password"});
      const sql=db(); const rows=await sql`SELECT id,username,password_hash,totp_secret,totp_enabled FROM admin_users WHERE username=${username} LIMIT 1`;
      if(!rows.length || !(await bcrypt.compare(password,rows[0].password_hash))) return send(res,401,{error:"Incorrect username or password"});
      if(!process.env.SESSION_SECRET) return send(res,500,{error:"SESSION_SECRET is not configured"});
      const user=rows[0];
      if(user.totp_enabled){
        setPending(res,makePending(user,"verify"));
        return send(res,200,{ok:true,requiresTotp:true});
      }
      const enrollment=await startEnrollment(res,sql,user);
      return send(res,200,{ok:true,...enrollment});
    }
    if(action==="verify" && req.method==="POST"){
      const pending=currentPending(req), code=String((req.body||{}).code||"").trim();
      if(!pending) return send(res,401,{error:"Your sign-in step has expired. Please enter your username and password again."});
      const sql=db(); const rows=await sql`SELECT id,username,totp_secret,totp_enabled FROM admin_users WHERE id=${pending.id} LIMIT 1`;
      if(!rows.length || !rows[0].totp_secret) return send(res,401,{error:"Authenticator setup is unavailable. Please sign in again."});
      const secret=decryptSecret(rows[0].totp_secret);
      if(!verifyTotp(secret,code)) return send(res,401,{error:"That code is incorrect or has expired. Try the latest six-digit code."});
      if(!rows[0].totp_enabled) await sql`UPDATE admin_users SET totp_enabled=TRUE, updated_at=NOW() WHERE id=${pending.id}`;
      setSession(res,makeSession(rows[0]));
      return send(res,200,{ok:true,user:{username:rows[0].username}});
    }
    return send(res,405,{error:"Method not allowed"});
  }catch(e){console.error("auth error",e);return send(res,500,{error:"Authentication service error"});}
};
