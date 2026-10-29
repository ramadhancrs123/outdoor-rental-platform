import { describe, expect, it } from "vitest";
import { generatedMountainCode, greatCircleDistanceKm, numberValue, readRouteLines, slugify } from "./utils";

describe("hiking admin helpers", () => {
  it("creates readable URL slugs from Indonesian names", () => {
    expect(slugify("Gunung Ciremai & Jalur Palutungan")).toBe("gunung-ciremai-jalur-palutungan");
  });

  it("generates a normalized internal code", () => {
    expect(generatedMountainCode("Gunung Gede Pangrango")).toBe("GUNUNG-GEDE-PANGRANGO");
  });

  it("accepts valid LineString and MultiLineString route geometry only", () => {
    expect(readRouteLines({ type: "LineString", coordinates: [[106.1, -6.1], [106.2, -6.2]] })).toEqual([[[106.1, -6.1], [106.2, -6.2]]]);
    expect(readRouteLines({ type: "MultiLineString", coordinates: [[[106.1, -6.1], [106.2, -6.2]], [[106.3, -6.3], [106.4, -6.4]]] })).toHaveLength(2);
    expect(readRouteLines({ type: "Point", coordinates: [106.1, -6.1] })).toEqual([]);
    expect(readRouteLines({ type: "LineString", coordinates: [[106.1, -6.1]] })).toEqual([]);
  });

  it("calculates a plausible geographic distance", () => {
    const km = greatCircleDistanceKm({ latitude: -6.2, longitude: 106.8 }, { latitude: -6.21, longitude: 106.81 });
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(2);
  });

  it("rejects non-finite numeric values without inventing a number", () => {
    expect(numberValue("")).toBeNull();
    expect(numberValue(null)).toBeNull();
    expect(numberValue("not-a-number")).toBeNull();
    expect(numberValue("12.5")).toBe(12.5);
  });
});
