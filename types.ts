/**
 * Type definitions for memory-ruvector plugin.
 */

export type MemoryCategory = "preference" | "fact" | "decision" | "entity" | "other";

export const MEMORY_CATEGORIES = ["preference", "fact", "decision", "entity", "other"] as const;

export interface MemoryPoint {
  id: string;
  vector: number[];
  metadata: {
    agent_id: string;
    text: string;
    category: string;
    chunk_hash: string;
    importance: number;
    scope?: string;
    source?: string;
    shared_by?: string;
    shared_scope?: string;
    supersedes?: string;
    created_at: string;
    updated_at: string;
    ttl_expires?: string;
  };
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: MemoryPoint["metadata"];
}

export interface RuVectorPoint {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface RuVectorSearchQuery {
  vector: number[];
  k: number;
  score_threshold?: number;
  filter?: Record<string, unknown>;
}

export interface RuVectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly cacheSize: number;
}
