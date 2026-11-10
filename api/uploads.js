const crypto=require("crypto");
const {put}=require("@vercel/blob");
const {send,requireAdmin}=require("../lib/publishing");

module.exports=async function handler(req,res){
  if(req.method!=="POST") return send(res,405,{error:"Method not allowed"});
  if(!requireAdmin(req,res)) return;
  const type=String(req.headers["content-type"]||"").toLowerCase();
  const extensions={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  if(!extensions[type]) return send(res,415,{error:"Use a JPG, PNG or WebP image"});
  const size=Number(req.headers["content-length"]||0);
  if(size>4*1024*1024) return send(res,413,{error:"Image must be 4 MB or smaller"});
  if(!process.env.BLOB_READ_WRITE_TOKEN) return send(res,503,{error:"Image storage is not connected yet"});
  try{
    const pathname="publications/"+Date.now()+"-"+crypto.randomBytes(8).toString("hex")+"."+extensions[type];
    const blob=await put(pathname,req,{access:"public",contentType:type,contentDisposition:"inline",addRandomSuffix:true,cacheControlMaxAge:31536000});
    return send(res,200,{url:blob.url,pathname:blob.pathname});
  }catch(error){
    console.error("publication image upload error",error);
    return send(res,500,{error:"Could not upload image. Please try again."});
  }
};
module.exports.config={api:{bodyParser:false}};
