export type HikingEntity = Record<string, unknown> & {
  mountain_id?: string;
  trail_id?: string;
  checkpoint_id?: string;
  source_id?: string;
  operator_id?: string;
  advisory_id?: string;
  media_id?: string;
  import_id?: string;
  route_version_id?: string;
  publication_status?: string;
  name?: string;
  slug?: string;
  code?: string;
};

export type HikingResource =
  | "mountains"
  | "trails"
  | "checkpoints"
  | "sources"
  | "weatherAreas"
  | "mountainWeatherMappings"
  | "trailWeatherMappings"
  | "advisories"
  | "routeImports"
  | "routeVersions"
  | "media"
  | "operators"
  | "featureFlags"
  | "weatherAlerts";

export type HikingOverview = {
  resource: "overview";
  generatedAt: string;
  counts: Record<string, number>;
  mountainReviewQueue: HikingEntity[];
  featureFlags: Array<{
    flag_key: string;
    is_enabled: boolean;
    description: string;
    updated_at: string;
    isLocked?: boolean;
  }>;
  policy?: {
    bookingEnabled: false;
    bookingActivationAllowedByThisApi: false;
    privilegedRole: string;
    message: string;
  };
};

export type HikingList<T extends HikingEntity = HikingEntity> = {
  resource: HikingResource;
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type GpxRouteCandidate = {
  index: number;
  name: string | null;
  sourceType: "track" | "route";
  geojson: { type: "MultiLineString"; coordinates: number[][][] };
  points: number;
  segmentCount: number;
  distanceM: number;
  elevationGainM: number | null;
  warnings: string[];
};

export type GpxPreview = {
  geojson: { type: "MultiLineString"; coordinates: number[][][] };
  routeCandidates?: GpxRouteCandidate[];
  waypointCandidates: Array<{
    sequence_number: number;
    code: string | null;
    name: string;
    checkpoint_type: string;
    description: string | null;
    latitude: number;
    longitude: number;
    elevation_m: number | null;
    origin?: string;
  }>;
  distanceM: number;
  elevationGainM: number | null;
  warnings: string[];
};

export type GpxUploadResult = {
  ok: true;
  import: HikingEntity & { import_id: string };
  preview: GpxPreview;
  nextStep: string;
};

export type RouteApplyResult = {
  ok: true;
  import_id: string;
  route_version_id: string;
  point_count: number;
  segment_count: number;
  distance_m: number;
  elevation_gain_m: number | null;
  route_index?: number;
  route_name?: string | null;
  route_candidate_count?: number;
  publication_status: "draft";
  nextStep: string;
};

export type MapPoint = { latitude: number; longitude: number; label?: string };
