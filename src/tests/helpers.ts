import { vi } from "vitest";

type Json = Record<string, unknown>;

type StubFetchOptions<T extends Json> = {
  rows: T[];
  onCall?: (input: RequestInfo | URL, init?: RequestInit) => void;
};

const unquote = (value: string) =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

/**
 * Stub fetch for the Supabase/PostgREST data provider.
 * Body is a plain array, total comes from the `Content-Range` header, and
 * `limit` / `offset` query params plus the `order=field.asc` param drive
 * pagination and sorting so server-side table state can be asserted.
 * The legacy json-server conventions (`_start` / `_end` / `_sort` / `_order`
 * and `x-total-count`) are still honoured for the demo REST fallback.
 */
export function stubFetch<T extends Json>({ rows, onCall }: StubFetchOptions<T>) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      onCall?.(input, init);

      const rawUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl, "http://localhost");

      const offsetParam = url.searchParams.get("offset");
      const limitParam = url.searchParams.get("limit");
      const legacyStart = url.searchParams.get("_start");
      const legacyEnd = url.searchParams.get("_end");

      let start: number;
      let end: number;
      if (offsetParam !== null || limitParam !== null) {
        start = Number(offsetParam ?? 0) || 0;
        end =
          limitParam === null
            ? rows.length
            : start + (Number(limitParam) || 0);
      } else {
        start = Number(legacyStart ?? 0) || 0;
        end =
          legacyEnd === null
            ? rows.length
            : Number(legacyEnd) || start + rows.length;
      }

      const sortSpec: { field: string; direction: number }[] = [];
      const order = url.searchParams.get("order");
      if (order) {
        for (const part of order.split(",").filter(Boolean)) {
          const separator = part.lastIndexOf(".");
          const field = unquote(
            separator === -1 ? part : part.slice(0, separator),
          );
          const direction =
            separator !== -1 && part.slice(separator + 1) === "desc" ? -1 : 1;
          sortSpec.push({ field, direction });
        }
      } else {
        const sortFields = (url.searchParams.get("_sort") ?? "")
          .split(",")
          .filter(Boolean);
        const sortOrders = (url.searchParams.get("_order") ?? "").split(",");
        sortFields.forEach((field, index) => {
          sortSpec.push({
            field,
            direction: sortOrders[index] === "desc" ? -1 : 1,
          });
        });
      }

      const sorted = [...rows];
      if (sortSpec.length > 0) {
        sorted.sort((a, b) => {
          for (const { field, direction } of sortSpec) {
            const cmp = String(a[field] ?? "").localeCompare(
              String(b[field] ?? ""),
            );
            if (cmp !== 0) return cmp * direction;
          }
          return 0;
        });
      }

      const data = sorted.slice(start, end);
      const total = rows.length;
      const contentRange =
        data.length > 0
          ? `${start}-${start + data.length - 1}/${total}`
          : `*/${total}`;

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": contentRange,
          "x-total-count": String(total),
        },
      });
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
