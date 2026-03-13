/**
 * Configuration types and validation for memory-ruvector plugin.
 */

import type { MemoryCategory } from "./types.js";

export type RuVectorMemoryConfig = {
  uri: string;
  collectionName: string;
  embedding: {
    provider: "openai-compatible";
    model: string;
    apiKey: string;
    baseUrl?: string;
    dimensions?: number;
  };
  autoRecall: boolean;
  autoCapture: boolean;
  captureMaxChars: number;
  recallLimit: number;
  recallMinScore: number;
  sensitiveAgents?: string[];
  ttlEnabled: boolean;
  importanceDefault: number;
};

export { MEMORY_CATEGORIES, type MemoryCategory } from "./types.js";

const DEFAULT_URI = "http://localhost:6333";
const DEFAULT_COLLECTION = "fleet_memory";
const DEFAULT_MODEL = "gemini-embedding-2-preview";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_CAPTURE_MAX_CHARS = 500;
const DEFAULT_RECALL_LIMIT = 3;
const DEFAULT_RECALL_MIN_SCORE = 0.01;
const DEFAULT_IMPORTANCE = 0.5;

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "gemini-embedding-2-preview": 3072,
  "text-embedding-004": 3072,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

export const GEMINI_SUPPORTED_DIMENSIONS: Record<string, number[]> = {
  "gemini-embedding-2-preview": [768, 1536, 3072],
  "text-embedding-004": [768, 1536, 3072],
};

const COLLECTION_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function vectorDimsForModel(model: string): number | undefined {
  return EMBEDDING_DIMENSIONS[model];
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function resolveEmbeddingModel(embedding: Record<string, unknown>): string {
  const model = typeof embedding.model === "string" ? embedding.model : DEFAULT_MODEL;
  if (typeof embedding.dimensions !== "number") {
    const knownDims = vectorDimsForModel(model);
    if (knownDims === undefined) {
      throw new Error(`Unknown embedding model "${model}" — set embedding.dimensions explicitly`);
    }
  }
  return model;
}

function validateGeminiDimensions(model: string, dimensions: number): void {
  const supported = GEMINI_SUPPORTED_DIMENSIONS[model];
  if (supported && !supported.includes(dimensions)) {
    throw new Error(
      `Gemini model "${model}" does not support dimensions=${dimensions}. Supported: ${supported.join(", ")}`,
    );
  }
}

export const ruvectorMemoryConfigSchema = {
  parse(value: unknown): RuVectorMemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-ruvector config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      [
        "uri", "collectionName", "embedding",
        "autoCapture", "autoRecall", "captureMaxChars",
        "recallLimit", "recallMinScore", "sensitiveAgents",
        "ttlEnabled", "importanceDefault",
      ],
      "memory-ruvector config",
    );

    const embedding = cfg.embedding as Record<string, unknown> | undefined;
    if (!embedding || typeof embedding.apiKey !== "string") {
      throw new Error("embedding.apiKey is required");
    }
    assertAllowedKeys(embedding, ["apiKey", "model", "baseUrl", "dimensions", "provider"], "embedding config");

    const model = resolveEmbeddingModel(embedding);
    const explicitDimensions = typeof embedding.dimensions === "number" ? embedding.dimensions : undefined;
    if (explicitDimensions !== undefined) {
      validateGeminiDimensions(model, explicitDimensions);
    }

    const captureMaxChars =
      typeof cfg.captureMaxChars === "number" ? Math.floor(cfg.captureMaxChars) : undefined;
    if (typeof captureMaxChars === "number" && (captureMaxChars < 100 || captureMaxChars > 10_000)) {
      throw new Error("captureMaxChars must be between 100 and 10000");
    }

    const recallLimit =
      typeof cfg.recallLimit === "number" ? Math.floor(cfg.recallLimit) : DEFAULT_RECALL_LIMIT;
    if (recallLimit < 1 || recallLimit > 20) {
      throw new Error("recallLimit must be between 1 and 20");
    }

    const recallMinScore =
      typeof cfg.recallMinScore === "number" ? cfg.recallMinScore : DEFAULT_RECALL_MIN_SCORE;
    if (recallMinScore < 0 || recallMinScore > 1) {
      throw new Error("recallMinScore must be between 0 and 1");
    }

    const collectionName =
      typeof cfg.collectionName === "string" ? cfg.collectionName : DEFAULT_COLLECTION;
    if (!COLLECTION_NAME_PATTERN.test(collectionName)) {
      throw new Error(
        `Invalid collectionName "${collectionName}" — must match: letter/underscore start, alphanumeric/underscores only`,
      );
    }

    const uri = typeof cfg.uri === "string" ? cfg.uri : DEFAULT_URI;
    if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
      throw new Error("uri must start with http:// or https://");
    }

    let sensitiveAgents: string[] | undefined;
    if (Array.isArray(cfg.sensitiveAgents)) {
      sensitiveAgents = cfg.sensitiveAgents.filter(
        (a): a is string => typeof a === "string" && /^[a-zA-Z0-9_-]+$/.test(a),
      );
    }

    const importanceDefault =
      typeof cfg.importanceDefault === "number"
        ? Math.max(0, Math.min(1, cfg.importanceDefault))
        : DEFAULT_IMPORTANCE;

    return {
      uri,
      collectionName,
      embedding: {
        provider: "openai-compatible",
        model,
        apiKey: resolveEnvVars(embedding.apiKey as string),
        baseUrl:
          typeof embedding.baseUrl === "string"
            ? resolveEnvVars(embedding.baseUrl)
            : DEFAULT_BASE_URL,
        dimensions: explicitDimensions,
      },
      autoCapture: cfg.autoCapture === true,
      autoRecall: cfg.autoRecall !== false,
      captureMaxChars: captureMaxChars ?? DEFAULT_CAPTURE_MAX_CHARS,
      recallLimit,
      recallMinScore,
      sensitiveAgents,
      ttlEnabled: cfg.ttlEnabled !== false,
      importanceDefault,
    };
  },
  uiHints: {
    uri: {
      label: "RuVector URI",
      placeholder: DEFAULT_URI,
      help: "HTTP endpoint for RuVector server",
    },
    "embedding.apiKey": {
      label: "Embedding API Key",
      sensitive: true,
      placeholder: "${GOOGLE_API_KEY}",
      help: "API key for embeddings — defaults to Google Gemini",
    },
    "embedding.model": {
      label: "Embedding Model",
      placeholder: DEFAULT_MODEL,
      help: "Embedding model (default: Gemini Embedding 2)",
    },
    "embedding.baseUrl": {
      label: "Base URL",
      placeholder: DEFAULT_BASE_URL,
      help: "Base URL for embedding provider",
      advanced: true,
    },
    "embedding.dimensions": {
      label: "Dimensions",
      placeholder: "3072",
      help: "Vector dimensions",
      advanced: true,
    },
    collectionName: {
      label: "Collection Name",
      placeholder: DEFAULT_COLLECTION,
      help: "RuVector collection name",
      advanced: true,
    },
    autoCapture: {
      label: "Auto-Capture",
      help: "Automatically capture important information from conversations (default: off)",
    },
    autoRecall: {
      label: "Auto-Recall",
      help: "Automatically inject relevant memories into context (default: on)",
    },
    captureMaxChars: {
      label: "Capture Max Chars",
      help: "Maximum message length eligible for auto-capture",
      advanced: true,
      placeholder: String(DEFAULT_CAPTURE_MAX_CHARS),
    },
    recallLimit: {
      label: "Recall Limit",
      help: "Maximum number of memories to inject during auto-recall",
      advanced: true,
      placeholder: String(DEFAULT_RECALL_LIMIT),
    },
    recallMinScore: {
      label: "Recall Min Score",
      help: "Minimum similarity score (0-1) for auto-recall results",
      advanced: true,
      placeholder: String(DEFAULT_RECALL_MIN_SCORE),
    },
    sensitiveAgents: {
      label: "Additional Sensitive Agents",
      help: "Extra agent IDs to privacy-isolate (added to built-in: finance, hr, home, vendor)",
      advanced: true,
    },
    ttlEnabled: {
      label: "TTL Enabled",
      help: "Enable time-to-live for memories (default: on)",
      advanced: true,
    },
    importanceDefault: {
      label: "Default Importance",
      help: "Default importance score for new memories (0-1)",
      advanced: true,
      placeholder: String(DEFAULT_IMPORTANCE),
    },
  },
};
