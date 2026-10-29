import type { HikingEntity, MapPoint } from "./types";

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function generatedMountainCode(value: string): string {
  const result = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);
  return result.length >= 2 ? result : "GUNUNG-BARU";
}

export function readRouteLines(geojson: unknown): number[][][] {
  if (!geojson || typeof geojson !== "object") return [];
  const record = geojson as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(record.coordinates)) return [];
  const coordinates = record.coordinates as unknown[];
  const segments = record.type === "LineString" ? [coordinates] : record.type === "MultiLineString" ? coordinates : [];
  return segments.map((segment) => Array.isArray(segment)
    ? segment.filter((point): point is number[] => Array.isArray(point) && point.length >= 2
      && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map((point) => [Number(point[0]), Number(point[1])])
    : []).filter((segment) => segment.length >= 2);
}

export function greatCircleDistanceKm(a: MapPoint, b: MapPoint): number {
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function entityId(entity: HikingEntity | null | undefined, type: "mountain" | "trail" | "checkpoint" | "source" | "operator" | "advisory" | "media"): string | null {
  if (!entity) return null;
  const key = {
    mountain: "mountain_id",
    trail: "trail_id",
    checkpoint: "checkpoint_id",
    source: "source_id",
    operator: "operator_id",
    advisory: "advisory_id",
    media: "media_id",
  }[type];
  const value = entity[key];
  return typeof value === "string" ? value : null;
}

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
