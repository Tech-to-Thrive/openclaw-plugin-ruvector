/**
 * RuVector HTTP client — thin wrapper around native fetch().
 * All heavy lifting happens in the Rust server; this is orchestration only.
 */

import type { RuVectorPoint, RuVectorSearchQuery, RuVectorSearchResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const REINDEX_TIMEOUT_MS = 900_000; // 15 minutes for reindex

export class RuVectorClient {
  constructor(
    private readonly uri: string,
    private readonly logger: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit & { timeout?: number } = {},
  ): Promise<T> {
    const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOpts } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.uri}${path}`, {
        ...fetchOpts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...fetchOpts.headers,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`RuVector ${response.status}: ${body.slice(0, 200)}`);
      }

      const text = await response.text();
      return text ? (JSON.parse(text) as T) : ({} as T);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.request<unknown>("/health", { method: "GET", timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async createCollection(name: string, dimension: number, metric = "cosine"): Promise<void> {
    await this.request(`/collections`, {
      method: "POST",
      body: JSON.stringify({ name, dimension, metric }),
    });
  }

  async ensureCollection(name: string, dimension: number): Promise<void> {
    try {
      await this.request<unknown>(`/collections/${encodeURIComponent(name)}`, { method: "GET" });
    } catch (err) {
      if (String(err).includes("404") || String(err).includes("not found")) {
        await this.createCollection(name, dimension);
        this.logger.info(`memory-ruvector: created collection "${name}" (dim=${dimension})`);
      } else {
        throw err;
      }
    }
  }

  async upsert(collection: string, points: RuVectorPoint[]): Promise<string[]> {
    const result = await this.request<{ ids?: string[] }>(
      `/collections/${encodeURIComponent(collection)}/points`,
      {
        method: "PUT",
        body: JSON.stringify({ points }),
      },
    );
    return result.ids ?? points.map((p) => p.id);
  }

  async search(
    collection: string,
    query: RuVectorSearchQuery,
  ): Promise<RuVectorSearchResult[]> {
    const result = await this.request<{ results?: RuVectorSearchResult[] }>(
      `/collections/${encodeURIComponent(collection)}/points/search`,
      {
        method: "POST",
        body: JSON.stringify(query),
      },
    );
    return result.results ?? [];
  }

  async get(collection: string, id: string): Promise<RuVectorSearchResult | null> {
    try {
      return await this.request<RuVectorSearchResult>(
        `/collections/${encodeURIComponent(collection)}/points/${encodeURIComponent(id)}`,
        { method: "GET" },
      );
    } catch (err) {
      if (String(err).includes("404")) return null;
      throw err;
    }
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    await this.request(
      `/collections/${encodeURIComponent(collection)}/points/delete`,
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    );
  }

  async deleteByFilter(collection: string, filter: Record<string, unknown>): Promise<void> {
    await this.request(
      `/collections/${encodeURIComponent(collection)}/points/delete`,
      {
        method: "POST",
        body: JSON.stringify({ filter }),
      },
    );
  }

  async listCollections(): Promise<string[]> {
    const result = await this.request<{ collections?: string[] }>("/collections", {
      method: "GET",
    });
    return result.collections ?? [];
  }

  async collectionInfo(name: string): Promise<{ count: number; dimension: number }> {
    return this.request<{ count: number; dimension: number }>(
      `/collections/${encodeURIComponent(name)}`,
      { method: "GET" },
    );
  }

  async count(collection: string): Promise<number> {
    const info = await this.collectionInfo(collection);
    return info.count ?? 0;
  }
}
