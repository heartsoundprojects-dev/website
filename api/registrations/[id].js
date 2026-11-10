const {db,send,requireAdmin}=require("../../lib/publishing");
const allowedPayment=["not_required","pending","verified","rejected"];
const allowedReservation=["reserved","confirmed","cancelled"];
module.exports=async function handler(req,res){
 if(!requireAdmin(req,res)) return;
 if(req.method!=="PATCH"&&req.method!=="DELETE") return send(res,405,{error:"Method not allowed"});
 try{
  const b=req.body||{},id=req.query.id,sql=db();
  if(req.method==="DELETE"){
   if(!id) return send(res,400,{error:"A registration ID is required."});
   const deleted=await sql`DELETE FROM event_registrations WHERE id=${id} RETURNING id`;
   return deleted.length?send(res,200,{deleted:true,id:deleted[0].id}):send(res,404,{error:"Registration not found."});
  }
  if(!allowedPayment.includes(b.payment_status)&&!allowedReservation.includes(b.reservation_status)) return send(res,400,{error:"No valid status change was supplied."});
  const rows=await sql`UPDATE event_registrations SET payment_status=COALESCE(${allowedPayment.includes(b.payment_status)?b.payment_status:null},payment_status),reservation_status=COALESCE(${allowedReservation.includes(b.reservation_status)?b.reservation_status:null},reservation_status),updated_at=NOW() WHERE id=${id} RETURNING id,payment_status,reservation_status`;
  return rows.length?send(res,200,{registration:rows[0]}):send(res,404,{error:"Registration not found."});
 }catch(e){console.error("registration update error",e);return send(res,500,{error:"Could not update registration."});}
};
