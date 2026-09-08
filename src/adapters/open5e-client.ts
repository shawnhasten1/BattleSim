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

export type Open5eCompendiumCategory = "all" | "creatures" | "spells" | "items" | "features" | "conditions";

export type Open5eCompendiumResource = "creature" | "spell" | "item" | "weapon" | "feature" | "condition" | "rule";

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

export interface Open5eCompendiumSummary {
  key: string;
  objectKey: string;
  slug: string;
  name: string;
  resource: Open5eCompendiumResource;
  model?: string;
  route?: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
  text?: string;
  highlighted?: string;
  raw: Record<string, unknown>;
}

export interface Open5eImportedPayload {
  provider: "open5e";
  resource: "creature" | "spell" | "item" | "weapon" | "feature" | "condition" | "rule";
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

  async searchCompendium(options: Open5eSearchOptions & { category?: Open5eCompendiumCategory }): Promise<Open5eCompendiumSummary[]> {
    const category = options.category ?? "all";
    if (category === "creatures") {
      const results = await this.searchCreatures(options);
      return results.map((result) => ({
        ...result,
        objectKey: result.slug,
        resource: "creature",
        model: "Creature",
        route: "v2/creatures/"
      }));
    }
    if (category === "spells") {
      const results = await this.searchSpells(options);
      return results.map((result) => ({
        ...result,
        objectKey: result.slug,
        resource: "spell",
        model: "Spell",
        route: "v2/spells/"
      }));
    }
    if (category === "items") {
      return this.searchEndpoint("/items/", options, "item", "Item", "key,name,document,category,weapon");
    }
    if (category === "conditions") {
      return this.searchEndpoint("/conditions/", options, "condition", "Condition", "key,name,document,desc");
    }

    const url = this.v2Url("/search/");
    url.searchParams.set("query", options.query);
    url.searchParams.set("limit", String(options.limit ?? 20));
    const data = await this.fetchJson(url);
    return data.results
      .map((record, index) => this.searchResultToCompendiumSummary(record, index))
      .filter((result) => !options.documentKey || result.documentKey === options.documentKey)
      .filter((result) => category !== "features" || result.resource === "feature" || result.resource === "rule");
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
      key: stringField(raw, "key") ?? slug,
      documentKey: readNestedString(raw, ["document", "key"]),
      importedAt: new Date().toISOString(),
      payloadVersion: "v2",
      raw
    };
  }

  async importCompendiumRecord(route: string, key: string): Promise<Open5eImportedPayload> {
    const normalizedRoute = normalizeRoute(route);
    if (!isAllowedRoute(normalizedRoute)) {
      throw new Error(`Unsupported Open5e route: ${route}`);
    }
    const raw = await this.fetchRecord(new URL(`/${normalizedRoute}${encodeURIComponent(key)}/`, this.baseUrl));
    return {
      provider: "open5e",
      resource: resourceFromRoute(normalizedRoute),
      slug: key,
      key: stringField(raw, "key") ?? key,
      documentKey: readNestedString(raw, ["document", "key"]),
      importedAt: new Date().toISOString(),
      payloadVersion: "v2",
      raw
    };
  }

  private async searchEndpoint(
    path: string,
    options: Open5eSearchOptions,
    resource: Open5eCompendiumResource,
    model: string,
    fields: string
  ): Promise<Open5eCompendiumSummary[]> {
    const url = this.v2Url(path);
    url.searchParams.set("name__icontains", options.query);
    url.searchParams.set("fields", fields);
    url.searchParams.set("limit", String(options.limit ?? 20));
    if (options.documentKey) {
      url.searchParams.set("document__key", options.documentKey);
    }

    const data = await this.fetchJson(url);
    return data.results.map((record, index) => {
      const key = String(record.key ?? record.slug ?? "");
      const documentKey = readNestedString(record, ["document", "key"]);
      return {
        key: `${resource}:${documentKey ?? "unknown"}:${key || index}`,
        objectKey: key,
        slug: String(record.slug ?? key),
        name: String(record.name ?? "Unknown"),
        resource,
        model,
        route: `v2${path}`,
        level: typeof record.level === "number" ? record.level : undefined,
        documentKey,
        documentTitle: documentTitle(record),
        text: stringField(record, "desc"),
        raw: record
      };
    });
  }

  private searchResultToCompendiumSummary(record: Record<string, unknown>, index: number): Open5eCompendiumSummary {
    const object = record.object && typeof record.object === "object" ? record.object as Record<string, unknown> : undefined;
    const model = stringField(record, "object_model") ?? "Open5e";
    const route = stringField(record, "route");
    const objectKey = stringField(record, "object_pk") ?? stringField(record, "key") ?? `result-${index}`;
    const documentKey = readNestedString(record, ["document", "key"]);
    return {
      key: `search:${documentKey ?? "unknown"}:${objectKey}:${index}`,
      objectKey,
      slug: objectKey,
      name: stringField(record, "object_name") ?? stringField(record, "name") ?? "Unknown",
      resource: resourceFromModel(model, route),
      model,
      route,
      level: numberField(object, "level"),
      documentKey,
      documentTitle: documentTitle(record),
      text: stringField(record, "text"),
      highlighted: stringField(record, "highlighted"),
      raw: record
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

function numberField(record: Record<string, unknown> | undefined, field: string): number | undefined {
  if (!record) return undefined;
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function documentTitle(record: Record<string, unknown>): string | undefined {
  return readNestedString(record, ["document", "display_name"])
    ?? readNestedString(record, ["document", "title"])
    ?? readNestedString(record, ["document", "name"]);
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

function normalizeRoute(route: string): string {
  const withoutLeadingSlash = route.replace(/^\/+/, "");
  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`;
}

function isAllowedRoute(route: string): boolean {
  return [
    "v2/items/",
    "v2/weapons/",
    "v2/conditions/",
    "v2/rules/",
    "v2/feats/",
    "v2/classes/"
  ].includes(route);
}

function resourceFromRoute(route: string): Open5eCompendiumResource {
  if (route.includes("/weapons/")) return "weapon";
  if (route.includes("/items/")) return "item";
  if (route.includes("/conditions/")) return "condition";
  if (route.includes("/rules/")) return "rule";
  return "feature";
}

function resourceFromModel(model: string, route?: string): Open5eCompendiumResource {
  const loweredModel = model.toLowerCase();
  const loweredRoute = route?.toLowerCase() ?? "";
  if (loweredModel.includes("creature") || loweredRoute.includes("/creatures/")) return "creature";
  if (loweredModel.includes("spell") || loweredRoute.includes("/spells/")) return "spell";
  if (loweredModel.includes("condition") || loweredRoute.includes("/conditions/")) return "condition";
  if (loweredModel.includes("weapon") || loweredRoute.includes("/weapons/")) return "weapon";
  if (loweredModel.includes("item") || loweredRoute.includes("/items/")) return "item";
  if (loweredModel.includes("rule") || loweredRoute.includes("/rules/")) return "rule";
  return "feature";
}
