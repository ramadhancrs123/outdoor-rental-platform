import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownToLine, Check, CheckCircle2, ChevronRight,
  CloudSun, Compass, FileImage, FileUp, Info, LoaderCircle, MapPin, Mountain, Plus, RefreshCw,
  Save, Search, ShieldAlert, Sparkles, Waypoints, Wind, X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { HikingMapCanvas } from "@/features/pendakian/map-canvas";
import {
  applyGpxRoute, getHikingForecast, getHikingOverview, listHikingResource, saveHikingAction,
  uploadGpxRoute, uploadHikingMedia,
} from "@/features/pendakian/service";
import type { GpxPreview, HikingEntity, HikingList, HikingOverview, HikingResource, MapPoint } from "@/features/pendakian/types";
import { entityId, generatedMountainCode, numberValue, slugify } from "@/features/pendakian/utils";

type EntityKind = "mountain" | "trail";
type WorkspaceTab = "workspace" | "keselamatan" | "media" | "sumber" | "pengaturan";
type MountainForm = {
  code: string; slug: string; name: string; aliases: string; description: string; elevation_m: string;
  province: string; regency: string; latitude: string; longitude: string; is_volcanic: boolean;
  volcanic_status: string; volcanic_status_source_id: string; volcanic_status_source_url: string;
  volcanic_status_checked_at: string; operator_id: string; primary_source_id: string; source_reference_url: string;
};
type TrailForm = {
  mountain_id: string; code: string; slug: string; name: string; description: string; operator_id: string;
  basecamp_name: string; basecamp_address: string; basecamp_latitude: string; basecamp_longitude: string;
  distance_m: string; elevation_gain_m: string; estimated_duration_minutes: string; difficulty_grade: string;
  difficulty_grade_status: string; difficulty_grade_source_id: string; difficulty_grade_source_url: string;
  daily_quota: string; quota_source_url: string; route_source_id: string; route_source_reference_url: string;
  operational_status: string;
};
type CheckpointForm = { name: string; code: string; sequence_number: string; checkpoint_type: string; description: string; latitude: string; longitude: string; elevation_m: string; source_id: string; source_reference_url: string };
type SourceForm = { code: string; name: string; source_type: string; source_url: string; attribution_text: string; license_name: string; license_url: string; permission_status: string; is_public: boolean; is_active: boolean; notes: string };
type AdvisoryForm = { mountain_id: string; trail_id: string; advisory_type: string; severity: string; title: string; description: string; instruction: string; source_id: string; source_url: string; official_source: boolean; starts_at: string; expires_at: string };
type OperatorForm = { code: string; name: string; operator_type: string; province: string; regency: string; address: string; public_phone: string; public_email: string; website_url: string; official_booking_url: string; source_id: string; source_reference_url: string };
type MediaDraft = { file: File | null; source_id: string; source_reference_url: string; media_type: string; alt_text: string; caption: string };
type PendingRoute = { importId: string; preview: GpxPreview; fileName: string; applied: boolean; selectedRouteIndex: number };
type ResultRecord = { ok: true; action: string; result: HikingEntity; bookingEnabled?: false };

const emptyMountain = (): MountainForm => ({
  code: "", slug: "", name: "", aliases: "", description: "", elevation_m: "", province: "", regency: "",
  latitude: "", longitude: "", is_volcanic: false, volcanic_status: "unknown", volcanic_status_source_id: "",
  volcanic_status_source_url: "", volcanic_status_checked_at: "", operator_id: "", primary_source_id: "",
  source_reference_url: "",
});
const emptyTrail = (mountainId = ""): TrailForm => ({
  mountain_id: mountainId, code: "", slug: "", name: "", description: "", operator_id: "", basecamp_name: "",
  basecamp_address: "", basecamp_latitude: "", basecamp_longitude: "", distance_m: "", elevation_gain_m: "",
  estimated_duration_minutes: "", difficulty_grade: "", difficulty_grade_status: "not_assessed",
  difficulty_grade_source_id: "", difficulty_grade_source_url: "", daily_quota: "", quota_source_url: "",
  route_source_id: "", route_source_reference_url: "", operational_status: "unknown",
});
const emptyCheckpoint = (sequence = 0): CheckpointForm => ({
  name: "", code: "", sequence_number: String(sequence), checkpoint_type: "waypoint", description: "",
  latitude: "", longitude: "", elevation_m: "", source_id: "", source_reference_url: "",
});
const emptySource = (): SourceForm => ({
  code: "", name: "", source_type: "official_agency", source_url: "", attribution_text: "",
  license_name: "", license_url: "", permission_status: "unknown", is_public: false, is_active: true, notes: "",
});
const emptyAdvisory = (): AdvisoryForm => ({
  mountain_id: "", trail_id: "", advisory_type: "other", severity: "info", title: "", description: "",
  instruction: "", source_id: "", source_url: "", official_source: false,
  starts_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16), expires_at: "",
});
const emptyOperator = (): OperatorForm => ({
  code: "", name: "", operator_type: "other", province: "", regency: "", address: "", public_phone: "",
  public_email: "", website_url: "", official_booking_url: "", source_id: "", source_reference_url: "",
});
const emptyMedia = (): MediaDraft => ({ file: null, source_id: "", source_reference_url: "", media_type: "cover", alt_text: "", caption: "" });

const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof Mountain }> = [
  { id: "workspace", label: "Data & peta", icon: Mountain },
  { id: "keselamatan", label: "Keselamatan", icon: ShieldAlert },
  { id: "media", label: "Foto", icon: FileImage },
  { id: "sumber", label: "Sumber", icon: Info },
  { id: "pengaturan", label: "Status sistem", icon: Activity },
];

function valueOf(record: HikingEntity | null | undefined, key: string, fallback = ""): string {
  const value = record?.[key];
  return value === null || value === undefined ? fallback : String(value);
}
function boolOf(record: HikingEntity | null | undefined, key: string): boolean {
  return record?.[key] === true;
}
function isPublished(record: HikingEntity | null | undefined): boolean {
  return record?.publication_status === "published";
}
function sourceHasClearPermission(source: HikingEntity | null | undefined): boolean {
  return Boolean(source?.is_active !== false && ["verified_open", "permission_granted"].includes(String(source?.permission_status)));
}
function labelOfStatus(status: unknown): string {
  const labels: Record<string, string> = {
    draft: "Draf", pending_review: "Menunggu pemeriksaan", published: "Ditampilkan", archived: "Diarsipkan",
    open: "Dibuka", closed: "Ditutup", limited: "Akses terbatas", temporarily_suspended: "Ditangguhkan sementara",
    unknown: "Belum diketahui", unverified: "Belum diverifikasi", verified: "Terverifikasi", rejected: "Ditolak",
    verified_open: "Penggunaan terbuka terverifikasi", permission_granted: "Izin diberikan",
    permission_required: "Memerlukan izin", restricted: "Penggunaan dibatasi",
  };
  return labels[String(status)] ?? String(status ?? "Belum diketahui").replaceAll("_", " ");
}
function badgeTone(status: unknown): "default" | "secondary" | "outline" | "destructive" {
  const value = String(status ?? "");
  if (["published", "open", "verified", "verified_open", "permission_granted"].includes(value)) return "default";
  if (["closed", "temporarily_suspended", "rejected", "restricted", "critical", "warning"].includes(value)) return "destructive";
  if (["draft", "unknown", "unverified", "permission_required", "pending_review", "pending"].includes(value)) return "secondary";
  return "outline";
}
function intOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function dateToInput(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Tindakan belum berhasil. Silakan periksa kembali.";
}
function Field({ label, children, hint, required = false }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return <div className="min-w-0 space-y-1.5"><Label className="text-xs font-medium">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>{children}{hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}</div>;
}
function SelectInput({ value, onChange, options, placeholder, disabled = false }: {
  value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string; disabled?: boolean;
}) {
  return (
    <select
      value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p> : null}</div>{action}</div>;
}
function CountCard({ title, value, detail, icon: Icon }: { title: string; value: number; detail: string; icon: typeof Mountain }) {
  return <Card className="rounded-2xl shadow-none"><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-xs font-medium text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p></div><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><Icon className="size-5" /></span></CardContent></Card>;
}
function StatusPill({ status }: { status: unknown }) {
  return <Badge variant={badgeTone(status)} className="whitespace-nowrap">{labelOfStatus(status)}</Badge>;
}

export function PendakianWorkspace() {
  const initialSelectionDone = useRef(false);
  const [overview, setOverview] = useState<HikingOverview | null>(null);
  const [mountains, setMountains] = useState<HikingEntity[]>([]);
  const [trails, setTrails] = useState<HikingEntity[]>([]);
  const [checkpoints, setCheckpoints] = useState<HikingEntity[]>([]);
  const [sources, setSources] = useState<HikingEntity[]>([]);
  const [weatherAreas, setWeatherAreas] = useState<HikingEntity[]>([]);
  const [mountainMappings, setMountainMappings] = useState<HikingEntity[]>([]);
  const [trailMappings, setTrailMappings] = useState<HikingEntity[]>([]);
  const [advisories, setAdvisories] = useState<HikingEntity[]>([]);
  const [routeImports, setRouteImports] = useState<HikingEntity[]>([]);
  const [routeVersions, setRouteVersions] = useState<HikingEntity[]>([]);
  const [media, setMedia] = useState<HikingEntity[]>([]);
  const [operators, setOperators] = useState<HikingEntity[]>([]);
  const [weatherAlerts, setWeatherAlerts] = useState<HikingEntity[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("workspace");
  const [entityKind, setEntityKind] = useState<EntityKind>("mountain");
  const [selectedMountainId, setSelectedMountainId] = useState<string | null>(null);
  const [selectedTrailId, setSelectedTrailId] = useState<string | null>(null);
  const [mountainForm, setMountainForm] = useState<MountainForm>(emptyMountain);
  const [trailForm, setTrailForm] = useState<TrailForm>(emptyTrail());
  const [checkpointForm, setCheckpointForm] = useState<CheckpointForm>(emptyCheckpoint());
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySource);
  const [advisoryForm, setAdvisoryForm] = useState<AdvisoryForm>(emptyAdvisory);
  const [operatorForm, setOperatorForm] = useState<OperatorForm>(emptyOperator);
  const [mediaDraft, setMediaDraft] = useState<MediaDraft>(emptyMedia);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [routeSourceId, setRouteSourceId] = useState("");
  const [routeReferenceUrl, setRouteReferenceUrl] = useState("");
  const [routeReviewNote, setRouteReviewNote] = useState("Sumber dan izin penggunaan rute sudah diperiksa.");
  const [routeFile, setRouteFile] = useState<File | null>(null);
  const [pendingRoute, setPendingRoute] = useState<PendingRoute | null>(null);
  const [createdWaypointIndexes, setCreatedWaypointIndexes] = useState<number[]>([]);
  const [mapPickMode, setMapPickMode] = useState(false);
  const [mapPickTarget, setMapPickTarget] = useState<"mountain" | "basecamp" | "checkpoint">("mountain");
  const [mapPicked, setMapPicked] = useState<MapPoint | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [forecast, setForecast] = useState<unknown>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const refreshWorkspace = useCallback(async () => {
    const [o, m, t, c, s, w, mm, tm, a, ri, rv, md, ops, alerts] = await Promise.all([
      getHikingOverview(),
      listHikingResource("mountains", { pageSize: 100 }),
      listHikingResource("trails", { pageSize: 100 }),
      listHikingResource("checkpoints", { pageSize: 100 }),
      listHikingResource("sources", { pageSize: 100 }),
      listHikingResource("weatherAreas", { pageSize: 100, is_active: true }),
      listHikingResource("mountainWeatherMappings", { pageSize: 100 }),
      listHikingResource("trailWeatherMappings", { pageSize: 100 }),
      listHikingResource("advisories", { pageSize: 100 }),
      listHikingResource("routeImports", { pageSize: 100 }),
      listHikingResource("routeVersions", { pageSize: 100 }),
      listHikingResource("media", { pageSize: 100 }),
      listHikingResource("operators", { pageSize: 100 }),
      listHikingResource("weatherAlerts", { pageSize: 100 }),
    ]);
    setOverview(o);
    setMountains(m.items);
    setTrails(t.items);
    setCheckpoints(c.items);
    setSources(s.items);
    setWeatherAreas(w.items);
    setMountainMappings(mm.items);
    setTrailMappings(tm.items);
    setAdvisories(a.items);
    setRouteImports(ri.items);
    setRouteVersions(rv.items);
    setMedia(md.items);
    setOperators(ops.items);
    setWeatherAlerts(alerts.items);
    setLoadError(null);
    setPageNotice(null);
    return { mountains: m.items, trails: t.items, sources: s.items };
  }, []);

  useEffect(() => {
    let alive = true;
    void refreshWorkspace().then((data) => {
      if (!alive) return;
      if (!initialSelectionDone.current) {
        setSelectedMountainId(data.mountains[0] ? String(data.mountains[0].mountain_id) : null);
        const preferredSource = data.sources.find(sourceHasClearPermission) ?? data.sources[0] ?? null;
        setRouteSourceId(preferredSource ? String(preferredSource.source_id) : "");
        setRouteReferenceUrl(preferredSource ? valueOf(preferredSource, "source_url") : "");
        setSelectedSourceId(preferredSource ? String(preferredSource.source_id) : "");
        initialSelectionDone.current = true;
      }
    }).catch((error: unknown) => {
      if (alive) setLoadError(errorText(error));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [refreshWorkspace]); // selection defaults are only assigned for the first successful read

  const selectedMountain = useMemo(
    () => mountains.find((item) => String(item.mountain_id) === selectedMountainId) ?? null,
    [mountains, selectedMountainId],
  );
  const selectedTrail = useMemo(
    () => trails.find((item) => String(item.trail_id) === selectedTrailId) ?? null,
    [trails, selectedTrailId],
  );
  const currentMountainId = entityKind === "trail" ? valueOf(selectedTrail ?? undefined, "mountain_id", trailForm.mountain_id) : selectedMountainId ?? "";
  const currentMountain = mountains.find((item) => String(item.mountain_id) === currentMountainId) ?? selectedMountain;
  const activeEntity = entityKind === "trail" ? selectedTrail : selectedMountain;
  const currentEntityId = entityKind === "trail" ? selectedTrailId : selectedMountainId;
  const selectedMapMappings = entityKind === "trail" ? trailMappings : mountainMappings;
  const currentMapping = selectedMapMappings.find((mapping) =>
    String(mapping[entityKind === "trail" ? "trail_id" : "mountain_id"]) === String(currentEntityId)
      && mapping.is_primary === true
  ) ?? null;
  const currentWeatherArea = weatherAreas.find((area) => String(area.weather_area_id) === String(currentMapping?.weather_area_id)) ?? null;
  const filteredMountains = mountains.filter((mountain) =>
    [mountain.name, mountain.code, mountain.province, mountain.regency].some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase()))
  );
  const linkedTrails = trails.filter((trail) => String(trail.mountain_id) === String(selectedMountainId));
  const activeFlags = overview?.featureFlags ?? [];
  const catalogEnabled = activeFlags.some((flag) => flag.flag_key === "public_hiking_catalog_enabled" && flag.is_enabled);
  const clearSources = sources.filter(sourceHasClearPermission);
  const currentPublicationStatus = activeEntity?.publication_status;
  const currentCenter = entityKind === "trail"
    ? (numberValue(trailForm.basecamp_latitude) !== null && numberValue(trailForm.basecamp_longitude) !== null
      ? { latitude: Number(trailForm.basecamp_latitude), longitude: Number(trailForm.basecamp_longitude) }
      : (numberValue(currentMountain?.latitude) !== null && numberValue(currentMountain?.longitude) !== null
        ? { latitude: Number(currentMountain?.latitude), longitude: Number(currentMountain?.longitude) } : null))
    : (numberValue(mountainForm.latitude) !== null && numberValue(mountainForm.longitude) !== null
      ? { latitude: Number(mountainForm.latitude), longitude: Number(mountainForm.longitude) } : null);
  const mapPoints = useMemo(() => {
    const output: Array<MapPoint & { kind?: string }> = [];
    for (const mountain of mountains) {
      const isCurrentDraft = entityKind === "mountain" && String(mountain.mountain_id) === String(selectedMountainId);
      const latitude = isCurrentDraft ? numberValue(mountainForm.latitude) : numberValue(mountain.latitude);
      const longitude = isCurrentDraft ? numberValue(mountainForm.longitude) : numberValue(mountain.longitude);
      if (latitude !== null && longitude !== null) {
        output.push({
          latitude, longitude,
          label: isCurrentDraft ? (mountainForm.name || String(mountain.name ?? "Gunung")) : String(mountain.name ?? "Gunung"),
          kind: "mountain",
        });
      }
    }
    if (entityKind === "mountain" && !selectedMountainId
      && numberValue(mountainForm.latitude) !== null && numberValue(mountainForm.longitude) !== null) {
      output.push({
        latitude: Number(mountainForm.latitude), longitude: Number(mountainForm.longitude),
        label: mountainForm.name || "Gunung baru", kind: "mountain",
      });
    }
    if (entityKind === "trail") {
      if (numberValue(trailForm.basecamp_latitude) !== null && numberValue(trailForm.basecamp_longitude) !== null) {
        output.push({ latitude: Number(trailForm.basecamp_latitude), longitude: Number(trailForm.basecamp_longitude), label: "Basecamp", kind: "basecamp" });
      }
      for (const point of checkpoints.filter((checkpoint) => String(checkpoint.trail_id) === String(selectedTrailId))) {
        if (numberValue(point.latitude) !== null && numberValue(point.longitude) !== null) {
          output.push({ latitude: Number(point.latitude), longitude: Number(point.longitude), label: String(point.name ?? "Titik"), kind: String(point.checkpoint_type ?? "checkpoint") });
        }
      }
    }
    return output;
  }, [entityKind, mountains, mountainForm.latitude, mountainForm.longitude, mountainForm.name, selectedMountainId, trailForm.basecamp_latitude, trailForm.basecamp_longitude, checkpoints, selectedTrailId]);

  const selectedRouteCandidate = pendingRoute?.preview.routeCandidates?.find(
    (candidate) => candidate.index === pendingRoute.selectedRouteIndex,
  ) ?? null;
  const selectedRouteGeoJson = selectedRouteCandidate?.geojson ?? pendingRoute?.preview.geojson ?? selectedTrail?.route_geojson;
  const selectedRouteDistanceM = selectedRouteCandidate?.distanceM ?? pendingRoute?.preview.distanceM ?? null;
  const selectedRouteElevationGainM = selectedRouteCandidate?.elevationGainM ?? pendingRoute?.preview.elevationGainM ?? null;
  const selectedRoutePointCount = selectedRouteCandidate?.points
    ?? pendingRoute?.preview.geojson.coordinates.reduce((sum, segment) => sum + segment.length, 0)
    ?? 0;
  const selectedRouteSegmentCount = selectedRouteCandidate?.segmentCount
    ?? pendingRoute?.preview.geojson.coordinates.length
    ?? 0;
  const selectedRouteWarnings = selectedRouteCandidate?.warnings ?? pendingRoute?.preview.warnings ?? [];
  const routeCandidateCount = pendingRoute?.preview.routeCandidates?.length ?? 1;
  const currentCheckpoints = checkpoints.filter((checkpoint) => String(checkpoint.trail_id) === String(selectedTrailId));

  useEffect(() => {
    if (entityKind === "mountain") {
      if (selectedMountain) {
        setMountainForm({
          code: valueOf(selectedMountain, "code"), slug: valueOf(selectedMountain, "slug"), name: valueOf(selectedMountain, "name"),
          aliases: Array.isArray(selectedMountain.aliases) ? (selectedMountain.aliases as string[]).join(", ") : "",
          description: valueOf(selectedMountain, "description"), elevation_m: valueOf(selectedMountain, "elevation_m"),
          province: valueOf(selectedMountain, "province"), regency: valueOf(selectedMountain, "regency"),
          latitude: valueOf(selectedMountain, "latitude"), longitude: valueOf(selectedMountain, "longitude"),
          is_volcanic: boolOf(selectedMountain, "is_volcanic"), volcanic_status: valueOf(selectedMountain, "volcanic_status", "unknown"),
          volcanic_status_source_id: valueOf(selectedMountain, "volcanic_status_source_id"),
          volcanic_status_source_url: valueOf(selectedMountain, "volcanic_status_source_url"),
          volcanic_status_checked_at: dateToInput(selectedMountain.volcanic_status_checked_at),
          operator_id: valueOf(selectedMountain, "operator_id"), primary_source_id: valueOf(selectedMountain, "primary_source_id"),
          source_reference_url: valueOf(selectedMountain, "source_reference_url"),
        });
      } else if (!selectedMountainId) {
        setMountainForm(emptyMountain());
      }
    }
  }, [entityKind, selectedMountain, selectedMountainId]);

  useEffect(() => {
    if (entityKind === "trail") {
      if (selectedTrail) {
        setTrailForm({
          mountain_id: valueOf(selectedTrail, "mountain_id"), code: valueOf(selectedTrail, "code"), slug: valueOf(selectedTrail, "slug"),
          name: valueOf(selectedTrail, "name"), description: valueOf(selectedTrail, "description"), operator_id: valueOf(selectedTrail, "operator_id"),
          basecamp_name: valueOf(selectedTrail, "basecamp_name"), basecamp_address: valueOf(selectedTrail, "basecamp_address"),
          basecamp_latitude: valueOf(selectedTrail, "basecamp_latitude"), basecamp_longitude: valueOf(selectedTrail, "basecamp_longitude"),
          distance_m: valueOf(selectedTrail, "distance_m"), elevation_gain_m: valueOf(selectedTrail, "elevation_gain_m"),
          estimated_duration_minutes: valueOf(selectedTrail, "estimated_duration_minutes"), difficulty_grade: valueOf(selectedTrail, "difficulty_grade"),
          difficulty_grade_status: valueOf(selectedTrail, "difficulty_grade_status", "not_assessed"),
          difficulty_grade_source_id: valueOf(selectedTrail, "difficulty_grade_source_id"),
          difficulty_grade_source_url: valueOf(selectedTrail, "difficulty_grade_source_url"),
          daily_quota: valueOf(selectedTrail, "daily_quota"), quota_source_url: valueOf(selectedTrail, "quota_source_url"),
          route_source_id: valueOf(selectedTrail, "route_source_id"), route_source_reference_url: valueOf(selectedTrail, "route_source_reference_url"),
          operational_status: valueOf(selectedTrail, "operational_status", "unknown"),
        });
        setCheckpointForm((current) => ({ ...current, sequence_number: String(currentCheckpoints.length) }));
      } else {
        setTrailForm(emptyTrail(selectedMountainId ?? ""));
      }
    }
  }, [entityKind, selectedTrail, selectedTrailId, selectedMountainId, currentCheckpoints.length]);

  useEffect(() => {
    if (activeTab !== "workspace") return;
    setForecast(null);
    setForecastError(null);
    if (!activeEntity || activeEntity.publication_status !== "published") return;
    const slug = valueOf(activeEntity, "slug");
    if (!slug) return;
    let alive = true;
    setForecastLoading(true);
    void getHikingForecast(entityKind, slug).then((result) => {
      if (alive) setForecast(result);
    }).catch((error: unknown) => {
      if (alive) setForecastError(errorText(error));
    }).finally(() => {
      if (alive) setForecastLoading(false);
    });
    return () => { alive = false; };
  }, [activeTab, activeEntity, entityKind]);

  const perform = async (action: string, payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await saveHikingAction<ResultRecord>(action, payload);
      return response.result;
    } catch (error) {
      toast.error(errorText(error));
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const refreshAfterSave = async (message: string) => {
    await refreshWorkspace();
    toast.success(message);
  };

  const updateMountain = (key: keyof MountainForm, value: string | boolean) => {
    setMountainForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && typeof value === "string" && !selectedMountainId) {
        next.code = generatedMountainCode(value);
        next.slug = slugify(value);
      }
      if (key === "primary_source_id" && typeof value === "string") {
        const source = sources.find((item) => String(item.source_id) === value);
        if (source) next.source_reference_url = valueOf(source, "source_url") || next.source_reference_url;
      }
      return next;
    });
  };
  const updateTrail = (key: keyof TrailForm, value: string) => {
    setTrailForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !selectedTrailId) next.slug = slugify(value);
      if (key === "route_source_id") {
        const source = sources.find((item) => String(item.source_id) === value);
        if (source) next.route_source_reference_url = valueOf(source, "source_url") || next.route_source_reference_url;
      }
      return next;
    });
  };

  const saveMountain = async (): Promise<HikingEntity | null> => {
    if (!mountainForm.name.trim()) { toast.error("Nama gunung wajib diisi."); return null; }
    if (selectedMountain && isPublished(selectedMountain) && !window.confirm("Menyimpan perubahan pada gunung yang sudah ditampilkan akan mengembalikannya ke draf dan menghapus status verifikasi. Lanjutkan?")) return null;
    const saved = await perform("upsert_mountain", {
      mountain_id: selectedMountainId,
      code: mountainForm.code || generatedMountainCode(mountainForm.name),
      slug: mountainForm.slug || slugify(mountainForm.name),
      name: mountainForm.name.trim(),
      aliases: mountainForm.aliases.split(",").map((value) => value.trim()).filter(Boolean),
      description: mountainForm.description || null,
      elevation_m: intOrNull(mountainForm.elevation_m),
      province: mountainForm.province || null, regency: mountainForm.regency || null,
      latitude: numberValue(mountainForm.latitude), longitude: numberValue(mountainForm.longitude),
      is_volcanic: mountainForm.is_volcanic,
      volcanic_status: mountainForm.is_volcanic ? mountainForm.volcanic_status : "not_applicable",
      volcanic_status_source_id: mountainForm.is_volcanic ? (mountainForm.volcanic_status_source_id || null) : null,
      volcanic_status_source_url: mountainForm.is_volcanic ? (mountainForm.volcanic_status_source_url || null) : null,
      volcanic_status_checked_at: mountainForm.is_volcanic && mountainForm.volcanic_status_checked_at
        ? new Date(mountainForm.volcanic_status_checked_at).toISOString() : null,
      operator_id: mountainForm.operator_id || null, primary_source_id: mountainForm.primary_source_id || null,
      source_reference_url: mountainForm.source_reference_url || null,
    });
    if (!saved) return null;
    const id = entityId(saved, "mountain");
    if (id) { setEntityKind("mountain"); setSelectedMountainId(id); setSelectedTrailId(null); }
    const weatherMapping = saved.weather_mapping && typeof saved.weather_mapping === "object"
      ? saved.weather_mapping as Record<string, unknown> : null;
    await refreshAfterSave(weatherMapping?.status === "mapped"
      ? "Draf gunung tersimpan. Wilayah cuaca berhasil dipetakan otomatis."
      : weatherMapping?.status === "already_mapped"
        ? "Draf gunung tersimpan. Pemetaan cuaca yang sudah ada tetap dipertahankan."
        : "Draf gunung tersimpan. Lokasi cuaca belum cukup meyakinkan dan akan tetap menunggu pemeriksaan.");
    return saved;
  };

  const saveTrail = async (): Promise<HikingEntity | null> => {
    if (!trailForm.mountain_id || !trailForm.name.trim()) { toast.error("Pilih gunung dan isi nama jalur."); return null; }
    if (selectedTrail && isPublished(selectedTrail) && !window.confirm("Menyimpan perubahan pada jalur yang sudah ditampilkan akan mengembalikannya ke draf dan menghapus status verifikasi. Lanjutkan?")) return null;
    const saved = await perform("upsert_trail", {
      trail_id: selectedTrailId,
      mountain_id: trailForm.mountain_id,
      code: trailForm.code || null, slug: trailForm.slug || slugify(trailForm.name),
      name: trailForm.name.trim(), description: trailForm.description || null,
      operator_id: trailForm.operator_id || null,
      basecamp_name: trailForm.basecamp_name || null, basecamp_address: trailForm.basecamp_address || null,
      basecamp_latitude: numberValue(trailForm.basecamp_latitude), basecamp_longitude: numberValue(trailForm.basecamp_longitude),
      distance_m: intOrNull(trailForm.distance_m), elevation_gain_m: intOrNull(trailForm.elevation_gain_m),
      estimated_duration_minutes: intOrNull(trailForm.estimated_duration_minutes),
      difficulty_grade: intOrNull(trailForm.difficulty_grade),
      difficulty_grade_status: trailForm.difficulty_grade_status,
      difficulty_grade_source_id: trailForm.difficulty_grade_source_id || null,
      difficulty_grade_source_url: trailForm.difficulty_grade_source_url || null,
      daily_quota: intOrNull(trailForm.daily_quota), quota_source_url: trailForm.quota_source_url || null,
    });
    if (!saved) return null;
    const id = entityId(saved, "trail");
    if (id) { setEntityKind("trail"); setSelectedTrailId(id); setSelectedMountainId(trailForm.mountain_id); }
    const weatherMapping = saved.weather_mapping && typeof saved.weather_mapping === "object"
      ? saved.weather_mapping as Record<string, unknown> : null;
    await refreshAfterSave(weatherMapping?.status === "mapped"
      ? "Draf jalur tersimpan. Wilayah cuaca basecamp berhasil dipetakan otomatis."
      : weatherMapping?.status === "already_mapped"
        ? "Draf jalur tersimpan. Pemetaan cuaca yang sudah ada tetap dipertahankan."
        : "Draf jalur tersimpan. Wilayah cuaca belum cukup meyakinkan dan akan tetap menunggu pemeriksaan.");
    return saved;
  };

  const publishMountain = async () => {
    const saved = await saveMountain();
    const id = saved ? entityId(saved, "mountain") : selectedMountainId;
    if (!id) return;
    if (!mountainForm.primary_source_id || !mountainForm.source_reference_url) {
      toast.error("Pilih sumber gunung dan tautan rujukannya sebelum verifikasi."); return;
    }
    try {
      await perform("verify_mountain", {
        mountain_id: id, source_id: mountainForm.primary_source_id, source_reference_url: mountainForm.source_reference_url,
      });
      await perform("publish_mountain", { mountain_id: id });
      await refreshAfterSave("Gunung berhasil diverifikasi dan ditampilkan.");
    } catch (error) {
      setPageNotice(errorText(error));
    }
  };

  const publishTrail = async () => {
    const saved = await saveTrail();
    const id = saved ? entityId(saved, "trail") : selectedTrailId;
    if (!id) return;
    const sourceId = trailForm.route_source_id;
    const sourceUrl = trailForm.route_source_reference_url;
    if (!sourceId || !sourceUrl) { toast.error("Terapkan rute GPX dan pilih sumber rute terlebih dahulu."); setActiveTab("workspace"); return; }
    try {
      await perform("verify_trail", { trail_id: id, source_id: sourceId, source_reference_url: sourceUrl });
      await perform("publish_trail", { trail_id: id });
      await refreshAfterSave("Jalur berhasil diverifikasi dan ditampilkan.");
    } catch (error) {
      setPageNotice(errorText(error));
    }
  };

  const saveCheckpoint = async () => {
    if (!selectedTrailId) { toast.error("Pilih atau buat jalur terlebih dahulu."); setActiveTab("workspace"); return; }
    if (!checkpointForm.name.trim() || checkpointForm.latitude === "" || checkpointForm.longitude === "") { toast.error("Nama dan lokasi titik wajib diisi."); setActiveTab("workspace"); setMapPickTarget("checkpoint"); setMapPickMode(true); return; }
    const sourceId = checkpointSourceId();
    const sourceUrl = checkpointSourceUrl();
    if (!sourceId || !sourceUrl) { toast.error("Sistem belum memiliki sumber rujukan yang bisa digunakan. Lengkapi sumber sekali pada bagian Sumber."); setActiveTab("sumber"); return; }
    await perform("upsert_checkpoint", {
      trail_id: selectedTrailId, name: checkpointForm.name.trim(), code: checkpointForm.code || null,
      sequence_number: intOrNull(checkpointForm.sequence_number) ?? currentCheckpoints.length,
      checkpoint_type: checkpointForm.checkpoint_type, description: checkpointForm.description || null,
      latitude: numberValue(checkpointForm.latitude), longitude: numberValue(checkpointForm.longitude),
      elevation_m: intOrNull(checkpointForm.elevation_m), source_id: sourceId,
      source_reference_url: sourceUrl,
    });
    setCheckpointForm(emptyCheckpoint(currentCheckpoints.length + 1));
    await refreshAfterSave("Titik penting disimpan sebagai draf.");
  };

  const verifyAndPublishCheckpoint = async (checkpoint: HikingEntity) => {
    const id = entityId(checkpoint, "checkpoint");
    if (!id) return;
    try {
      await perform("publish_checkpoint", { checkpoint_id: id });
      await refreshAfterSave("Titik penting sudah ditampilkan.");
    } catch (error) { setPageNotice(errorText(error)); }
  };

  const saveSource = async () => {
    if (!sourceForm.name.trim() || !sourceForm.code.trim()) { toast.error("Nama dan kode sumber wajib diisi."); return; }
    const result = await perform("upsert_source", {
      code: sourceForm.code.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""),
      name: sourceForm.name.trim(), source_type: sourceForm.source_type, source_url: sourceForm.source_url || null,
      attribution_text: sourceForm.attribution_text || null, license_name: sourceForm.license_name || null,
      license_url: sourceForm.license_url || null, permission_status: sourceForm.permission_status,
      is_public: sourceForm.is_public, is_active: sourceForm.is_active, notes: sourceForm.notes || null,
    });
    const id = entityId(result, "source");
    if (id) { setSelectedSourceId(id); setRouteSourceId(id); }
    setSourceForm(emptySource());
    await refreshAfterSave("Sumber informasi tersimpan.");
  };

  const saveOperator = async () => {
    if (!operatorForm.name.trim()) { toast.error("Nama pengelola wajib diisi."); return; }
    const result = await perform("upsert_operator", {
      code: operatorForm.code || null, name: operatorForm.name.trim(), operator_type: operatorForm.operator_type,
      province: operatorForm.province || null, regency: operatorForm.regency || null, address: operatorForm.address || null,
      public_phone: operatorForm.public_phone || null, public_email: operatorForm.public_email || null,
      website_url: operatorForm.website_url || null, official_booking_url: operatorForm.official_booking_url || null,
      source_id: operatorForm.source_id || null, source_reference_url: operatorForm.source_reference_url || null,
    });
    if (result) setOperatorForm(emptyOperator());
    await refreshAfterSave("Data pengelola tersimpan sebagai belum diverifikasi.");
  };

  const publishAdvisory = async () => {
    if (!advisoryForm.title.trim() || !advisoryForm.description.trim() || !advisoryForm.source_id || !advisoryForm.source_url) {
      toast.error("Judul, penjelasan, dan sumber peringatan wajib diisi."); return;
    }
    if (Boolean(advisoryForm.mountain_id) === Boolean(advisoryForm.trail_id)) {
      toast.error("Pilih gunung atau jalur sebagai sasaran peringatan."); return;
    }
    const result = await perform("save_advisory", {
      mountain_id: advisoryForm.mountain_id || null, trail_id: advisoryForm.trail_id || null,
      advisory_type: advisoryForm.advisory_type, severity: advisoryForm.severity,
      title: advisoryForm.title.trim(), description: advisoryForm.description.trim(),
      instruction: advisoryForm.instruction || null, source_id: advisoryForm.source_id, source_url: advisoryForm.source_url,
      official_source: advisoryForm.official_source,
      starts_at: advisoryForm.starts_at ? new Date(advisoryForm.starts_at).toISOString() : new Date().toISOString(),
      expires_at: advisoryForm.expires_at ? new Date(advisoryForm.expires_at).toISOString() : null,
    });
    const id = entityId(result, "advisory");
    if (id) {
      try {
        await perform("publish_advisory", { advisory_id: id });
        setAdvisoryForm(emptyAdvisory());
        await refreshAfterSave("Peringatan keselamatan berhasil diterbitkan.");
      } catch (error) { setPageNotice(errorText(error)); }
    }
  };

  const uploadRoute = async () => {
    if (!routeFile || !selectedTrailId || !routeSourceId) { toast.error("Pilih jalur, sumber, dan berkas GPX."); return; }
    const selectedSource = sources.find((source) => String(source.source_id) === routeSourceId);
    const effectiveSourceUrl = routeReferenceUrl.trim() || valueOf(selectedSource, "source_url");
    if (!effectiveSourceUrl) { toast.error("Sumber belum memiliki tautan rujukan. Pilih atau perbaiki sumber terlebih dahulu."); return; }
    const result = await uploadGpxRoute(routeFile, selectedTrailId, routeSourceId, effectiveSourceUrl);
    setPendingRoute({ importId: String(result.import.import_id), preview: result.preview, fileName: routeFile.name, applied: false, selectedRouteIndex: 0 });
    setCreatedWaypointIndexes([]);
    setRouteFile(null);
    setPageNotice(null);
    toast.success("Rute berhasil diperiksa. Periksa pratinjau dan izin penggunaan sebelum diterapkan.");
  };

  const reviewAndApplyRoute = async () => {
    if (!pendingRoute || pendingRoute.applied) return;
    const selectedSource = sources.find((source) => String(source.source_id) === routeSourceId);
    if (!sourceHasClearPermission(selectedSource)) { toast.error("Sumber rute harus sudah memiliki izin penggunaan yang jelas."); return; }
    if (!routeReferenceUrl.trim()) { toast.error("Isi tautan sumber rute yang spesifik."); return; }
    await perform("review_route_import", {
      import_id: pendingRoute.importId, license_review_status: "approved",
      source_reference_url: routeReferenceUrl, review_note: routeReviewNote || "Izin penggunaan sudah diperiksa melalui panel admin.",
    });
    const applied = await applyGpxRoute(pendingRoute.importId, routeReviewNote, pendingRoute.selectedRouteIndex);
    setPendingRoute({ ...pendingRoute, applied: true });
    setTrailForm((current) => ({
      ...current,
      distance_m: String(applied.distance_m),
      elevation_gain_m: applied.elevation_gain_m === null ? current.elevation_gain_m : String(applied.elevation_gain_m),
      route_source_id: routeSourceId,
      route_source_reference_url: routeReferenceUrl,
    }));
    setPageNotice("Rute diterapkan sebagai draf. " + applied.point_count.toLocaleString("id-ID") + " titik dari GPX sudah dibaca.");
    await refreshWorkspace();
    toast.success("Rute dan versi rute tersimpan. Publikasi tetap terpisah.");
  };

  const createCheckpointFromCandidate = async (candidate: GpxPreview["waypointCandidates"][number], index: number) => {
    if (!selectedTrailId) { toast.error("Pilih jalur terlebih dahulu."); return; }
    const sourceId = checkpointSourceId();
    const sourceUrl = checkpointSourceUrl();
    if (!sourceId || !sourceUrl) { toast.error("Tambahkan sumber rujukan pada bagian Sumber terlebih dahulu."); setActiveTab("sumber"); return; }
    await perform("upsert_checkpoint", {
      trail_id: selectedTrailId, name: candidate.name, code: null, sequence_number: currentCheckpoints.length,
      checkpoint_type: candidate.checkpoint_type || "waypoint", description: candidate.description,
      latitude: candidate.latitude, longitude: candidate.longitude, elevation_m: candidate.elevation_m,
      source_id: sourceId, source_reference_url: sourceUrl,
    });
    setCreatedWaypointIndexes((current) => [...current, index]);
    await refreshAfterSave(`Titik “${candidate.name}” disimpan sebagai draf.`);
  };

  const uploadMedia = async () => {
    if (!mediaDraft.file || !mediaDraft.source_id || !mediaDraft.source_reference_url || !mediaDraft.alt_text.trim()) {
      toast.error("Pilih berkas, sumber, tautan sumber, dan deskripsi gambar."); return;
    }
    if (entityKind === "trail" && !selectedTrailId) return;
    if (entityKind === "mountain" && !selectedMountainId) { toast.error("Simpan data gunung terlebih dahulu."); return; }
    await uploadHikingMedia({
      file: mediaDraft.file, mountainId: entityKind === "mountain" ? selectedMountainId ?? undefined : undefined,
      trailId: entityKind === "trail" ? selectedTrailId ?? undefined : undefined,
      sourceId: mediaDraft.source_id, sourceReferenceUrl: mediaDraft.source_reference_url,
      mediaType: mediaDraft.media_type, altText: mediaDraft.alt_text, caption: mediaDraft.caption,
    });
    setMediaDraft(emptyMedia());
    await refreshAfterSave("Foto tersimpan sebagai draf dan belum tampil ke publik.");
  };

  const mapPick = (point: MapPoint) => {
    setMapPicked(point);
    if (mapPickTarget === "mountain") {
      updateMountain("latitude", String(point.latitude.toFixed(6)));
      updateMountain("longitude", String(point.longitude.toFixed(6)));
    } else if (mapPickTarget === "basecamp") {
      updateTrail("basecamp_latitude", String(point.latitude.toFixed(6)));
      updateTrail("basecamp_longitude", String(point.longitude.toFixed(6)));
    } else {
      setCheckpointForm((current) => ({ ...current, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) }));
    }
    setMapPickMode(false);
    toast.success("Koordinat dipilih dari peta. Simpan formulir untuk menerapkannya.");
  };

  const activateMapPickTarget = (target: "mountain" | "basecamp" | "checkpoint") => {
    setMapPickTarget(target);
    setMapPickMode(true);
    window.setTimeout(() => {
      document.getElementById("hiking-map-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const checkpointSource = () =>
    sources.find((source) => String(source.source_id) === (routeSourceId || trailForm.route_source_id))
    ?? sources.find((source) => String(source.source_id) === mountainForm.primary_source_id)
    ?? sources.find(sourceHasClearPermission)
    ?? sources[0]
    ?? null;

  const checkpointSourceId = () =>
    routeSourceId || trailForm.route_source_id || mountainForm.primary_source_id
    || (checkpointSource() ? String(checkpointSource()?.source_id) : "");

  const checkpointSourceUrl = () =>
    routeReferenceUrl || trailForm.route_source_reference_url || mountainForm.source_reference_url
    || valueOf(checkpointSource(), "source_url");

  const reload = async () => {
    setLoading(true);
    try { await refreshWorkspace(); }
    catch (error) { setLoadError(errorText(error)); }
    finally { setLoading(false); }
  };

  if (loading) {
    return <div className="space-y-5 p-1"><div className="space-y-2"><div className="h-5 w-32 animate-pulse rounded bg-muted" /><div className="h-8 w-64 animate-pulse rounded bg-muted" /></div><div className="grid grid-cols-3 gap-2 sm:gap-3">{[0,1,2].map((value) => <div key={value} className="h-20 animate-pulse rounded-2xl border bg-muted/30" />)}</div><div className="h-[500px] animate-pulse rounded-2xl border bg-muted/30" /></div>;
  }
  if (loadError) {
    return <div className="space-y-4"><header><p className="text-sm font-medium text-primary">Pusat pengelolaan</p><h1 className="text-2xl font-semibold">Pendakian</h1></header><Alert variant="destructive" className="rounded-2xl"><AlertCircle className="size-4" /><AlertTitle>Data pendakian belum dapat dibuka</AlertTitle><AlertDescription className="space-y-3"><p>{loadError}</p><p className="text-xs">Layanan tidak menjawab permintaan data. Coba ulangi; bila tetap gagal, periksa sesi super admin dan koneksi jaringan.</p><Button size="sm" variant="outline" onClick={() => void reload()}><RefreshCw className="mr-2 size-4" />Coba lagi</Button></AlertDescription></Alert></div>;
  }

  const currentSource = sources.find((source) => String(source.source_id) === selectedSourceId) ?? null;
  const currentTrailSource = sources.find((source) => String(source.source_id) === routeSourceId) ?? null;
  const mountainReadyCount = [
    Boolean(mountainForm.name.trim()),
    numberValue(mountainForm.latitude) !== null && numberValue(mountainForm.longitude) !== null,
    Boolean(mountainForm.primary_source_id && mountainForm.source_reference_url
      && sourceHasClearPermission(sources.find((source) => String(source.source_id) === mountainForm.primary_source_id))),
  ].filter(Boolean).length;
  const trailReadyCount = [
    Boolean(trailForm.name.trim() && trailForm.mountain_id),
    Boolean(selectedTrail?.route_geojson),
    Boolean(trailForm.route_source_id && trailForm.route_source_reference_url
      && sourceHasClearPermission(sources.find((source) => String(source.source_id) === trailForm.route_source_id))),
  ].filter(Boolean).length;
  const volcanicSource = sources.find((source) => String(source.source_id) === mountainForm.volcanic_status_source_id);
  const volcanicCheckedAt = mountainForm.volcanic_status_checked_at ? new Date(mountainForm.volcanic_status_checked_at).getTime() : Number.NaN;
  const volcanicStatusReady = !mountainForm.is_volcanic || mountainForm.volcanic_status === "unknown" || (
    Boolean(volcanicSource && volcanicSource.source_type === "official_agency" && sourceHasClearPermission(volcanicSource))
    && Boolean(mountainForm.volcanic_status_source_url)
    && Number.isFinite(volcanicCheckedAt)
    && volcanicCheckedAt <= Date.now() + 60_000
    && Date.now() - volcanicCheckedAt <= 24 * 60 * 60 * 1000
  );
  const routeHistoryForTrail = routeVersions.filter((version) => String(version.trail_id) === String(selectedTrailId));
  const importsForTrail = routeImports.filter((routeImport) => String(routeImport.trail_id) === String(selectedTrailId));
  const mediaForTarget = media.filter((item) => entityKind === "trail"
    ? String(item.trail_id) === String(selectedTrailId)
    : String(item.mountain_id) === String(selectedMountainId));

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Akasha Outdoor · Pusat pengelolaan</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">Pendakian</h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">Kelola gunung, jalur, peta, dan informasi keselamatan dalam satu ruang kerja. Sistem menangani pemeriksaan teknis di belakang layar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={catalogEnabled ? "default" : "secondary"} className="h-7 rounded-lg px-2.5">{catalogEnabled ? "Katalog aktif" : "Mode persiapan"}</Badge>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void reload()} disabled={saving}><RefreshCw className="mr-2 size-4" />Perbarui data</Button>
        </div>
      </header>

      {pageNotice ? <Alert className="rounded-2xl"><Info className="size-4" /><AlertTitle>Status tindakan</AlertTitle><AlertDescription>{pageNotice}</AlertDescription><button type="button" aria-label="Tutup pesan" className="absolute right-3 top-3 text-muted-foreground" onClick={() => setPageNotice(null)}><X className="size-4" /></button></Alert> : null}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <CountCard title="Gunung" value={overview?.counts.mountains ?? mountains.length} detail="Destinasi" icon={Mountain} />
        <CountCard title="Jalur" value={overview?.counts.trails ?? trails.length} detail="Rute" icon={Compass} />
        <CountCard title="Titik" value={overview?.counts.checkpoints ?? checkpoints.length} detail="Pos & basecamp" icon={Waypoints} />
      </div>

      {!catalogEnabled ? (
        <Alert className="rounded-2xl border-primary/15 bg-primary/[0.03]"><Info className="size-4 text-primary" /><AlertTitle>Katalog publik masih dalam tahap persiapan</AlertTitle><AlertDescription>Data dapat disiapkan dan diperiksa di sini. Sistem tidak akan menampilkan konten kepada pengguna publik sebelum rilis diaktifkan secara terpisah. Pemesanan dan pembayaran tiket tetap terkunci.</AlertDescription></Alert>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="overflow-hidden rounded-2xl shadow-none">
          <CardHeader className="space-y-3 border-b bg-muted/15 p-4">
            <div className="flex items-center justify-between gap-2"><CardTitle className="text-sm font-semibold">Gunung & jalur</CardTitle><Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Tambah gunung" onClick={() => { setEntityKind("mountain"); setSelectedMountainId(null); setSelectedTrailId(null); setMountainForm(emptyMountain()); setActiveTab("workspace"); }}><Plus className="size-4" /></Button></div>
            <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari gunung atau wilayah" className="h-9 rounded-xl pl-9 text-sm" /></div>
            <Button onClick={() => { setEntityKind("mountain"); setSelectedMountainId(null); setSelectedTrailId(null); setMountainForm(emptyMountain()); setActiveTab("workspace"); }} variant="outline" size="sm" className="w-full rounded-xl"><Plus className="mr-2 size-4" />Tambah gunung</Button>
          </CardHeader>
          <CardContent className="max-h-[72vh] space-y-1 overflow-y-auto p-2">
            {filteredMountains.map((mountain) => {
              const mountainId = String(mountain.mountain_id);
              const active = entityKind === "mountain" && selectedMountainId === mountainId;
              const childTrails = linkedTrails.filter((trail) => String(trail.mountain_id) === mountainId);
              return (
                <div key={mountainId} className="space-y-1">
                  <button type="button" onClick={() => { setEntityKind("mountain"); setSelectedMountainId(mountainId); setSelectedTrailId(null); setPendingRoute(null); setMapPicked(null); }}
                    className={`flex w-full items-start gap-2 rounded-xl p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary/8 text-foreground ring-1 ring-primary/20" : "hover:bg-muted/60"}`}>
                    <Mountain className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{String(mountain.name ?? "Gunung tanpa nama")}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{[mountain.regency, mountain.province].filter(Boolean).join(", ") || "Lokasi belum lengkap"}</span></span>
                    <StatusPill status={mountain.publication_status} />
                  </button>
                  {active || String(selectedMountainId) === mountainId ? childTrails.map((trail) => {
                    const trailId = String(trail.trail_id);
                    const activeTrail = entityKind === "trail" && selectedTrailId === trailId;
                    return <button key={trailId} type="button" onClick={() => { setEntityKind("trail"); setSelectedMountainId(mountainId); setSelectedTrailId(trailId); setMapPicked(null); }}
                      className={`ml-4 flex w-[calc(100%-1rem)] items-start gap-2 rounded-lg px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTrail ? "bg-primary/8 ring-1 ring-primary/20" : "hover:bg-muted/60"}`}>
                      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs font-medium">{String(trail.name ?? "Jalur tanpa nama")}</span><StatusPill status={trail.publication_status} />
                    </button>;
                  }) : null}
                </div>
              );
            })}
            {entityKind === "mountain" && !selectedMountainId ? <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground"><Sparkles className="mb-2 size-4 text-primary" />Data gunung baru. Lengkapi informasi di panel kanan lalu simpan sebagai draf.</div> : null}
            {!filteredMountains.length ? <div className="px-4 py-8 text-center"><Mountain className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">Belum ada gunung</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Mulai dari menambahkan satu destinasi.</p><Button size="sm" variant="outline" className="mt-3 rounded-xl" onClick={() => { setEntityKind("mountain"); setSelectedMountainId(null); setSelectedTrailId(null); setActiveTab("workspace"); }}><Plus className="mr-2 size-3.5" />Tambah gunung</Button></div> : null}
            {selectedMountainId && entityKind === "mountain" ? <Button variant="outline" size="sm" className="mt-2 w-full rounded-xl" onClick={() => { setEntityKind("trail"); setSelectedTrailId(null); setTrailForm(emptyTrail(selectedMountainId)); setActiveTab("workspace"); }}><Plus className="mr-2 size-4" />Tambah jalur untuk gunung ini</Button> : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="rounded-lg">{entityKind === "trail" ? "Jalur pendakian" : "Destinasi gunung"}</Badge>{activeEntity ? <StatusPill status={activeEntity.publication_status} /> : <Badge variant="secondary">Draf baru</Badge>}</div>
                <h2 className="mt-2 truncate text-xl font-semibold tracking-tight">{entityKind === "trail" ? trailForm.name || "Jalur baru" : mountainForm.name || "Gunung baru"}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{entityKind === "trail" ? `Induk: ${String(currentMountain?.name ?? "Pilih gunung")}` : [mountainForm.regency, mountainForm.province].filter(Boolean).join(", ") || "Lokasi belum diisi"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {entityKind === "mountain" ? <Button onClick={() => void saveMountain()} disabled={saving} className="rounded-xl">{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}Simpan draf</Button> : <Button onClick={() => void saveTrail()} disabled={saving || !trailForm.mountain_id} className="rounded-xl">{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}Simpan draf</Button>}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/40 p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Kelengkapan data</span><span className="text-xs font-semibold">{entityKind === "trail" ? trailReadyCount : mountainReadyCount}/3</span></div><Progress value={(entityKind === "trail" ? trailReadyCount : mountainReadyCount) / 3 * 100} className="mt-2 h-1.5" /><p className="mt-2 text-[11px] text-muted-foreground">Ringkasan nama, lokasi, dan sumber; ketinggian opsional jika belum diketahui. Backend tetap memeriksa persyaratan publikasi.</p></div>
              <div className="rounded-xl bg-muted/40 p-3"><div className="flex items-center gap-2 text-xs font-medium"><CloudSun className="size-4 text-primary" />Cuaca dikelola otomatis</div><p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{currentMapping ? `Terhubung ke ${String(currentWeatherArea?.village_name ?? "wilayah referensi")}. Prakiraan menggunakan data wilayah BMKG.` : "Tidak perlu memasukkan kode BMKG. Pemetaan otomatis tampil di sini ketika layanan backend menemukan wilayah referensi yang sesuai."}</p></div>
            </div>
          </div>

          <nav aria-label="Bagian pengelolaan pendakian" className="overflow-x-auto rounded-2xl border bg-card p-1.5">
            <div className="flex min-w-max gap-1">
              {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tab.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className="size-4" />{tab.label}</button>; })}
            </div>
          </nav>

          {activeTab === "workspace" ? (
            entityKind === "mountain" ? (
              <Card className="rounded-2xl shadow-none">
                <CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Informasi gunung" description="Isi yang diketahui. Kode internal dan alamat nama dibuat otomatis; data yang belum pasti dapat dibiarkan kosong." /></CardHeader>
                <CardContent className="space-y-5 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nama gunung" required><Input value={mountainForm.name} onChange={(e) => updateMountain("name", e.target.value)} placeholder="Contoh: Gunung Gede" className="rounded-xl" /></Field>
                    <Field label="Ketinggian (opsional)" hint="Boleh kosong jika belum ada sumber yang meyakinkan."><Input type="number" min={0} max={9000} value={mountainForm.elevation_m} onChange={(e) => updateMountain("elevation_m", e.target.value)} placeholder="Meter, jika diketahui" className="rounded-xl" /></Field>
                  </div>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Informasi tambahan (opsional)</summary>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Field label="Provinsi"><Input value={mountainForm.province} onChange={(e) => updateMountain("province", e.target.value)} placeholder="Terisi saat diketahui" className="rounded-xl" /></Field>
                      <Field label="Kabupaten / kota"><Input value={mountainForm.regency} onChange={(e) => updateMountain("regency", e.target.value)} placeholder="Terisi saat diketahui" className="rounded-xl" /></Field>
                      <Field label="Nama lain"><Input value={mountainForm.aliases} onChange={(e) => updateMountain("aliases", e.target.value)} placeholder="Nama lokal atau populer, jika ada" className="rounded-xl" /></Field>
                      <Field label="Pengelola"><SelectInput value={mountainForm.operator_id} onChange={(value) => updateMountain("operator_id", value)} placeholder="Pilih jika diketahui" options={operators.map((op) => ({ value: String(op.operator_id), label: String(op.name ?? "Pengelola") }))} /></Field>
                      <div className="sm:col-span-2"><Field label="Deskripsi"><Textarea value={mountainForm.description} onChange={(e) => updateMountain("description", e.target.value)} rows={3} placeholder="Informasi tambahan, bila tersedia" className="resize-y rounded-xl" /></Field></div>
                      <Field label="Kode internal"><Input value={mountainForm.code} readOnly aria-readonly="true" placeholder="Dibuat otomatis" className="rounded-xl bg-muted/40 font-mono text-xs" /></Field>
                      <Field label="Alamat halaman"><Input value={mountainForm.slug} readOnly aria-readonly="true" placeholder="Dibuat otomatis dari nama" className="rounded-xl bg-muted/40 font-mono text-xs" /></Field>
                      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm sm:col-span-2">
                        <input type="checkbox" checked={mountainForm.is_volcanic} onChange={(event) => updateMountain("is_volcanic", event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                        <span><span className="font-medium">Gunung berapi</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Aktifkan bila status aktivitas vulkanik perlu ditampilkan.</span></span>
                      </label>
                    </div>
                  </details>
                  <Separator />
                  <SectionHeading title="Lokasi pada peta" description="Klik tombol pilih lokasi, lalu klik titik gunung di peta. Koordinat akan terisi otomatis." action={<Button variant="outline" size="sm" className="rounded-xl" onClick={() => activateMapPickTarget("mountain") }><MapPin className="mr-2 size-4" />Pilih di peta</Button>} />
                  <div className="flex flex-col gap-2 rounded-xl border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{mountainForm.latitude && mountainForm.longitude ? "Titik gunung telah dipilih" : "Pilih lokasi gunung di peta"}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{mountainForm.latitude && mountainForm.longitude ? Number(mountainForm.latitude).toFixed(6) + ", " + Number(mountainForm.longitude).toFixed(6) : "Koordinat akan diisi dari pin peta."}</p>
                    </div>
                    <Button variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => activateMapPickTarget("mountain")}><MapPin className="mr-2 size-4" />Pilih titik</Button>
                  </div>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-xs font-medium">Koreksi koordinat manual (opsional)</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Lintang"><Input type="number" step="any" value={mountainForm.latitude} onChange={(e) => updateMountain("latitude", e.target.value)} placeholder="Dari pin peta" className="rounded-xl font-mono text-xs" /></Field>
                      <Field label="Bujur"><Input type="number" step="any" value={mountainForm.longitude} onChange={(e) => updateMountain("longitude", e.target.value)} placeholder="Dari pin peta" className="rounded-xl font-mono text-xs" /></Field>
                    </div>
                  </details>
                  <Separator />
                  <SectionHeading title="Sumber informasi" description="Pilih sumber sekali. Tautannya terisi otomatis dan bisa dikoreksi bila ada halaman yang lebih spesifik." />
                  <Field label="Sumber informasi" required><SelectInput value={mountainForm.primary_source_id} onChange={(value) => updateMountain("primary_source_id", value)} placeholder="Pilih sumber informasi" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name ?? source.code) }))} /></Field>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-xs font-medium">Koreksi tautan sumber (otomatis terisi)</summary>
                    <div className="mt-3"><Field label="Tautan rujukan"><Input type="url" value={mountainForm.source_reference_url} onChange={(e) => updateMountain("source_reference_url", e.target.value)} placeholder="Terisi dari sumber pilihan" className="rounded-xl" /></Field></div>
                  </details>
                  <div className="rounded-xl border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Simpan draf terlebih dahulu. Tombol verifikasi dan publikasi baru dapat berhasil jika sumber sudah memiliki izin penggunaan yang jelas serta informasi wajib telah lengkap.</div>
                  {mountainForm.is_volcanic ? (
                    <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
                      <SectionHeading title="Status aktivitas gunung berapi" description="Pisahkan dari status jalur. Informasi non-normal perlu berasal dari sumber resmi dan masih berlaku." />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Status terbaru"><SelectInput value={mountainForm.volcanic_status} onChange={(value) => updateMountain("volcanic_status", value)} options={[{ value: "unknown", label: "Belum diketahui" }, { value: "normal", label: "Normal" }, { value: "waspada", label: "Waspada" }, { value: "siaga", label: "Siaga" }, { value: "awas", label: "Awas" }]} /></Field>
                        <Field label="Waktu pemeriksaan"><Input type="datetime-local" value={mountainForm.volcanic_status_checked_at} onChange={(e) => updateMountain("volcanic_status_checked_at", e.target.value)} className="rounded-xl" /></Field>
                        <Field label="Sumber resmi status"><SelectInput value={mountainForm.volcanic_status_source_id} onChange={(value) => updateMountain("volcanic_status_source_id", value)} placeholder="Pilih instansi resmi" options={sources.filter((source) => source.source_type === "official_agency" && source.is_active === true).map((source) => ({ value: String(source.source_id), label: String(source.name) }))} /></Field>
                        <Field label="Tautan pemeriksaan terbaru"><Input type="url" value={mountainForm.volcanic_status_source_url} onChange={(e) => updateMountain("volcanic_status_source_url", e.target.value)} placeholder="https://..." className="rounded-xl" /></Field>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
                    <Button variant="outline" className="rounded-xl" disabled={saving || !selectedMountainId || !mountainForm.name.trim() || numberValue(mountainForm.latitude) === null || numberValue(mountainForm.longitude) === null || !mountainForm.primary_source_id || !mountainForm.source_reference_url || !sourceHasClearPermission(sources.find((source) => String(source.source_id) === mountainForm.primary_source_id)) || !volcanicStatusReady} onClick={() => void publishMountain()}>{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}Verifikasi & tampilkan gunung</Button>
                    <Button className="rounded-xl" disabled={saving} onClick={() => void saveMountain()}><Save className="mr-2 size-4" />Simpan draf</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl shadow-none">
                <CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Informasi jalur" description="Data perjalanan dan basecamp. Garis rute dikelola melalui impor GPX pada tab Peta & rute." /></CardHeader>
                <CardContent className="space-y-5 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Gunung induk" required><SelectInput value={trailForm.mountain_id} onChange={(value) => updateTrail("mountain_id", value)} placeholder="Pilih gunung" options={mountains.map((mountain) => ({ value: String(mountain.mountain_id), label: String(mountain.name) }))} /></Field>
                    <Field label="Nama jalur" required><Input value={trailForm.name} onChange={(e) => updateTrail("name", e.target.value)} placeholder="Contoh: Jalur utama" className="rounded-xl" /></Field>
                    <Field label="Basecamp (jika diketahui)"><Input value={trailForm.basecamp_name} onChange={(e) => updateTrail("basecamp_name", e.target.value)} placeholder="Nama basecamp" className="rounded-xl" /></Field>
                  </div>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Detail operasional (opsional)</summary>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Field label="Kode jalur"><Input value={trailForm.code} readOnly aria-readonly="true" placeholder="Dikelola sistem" className="rounded-xl bg-muted/40 font-mono text-xs" /></Field>
                      <Field label="Alamat halaman"><Input value={trailForm.slug} readOnly aria-readonly="true" placeholder="Dibuat otomatis dari nama" className="rounded-xl bg-muted/40 font-mono text-xs" /></Field>
                      <Field label="Pengelola"><SelectInput value={trailForm.operator_id} onChange={(value) => updateTrail("operator_id", value)} placeholder="Pilih jika diketahui" options={operators.map((op) => ({ value: String(op.operator_id), label: String(op.name) }))} /></Field>
                    </div>
                  </details>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Alamat dan catatan tambahan (opsional)</summary>
                    <div className="mt-4 space-y-3">
                  <Field label="Alamat basecamp"><Input value={trailForm.basecamp_address} onChange={(e) => updateTrail("basecamp_address", e.target.value)} placeholder="Alamat atau patokan" className="rounded-xl" /></Field>
                  <Field label="Deskripsi jalur"><Textarea value={trailForm.description} onChange={(e) => updateTrail("description", e.target.value)} rows={3} placeholder="Deskripsi dan informasi akses" className="rounded-xl" /></Field>
                    </div>
                  </details>
                  <SectionHeading title="Lokasi basecamp" description="Ketuk lokasi basecamp di peta di bawah. Sistem memakai titik ini untuk referensi prakiraan wilayah secara otomatis." action={<Button variant="outline" size="sm" className="rounded-xl" onClick={() => activateMapPickTarget("basecamp") }><MapPin className="mr-2 size-4" />Pilih di peta</Button>} />
                  <div className="flex flex-col gap-2 rounded-xl border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{trailForm.basecamp_latitude && trailForm.basecamp_longitude ? "Lokasi basecamp dipilih" : "Pilih titik basecamp di peta"}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{trailForm.basecamp_latitude && trailForm.basecamp_longitude ? Number(trailForm.basecamp_latitude).toFixed(6) + ", " + Number(trailForm.basecamp_longitude).toFixed(6) : "Koordinat akan terisi dari pin peta."}</p>
                    </div>
                    <Button variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => activateMapPickTarget("basecamp")}><MapPin className="mr-2 size-4" />Pilih titik</Button>
                  </div>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-xs font-medium">Koreksi koordinat manual (opsional)</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Lintang basecamp"><Input type="number" step="any" value={trailForm.basecamp_latitude} onChange={(e) => updateTrail("basecamp_latitude", e.target.value)} className="rounded-xl font-mono text-xs" /></Field>
                      <Field label="Bujur basecamp"><Input type="number" step="any" value={trailForm.basecamp_longitude} onChange={(e) => updateTrail("basecamp_longitude", e.target.value)} className="rounded-xl font-mono text-xs" /></Field>
                    </div>
                  </details>
                  <Separator />
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Rincian perjalanan (otomatis dari GPX bila tersedia)</summary>
                    <div className="mt-4 space-y-4">
                  <SectionHeading title="Ringkasan perjalanan" description="Jarak dan kenaikan elevasi dari GPX dapat dihitung saat rute diterapkan. Durasi tetap perlu didukung informasi yang layak." />
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label="Jarak (meter)"><Input type="number" min={0} value={trailForm.distance_m} onChange={(e) => updateTrail("distance_m", e.target.value)} placeholder="Diisi setelah impor rute" className="rounded-xl" /></Field>
                    <Field label="Kenaikan elevasi (meter)"><Input type="number" min={0} value={trailForm.elevation_gain_m} onChange={(e) => updateTrail("elevation_gain_m", e.target.value)} placeholder="Dari data elevasi" className="rounded-xl" /></Field>
                    <Field label="Perkiraan durasi (menit)"><Input type="number" min={1} value={trailForm.estimated_duration_minutes} onChange={(e) => updateTrail("estimated_duration_minutes", e.target.value)} placeholder="Contoh: 300" className="rounded-xl" /></Field>
                    <Field label="Tingkat kesulitan"><SelectInput value={trailForm.difficulty_grade_status} onChange={(value) => updateTrail("difficulty_grade_status", value)} options={[{ value: "not_assessed", label: "Belum dinilai" }, { value: "community_reference", label: "Referensi komunitas" }, { value: "operator_verified", label: "Diverifikasi pengelola" }, { value: "official", label: "Informasi resmi" }]} /></Field>
                    {["official", "operator_verified"].includes(trailForm.difficulty_grade_status) ? <Field label="Nilai tingkat kesulitan (1–5)"><SelectInput value={trailForm.difficulty_grade} onChange={(value) => updateTrail("difficulty_grade", value)} placeholder="Pilih nilai" options={[1,2,3,4,5].map((n) => ({ value: String(n), label: `${n} / 5` }))} /></Field> : <div className="rounded-xl bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">Nilai angka hanya dicatat jika didukung sumber resmi atau diverifikasi pengelola. Sistem tidak akan menganggap perkiraan sebagai nilai resmi.</div>}
                    {["official", "operator_verified"].includes(trailForm.difficulty_grade_status) ? <Field label="Sumber penilaian"><SelectInput value={trailForm.difficulty_grade_source_id} onChange={(value) => updateTrail("difficulty_grade_source_id", value)} placeholder="Pilih sumber" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name) }))} /></Field> : null}
                    {["official", "operator_verified"].includes(trailForm.difficulty_grade_status) ? <Field label="Tautan rujukan penilaian"><Input type="url" value={trailForm.difficulty_grade_source_url} onChange={(e) => updateTrail("difficulty_grade_source_url", e.target.value)} placeholder="https://..." className="rounded-xl" /></Field> : null}
                    <Field label="Kuota harian (opsional)" hint="Isi hanya bila ada informasi kuota yang dapat dipercaya."><Input type="number" min={0} value={trailForm.daily_quota} onChange={(e) => updateTrail("daily_quota", e.target.value)} placeholder="Kosongkan jika belum ada" className="rounded-xl" /></Field>
                    <Field label="Sumber informasi kuota"><Input type="url" value={trailForm.quota_source_url} onChange={(e) => updateTrail("quota_source_url", e.target.value)} placeholder="https://..." className="rounded-xl" /></Field>
                  </div>
                    </div>
                  </details>
                  <div className="rounded-xl border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Status buka/tutup jalur dikelola terpisah pada bagian Keselamatan agar setiap perubahan status memiliki sumber dan riwayat pemeriksaan.</div>
                  <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
                    <Button variant="outline" className="rounded-xl" disabled={saving || !selectedTrailId || !trailForm.name.trim() || !trailForm.mountain_id || !isPublished(currentMountain) || !selectedTrail?.route_geojson || !trailForm.route_source_id || !trailForm.route_source_reference_url || !sourceHasClearPermission(sources.find((source) => String(source.source_id) === trailForm.route_source_id))} onClick={() => void publishTrail()}>{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}Verifikasi & tampilkan jalur</Button>
                    <Button className="rounded-xl" disabled={saving} onClick={() => void saveTrail()}><Save className="mr-2 size-4" />Simpan draf</Button>
                  </div>
                </CardContent>
              </Card>
            )
          ) : null}

          {activeTab === "workspace" ? (
            <div className="space-y-4">
              <Card id="hiking-map-section" className="overflow-hidden rounded-2xl shadow-none">
                <CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Peta lokasi dan jalur" description="Geser dan perbesar peta. Aktifkan pemilihan titik untuk mengisi koordinat gunung, basecamp, atau titik penting." action={<Button variant={mapPickMode ? "default" : "outline"} size="sm" className="rounded-xl" onClick={() => setMapPickMode((value) => !value)}><MapPin className="mr-2 size-4" />{mapPickMode ? "Batalkan pilih titik" : "Pilih titik dari peta"}</Button>} /></CardHeader>
                <CardContent className="space-y-4 p-3 sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                    <Field label="Titik yang akan diisi"><SelectInput value={mapPickTarget} onChange={(value) => setMapPickTarget(value as typeof mapPickTarget)} options={[{ value: "mountain", label: "Lokasi gunung" }, { value: "basecamp", label: "Lokasi basecamp" }, { value: "checkpoint", label: "Titik penting" }]} /></Field>
                    <p className="text-xs leading-5 text-muted-foreground">Koordinat terpilih belum tersimpan sampai formulir disimpan.</p>
                  </div>
                  <HikingMapCanvas center={currentCenter} selectedPoint={mapPicked} routeGeoJson={selectedRouteGeoJson} points={mapPoints} pickMode={mapPickMode} onPickPoint={mapPick} />
                  <div className="space-y-3 rounded-2xl border bg-muted/10 p-3 sm:p-4">
                    <SectionHeading title="Cuaca wilayah otomatis" description="Sistem mencocokkan koordinat gunung/basecamp dengan wilayah BMKG. Admin tidak perlu memilih kode wilayah." action={<Badge variant={forecast ? "default" : "outline"}>{forecastLoading ? "Memuat" : forecast ? "Prakiraan tersedia" : "Menunggu data"}</Badge>} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-xs font-medium">Wilayah referensi</p>
                        <p className="mt-1 text-sm">{currentWeatherArea ? [currentWeatherArea.village_name, currentWeatherArea.district_name, currentWeatherArea.regency_name, currentWeatherArea.province_name].filter(Boolean).join(", ") : "Belum terverifikasi"}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentWeatherArea ? "Pemetaan dilakukan sistem dan tetap mengikuti sumber wilayah." : "Lokasi yang belum meyakinkan akan ditandai untuk pemeriksaan; sistem tidak mengarang kode BMKG."}</p>
                      </div>
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-xs font-medium">Pembaruan prakiraan</p>
                        <p className="mt-1 text-sm">{forecastLoading ? "Mengambil data terbaru…" : forecast ? "Prakiraan dan cache dikelola backend." : activeEntity?.publication_status === "published" ? (forecastError ? "Belum dapat dimuat" : "Menunggu data wilayah") : "Aktif setelah data gunung/jalur diterbitkan."}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">Prakiraan wilayah bukan pengukuran langsung di jalur atau puncak gunung.</p>
                      </div>
                    </div>
                    {forecastError ? <Alert variant="destructive" className="rounded-xl"><AlertCircle className="size-4" /><AlertDescription>{forecastError}</AlertDescription></Alert> : null}
                    {forecast && typeof forecast === "object" ? <ForecastSummary value={forecast} /> : null}
                    {!weatherAreas.length ? <p className="text-xs leading-5 text-muted-foreground">Direktori wilayah belum tersedia. Pemetaan otomatis akan aktif setelah data wilayah bersumber resmi tersedia di database.</p> : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border p-3"><p className="text-[11px] text-muted-foreground">Gunung</p><p className="mt-1 text-sm font-medium">{mountainForm.latitude && mountainForm.longitude ? `${Number(mountainForm.latitude).toFixed(4)}, ${Number(mountainForm.longitude).toFixed(4)}` : "Lokasi belum diatur"}</p></div>
                    <div className="rounded-xl border p-3"><p className="text-[11px] text-muted-foreground">Basecamp</p><p className="mt-1 text-sm font-medium">{trailForm.basecamp_latitude && trailForm.basecamp_longitude ? `${Number(trailForm.basecamp_latitude).toFixed(4)}, ${Number(trailForm.basecamp_longitude).toFixed(4)}` : "Lokasi belum diatur"}</p></div>
                    <div className="rounded-xl border p-3"><p className="text-[11px] text-muted-foreground">Rute</p><p className="mt-1 text-sm font-medium">{selectedTrail?.route_geojson || pendingRoute?.applied ? "Garis rute tersedia" : "Belum ada rute"}</p></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-none">
                <CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Impor rute dari GPX" description="Sistem membaca setiap rute secara terpisah. Tinjau pratinjau lalu pilih rute yang sesuai untuk jalur ini; rute lain dalam berkas tidak akan digabungkan." /></CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  {!selectedTrailId ? <Alert className="rounded-xl"><Info className="size-4" /><AlertDescription>Pilih atau simpan jalur terlebih dahulu, lalu impor rutenya.</AlertDescription></Alert> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Sumber rute" required><SelectInput value={routeSourceId} onChange={(value) => { setRouteSourceId(value); const source = sources.find((item) => String(item.source_id) === value); if (source) setRouteReferenceUrl(valueOf(source, "source_url")); setTrailForm((current) => ({ ...current, route_source_id: value, route_source_reference_url: valueOf(source, "source_url") })); }} placeholder="Sumber terpilih otomatis bila tersedia" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name) + " · " + labelOfStatus(source.permission_status) }))} /></Field>
                    <Field label="Berkas GPX" required hint="Satu berkas boleh memuat beberapa rute."><Input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={(event) => setRouteFile(event.target.files?.[0] ?? null)} className="rounded-xl file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" /></Field>
                  </div>
                  <details className="rounded-xl border bg-muted/10 p-3">
                    <summary className="cursor-pointer text-xs font-medium">Koreksi tautan sumber (opsional)</summary>
                    <div className="mt-3"><Field label="Tautan rujukan"><Input type="url" value={routeReferenceUrl} onChange={(event) => setRouteReferenceUrl(event.target.value)} placeholder="Terisi otomatis dari sumber" className="rounded-xl" /></Field></div>
                  </details>
                  <p className="text-xs leading-5 text-muted-foreground">{selectedTrail ? "Berkas akan ditinjau untuk jalur " + String(selectedTrail.name) + "." : "Pilih jalur pada daftar Gunung & jalur terlebih dahulu, lalu impor GPX."}</p>
                  <Button onClick={() => void uploadRoute().catch((error) => toast.error(errorText(error)))} disabled={saving || !routeFile || !selectedTrailId || !routeSourceId} className="rounded-xl"><FileUp className="mr-2 size-4" />Baca dan pratinjau rute</Button>
                  {pendingRoute ? (
                    <div className="space-y-4 rounded-2xl border bg-muted/15 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold">{pendingRoute.fileName}</p><p className="mt-1 text-xs text-muted-foreground">ID pemeriksaan tersimpan: {pendingRoute.importId}</p></div><Badge variant={pendingRoute.applied ? "default" : "secondary"}>{pendingRoute.applied ? "Rute diterapkan sebagai draf" : "Menunggu pemeriksaan izin"}</Badge></div>
                      {routeCandidateCount > 1 ? <Field label="Pilih rute yang akan digunakan" required hint="Setiap rute dipertahankan terpisah. Pastikan garis di peta sesuai dengan jalur yang sedang Anda kelola."><SelectInput value={String(pendingRoute.selectedRouteIndex)} onChange={(value) => setPendingRoute((current) => current ? { ...current, selectedRouteIndex: Number(value) } : current)} options={(pendingRoute.preview.routeCandidates ?? []).map((candidate) => ({ value: String(candidate.index), label: String(candidate.name ?? ("Rute " + (candidate.index + 1))) + " · " + (candidate.distanceM / 1000).toFixed(2) + " km · " + candidate.points.toLocaleString("id-ID") + " titik" }))} /></Field> : null}
                      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-background p-3"><p className="text-xs text-muted-foreground">Jarak rute terpilih</p><p className="mt-1 text-lg font-semibold">{selectedRouteDistanceM === null ? "Tidak tersedia" : (selectedRouteDistanceM / 1000).toFixed(2) + " km"}</p></div><div className="rounded-xl bg-background p-3"><p className="text-xs text-muted-foreground">Titik rute</p><p className="mt-1 text-lg font-semibold">{selectedRoutePointCount.toLocaleString("id-ID")}</p><p className="mt-1 text-[11px] text-muted-foreground">{selectedRouteSegmentCount} bagian jalur</p></div><div className="rounded-xl bg-background p-3"><p className="text-xs text-muted-foreground">Kenaikan elevasi</p><p className="mt-1 text-lg font-semibold">{selectedRouteElevationGainM === null ? "Tidak tersedia" : selectedRouteElevationGainM.toLocaleString("id-ID") + " m"}</p></div></div>
                      <HikingMapCanvas center={currentCenter} routeGeoJson={selectedRouteGeoJson} heightClassName="h-[300px]" />
                      {selectedRouteWarnings.length ? <Alert className="rounded-xl border-amber-500/30"><AlertTriangle className="size-4 text-amber-600" /><AlertTitle>Hal yang perlu diperhatikan</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{selectedRouteWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></AlertDescription></Alert> : null}
                      {routeCandidateCount > 1 ? <p className="text-xs leading-5 text-muted-foreground">Berkas ini berisi {routeCandidateCount} kandidat rute. Hanya rute yang dipilih yang akan diterapkan; kandidat lain tidak diubah.</p> : null}
                      {!pendingRoute.applied ? <div className="space-y-3 border-t pt-4"><p className="text-sm font-medium">Pemeriksaan izin sebelum menerapkan</p><p className="text-xs leading-5 text-muted-foreground">Jangan lanjutkan jika Anda belum memastikan bahwa berkas dapat digunakan untuk tujuan ini. Backend akan memeriksa sumber dan domain rujukan.</p><details className="rounded-xl border bg-background p-3"><summary className="cursor-pointer text-xs font-medium">Catatan audit pemeriksaan (opsional)</summary><div className="mt-3"><Field label="Catatan pemeriksaan"><Textarea value={routeReviewNote} onChange={(event) => setRouteReviewNote(event.target.value)} rows={2} className="rounded-xl" /></Field></div></details><Button onClick={() => void reviewAndApplyRoute().catch((error) => toast.error(errorText(error)))} disabled={saving || !routeReferenceUrl || !sourceHasClearPermission(currentTrailSource)} className="rounded-xl">{saving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}Setujui izin & terapkan sebagai draf</Button></div> : null}
                      {pendingRoute.applied && pendingRoute.preview.waypointCandidates.length ? <div className="space-y-3 border-t pt-4"><SectionHeading title="Titik kandidat dari GPX" description={routeCandidateCount > 1 ? "Waypoint berasal dari seluruh berkas GPX dan tidak selalu terikat ke rute yang dipilih. Periksa kecocokannya sebelum menambahkan titik." : "Sistem tidak menerbitkan waypoint otomatis. Pilih titik yang memang layak menjadi informasi rute."} /><div className="space-y-2">{pendingRoute.preview.waypointCandidates.map((candidate, index) => <div key={`${candidate.name}-${index}`} className="flex items-center gap-3 rounded-xl border bg-background p-3"><MapPin className="size-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{candidate.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}{candidate.elevation_m !== null ? ` · ${candidate.elevation_m} mdpl` : ""}</p></div><Button size="sm" variant="outline" className="rounded-lg" disabled={saving || createdWaypointIndexes.includes(index)} onClick={() => void createCheckpointFromCandidate(candidate, index).catch((error) => toast.error(errorText(error)))}>{createdWaypointIndexes.includes(index) ? <><Check className="mr-1.5 size-3.5" />Disimpan</> : "Jadikan titik"}</Button></div>)}</div></div> : null}
                    </div>
                  ) : null}
                  <Separator />
                  <SectionHeading title="Riwayat pemeriksaan rute" description="Riwayat yang sudah tersimpan di server." />
                  {importsForTrail.length ? <div className="space-y-2">{importsForTrail.map((routeImport) => <div key={String(routeImport.import_id)} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(routeImport.original_filename ?? "Berkas rute")}</p><p className="mt-1 text-xs text-muted-foreground">{Number(routeImport.calculated_distance_m ?? 0) > 0 ? `${(Number(routeImport.calculated_distance_m) / 1000).toFixed(2)} km` : "Jarak belum tersedia"} · {Number(routeImport.point_count ?? 0).toLocaleString("id-ID")} titik</p></div><div className="flex flex-wrap gap-2"><StatusPill status={routeImport.import_status} /><StatusPill status={routeImport.license_review_status} /></div></div>)}</div> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Belum ada berkas rute untuk jalur ini.</p>}
                  {routeHistoryForTrail.length ? <div className="space-y-2">{routeHistoryForTrail.map((version) => <div key={String(version.route_version_id)} className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-medium">Versi {String(version.version_number)}</p><p className="mt-1 text-xs text-muted-foreground">{Number(version.distance_m ?? 0) > 0 ? `${(Number(version.distance_m) / 1000).toFixed(2)} km` : "Jarak belum tersedia"} · {valueOf(version, "created_at") ? new Date(valueOf(version, "created_at")).toLocaleDateString("id-ID") : ""}</p></div><Badge variant="outline">Tersimpan</Badge></div>)}</div> : null}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeTab === "workspace" ? (
            <div className="space-y-4">
              {!selectedTrailId ? <Alert className="rounded-xl"><Info className="size-4" /><AlertDescription>Pilih jalur dari panel kiri terlebih dahulu untuk mengelola titik penting.</AlertDescription></Alert> : null}
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Tambah titik penting" description="Pilih jenis titik, isi nama, lalu ambil lokasi dari peta jika koordinat belum tersedia." action={<Button size="sm" variant="outline" className="rounded-xl" onClick={() => activateMapPickTarget("checkpoint") }><MapPin className="mr-2 size-4" />Pilih lokasi di peta</Button>} /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama titik" required><Input value={checkpointForm.name} onChange={(event) => setCheckpointForm((current) => ({ ...current, name: event.target.value }))} placeholder="Contoh: Pos 2" className="rounded-xl" /></Field>
                  <Field label="Jenis titik"><SelectInput value={checkpointForm.checkpoint_type} onChange={(value) => setCheckpointForm((current) => ({ ...current, checkpoint_type: value }))} options={[{ value: "basecamp", label: "Basecamp" }, { value: "pos", label: "Pos pendakian" }, { value: "water_source", label: "Sumber air" }, { value: "camping_area", label: "Area berkemah" }, { value: "summit", label: "Puncak" }, { value: "emergency_point", label: "Titik darurat" }, { value: "viewpoint", label: "Titik pandang" }, { value: "shelter", label: "Tempat berlindung" }, { value: "waypoint", label: "Titik lainnya" }]} /></Field>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{checkpointForm.latitude && checkpointForm.longitude ? "Lokasi titik dipilih" : "Lokasi belum dipilih"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{checkpointForm.latitude && checkpointForm.longitude ? Number(checkpointForm.latitude).toFixed(6) + ", " + Number(checkpointForm.longitude).toFixed(6) : "Ketuk peta untuk menentukan lokasi."}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => activateMapPickTarget("checkpoint")}><MapPin className="mr-2 size-4" />Pilih di peta</Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">Sumber informasi diturunkan otomatis dari sumber rute/gunung yang dipilih. Sistem menyimpan titik sebagai draf untuk ditinjau sebelum ditampilkan.</p>
                <details className="rounded-xl border bg-muted/10 p-3">
                  <summary className="cursor-pointer text-xs font-medium">Koreksi lanjutan (opsional)</summary>
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Urutan pada jalur"><Input type="number" min={0} value={checkpointForm.sequence_number} onChange={(event) => setCheckpointForm((current) => ({ ...current, sequence_number: event.target.value }))} className="rounded-xl" /></Field>
                      <Field label="Kode titik"><Input value={checkpointForm.code} onChange={(event) => setCheckpointForm((current) => ({ ...current, code: event.target.value }))} placeholder="Otomatis bila dikosongkan" className="rounded-xl" /></Field>
                      <Field label="Lintang"><Input type="number" step="any" value={checkpointForm.latitude} onChange={(event) => setCheckpointForm((current) => ({ ...current, latitude: event.target.value }))} className="rounded-xl font-mono text-xs" /></Field>
                      <Field label="Bujur"><Input type="number" step="any" value={checkpointForm.longitude} onChange={(event) => setCheckpointForm((current) => ({ ...current, longitude: event.target.value }))} className="rounded-xl font-mono text-xs" /></Field>
                      <Field label="Ketinggian (meter)"><Input type="number" min={-500} max={9000} value={checkpointForm.elevation_m} onChange={(event) => setCheckpointForm((current) => ({ ...current, elevation_m: event.target.value }))} className="rounded-xl" /></Field>
                    </div>
                    <Field label="Catatan titik"><Textarea value={checkpointForm.description} onChange={(event) => setCheckpointForm((current) => ({ ...current, description: event.target.value }))} rows={2} className="rounded-xl" /></Field>
                  </div>
                </details>
                <div className="flex justify-end"><Button disabled={saving || !selectedTrailId} onClick={() => void saveCheckpoint().catch((error) => toast.error(errorText(error)))} className="rounded-xl"><Save className="mr-2 size-4" />Simpan titik sebagai draf</Button></div>
              </CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title={`Titik pada jalur (${currentCheckpoints.length})`} description="Titik dari GPX ditambahkan sebagai draf dan perlu diperiksa sebelum ditampilkan." /></CardHeader><CardContent className="p-3 sm:p-4">{currentCheckpoints.length ? <div className="space-y-2">{currentCheckpoints.slice().sort((a,b) => Number(a.sequence_number) - Number(b.sequence_number)).map((checkpoint) => <div key={String(checkpoint.checkpoint_id)} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><MapPin className="size-4" /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{String(checkpoint.sequence_number ?? 0)}. {String(checkpoint.name ?? "Titik")}</p><p className="mt-1 text-xs text-muted-foreground">{labelOfStatus(checkpoint.checkpoint_type)} · {numberValue(checkpoint.latitude)?.toFixed(5)}, {numberValue(checkpoint.longitude)?.toFixed(5)}</p></div><div className="flex flex-wrap items-center gap-2"><StatusPill status={checkpoint.publication_status} />{checkpoint.publication_status !== "published" ? <Button size="sm" variant="outline" className="rounded-lg" disabled={saving || !isPublished(selectedTrail) || !isPublished(currentMountain)} onClick={() => void verifyAndPublishCheckpoint(checkpoint)}>Tampilkan</Button> : null}</div></div>)}</div> : <div className="rounded-xl border border-dashed p-6 text-center"><Waypoints className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">Belum ada titik penting</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Titik dapat ditambahkan di sini atau diambil dari waypoint berkas GPX.</p></div>}</CardContent></Card>
            </div>
          ) : null}

          {activeTab === "keselamatan" ? (
            <div className="space-y-4">
              {entityKind === "trail" && selectedTrailId ? <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Status operasional jalur" description="Perubahan buka/tutup harus merujuk sumber dan selalu tersimpan dalam riwayat." /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Status jalur"><SelectInput value={trailForm.operational_status} onChange={(value) => updateTrail("operational_status", value)} options={[{ value: "unknown", label: "Belum diketahui" }, { value: "open", label: "Dibuka" }, { value: "closed", label: "Ditutup" }, { value: "limited", label: "Akses terbatas" }, { value: "temporarily_suspended", label: "Ditangguhkan sementara" }]} /></Field><Field label="Sumber pemeriksaan"><SelectInput value={routeSourceId} onChange={(value) => { setRouteSourceId(value); const source = sources.find((item) => String(item.source_id) === value); if (source) setRouteReferenceUrl(valueOf(source, "source_url")); }} placeholder="Pilih sumber" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name) }))} /></Field><Field label="Tautan rujukan status"><Input type="url" value={routeReferenceUrl} onChange={(event) => setRouteReferenceUrl(event.target.value)} placeholder="https://..." className="rounded-xl" /></Field></div><Button className="rounded-xl" disabled={saving} onClick={() => void perform("set_trail_status", { trail_id: selectedTrailId, operational_status: trailForm.operational_status, source_id: routeSourceId || null, source_url: routeReferenceUrl || null, verification_status: trailForm.operational_status === "unknown" ? "unverified" : "official", notes: "Diperbarui melalui pusat pengelolaan pendakian." }).then(() => refreshAfterSave("Status jalur diperbarui dan tercatat.")).catch((error) => toast.error(errorText(error)))}><Save className="mr-2 size-4" />Simpan status jalur</Button></CardContent></Card> : null}
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Buat peringatan keselamatan" description="Peringatan harus memiliki sumber dan sasaran yang jelas. Publikasi akan diperiksa backend." /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Peringatan ditujukan ke" required hint="Pilih satu gunung atau satu jalur. Sistem mengunci sasaran lainnya otomatis."><SelectInput value={advisoryForm.mountain_id ? "mountain:" + advisoryForm.mountain_id : advisoryForm.trail_id ? "trail:" + advisoryForm.trail_id : ""} onChange={(value) => { if (value.startsWith("mountain:")) setAdvisoryForm((current) => ({ ...current, mountain_id: value.slice(8), trail_id: "" })); else if (value.startsWith("trail:")) setAdvisoryForm((current) => ({ ...current, trail_id: value.slice(6), mountain_id: "" })); else setAdvisoryForm((current) => ({ ...current, mountain_id: "", trail_id: "" })); }} placeholder="Pilih gunung atau jalur" options={[...mountains.map((mountain) => ({ value: "mountain:" + String(mountain.mountain_id), label: "Gunung · " + String(mountain.name) })), ...trails.map((trail) => ({ value: "trail:" + String(trail.trail_id), label: "Jalur · " + String(trail.name) + " · " + String(mountains.find((mountain) => String(mountain.mountain_id) === String(trail.mountain_id))?.name ?? "Gunung") }))]} /></Field><Field label="Jenis peringatan"><SelectInput value={advisoryForm.advisory_type} onChange={(value) => setAdvisoryForm((current) => ({ ...current, advisory_type: value }))} options={[{ value: "closure", label: "Penutupan jalur" }, { value: "weather", label: "Cuaca" }, { value: "landslide", label: "Longsor" }, { value: "flood", label: "Banjir" }, { value: "wildfire", label: "Kebakaran hutan" }, { value: "volcanic", label: "Aktivitas vulkanik" }, { value: "earthquake", label: "Gempa bumi" }, { value: "wildlife", label: "Satwa liar" }, { value: "infrastructure", label: "Infrastruktur" }, { value: "health", label: "Kesehatan" }, { value: "other", label: "Lainnya" }]} /></Field><Field label="Tingkat perhatian"><SelectInput value={advisoryForm.severity} onChange={(value) => setAdvisoryForm((current) => ({ ...current, severity: value }))} options={[{ value: "info", label: "Informasi" }, { value: "watch", label: "Waspada" }, { value: "warning", label: "Peringatan" }, { value: "critical", label: "Kritis" }]} /></Field></div>
                <Field label="Judul peringatan" required><Input value={advisoryForm.title} onChange={(event) => setAdvisoryForm((current) => ({ ...current, title: event.target.value }))} placeholder="Judul singkat dan jelas" className="rounded-xl" /></Field>
                <Field label="Penjelasan" required><Textarea value={advisoryForm.description} onChange={(event) => setAdvisoryForm((current) => ({ ...current, description: event.target.value }))} rows={3} className="rounded-xl" /></Field>
                <Field label="Instruksi untuk pendaki"><Textarea value={advisoryForm.instruction} onChange={(event) => setAdvisoryForm((current) => ({ ...current, instruction: event.target.value }))} rows={2} placeholder="Langkah aman yang perlu diambil" className="rounded-xl" /></Field>
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Sumber peringatan" required><SelectInput value={advisoryForm.source_id} onChange={(value) => { const source = sources.find((item) => String(item.source_id) === value); setAdvisoryForm((current) => ({ ...current, source_id: value, source_url: valueOf(source, "source_url") || current.source_url })); }} placeholder="Pilih sumber" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name) }))} /></Field><Field label="Tautan sumber" required><Input type="url" value={advisoryForm.source_url} onChange={(event) => setAdvisoryForm((current) => ({ ...current, source_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field><Field label="Mulai berlaku"><Input type="datetime-local" value={advisoryForm.starts_at} onChange={(event) => setAdvisoryForm((current) => ({ ...current, starts_at: event.target.value }))} className="rounded-xl" /></Field><Field label="Berakhir (opsional)"><Input type="datetime-local" value={advisoryForm.expires_at} onChange={(event) => setAdvisoryForm((current) => ({ ...current, expires_at: event.target.value }))} className="rounded-xl" /></Field></div>
                <p className="text-xs leading-5 text-muted-foreground">Pilih status “sumber resmi” hanya untuk sumber instansi resmi atau penyedia peringatan cuaca yang sesuai.</p>
                <div className="flex justify-end"><Button disabled={saving} className="rounded-xl" onClick={() => void publishAdvisory().catch((error) => toast.error(errorText(error)))}><ShieldAlert className="mr-2 size-4" />Simpan & terbitkan peringatan</Button></div>
              </CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4"><SectionHeading title="Peringatan khusus yang tersimpan" description="Peringatan yang sudah berakhir tetap dapat ditelusuri dari data internal." /></CardHeader><CardContent className="space-y-2 p-4">{advisories.length ? advisories.slice().sort((a,b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))).slice(0,20).map((advisory) => <div key={String(advisory.advisory_id)} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium">{String(advisory.title ?? "Peringatan")}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{String(advisory.description ?? "")}</p><p className="mt-1 text-[11px] text-muted-foreground">{String(advisory.advisory_type ?? "").replaceAll("_", " ")} · {advisory.starts_at ? new Date(String(advisory.starts_at)).toLocaleDateString("id-ID") : "Tanggal belum ditetapkan"}</p></div><div className="flex flex-wrap gap-2"><StatusPill status={advisory.severity} /><StatusPill status={advisory.publication_status} /></div></div>) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada peringatan khusus.</p>}</CardContent></Card>
            </div>
          ) : null}

          {activeTab === "media" ? (
            <div className="space-y-4">
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Tambah foto" description="Foto disimpan secara privat terlebih dahulu. Publikasi dilakukan terpisah setelah sumber dan hak penggunaan diperiksa." /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5">
                {!currentEntityId ? <Alert className="rounded-xl"><Info className="size-4" /><AlertDescription>Simpan data gunung atau jalur sebelum mengunggah foto.</AlertDescription></Alert> : null}
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Berkas gambar" required hint="JPEG, PNG, WebP, atau AVIF; maksimal 10 MB."><Input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setMediaDraft((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} className="rounded-xl file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" /></Field><Field label="Jenis gambar"><SelectInput value={mediaDraft.media_type} onChange={(value) => setMediaDraft((current) => ({ ...current, media_type: value }))} options={[{ value: "cover", label: "Foto utama" }, { value: "gallery", label: "Galeri" }, { value: "route_preview", label: "Pratinjau jalur" }, { value: "basecamp", label: "Basecamp" }, { value: "operator_logo", label: "Logo pengelola" }, { value: "other", label: "Lainnya" }]} /></Field><Field label="Teks deskripsi gambar" required hint="Membantu aksesibilitas dan menjelaskan isi foto."><Input value={mediaDraft.alt_text} onChange={(event) => setMediaDraft((current) => ({ ...current, alt_text: event.target.value }))} placeholder="Contoh: Pos pendakian di jalur utara" className="rounded-xl" /></Field><Field label="Keterangan tambahan"><Input value={mediaDraft.caption} onChange={(event) => setMediaDraft((current) => ({ ...current, caption: event.target.value }))} placeholder="Opsional" className="rounded-xl" /></Field><Field label="Sumber gambar" required><SelectInput value={mediaDraft.source_id} onChange={(value) => { const source = sources.find((item) => String(item.source_id) === value); setMediaDraft((current) => ({ ...current, source_id: value, source_reference_url: valueOf(source, "source_url") || current.source_reference_url })); }} placeholder="Pilih sumber" options={sources.map((source) => ({ value: String(source.source_id), label: `${String(source.name)} · ${labelOfStatus(source.permission_status)}` }))} /></Field><Field label="Tautan rujukan gambar" required><Input type="url" value={mediaDraft.source_reference_url} onChange={(event) => setMediaDraft((current) => ({ ...current, source_reference_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field></div>
                <div className="flex justify-end"><Button onClick={() => void uploadMedia().catch((error) => toast.error(errorText(error)))} disabled={saving || !currentEntityId} className="rounded-xl"><FileImage className="mr-2 size-4" />Unggah sebagai draf</Button></div>
                {!catalogEnabled ? <p className="rounded-xl bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">Publikasi foto masih ditahan karena katalog publik belum dirilis. Foto tidak akan tersedia pada URL publik.</p> : null}
              </CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title={`Foto terkait (${mediaForTarget.length})`} description="Pratinjau menggunakan tautan sementara yang dibuat oleh backend." /></CardHeader><CardContent className="p-4 sm:p-5">{mediaForTarget.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{mediaForTarget.map((item) => <div key={String(item.media_id)} className="overflow-hidden rounded-xl border"><div className="aspect-[4/3] bg-muted/50">{item.preview_url ? <img src={String(item.preview_url)} alt={String(item.alt_text ?? "")} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted-foreground"><FileImage className="size-7" /></div>}</div><div className="space-y-2 p-3"><p className="line-clamp-2 text-sm font-medium">{String(item.alt_text ?? "Foto")}</p><div className="flex flex-wrap gap-2"><StatusPill status={item.publication_status} /><Badge variant="outline">{labelOfStatus(item.media_type)}</Badge></div><p className="text-[11px] text-muted-foreground">{labelOfStatus(item.permission_status)}</p></div></div>)}</div> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada foto untuk pilihan ini.</p>}</CardContent></Card>
            </div>
          ) : null}

          {activeTab === "sumber" ? (
            <div className="space-y-4">
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Daftar sumber informasi" description="Sumber dibuat sekali lalu digunakan kembali pada gunung, jalur, titik, dan peringatan." /></CardHeader><CardContent className="space-y-2 p-4 sm:p-5">{sources.map((source) => <div key={String(source.source_id)} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{String(source.name)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{String(source.source_url ?? "Belum ada alamat sumber")}</p><p className="mt-1 text-[11px] text-muted-foreground">{String(source.source_type).replaceAll("_", " ")} · {String(source.license_name ?? "Lisensi belum dicatat")}</p></div><div className="flex flex-wrap gap-2"><StatusPill status={source.permission_status} /><Badge variant={source.is_active ? "outline" : "secondary"}>{source.is_active ? "Aktif" : "Nonaktif"}</Badge></div></div>)}</CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Tambah sumber" description="Pilih status izin sesuai bukti yang benar-benar tersedia. Jangan menandai izin sebagai diberikan tanpa pemeriksaan." /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Nama sumber" required><Input value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value, code: current.code || slugify(event.target.value).replace(/-/g, "_") }))} placeholder="Nama instansi atau penyedia data" className="rounded-xl" /></Field><Field label="Kode internal" required><Input value={sourceForm.code} onChange={(event) => setSourceForm((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") }))} placeholder="kode_sumber" className="rounded-xl font-mono text-xs" /></Field><Field label="Jenis sumber"><SelectInput value={sourceForm.source_type} onChange={(value) => setSourceForm((current) => ({ ...current, source_type: value }))} options={[{ value: "official_agency", label: "Instansi resmi" }, { value: "basemap", label: "Peta dasar" }, { value: "trail_network", label: "Jaringan jalur" }, { value: "gpx_archive", label: "Arsip berkas GPX" }, { value: "elevation_dem", label: "Data elevasi" }, { value: "weather_forecast", label: "Prakiraan cuaca" }, { value: "weather_alert", label: "Peringatan cuaca" }, { value: "ticket_provider", label: "Penyedia tiket (belum aktif)" }, { value: "community", label: "Komunitas" }, { value: "other", label: "Lainnya" }]} /></Field><Field label="Status izin"><SelectInput value={sourceForm.permission_status} onChange={(value) => setSourceForm((current) => ({ ...current, permission_status: value }))} options={[{ value: "unknown", label: "Belum diperiksa" }, { value: "permission_required", label: "Memerlukan izin" }, { value: "verified_open", label: "Penggunaan terbuka telah diverifikasi" }, { value: "permission_granted", label: "Izin penggunaan diberikan" }, { value: "restricted", label: "Penggunaan dibatasi" }]} /></Field><Field label="Alamat situs sumber" required><Input type="url" value={sourceForm.source_url} onChange={(event) => setSourceForm((current) => ({ ...current, source_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field><Field label="Nama lisensi"><Input value={sourceForm.license_name} onChange={(event) => setSourceForm((current) => ({ ...current, license_name: event.target.value }))} placeholder="Nama lisensi atau ketentuan" className="rounded-xl" /></Field><Field label="Tautan lisensi"><Input type="url" value={sourceForm.license_url} onChange={(event) => setSourceForm((current) => ({ ...current, license_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field><Field label="Teks atribusi"><Input value={sourceForm.attribution_text} onChange={(event) => setSourceForm((current) => ({ ...current, attribution_text: event.target.value }))} placeholder="Teks sumber yang perlu ditampilkan" className="rounded-xl" /></Field></div>
                <Field label="Catatan internal"><Textarea value={sourceForm.notes} onChange={(event) => setSourceForm((current) => ({ ...current, notes: event.target.value }))} rows={2} className="rounded-xl" /></Field>
                <div className="flex justify-end"><Button disabled={saving} className="rounded-xl" onClick={() => void saveSource().catch((error) => toast.error(errorText(error)))}><Save className="mr-2 size-4" />Simpan sumber</Button></div>
              </CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Pengelola atau operator" description="Data publik pengelola dapat dipilih pada gunung atau jalur setelah statusnya diverifikasi." /></CardHeader><CardContent className="space-y-4 p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Nama pengelola" required><Input value={operatorForm.name} onChange={(event) => setOperatorForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nama pengelola" className="rounded-xl" /></Field><Field label="Jenis pengelola"><SelectInput value={operatorForm.operator_type} onChange={(value) => setOperatorForm((current) => ({ ...current, operator_type: value }))} options={[{ value: "national_park", label: "Taman nasional" }, { value: "nature_park", label: "Taman wisata alam" }, { value: "forest_area", label: "Kawasan hutan" }, { value: "basecamp", label: "Basecamp" }, { value: "community", label: "Komunitas" }, { value: "ticket_vendor", label: "Penyedia tiket" }, { value: "other", label: "Lainnya" }]} /></Field><Field label="Provinsi"><Input value={operatorForm.province} onChange={(event) => setOperatorForm((current) => ({ ...current, province: event.target.value }))} className="rounded-xl" /></Field><Field label="Kabupaten/kota"><Input value={operatorForm.regency} onChange={(event) => setOperatorForm((current) => ({ ...current, regency: event.target.value }))} className="rounded-xl" /></Field><Field label="Situs"><Input type="url" value={operatorForm.website_url} onChange={(event) => setOperatorForm((current) => ({ ...current, website_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field><Field label="Situs reservasi resmi (opsional)"><Input type="url" value={operatorForm.official_booking_url} onChange={(event) => setOperatorForm((current) => ({ ...current, official_booking_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field><Field label="Nomor telepon publik"><Input value={operatorForm.public_phone} onChange={(event) => setOperatorForm((current) => ({ ...current, public_phone: event.target.value }))} className="rounded-xl" /></Field><Field label="Email publik"><Input type="email" value={operatorForm.public_email} onChange={(event) => setOperatorForm((current) => ({ ...current, public_email: event.target.value }))} className="rounded-xl" /><p className="text-[11px] text-muted-foreground">Hanya kontak yang memang boleh dipublikasikan.</p></Field><Field label="Sumber pengelola"><SelectInput value={operatorForm.source_id} onChange={(value) => { const source = sources.find((item) => String(item.source_id) === value); setOperatorForm((current) => ({ ...current, source_id: value, source_reference_url: current.source_reference_url || valueOf(source, "source_url") })); }} placeholder="Pilih sumber" options={sources.map((source) => ({ value: String(source.source_id), label: String(source.name) }))} /></Field><Field label="Tautan bukti"><Input type="url" value={operatorForm.source_reference_url} onChange={(event) => setOperatorForm((current) => ({ ...current, source_reference_url: event.target.value }))} placeholder="https://..." className="rounded-xl" /></Field></div><Field label="Alamat"><Textarea value={operatorForm.address} onChange={(event) => setOperatorForm((current) => ({ ...current, address: event.target.value }))} rows={2} className="rounded-xl" /></Field><div className="flex justify-end"><Button disabled={saving} className="rounded-xl" onClick={() => void saveOperator().catch((error) => toast.error(errorText(error)))}><Save className="mr-2 size-4" />Simpan pengelola</Button></div><Separator /><div className="space-y-2">{operators.map((operator) => <div key={String(operator.operator_id)} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{String(operator.name)}</p><p className="mt-1 text-xs text-muted-foreground">{[operator.regency, operator.province].filter(Boolean).join(", ") || "Wilayah belum diisi"}</p></div><div className="flex items-center gap-2"><StatusPill status={operator.verification_status} />{operator.verification_status !== "verified" ? <Button size="sm" variant="outline" className="rounded-lg" disabled={!operator.source_id || !operator.source_reference_url || saving} onClick={() => void perform("verify_operator", { operator_id: operator.operator_id, source_id: operator.source_id, source_reference_url: operator.source_reference_url, is_public: true }).then(() => refreshAfterSave("Pengelola berhasil diverifikasi.")).catch((error) => toast.error(errorText(error)))}>Verifikasi</Button> : null}</div></div>)}</div></CardContent></Card>
            </div>
          ) : null}

          {activeTab === "pengaturan" ? (
            <div className="space-y-4">
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Status integrasi" description="Status ini dibaca dari backend. Pengaturan teknis tidak perlu dilakukan pada setiap gunung atau jalur." /></CardHeader><CardContent className="space-y-3 p-4 sm:p-5">
                {activeFlags.map((flag) => {
                  const locked = flag.isLocked || ["hiking_ticket_booking_enabled", "akasha_rental_booking_enabled"].includes(flag.flag_key);
                  const isPublicCatalog = flag.flag_key === "public_hiking_catalog_enabled";
                  const friendly = flag.flag_key === "public_hiking_catalog_enabled" ? "Katalog pendakian publik" : flag.flag_key === "bmkg_forecast_enabled" ? "Prakiraan cuaca BMKG" : flag.flag_key === "bmkg_nowcast_alerts_enabled" ? "Peringatan cuaca BMKG" : flag.flag_key === "hiking_ticket_booking_enabled" ? "Pemesanan tiket pendakian" : flag.flag_key === "akasha_rental_booking_enabled" ? "Transaksi rental" : flag.flag_key;
                  return <div key={flag.flag_key} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium">{friendly}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{flag.description}</p></div><div className="flex shrink-0 items-center gap-2"><Badge variant={flag.is_enabled ? "default" : "secondary"}>{flag.is_enabled ? "Aktif" : "Nonaktif"}</Badge>{locked ? <Badge variant="outline">Terkunci</Badge> : null}{isPublicCatalog ? <Badge variant="outline">Rilis terpisah</Badge> : null}</div></div>;
                })}
                <Alert className="rounded-xl"><ShieldAlert className="size-4" /><AlertTitle>Pemesanan dan pembayaran tetap terkunci</AlertTitle><AlertDescription>Halaman ini tidak menyediakan tombol untuk mengaktifkan transaksi tiket atau mengubah alur rental yang sudah berjalan. Integrasi pemesanan memerlukan persetujuan dan pengujian terpisah.</AlertDescription></Alert>
              </CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4 sm:p-5"><SectionHeading title="Ringkasan data" description="Informasi ini hanya untuk memandu pekerjaan admin." /></CardHeader><CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(overview?.counts ?? {}).map(([key, count]) => <div key={key} className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replaceAll("_", " ")}</p><p className="mt-1 text-lg font-semibold">{count.toLocaleString("id-ID")}</p></div>)}</CardContent></Card>
              <Card className="rounded-2xl shadow-none"><CardHeader className="border-b p-4"><SectionHeading title="Aktivitas terbaru" description="Pembaruan status tidak mengubah fitur rental." /></CardHeader><CardContent className="space-y-2 p-4">{mountains.filter((item) => item.publication_status !== "published").slice(0,8).map((item) => <div key={String(item.mountain_id)} className="flex items-center justify-between gap-3 rounded-xl bg-muted/25 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(item.name)}</p><p className="mt-1 text-[11px] text-muted-foreground">Gunung · {item.updated_at ? new Date(String(item.updated_at)).toLocaleString("id-ID") : "Waktu tidak tersedia"}</p></div><StatusPill status={item.publication_status} /></div>)}{!mountains.some((item) => item.publication_status !== "published") ? <p className="text-sm text-muted-foreground">Tidak ada draf gunung baru.</p> : null}</CardContent></Card>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatForecastTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  }).format(parsed) + " WIB";
}

function collectForecastItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectForecastItems);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  if (Array.isArray(item.cuaca)) return collectForecastItems(item.cuaca);
  if (Array.isArray(item.forecast)) return collectForecastItems(item.forecast);
  if (item.datetime !== undefined || item.local_datetime !== undefined || item.weather_desc !== undefined) return [item];
  if (Array.isArray(item.data)) return collectForecastItems(item.data);
  return [];
}

function ForecastSummary({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const locationCandidate = record.location ?? record.lokasi ?? record.bmkgLocation;
  const location = locationCandidate && typeof locationCandidate === "object"
    ? locationCandidate as Record<string, unknown>
    : null;
  const source = record.source && typeof record.source === "object"
    ? record.source as Record<string, unknown>
    : null;
  const rawForecast = Array.isArray(record.forecast) ? record.forecast : Array.isArray(record.data) ? record.data : [];
  const items = collectForecastItems(rawForecast).slice(0, 6);
  const village = location?.village ?? location?.desa;
  const district = location?.district ?? location?.kecamatan;
  const regency = location?.regency ?? location?.kotkab;
  const province = location?.province ?? location?.provinsi;
  const fetchedAt = formatForecastTime(record.fetchedAt);
  const analysisAt = formatForecastTime(record.analysisDate);
  const freshUntil = formatForecastTime(record.freshUntil);
  const sourceName = String(source?.name ?? source?.code ?? "BMKG");
  const sourceUrl = typeof source?.sourceUrl === "string" ? source.sourceUrl
    : typeof source?.url === "string" ? source.url : "https://data.bmkg.go.id/";
  const scopeNotice = typeof location?.scopeNotice === "string" ? location.scopeNotice
    : "Prakiraan menggambarkan wilayah administratif referensi, bukan pengukuran langsung di jalur atau puncak gunung.";

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Ringkasan prakiraan</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {[village, district, regency, province].filter((part) => typeof part === "string" && part.trim()).join(", ") || "Wilayah referensi BMKG belum tersedia"}
          </p>
        </div>
        {record.stale === true
          ? <Badge variant="secondary">Cache lama · pembaruan tertunda</Badge>
          : <Badge variant="outline">Data tersimpan</Badge>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-background p-3">
          <p className="text-[11px] text-muted-foreground">Terakhir diambil</p>
          <p className="mt-1 text-sm font-medium">{fetchedAt ?? "Waktu belum dilaporkan server"}</p>
        </div>
        <div className="rounded-xl bg-background p-3">
          <p className="text-[11px] text-muted-foreground">Masa cache berlaku sampai</p>
          <p className="mt-1 text-sm font-medium">{freshUntil ?? "Belum tersedia"}</p>
          {analysisAt ? <p className="mt-1 text-[11px] text-muted-foreground">Analisis BMKG: {analysisAt}</p> : null}
        </div>
      </div>

      {items.length ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => (
            <div key={String(item.datetime ?? item.local_datetime ?? index)} className="rounded-xl bg-background p-3">
              <p className="text-xs text-muted-foreground">{String(item.local_datetime ?? item.datetime ?? "Waktu belum tersedia")}</p>
              <p className="mt-1 text-sm font-semibold">{String(item.weather_desc ?? item.weather ?? "Prakiraan cuaca")}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {item.t !== undefined ? <span>{String(item.t)}°C</span> : null}
                {item.hu !== undefined ? <span>Kelembapan {String(item.hu)}%</span> : null}
                {item.ws !== undefined ? <span>Angin {String(item.ws)} km/j</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-xs leading-5 text-muted-foreground">
          Respons layanan belum memuat rincian prakiraan yang bisa ditampilkan.
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">{scopeNotice}</p>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Sumber: <a href={sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">{sourceName}</a>
        {source?.attribution ? " · " + String(source.attribution) : ""}
      </p>
    </div>
  );
}

export default PendakianWorkspace;
