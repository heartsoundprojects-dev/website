const {db,send,requireAdmin}=require("../../lib/publishing");
const clean=v=>typeof v==="string"?v.trim():"";
module.exports=async function handler(req,res){
 if(!requireAdmin(req,res)) return;
 try{
  const id=req.query.id, sql=db();
  if(req.method==="DELETE"){
   const rows=await sql`DELETE FROM publications WHERE id=${id} RETURNING id`;
   return rows.length?send(res,200,{ok:true}):send(res,404,{error:"Publication not found"});
  }
  if(req.method==="PUT"){
   const b=req.body||{}, category=clean(b.category), title=clean(b.title);
   if(!category||!title) return send(res,400,{error:"Category and title are required"});
   const status=["draft","published","archived"].includes(b.status)?b.status:"draft";
   const rows=await sql`UPDATE publications SET category=${category},title=${title},summary=${clean(b.summary)},body=${clean(b.body)},image_url=${clean(b.image_url)},external_url=${clean(b.external_url)},event_date=${b.event_date||null},event_end=${b.event_end||null},venue=${clean(b.venue)},location=${clean(b.location)},status=${status},featured=${!!b.featured},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=${id} RETURNING *`;
   return rows.length?send(res,200,{item:rows[0]}):send(res,404,{error:"Publication not found"});
  }
  return send(res,405,{error:"Method not allowed"});
 }catch(e){console.error("publication update error",e);return send(res,500,{error:"Could not update publication"});}
};
