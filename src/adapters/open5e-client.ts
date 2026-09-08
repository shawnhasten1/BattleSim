import { z } from "zod";

const open5eListResponseSchema = z.object({
  count: z.number().optional(),
  next: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
  results: z.array(z.record(z.unknown()))
});

export interface Open5eSearchOptions {
  query: string;
  documentKey?: string;
  limit?: number;
}

export interface Open5eCreatureSummary {
  key: string;
  slug: string;
  name: string;
  documentKey?: string;
  documentTitle?: string;
  raw: Record<string, unknown>;
}

export interface Open5eSpellSummary {
  key: string;
  slug: string;
  name: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
  raw: Record<string, unknown>;
}

export interface Open5eImportedPayload {
  provider: "open5e";
  resource: "creature" | "spell";
  slug: string;
  key?: string;
  documentKey?: string;
  importedAt: string;
  payloadVersion: "v2";
  raw: Record<string, unknown>;
}

export class Open5eClient {
  private readonly baseUrl: URL;

  constructor(baseUrl = "https://api.open5e.com") {
    this.baseUrl = new URL(baseUrl);
  }

  async searchCreatures(options: Open5eSearchOptions): Promise<Open5eCreatureSummary[]> {
    const url = this.v2Url("/creatures/");
    url.searchParams.set("name__icontains", options.query);
    url.searchParams.set("fields", "key,slug,name,document");
    url.searchParams.set("limit", String(options.limit ?? 20));
    if (options.documentKey) {
      url.searchParams.set("document__key", options.documentKey);
    }

    const data = await this.fetchJson(url);
    return data.results.map((record, index) => {
      const key = String(record.key ?? "");
      const slug = String(record.slug ?? key);
      const documentKey = readNestedString(record, ["document", "key"]);
      return {
      key: `${documentKey ?? "unknown"}:${key || slug}:${index}`,
      slug,
      name: String(record.name ?? "Unknown creature"),
      documentKey,
      documentTitle: readNestedString(record, ["document", "title"]) ?? readNestedString(record, ["document", "name"]),
      raw: record
    };
    });
  }

  async importCreature(slug: string): Promise<Open5eImportedPayload> {
    const url = this.v2Url(`/creatures/${encodeURIComponent(slug)}/`);
    const raw = await this.fetchRecord(url);
    return {
      provider: "open5e",
      resource: "creature",
      slug,
      key: stringField(raw, "key") ?? slug,
      documentKey: readNestedString(raw, ["document", "key"]),
      importedAt: new Date().toISOString(),
      payloadVersion: "v2",
      raw
    };
  }

  async searchSpells(options: Open5eSearchOptions): Promise<Open5eSpellSummary[]> {
    const url = this.v2Url("/spells/");
    url.searchParams.set("name__icontains", options.query);
    url.searchParams.set("fields", "key,slug,name,level,document");
    url.searchParams.set("limit", String(options.limit ?? 20));
    if (options.documentKey) {
      url.searchParams.set("document__key", options.documentKey);
    }

    const data = await this.fetchJson(url);
    return data.results.map((record, index) => {
      const key = String(record.key ?? "");
      const slug = String(record.slug ?? key);
      const documentKey = readNestedString(record, ["document", "key"]);
      return {
        key: `${documentKey ?? "unknown"}:${key || slug}:${index}`,
        slug,
        name: String(record.name ?? "Unknown spell"),
        level: typeof record.level === "number" ? record.level : undefined,
        documentKey,
        documentTitle: readNestedString(record, ["document", "title"]) ?? readNestedString(record, ["document", "name"]),
        raw: record
      };
    });
  }

  async importSpell(slug: string): Promise<Open5eImportedPayload> {
    const url = this.v2Url(`/spells/${encodeURIComponent(slug)}/`);
    const raw = await this.fetchRecord(url);
    return {
      provider: "open5e",
      resource: "spell",
      slug,
      documentKey: readNestedString(raw, ["document", "key"]),
      importedAt: new Date().toISOString(),
      payloadVersion: "v2",
      raw
    };
  }

  private v2Url(path: string): URL {
    return new URL(`/v2${path}`, this.baseUrl);
  }

  private async fetchJson(url: URL): Promise<z.infer<typeof open5eListResponseSchema>> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open5e request failed with ${response.status}: ${url.pathname}`);
    }
    return open5eListResponseSchema.parse(await response.json());
  }

  private async fetchRecord(url: URL): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open5e request failed with ${response.status}: ${url.pathname}`);
    }
    return z.record(z.unknown()).parse(await response.json());
  }
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let value: unknown = record;
  for (const segment of path) {
    if (!value || typeof value !== "object" || !(segment in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : undefined;
}
