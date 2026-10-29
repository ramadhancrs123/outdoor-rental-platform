import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { LogoControl } from "@maptoolkit/maplibre-logo-control";
import "@maptoolkit/maplibre-logo-control/style.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, MousePointer2 } from "lucide-react";
import type { MapPoint } from "./types";
import { readRouteLines } from "./utils";

maplibregl.setWorkerUrl(mapWorkerUrl);

type Props = {
  center?: MapPoint | null;
  selectedPoint?: MapPoint | null;
  routeGeoJson?: unknown;
  points?: Array<MapPoint & { kind?: string }>;
  pickMode?: boolean;
  onPickPoint?: (point: MapPoint) => void;
  heightClassName?: string;
};
type Coordinate = [number, number];
type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: Coordinate } | { type: "LineString"; coordinates: Coordinate[] };
    properties: Record<string, string | number | null>;
  }>;
};

const DEFAULT_CENTER: MapPoint = { latitude: -2.5, longitude: 117.5 };
const BASEMAP_STYLE = "https://styles.maptoolkit.org/hiking.json";

function asCollection(features: FeatureCollection["features"]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export function HikingMapCanvas({
  center,
  selectedPoint,
  routeGeoJson,
  points = [],
  pickMode = false,
  onPickPoint,
  heightClassName = "h-[390px]",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onPickRef = useRef(onPickPoint);
  const pickModeRef = useRef(pickMode);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => { onPickRef.current = onPickPoint; }, [onPickPoint]);
  useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);

  const initialCenter = center ?? selectedPoint ?? DEFAULT_CENTER;
  const routeData = useMemo(() => {
    const features: FeatureCollection["features"] = [];
    for (const [index, line] of readRouteLines(routeGeoJson).entries()) {
      const coordinates = line.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
        && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
        .map((point) => [point[0], point[1]] as Coordinate);
      if (coordinates.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: { index },
        });
      }
    }
    return asCollection(features);
  }, [routeGeoJson]);

  const pointData = useMemo(() => asCollection(points
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180)
    .map((point, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] as Coordinate },
      properties: { label: point.label ?? ("Titik " + (index + 1)), kind: point.kind ?? "checkpoint" },
    }))), [points]);

  const selectedData = useMemo(() => asCollection(selectedPoint
    && Number.isFinite(selectedPoint.latitude) && Number.isFinite(selectedPoint.longitude)
    && Math.abs(selectedPoint.latitude) <= 90 && Math.abs(selectedPoint.longitude) <= 180
    ? [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [selectedPoint.longitude, selectedPoint.latitude] as Coordinate },
        properties: { label: "Lokasi terpilih", kind: "selected" },
      }]
    : []), [selectedPoint]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    let disposed = false;
    const map = new maplibregl.Map({
      container: host,
      style: BASEMAP_STYLE,
      center: [initialCenter.longitude, initialCenter.latitude],
      zoom: center || selectedPoint ? 9 : 4.5,
      minZoom: 2,
      maxZoom: 18,
      attributionControl: { customAttribution: "", compact: false },
      cooperativeGestures: true,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    map.addControl(new LogoControl(), "bottom-left");
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");

    const installLayers = () => {
      if (disposed || map.getSource("hiking-route-lines")) return;
      map.addSource("hiking-route-lines", { type: "geojson", data: routeData as never });
      map.addSource("hiking-route-points", { type: "geojson", data: pointData as never });
      map.addSource("hiking-selected-point", { type: "geojson", data: selectedData as never });

      map.addLayer({
        id: "hiking-route-casing",
        type: "line",
        source: "hiking-route-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.92 },
      });
      map.addLayer({
        id: "hiking-route-main",
        type: "line",
        source: "hiking-route-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0f766e", "line-width": 4, "line-opacity": 0.96 },
      });
      map.addLayer({
        id: "hiking-checkpoint-circles",
        type: "circle",
        source: "hiking-route-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 10, 6, 16, 8],
          "circle-color": ["match", ["get", "kind"], "basecamp", "#2563eb", "summit", "#b91c1c", "#0f766e"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "hiking-checkpoint-labels",
        type: "symbol",
        source: "hiking-route-points",
        minzoom: 9,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-max-width": 14,
          "text-optional": true,
        },
        paint: {
          "text-color": "#12312d",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
      map.addLayer({
        id: "hiking-selected-halo",
        type: "circle",
        source: "hiking-selected-point",
        paint: { "circle-radius": 13, "circle-color": "#c2410c", "circle-opacity": 0.18 },
      });
      map.addLayer({
        id: "hiking-selected-marker",
        type: "circle",
        source: "hiking-selected-point",
        paint: { "circle-radius": 6, "circle-color": "#c2410c", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
      });
      setMapReady(true);
      setMapError(null);
    };

    map.on("load", installLayers);
    map.on("error", () => {
      if (!map.isStyleLoaded() && !disposed) {
        setMapError("Peta dasar belum dapat dimuat. Periksa koneksi atau coba lagi.");
      }
    });
    map.on("click", (event: MapMouseEvent) => {
      if (!pickModeRef.current || !onPickRef.current) return;
      onPickRef.current({
        latitude: Number(event.lngLat.lat.toFixed(7)),
        longitude: Number(event.lngLat.lng.toFixed(7)),
      });
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  // Props update map data separately so React does not recreate the base map.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSources = () => {
      const routeSource = map.getSource("hiking-route-lines") as GeoJSONSource | undefined;
      const pointSource = map.getSource("hiking-route-points") as GeoJSONSource | undefined;
      const selectedSource = map.getSource("hiking-selected-point") as GeoJSONSource | undefined;
      routeSource?.setData(routeData as never);
      pointSource?.setData(pointData as never);
      selectedSource?.setData(selectedData as never);
    };
    if (map.isStyleLoaded()) updateSources();
    else map.once("load", updateSources);
  }, [routeData, pointData, selectedData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(initialCenter.latitude) || !Number.isFinite(initialCenter.longitude)) return;
    map.easeTo({
      center: [initialCenter.longitude, initialCenter.latitude],
      duration: 250,
      zoom: center || selectedPoint ? Math.max(map.getZoom(), 9) : map.getZoom(),
    });
  }, [initialCenter.latitude, initialCenter.longitude, center, selectedPoint]);

  return (
    <div className="overflow-hidden rounded-2xl border bg-muted/10">
      <div className="relative">
        <div
          ref={hostRef}
          className={"relative w-full " + heightClassName + " bg-muted"}
          role="application"
          aria-label={pickMode
            ? "Peta interaktif. Klik atau ketuk lokasi untuk mengisi koordinat."
            : "Peta interaktif jalur pendakian."}
        />
        {!mapReady && !mapError ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/75 text-sm text-muted-foreground backdrop-blur-[1px]">
            <span className="flex items-center gap-2"><MapPin className="size-4 animate-pulse" />Memuat peta…</span>
          </div>
        ) : null}
        {mapError ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/95 p-5 text-center">
            <div className="max-w-xs">
              <MapPin className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">Peta belum tersedia</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{mapError}</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">Coba lagi</button>
            </div>
          </div>
        ) : null}
        {pickMode ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-primary/20 bg-background/95 px-3 py-2 text-xs font-medium shadow backdrop-blur">
            <MousePointer2 className="size-4 text-primary" /> Ketuk peta untuk memilih lokasi
          </div>
        ) : null}
      </div>
    </div>
  );
}
