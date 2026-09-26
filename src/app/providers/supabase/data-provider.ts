import type {
  BaseRecord,
  DataProvider,
  HttpError,
  MetaQuery,
} from "@refinedev/core";
import { createDataProvider } from "@refinedev/rest";
import type { CreateDataProviderOptions } from "@refinedev/rest";
import { appConfig } from "@/app/config";
import {
  buildFilterParam,
  buildIdFilter,
  buildIdsFilter,
  buildOrderParam,
  buildPaginationParams,
  resolvePrimaryKey,
  resolveSelect,
} from "./postgrest-query";

const { restUrl, anonKey, projectRef } = appConfig.supabase;

function readStoredAccessToken(): string | undefined {
  if (typeof window === "undefined" || !projectRef) return undefined;
  const raw = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
  if (!raw) return undefined;
  if (!raw.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    return typeof parsed.access_token === "string"
      ? parsed.access_token
      : undefined;
  } catch {
    return undefined;
  }
}

function authHeaders(meta?: MetaQuery): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${readStoredAccessToken() ?? anonKey}`,
  };
  const extra = meta?.headers;
  if (extra && typeof extra === "object") {
    for (const [name, value] of Object.entries(extra)) {
      if (typeof value === "string") headers[name] = value;
    }
  }
  return headers;
}

function parseContentRange(value: string | null): number {
  const total = value?.split("/")[1]?.trim();
  if (!total || total === "*") return -1;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : -1;
}

async function toHttpError(response: Response): Promise<HttpError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // body kosong / bukan JSON — pakai status text saja
  }
  const message =
    typeof body.message === "string" && body.message
      ? body.message
      : response.statusText || "Permintaan ke Supabase gagal";
  return { ...body, message, statusCode: response.status };
}

async function readRows(response: Response): Promise<BaseRecord[]> {
  if (!response.ok) throw await toHttpError(response);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw {
      message: "Respons Supabase tidak berupa daftar baris",
      statusCode: response.status,
    } satisfies HttpError;
  }
  return body as BaseRecord[];
}

async function readFirstRow(
  response: Response,
  emptyMessage: string,
  emptyStatus = 404,
): Promise<BaseRecord> {
  const rows = await readRows(response);
  const row = rows[0];
  if (!row) {
    throw { message: emptyMessage, statusCode: emptyStatus } satisfies HttpError;
  }
  return row;
}

const postgrestOptions: CreateDataProviderOptions = {
  getList: {
    async buildHeaders(params) {
      return { Prefer: "count=exact", ...authHeaders(params.meta) };
    },
    async buildQueryParams(params) {
      const query: Record<string, unknown> = {
        select: resolveSelect(params.meta),
      };
      const filters = buildFilterParam(params.filters);
      if (filters) query.and = filters;
      const order = buildOrderParam(params.sorters);
      if (order) query.order = order;
      Object.assign(query, buildPaginationParams(params.pagination));
      return query;
    },
    async mapResponse(response) {
      return readRows(response);
    },
    async getTotalCount(response) {
      return parseContentRange(response.headers.get("content-range"));
    },
  },
  getOne: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return authHeaders(params.meta);
    },
    async buildQueryParams(params) {
      return {
        select: resolveSelect(params.meta),
        [resolvePrimaryKey(params.meta)]: buildIdFilter(params.id),
      };
    },
    async mapResponse(response) {
      return readFirstRow(response, "Data tidak ditemukan");
    },
  },
  getMany: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return authHeaders(params.meta);
    },
    async buildQueryParams(params) {
      return {
        select: resolveSelect(params.meta),
        [resolvePrimaryKey(params.meta)]: buildIdsFilter(params.ids),
      };
    },
    async mapResponse(response) {
      return readRows(response);
    },
    transformError: toHttpError,
  },
  create: {
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async mapResponse(response) {
      return readFirstRow(
        response,
        "Penyimpanan gagal: tidak ada baris yang dikembalikan (cek RLS/grant)",
        403,
      );
    },
    transformError: toHttpError,
  },
  createMany: {
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async buildBodyParams(params) {
      return params.variables;
    },
    async mapResponse(response) {
      return readRows(response);
    },
    transformError: toHttpError,
  },
  update: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async buildQueryParams(params) {
      return {
        [resolvePrimaryKey(params.meta)]: buildIdFilter(params.id),
      };
    },
    async buildBodyParams(params) {
      return params.variables;
    },
    async mapResponse(response) {
      return readFirstRow(
        response,
        "Pembaruan gagal: tidak ada baris yang dikembalikan (cek RLS/grant)",
        403,
      );
    },
    transformError: toHttpError,
  },
  updateMany: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async buildQueryParams(params) {
      return {
        [resolvePrimaryKey(params.meta)]: buildIdsFilter(params.ids),
      };
    },
    async buildBodyParams(params) {
      return params.variables;
    },
    async mapResponse(response) {
      return readRows(response);
    },
    transformError: toHttpError,
  },
  deleteOne: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async buildQueryParams(params) {
      return {
        [resolvePrimaryKey(params.meta)]: buildIdFilter(params.id),
      };
    },
    async mapResponse(response) {
      return readFirstRow(
        response,
        "Penghapusan gagal: tidak ada baris yang dihapus (cek RLS/grant)",
        403,
      );
    },
    transformError: toHttpError,
  },
  deleteMany: {
    getEndpoint: (params) => params.resource,
    async buildHeaders(params) {
      return { Prefer: "return=representation", ...authHeaders(params.meta) };
    },
    async buildQueryParams(params) {
      return {
        [resolvePrimaryKey(params.meta)]: buildIdsFilter(params.ids),
      };
    },
    async mapResponse(response) {
      return readRows(response);
    },
  },
  custom: {
    async transformError(response) {
      return toHttpError(response);
    },
  },
};

const { dataProvider: baseDataProvider } = createDataProvider(
  restUrl,
  postgrestOptions,
);

const isAbsoluteUrl = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url);

export const supabaseDataProvider: DataProvider = {
  ...baseDataProvider,
  custom: async (params) => {
    const run = baseDataProvider.custom;
    if (!run) {
      throw {
        message: "custom data provider tidak tersedia",
        statusCode: 500,
      } satisfies HttpError;
    }
    return run({
      ...params,
      url: isAbsoluteUrl(params.url)
        ? params.url
        : `${restUrl}/${params.url.replace(/^\/+/, "")}`,
      headers: {
        ...authHeaders(params.meta),
        ...((params.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  },
};
