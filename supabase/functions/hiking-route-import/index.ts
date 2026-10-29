import { createClient } from "npm:@supabase/supabase-js@2";
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@4.5.3";

const BUCKET = "hiking-route-sources";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_POINTS = 100_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
  "Access-Control-Max-Age": "86400",
};

const restrictedOrigins = new Set([
  "https://akasha-outdoor.vercel.app",
  "https://rental-web-din-media.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]);

// Allow stable and immutable Vercel deployments belonging to this exact admin
// project/team. Preview URLs change per commit, so a static host list breaks
// browser preflight with a misleading "network unavailable" message.
function isAllowedOrigin(origin: string): boolean {
  if (restrictedOrigins.has(origin)) return true;
  // Includes the project's production domain, its stable Vercel alias and
  // immutable preview URLs used by mobile/desktop sessions.
  return /^https:\/\/outdoor-rental-platform(?:-[a-z0-9-]+)?(?:-din-media)?\.vercel\.app$/.test(origin);
}

function withRestrictedCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-request-id");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

type Obj = Record<string, unknown>;
type Point = { lat: number; lon: number; ele: number | null; name: string | null; type: string | null };
type RouteCandidate = {
  index: number;
  name: string | null;
  sourceType: "track" | "route";
  geojson: { type: "MultiLineString"; coordinates: number[][][] };
  segments: number[][][];
  points: number;
  segmentCount: number;
  distanceM: number;
  elevationGainM: number | null;
  warnings: string[];
};
type ParsedGpx = {
  geojson: { type: "MultiLineString"; coordinates: number[][][] };
  segments: number[][][];
  points: number;
  segmentCount: number;
  distanceM: number;
  elevationGainM: number | null;
  routeCandidates: RouteCandidate[];
  waypoints: Obj[];
  warnings: string[];
};
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true,
  parseTagValue: false, trimValues: true, processEntities: true,
});

class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function obj(v: unknown): Obj | null { return v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null; }
function asArray<T=unknown>(v: T | T[] | null | undefined): T[] { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function firstString(v: unknown): string | null { if(Array.isArray(v)) return firstString(v[0]); return typeof v==="string"&&v.trim()?v.trim():null; }
function sha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest)).map((x)=>x.toString(16).padStart(2,"0")).join(""));
}
function parseCoordinate(point: Obj): Point | null {
  const lat=Number(point["@_lat"]); const lon=Number(point["@_lon"]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180) return null;
  const eleRaw=firstString(point.ele);
  const ele=eleRaw===null?null:Number(eleRaw);
  return {
    lat,lon,ele:Number.isFinite(ele)&&ele! >= -500&&ele! <= 9000?ele:null,
    name:firstString(point.name)?.slice(0,180)??null,
    type:firstString(point.type)?.slice(0,80)??null,
  };
}
function segmentPoints(v: unknown): Point[] {
  return asArray(v).map(obj).filter((x):x is Obj=>x!==null).map(parseCoordinate).filter((x):x is Point=>x!==null);
}
function haversine(a: Point,b: Point): number {
  const rad=(x:number)=>x*Math.PI/180;
  const dLat=rad(b.lat-a.lat); const dLon=rad(b.lon-a.lon);
  const lat1=rad(a.lat); const lat2=rad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function parseGpx(gpxText:string): ParsedGpx {
  if(gpxText.length===0||gpxText.length>MAX_BYTES) throw new HttpError(413,"GPX_SIZE_INVALID");
  if(/<!DOCTYPE|<!ENTITY/i.test(gpxText)) throw new HttpError(422,"GPX_DTD_NOT_ALLOWED");
  const valid=XMLValidator.validate(gpxText);
  if(valid!==true) throw new HttpError(422,"GPX_XML_INVALID");
  let root:Obj;
  try { root=obj(parser.parse(gpxText))??{}; } catch { throw new HttpError(422,"GPX_XML_INVALID"); }
  const gpx=obj(root.gpx);
  if(!gpx) throw new HttpError(422,"GPX_ROOT_REQUIRED");

  const candidates:RouteCandidate[]=[];
  const fileWarnings:string[]=[];
  let totalPoints=0;
  let totalSegments=0;

  const buildCandidate = (
    name:string|null,
    sourceType:"track"|"route",
    segments:Point[][],
    candidateWarnings:string[],
  ) => {
    const pointCount=segments.reduce((total,segment)=>total+segment.length,0);
    if(pointCount<2) return;
    totalPoints+=pointCount;
    totalSegments+=segments.length;
    if(totalPoints>MAX_POINTS) throw new HttpError(413,"GPX_TOO_MANY_POINTS");
    let distance=0; let gain=0; let elevationPairs=0;
    for(const segment of segments){
      for(let i=1;i<segment.length;i++){
        distance+=haversine(segment[i-1],segment[i]);
        const e1=segment[i-1].ele; const e2=segment[i].ele;
        if(e1!==null&&e2!==null){ elevationPairs++; if(e2>e1) gain+=e2-e1; }
      }
    }
    if(!elevationPairs) candidateWarnings.push("Data elevasi rute ini tidak cukup untuk menghitung kenaikan elevasi.");
    const coordinates=segments.map(segment=>segment.map(point=>[point.lon,point.lat]));
    candidates.push({
      index:candidates.length,
      name:name?.trim().slice(0,180) || null,
      sourceType,
      geojson:{type:"MultiLineString",coordinates},
      segments:coordinates,
      points:pointCount,
      segmentCount:segments.length,
      distanceM:Math.round(distance),
      elevationGainM:elevationPairs?Math.round(gain):null,
      warnings:[...new Set(candidateWarnings)].slice(0,20),
    });
  };

  // Preserve every GPX track as a separate candidate (its segments stay connected).
  const tracks=asArray(gpx.trk).map(obj).filter((track):track is Obj=>track!==null);
  for(const [trackIndex,track] of tracks.entries()){
    const candidateWarnings:string[]=[];
    const segments:Point[][]=[];
    const trackSegments=asArray(track.trkseg).map(obj).filter((segment):segment is Obj=>segment!==null);
    for(const [segmentIndex,trackSegment] of trackSegments.entries()){
      const points=segmentPoints(trackSegment.trkpt);
      if(points.length>=2) segments.push(points);
      else if(points.length===1) candidateWarnings.push("Bagian " + (segmentIndex+1) + " hanya memiliki satu titik dan diabaikan.");
    }
    if(segments.length) buildCandidate(firstString(track.name) ?? ("Rute jalur " + (trackIndex+1)), "track", segments, candidateWarnings);
  }

  // Do not discard <rte> elements just because the same file also contains <trk>.
  const routes=asArray(gpx.rte).map(obj).filter((route):route is Obj=>route!==null);
  for(const [routeIndex,route] of routes.entries()){
    const points=segmentPoints(route.rtept);
    if(points.length>=2){
      buildCandidate(firstString(route.name) ?? ("Rute alternatif " + (routeIndex+1)), "route", [points], []);
    } else if(points.length===1) {
      fileWarnings.push("Rute alternatif " + (routeIndex+1) + " hanya memiliki satu titik dan diabaikan.");
    }
  }

  if(!candidates.length) throw new HttpError(422,"GPX_HAS_NO_ROUTE_SEGMENTS");
  if(candidates.length>100) throw new HttpError(413,"GPX_TOO_MANY_ROUTE_CANDIDATES");

  const waypoints=asArray(gpx.wpt).map(obj).filter((point):point is Obj=>point!==null).map(parseCoordinate)
    .filter((point):point is Point=>point!==null && Boolean(point.name)).slice(0,2000)
    .map((point,index)=>({
      sequence_number:index,
      code:null,
      name:point.name,
      checkpoint_type:"waypoint",
      description:point.type ? "Jenis sumber GPX: " + point.type : null,
      latitude:point.lat,longitude:point.lon,elevation_m:point.ele,
      origin:"gpx_waypoint_pending_review",
    }));
  if(!waypoints.length&&asArray(gpx.wpt).length) fileWarnings.push("GPX memiliki waypoint, tetapi tidak ada waypoint bernama yang dapat diajukan sebagai kandidat titik penting.");
  const first=candidates[0];
  const warnings=[...new Set([...fileWarnings,...candidates.flatMap(candidate=>candidate.warnings)])].slice(0,30);
  return {
    geojson:first.geojson,
    segments:first.segments,
    points:totalPoints,
    segmentCount:totalSegments,
    distanceM:first.distanceM,
    elevationGainM:first.elevationGainM,
    routeCandidates:candidates,
    waypoints,
    warnings,
  };
}
async function authenticate(request:Request,service:ReturnType<typeof createClient>) {
  const match=(request.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i);
  if(!match) throw new HttpError(401,"AUTHENTICATION_REQUIRED");
  const {data,error}=await service.auth.getUser(match[1]);
  if(error||!data.user) throw new HttpError(401,"INVALID_SESSION");
  const {data:admin,error:adminError}=await service.from("akun_admin").select("akun_admin_id,role,status")
    .eq("auth_user_id",data.user.id).eq("status","active").maybeSingle();
  if(adminError) throw new HttpError(500,"ADMIN_IDENTITY_LOOKUP_FAILED");
  if(!admin||admin.role!=="super_admin") throw new HttpError(403,"SUPER_ADMIN_REQUIRED");
  return admin as {akun_admin_id:string;role:string;status:string};
}
async function addAudit(service:ReturnType<typeof createClient>,adminId:string,action:string,targetId:string,details:Obj){
  const {error}=await service.from("hiking_admin_audit").insert({
    actor_admin_id:adminId,action,target_type:"route_import",target_id:targetId,safe_details:details,
  });
  if(error) console.error("hiking route audit insert failed",error.code??"DB_ERROR");
}

async function handleRequest(request: Request): Promise<Response> {
  if(request.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
  const serviceUrl=Deno.env.get("SUPABASE_URL"); const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceUrl||!serviceKey) return json({error:"SERVER_CONFIGURATION_MISSING"},500);
  const service=createClient(serviceUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
  let admin:{akun_admin_id:string;role:string;status:string};
  try { admin=await authenticate(request,service); }
  catch(error){return json({error:error instanceof HttpError?error.message:"AUTHENTICATION_FAILED"},error instanceof HttpError?error.status:500);}

  try {
    if((request.headers.get("content-type")??"").toLowerCase().includes("multipart/form-data")){
      const form=await request.formData();
      const fileValue=form.get("file");
      if(!(fileValue instanceof File)) throw new HttpError(400,"GPX_FILE_REQUIRED");
      const file=fileValue;
      if(file.size<20||file.size>MAX_BYTES) throw new HttpError(413,"GPX_SIZE_INVALID");
      const originalName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").replace(/^\.+/,"").slice(-120);
      if(!originalName.toLowerCase().endsWith(".gpx")) throw new HttpError(415,"GPX_EXTENSION_REQUIRED");
      const trailId=String(form.get("trail_id")??"");
      const sourceId=String(form.get("source_id")??"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trailId)) throw new HttpError(400,"INVALID_TRAIL_ID");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) throw new HttpError(400,"INVALID_SOURCE_ID");

      const {data:trail,error:trailError}=await service.from("hiking_trails").select("trail_id,slug,name").eq("trail_id",trailId).maybeSingle();
      if(trailError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
      if(!trail) throw new HttpError(404,"TRAIL_NOT_FOUND");
      const {data:source,error:sourceError}=await service.from("hiking_data_sources")
        .select("source_id,code,name,permission_status,is_active,source_url")
        .eq("source_id",sourceId).maybeSingle();
      if(sourceError) throw new HttpError(500,"SOURCE_LOOKUP_FAILED");
      if(!source||source.is_active!==true) throw new HttpError(409,"SOURCE_INACTIVE");

      const bytes=new Uint8Array(await file.arrayBuffer());
      const decoded=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
      if(!decoded.trim().startsWith("<?xml")&&!decoded.trim().startsWith("<gpx")&&!decoded.trim().startsWith("<")) throw new HttpError(422,"GPX_CONTENT_INVALID");
      const parsed=parseGpx(decoded);
      const importId=crypto.randomUUID();
      const path=`${trailId}/${importId}/${originalName}`;
      const {error:uploadError}=await service.storage.from(BUCKET).upload(path,new Blob([bytes as BlobPart],{type:"application/gpx+xml"}),{
        contentType:"application/gpx+xml",upsert:false,cacheControl:"0",
      });
      if(uploadError) throw new HttpError(500,"GPX_STORAGE_UPLOAD_FAILED");
      const hash=await sha256(bytes);
      const validationReport={
        parser:"gpx-v2-multi-route",valid_xml:true,geometry_valid:true,
        point_count:parsed.points,segment_count:parsed.segmentCount,
        route_candidate_count:parsed.routeCandidates.length,
        route_candidates:parsed.routeCandidates.map((candidate)=>({
          index:candidate.index,name:candidate.name,source_type:candidate.sourceType,
          point_count:candidate.points,segment_count:candidate.segmentCount,
          distance_m:candidate.distanceM,elevation_gain_m:candidate.elevationGainM,
          warnings:candidate.warnings,
        })),
        waypoint_candidate_count:parsed.waypoints.length,warnings:parsed.warnings,
        source_permission_status_at_upload:source.permission_status,
        note:"Parser validation is structural only; each candidate route must be selected and its source permissions reviewed before applying.",
      };
      const {data:imp,error:insertError}=await service.from("hiking_route_imports").insert({
        import_id:importId,trail_id:trailId,source_id:sourceId,bucket_id:BUCKET,storage_path:path,
        original_filename:originalName,content_sha256:hash,file_format:"gpx",license_review_status:"pending",
        import_status:"validated",point_count:parsed.points,segment_count:parsed.segmentCount,
        calculated_distance_m:parsed.routeCandidates.length===1?parsed.routeCandidates[0].distanceM:null,validation_report:validationReport,imported_by_admin_id:admin.akun_admin_id,
      }).select("import_id,trail_id,original_filename,content_sha256,license_review_status,import_status,point_count,segment_count,calculated_distance_m,created_at").single();
      if(insertError){
        await service.storage.from(BUCKET).remove([path]);
        throw new HttpError(409,"GPX_IMPORT_RECORD_FAILED");
      }
      await addAudit(service,admin.akun_admin_id,"upload_gpx_route",importId,{
        point_count:parsed.points,segment_count:parsed.segmentCount,distance_m:parsed.distanceM,source_id:sourceId,
      });
      return json({
        ok:true,import:imp,preview:{
          geojson:parsed.geojson,
          routeCandidates:parsed.routeCandidates.map((candidate)=>({
            index:candidate.index,name:candidate.name,sourceType:candidate.sourceType,
            geojson:candidate.geojson,points:candidate.points,segmentCount:candidate.segmentCount,
            distanceM:candidate.distanceM,elevationGainM:candidate.elevationGainM,warnings:candidate.warnings,
          })),
          waypointCandidates:parsed.waypoints,distanceM:parsed.distanceM,elevationGainM:parsed.elevationGainM,warnings:parsed.warnings,
        },
        nextStep:parsed.routeCandidates.length>1
          ?"Pilih satu rute dari pratinjau, lalu tinjau izin penggunaan sebelum menerapkan. Rute lain tetap tidak diubah."
          :"Tinjau izin penggunaan file dan tautan sumber spesifik sebelum menerapkan. Rute belum diterapkan ke jalur publik.",
      },201);
    }

    const raw=await request.text();
    if(raw.length>100_000) throw new HttpError(413,"REQUEST_TOO_LARGE");
    let body:unknown;try{body=JSON.parse(raw)}catch{throw new HttpError(400,"INVALID_JSON")}
    if(!obj(body)) throw new HttpError(400,"INVALID_BODY");
    const importId=typeof body.import_id==="string"?body.import_id:"";
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importId)) throw new HttpError(400,"INVALID_IMPORT_ID");
    if(body.action!=="apply") throw new HttpError(400,"UNKNOWN_ACTION");

    const {data:imp,error:impError}=await service.from("hiking_route_imports")
      .select("import_id,trail_id,source_id,bucket_id,storage_path,source_reference_url,source_version,license_review_status,import_status,content_sha256,validation_report,calculated_distance_m")
      .eq("import_id",importId).maybeSingle();
    if(impError) throw new HttpError(500,"IMPORT_LOOKUP_FAILED");
    if(!imp) throw new HttpError(404,"IMPORT_NOT_FOUND");
    if(imp.import_status==="accepted") throw new HttpError(409,"IMPORT_ALREADY_ACCEPTED");
    if(imp.import_status==="rejected") throw new HttpError(409,"IMPORT_REJECTED");
    if(!["approved","not_required"].includes(imp.license_review_status)||!imp.source_reference_url) throw new HttpError(409,"LICENSE_REVIEW_REQUIRED");
    if(imp.bucket_id!==BUCKET||!imp.storage_path.startsWith(`${imp.trail_id}/`)) throw new HttpError(409,"IMPORT_STORAGE_PATH_INVALID");
    const {data:source,error:sourceError}=await service.from("hiking_data_sources").select("source_id,permission_status,is_active")
      .eq("source_id",imp.source_id).maybeSingle();
    if(sourceError) throw new HttpError(500,"SOURCE_LOOKUP_FAILED");
    if(!source||source.is_active!==true||!["verified_open","permission_granted"].includes(source.permission_status)) throw new HttpError(409,"SOURCE_PERMISSION_NOT_CLEARED");

    const {data:file,error:downloadError}=await service.storage.from(BUCKET).download(imp.storage_path);
    if(downloadError||!file) throw new HttpError(500,"GPX_STORAGE_DOWNLOAD_FAILED");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const hash=await sha256(bytes);
    if(hash.toLowerCase()!==String(imp.content_sha256??"").toLowerCase()) throw new HttpError(409,"GPX_HASH_MISMATCH");
    const decoded=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
    const parsed=parseGpx(decoded);
    const routeIndexRaw=body.route_index;
    const routeIndex=routeIndexRaw===undefined?0:Number(routeIndexRaw);
    if(!Number.isSafeInteger(routeIndex)||routeIndex<0||routeIndex>=parsed.routeCandidates.length) {
      throw new HttpError(400,"INVALID_ROUTE_CANDIDATE");
    }
    const selectedRoute=parsed.routeCandidates[routeIndex];
    const {data:routeVersionId,error:applyError}=await service.rpc("hiking_admin_accept_route_import",{
      p_import_id:importId,p_route_geojson:selectedRoute.geojson,p_distance_m:selectedRoute.distanceM,
      p_elevation_gain_m:selectedRoute.elevationGainM,p_source_reference_url:imp.source_reference_url,
      p_source_version:imp.source_version??null,p_checkpoint_snapshot:parsed.waypoints,
      p_validation_report:{
        parser:"gpx-v2-multi-route",valid_xml:true,geometry_valid:true,
        selected_route_index:selectedRoute.index,selected_route_name:selectedRoute.name,selected_route_type:selectedRoute.sourceType,
        route_candidate_count:parsed.routeCandidates.length,
        point_count:selectedRoute.points,segment_count:selectedRoute.segmentCount,
        distance_m:selectedRoute.distanceM,elevation_gain_m:selectedRoute.elevationGainM,
        waypoint_candidate_count:parsed.waypoints.length,warnings:selectedRoute.warnings,content_sha256:hash,
      },
      p_review_note:typeof body.review_note==="string"?body.review_note.slice(0,2000):null,
      p_actor_admin_id:admin.akun_admin_id,
    });
    if(applyError) throw new HttpError(409,"ROUTE_APPLY_FAILED");
    await addAudit(service,admin.akun_admin_id,"apply_gpx_route",importId,{
      route_version_id:routeVersionId,route_index:selectedRoute.index,
      point_count:selectedRoute.points,segment_count:selectedRoute.segmentCount,distance_m:selectedRoute.distanceM,
    });
    return json({
      ok:true,import_id:importId,route_version_id:routeVersionId,
      route_index:selectedRoute.index,route_name:selectedRoute.name,route_candidate_count:parsed.routeCandidates.length,
      point_count:selectedRoute.points,segment_count:selectedRoute.segmentCount,distance_m:selectedRoute.distanceM,
      elevation_gain_m:selectedRoute.elevationGainM,publication_status:"draft",
      nextStep:"Rute terpilih disimpan sebagai draf. Rute lain dalam berkas tidak diterapkan; tinjau titik penting sebelum publikasi.",
    });
  } catch(error) {
    const status=error instanceof HttpError?error.status:500;
    const code=error instanceof HttpError?error.message:"INTERNAL_ERROR";
    if(status===500) console.error("hiking-route-import failed",code);
    return json({error:code},status);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" } });
  }
  return withRestrictedCors(await handleRequest(request), request);
});
