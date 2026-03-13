/**
 * Pluggable embedding providers for memory-ruvector.
 * Uses OpenAI SDK for OpenAI-compatible endpoints (Gemini, OpenAI, etc.)
 */

import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { EmbeddingProvider } from "./types.js";
import { vectorDimsForModel } from "./config.js";

// LRU embedding cache — eliminates 200-400ms per repeated prompt
const EMBEDDING_CACHE_MAX = 1000;
const EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type CacheEntry = {
  vector: number[];
  createdAt: number;
};

class EmbeddingCache {
  private cache = new Map<string, CacheEntry>();

  private makeKey(model: string, text: string): string {
    return createHash("sha256").update(`${model}:${text}`).digest("hex");
  }

  get(model: string, text: string): number[] | undefined {
    const key = this.makeKey(model, text);
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > EMBEDDING_CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.vector;
  }

  set(model: string, text: string, vector: number[]): void {
    const key = this.makeKey(model, text);
    if (this.cache.size >= EMBEDDING_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { vector, createdAt: Date.now() });
  }

  get size(): number {
    return this.cache.size;
  }
}

export class OpenAICompatibleEmbedding implements EmbeddingProvider {
  private client: OpenAI;
  private cache = new EmbeddingCache();
  readonly dimensions: number;

  constructor(
    apiKey: string,
    private model: string,
    baseUrl?: string,
    explicitDimensions?: number,
  ) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.dimensions = explicitDimensions ?? vectorDimsForModel(model) ?? 3072;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(this.model, text);
    if (cached) return cached;

    const params: { model: string; input: string; dimensions?: number } = {
      model: this.model,
      input: text,
    };
    if (this.dimensions) {
      params.dimensions = this.dimensions;
    }

    // Retry once on transient errors
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.embeddings.create(params);
        if (!response?.data?.[0]?.embedding) {
          throw new Error(
            `Embedding API returned malformed response: missing data[0].embedding (model: ${this.model})`,
          );
        }
        const vector = response.data[0].embedding;
        this.cache.set(this.model, text, vector);
        return vector;
      } catch (err) {
        const errMsg = String(err);
        const status = (err as { status?: number })?.status;
        const isTransient =
          status === 429 ||
          (status !== undefined && status >= 500) ||
          errMsg.includes("ECONNRESET") ||
          errMsg.includes("ETIMEDOUT");
        if (isTransient && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new Error(
          `Embedding failed (model: ${this.model}, attempt: ${attempt + 1}): ${errMsg.slice(0, 300)}`,
        );
      }
    }
    throw new Error("Embedding failed: exhausted retries");
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Serial for now — embedding APIs often rate-limit batch calls
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
