const {db,bcrypt,send,currentUser,makeSession,setSession}=require("../../lib/publishing");
module.exports=async function handler(req,res){
  const action=req.query.action;
  try{
    if(action==="setup-status" && req.method==="GET"){ const sql=db(); const rows=await sql`SELECT COUNT(*)::int AS count FROM admin_users`; return send(res,200,{needsSetup:rows[0].count===0}); }
    if(action==="me" && req.method==="GET"){
      const user=currentUser(req); return send(res,200,{authenticated:!!user,user:user?{username:user.username}:null});
    }
    if(action==="logout" && req.method==="POST"){
      res.setHeader("Set-Cookie","hs_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      return send(res,200,{ok:true});
    }
    if(action==="setup" && req.method==="POST"){
      if(!process.env.ADMIN_SETUP_TOKEN || req.headers["x-setup-token"]!==process.env.ADMIN_SETUP_TOKEN) return send(res,403,{error:"Setup token is invalid"});
      const {username,password}=req.body||{};
      if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username||"") || typeof password!=="string" || password.length<12) return send(res,400,{error:"Use a 3–40 character username and a password of at least 12 characters"});
      const sql=db(); const rows=await sql`SELECT COUNT(*)::int AS count FROM admin_users`;
      if(rows[0].count>0) return send(res,409,{error:"An administrator account already exists"});
      const hash=await bcrypt.hash(password,12);
      const inserted=await sql`INSERT INTO admin_users(username,password_hash) VALUES(${username},${hash}) RETURNING id,username`;
      setSession(res,makeSession(inserted[0])); return send(res,201,{ok:true,user:{username:inserted[0].username}});
    }
    if(action==="login" && req.method==="POST"){
      const {username,password}=req.body||{};
      if(typeof username!=="string" || typeof password!=="string") return send(res,400,{error:"Enter your username and password"});
      const sql=db(); const rows=await sql`SELECT id,username,password_hash FROM admin_users WHERE username=${username} LIMIT 1`;
      if(!rows.length || !(await bcrypt.compare(password,rows[0].password_hash))) return send(res,401,{error:"Incorrect username or password"});
      setSession(res,makeSession(rows[0])); return send(res,200,{ok:true,user:{username:rows[0].username}});
    }
    return send(res,405,{error:"Method not allowed"});
  }catch(e){console.error("auth error",e);return send(res,500,{error:"Authentication service error"});}
};
