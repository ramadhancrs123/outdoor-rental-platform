import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET="hiking-media-staging";
const MAX_BYTES=10*1024*1024;
const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info,x-request-id",
  "Access-Control-Max-Age":"86400",
};

const restrictedOrigins = new Set([
  "https://akasha-outdoor.vercel.app",
  "https://rental-web-din-media.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);
function withRestrictedCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = request.headers.get("Origin");
  if (origin && restrictedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-request-id");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

type Admin={akun_admin_id:string;role:string;status:string};
class HttpError extends Error{status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function text(value:FormDataEntryValue|null,max:number,required=false):string|null{
  if(typeof value!=="string")return required?"":null;
  const v=value.trim();if(!v&&!required)return null;return v.slice(0,max);
}
function uuid(value:string|null):string|null{return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;}
function sha256(bytes:Uint8Array):Promise<string>{return crypto.subtle.digest("SHA-256",bytes).then(d=>Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join(""));}
function detectedMime(b:Uint8Array):string|null{
  if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return "image/jpeg";
  if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return "image/png";
  if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP")return "image/webp";
  if(b.length>=12&&String.fromCharCode(...b.slice(4,8))==="ftyp"&&["avif","avis"].includes(String.fromCharCode(...b.slice(8,12))))return "image/avif";
  return null;
}
async function authenticate(request:Request,service:ReturnType<typeof createClient>){
  const match=(request.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i);
  if(!match)throw new HttpError(401,"AUTHENTICATION_REQUIRED");
  const {data,error}=await service.auth.getUser(match[1]);
  if(error||!data.user)throw new HttpError(401,"INVALID_SESSION");
  const {data:admin,error:adminError}=await service.from("akun_admin").select("akun_admin_id,role,status")
    .eq("auth_user_id",data.user.id).eq("status","active").maybeSingle();
  if(adminError)throw new HttpError(500,"ADMIN_IDENTITY_LOOKUP_FAILED");
  if(!admin||admin.role!=="super_admin")throw new HttpError(403,"SUPER_ADMIN_REQUIRED");
  return admin as Admin;
}

async function handleRequest(request: Request): Promise<Response> {
  if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const supabaseUrl=Deno.env.get("SUPABASE_URL");const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceKey)return json({error:"SERVER_CONFIGURATION_MISSING"},500);
  const service=createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
  let admin:Admin;
  try{admin=await authenticate(request,service);}catch(e){return json({error:e instanceof HttpError?e.message:"AUTHENTICATION_FAILED"},e instanceof HttpError?e.status:500);}

  try{
    if(!(request.headers.get("content-type")??"").toLowerCase().includes("multipart/form-data"))throw new HttpError(415,"MULTIPART_FORM_DATA_REQUIRED");
    const form=await request.formData();const fileValue=form.get("file");
    if(!(fileValue instanceof File))throw new HttpError(400,"IMAGE_FILE_REQUIRED");
    const file=fileValue;if(file.size<12||file.size>MAX_BYTES)throw new HttpError(413,"IMAGE_SIZE_INVALID");
    const mountainId=uuid(text(form.get("mountain_id"),64));
    const trailId=uuid(text(form.get("trail_id"),64));
    if(Boolean(mountainId)===Boolean(trailId))throw new HttpError(400,"EXACTLY_ONE_TARGET_REQUIRED");
    const targetId=mountainId??trailId!;
    const sourceId=uuid(text(form.get("source_id"),64,true));
    if(!sourceId)throw new HttpError(400,"SOURCE_ID_REQUIRED");
    const sourceUrl=text(form.get("source_reference_url"),1000,true);
    if(!sourceUrl)throw new HttpError(400,"SOURCE_REFERENCE_REQUIRED");
    try{const u=new URL(sourceUrl);if(u.protocol!=="https:"||u.username||u.password)throw new Error();}catch{throw new HttpError(400,"SOURCE_REFERENCE_MUST_USE_HTTPS");}
    const altText=text(form.get("alt_text"),240,true);
    if(!altText||altText.length<3)throw new HttpError(400,"ALT_TEXT_INVALID");
    const mediaType=text(form.get("media_type"),40,true);
    if(!["cover","gallery","route_preview","basecamp","operator_logo","other"].includes(mediaType!))throw new HttpError(400,"MEDIA_TYPE_INVALID");
    const sortOrderRaw=text(form.get("sort_order"),10)??"0";
    if(!/^\d+$/.test(sortOrderRaw)||Number(sortOrderRaw)>100000)throw new HttpError(400,"SORT_ORDER_INVALID");
    const [targetResult,sourceResult]=await Promise.all([
      mountainId
        ?service.from("hiking_mountains").select("mountain_id").eq("mountain_id",mountainId).maybeSingle()
        :service.from("hiking_trails").select("trail_id,mountain_id").eq("trail_id",trailId!).maybeSingle(),
      service.from("hiking_data_sources").select("source_id,permission_status,is_active").eq("source_id",sourceId).maybeSingle(),
    ]);
    if(targetResult.error)throw new HttpError(500,"MEDIA_TARGET_LOOKUP_FAILED");
    if(!targetResult.data)throw new HttpError(404,"MEDIA_TARGET_NOT_FOUND");
    if(sourceResult.error)throw new HttpError(500,"MEDIA_SOURCE_LOOKUP_FAILED");
    if(!sourceResult.data||!sourceResult.data.is_active)throw new HttpError(409,"MEDIA_SOURCE_INACTIVE");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mime=detectedMime(bytes);
    if(!mime)throw new HttpError(415,"IMAGE_CONTENT_TYPE_NOT_ALLOWED");
    const extension={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"}[mime];
    const mediaId=crypto.randomUUID();
    const storagePath=`${targetId}/${mediaId}/asset.${extension}`;
    const hash=await sha256(bytes);
    const {error:uploadError}=await service.storage.from(BUCKET).upload(storagePath,new Blob([bytes as BlobPart],{type:mime}),{
      contentType:mime,upsert:false,cacheControl:"0",
    });
    if(uploadError)throw new HttpError(500,"MEDIA_STAGING_UPLOAD_FAILED");
    const {data,error:insertError}=await service.from("hiking_media").insert({
      media_id:mediaId,mountain_id:mountainId,trail_id:trailId,bucket_id:BUCKET,storage_path:storagePath,
      media_type:mediaType,alt_text:altText,caption:text(form.get("caption"),600),
      sort_order:Number(sortOrderRaw),source_id:sourceId,source_reference_url:sourceUrl,
      permission_status:sourceResult.data.permission_status,
      publication_status:"draft",content_sha256:hash,
    }).select("media_id,mountain_id,trail_id,bucket_id,storage_path,media_type,alt_text,permission_status,publication_status,content_sha256,created_at").single();
    if(insertError){
      await service.storage.from(BUCKET).remove([storagePath]);
      throw new HttpError(409,"MEDIA_METADATA_SAVE_FAILED");
    }
    const {error:auditError}=await service.from("hiking_admin_audit").insert({
      actor_admin_id:admin.akun_admin_id,action:"upload_hiking_media",target_type:"media",target_id:mediaId,
      safe_details:{source_id:sourceId,media_type:mediaType,byte_size:bytes.length,content_sha256:hash},
    });
    if(auditError)console.error("hiking media audit write failed");
    return json({
      ok:true,media:insertError?null:data,
      nextStep:"Media disimpan di bucket privat. Verifikasi hak penggunaan dan sumber terlebih dahulu, lalu jalankan publish_media.",
    },201);
  }catch(error){
    const status=error instanceof HttpError?error.status:500;
    const code=error instanceof HttpError?error.message:"INTERNAL_ERROR";
    if(status===500)console.error("hiking-media-upload failed",code);
    return json({error:code},status);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && !restrictedOrigins.has(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" } });
  }
  return withRestrictedCors(await handleRequest(request), request);
});
