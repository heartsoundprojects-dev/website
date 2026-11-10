const {db,send,requireAdmin}=require("../../lib/publishing");
const clean=v=>typeof v==="string"?v.trim():"";
module.exports=async function handler(req,res){
 const sql=db();
 try{
  if(req.method==="POST"){
   const b=req.body||{}, eventId=clean(b.publication_id), name=clean(b.full_name), phone=clean(b.phone), email=clean(b.email);
   if(!eventId||!name||name.length>180||!phone||phone.length>40||email.length>254) return send(res,400,{error:"Enter a valid name and phone number. Email is optional."});
   if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res,400,{error:"Enter a valid email address."});
   const events=await sql`SELECT id,title,ticket_type,ticket_price,ticket_options FROM publications WHERE id=${eventId} AND category='Events' AND status='published' LIMIT 1`;
   if(!events.length) return send(res,404,{error:"This event is not available for registration."});
   const event=events[0], options=Array.isArray(event.ticket_options)?event.ticket_options:[], paid=event.ticket_type==="paid";
   let selected=null, price=null;
   if(paid){if(options.length){selected=options.find(x=>x.id===clean(b.ticket_option_id)&&x.available!==false);if(!selected)return send(res,400,{error:"Choose an available ticket option."});price=Number(selected.price);}else{price=Number(event.ticket_price);if(!(price>0))return send(res,400,{error:"This event has no valid ticket price."});}}
   const rows=await sql`INSERT INTO event_registrations(publication_id,full_name,phone,email,ticket_type,ticket_price,ticket_option_id,ticket_option_name,payment_status,reservation_status)
    VALUES(${event.id},${name},${phone},${email||null},${paid?"paid":"free"},${paid?price:null},${selected?.id||null},${selected?.name||null},${paid?"pending":"not_required"},'reserved') RETURNING id,publication_id,ticket_type,ticket_price,ticket_option_id,ticket_option_name,payment_status,reservation_status,created_at`;
   return send(res,201,{registration:rows[0],event_title:event.title});
  }
  if(req.method==="GET"){
   if(!requireAdmin(req,res)) return;
   const eventId=clean(req.query.event_id);
   if(!eventId) return send(res,400,{error:"An event ID is required."});
   const rows=await sql`SELECT r.id,r.publication_id,r.full_name,r.phone,r.email,r.ticket_type,r.ticket_price,r.ticket_option_id,r.ticket_option_name,r.payment_status,r.reservation_status,r.created_at,r.updated_at,p.title AS event_title FROM event_registrations r JOIN publications p ON p.id=r.publication_id WHERE r.publication_id=${eventId} ORDER BY r.created_at DESC`;
   const counts=await sql`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE reservation_status<>'cancelled')::int AS active,COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending_payment,COUNT(*) FILTER(WHERE payment_status='verified')::int AS verified FROM event_registrations WHERE publication_id=${eventId}`;
   return send(res,200,{items:rows,counts:counts[0]||{}});
  }
  return send(res,405,{error:"Method not allowed"});
 }catch(e){console.error("registrations error",e);return send(res,500,{error:"Could not process registration."});}
};
