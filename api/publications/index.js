const {db,send,requireAdmin}=require("../_lib");
const clean=v=>typeof v==="string"?v.trim():"";
const slugify=s=>s.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90)||"publication";
module.exports=async function handler(req,res){
 try{
  const sql=db();
  if(req.method==="GET"){
   const drafts=req.query.includeDrafts==="true";
   if(drafts && !requireAdmin(req,res)) return;
   const category=clean(req.query.category);
   const rows=drafts
    ? (category?await sql`SELECT * FROM publications WHERE category=${category} ORDER BY created_at DESC`:await sql`SELECT * FROM publications ORDER BY created_at DESC`)
    : (category?await sql`SELECT * FROM publications WHERE status='published' AND category=${category} ORDER BY event_date NULLS LAST, published_at DESC`:await sql`SELECT * FROM publications WHERE status='published' ORDER BY event_date NULLS LAST, published_at DESC`);
   return send(res,200,{items:rows});
  }
  if(req.method==="POST"){
   if(!requireAdmin(req,res)) return;
   const b=req.body||{}, category=clean(b.category), title=clean(b.title);
   if(!category||!title) return send(res,400,{error:"Category and title are required"});
   const status=["draft","published","archived"].includes(b.status)?b.status:"draft";
   const slug=slugify(clean(b.slug)||title)+"-"+require("crypto").randomBytes(3).toString("hex");
   const rows=await sql`INSERT INTO publications(category,title,slug,summary,body,image_url,external_url,event_date,event_end,venue,location,status,featured,published_at)
    VALUES(${category},${title},${slug},${clean(b.summary)},${clean(b.body)},${clean(b.image_url)},${clean(b.external_url)},${b.event_date||null},${b.event_end||null},${clean(b.venue)},${clean(b.location)},${status},${!!b.featured},CASE WHEN ${status}='published' THEN NOW() ELSE NULL END) RETURNING *`;
   return send(res,201,{item:rows[0]});
  }
  return send(res,405,{error:"Method not allowed"});
 }catch(e){console.error("publications error",e);return send(res,500,{error:"Could not process publication"});}
};
