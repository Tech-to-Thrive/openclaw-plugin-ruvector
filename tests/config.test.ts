/**
 * Tests for config validation.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ruvectorMemoryConfigSchema, vectorDimsForModel } from "../config.js";

describe("ruvectorMemoryConfigSchema", () => {
  const validConfig = {
    embedding: {
      apiKey: "test-key",
      model: "gemini-embedding-2-preview",
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses minimal valid config with defaults", () => {
    const cfg = ruvectorMemoryConfigSchema.parse(validConfig);
    expect(cfg.uri).toBe("http://localhost:6333");
    expect(cfg.collectionName).toBe("fleet_memory");
    expect(cfg.embedding.model).toBe("gemini-embedding-2-preview");
    expect(cfg.autoRecall).toBe(true);
    expect(cfg.autoCapture).toBe(false);
    expect(cfg.recallLimit).toBe(3);
    expect(cfg.recallMinScore).toBe(0.01);
    expect(cfg.ttlEnabled).toBe(true);
    expect(cfg.importanceDefault).toBe(0.5);
  });

  it("accepts custom URI", () => {
    const cfg = ruvectorMemoryConfigSchema.parse({
      ...validConfig,
      uri: "http://ruvector.local:6333",
    });
    expect(cfg.uri).toBe("http://ruvector.local:6333");
  });

  it("rejects invalid URI scheme", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, uri: "ftp://localhost" }),
    ).toThrow("uri must start with http");
  });

  it("rejects null/undefined config", () => {
    expect(() => ruvectorMemoryConfigSchema.parse(null)).toThrow("config required");
    expect(() => ruvectorMemoryConfigSchema.parse(undefined)).toThrow("config required");
  });

  it("rejects missing apiKey", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ embedding: {} }),
    ).toThrow("apiKey is required");
  });

  it("rejects unknown config keys", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, bogusKey: true }),
    ).toThrow("unknown keys");
  });

  it("rejects unknown embedding keys", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({
        embedding: { apiKey: "k", badKey: "v" },
      }),
    ).toThrow("unknown keys");
  });

  it("validates captureMaxChars range", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, captureMaxChars: 50 }),
    ).toThrow("between 100 and 10000");
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, captureMaxChars: 20000 }),
    ).toThrow("between 100 and 10000");
  });

  it("validates recallLimit range", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, recallLimit: 0 }),
    ).toThrow("between 1 and 20");
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, recallLimit: 25 }),
    ).toThrow("between 1 and 20");
  });

  it("validates recallMinScore range", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, recallMinScore: -0.1 }),
    ).toThrow("between 0 and 1");
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, recallMinScore: 1.5 }),
    ).toThrow("between 0 and 1");
  });

  it("validates collectionName pattern", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, collectionName: "123bad" }),
    ).toThrow("Invalid collectionName");
    expect(() =>
      ruvectorMemoryConfigSchema.parse({ ...validConfig, collectionName: "has spaces" }),
    ).toThrow("Invalid collectionName");
  });

  it("accepts valid collectionName", () => {
    const cfg = ruvectorMemoryConfigSchema.parse({
      ...validConfig,
      collectionName: "_my_collection_123",
    });
    expect(cfg.collectionName).toBe("_my_collection_123");
  });

  it("resolves env vars in apiKey", () => {
    vi.stubEnv("TEST_API_KEY", "resolved-key");
    const cfg = ruvectorMemoryConfigSchema.parse({
      embedding: { apiKey: "${TEST_API_KEY}" },
    });
    expect(cfg.embedding.apiKey).toBe("resolved-key");
  });

  it("throws for unset env vars", () => {
    delete process.env.NONEXISTENT_KEY;
    expect(() =>
      ruvectorMemoryConfigSchema.parse({
        embedding: { apiKey: "${NONEXISTENT_KEY}" },
      }),
    ).toThrow("NONEXISTENT_KEY is not set");
  });

  it("validates Gemini dimension restrictions", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({
        embedding: {
          apiKey: "key",
          model: "gemini-embedding-2-preview",
          dimensions: 512,
        },
      }),
    ).toThrow("does not support dimensions=512");
  });

  it("accepts valid Gemini dimensions", () => {
    const cfg = ruvectorMemoryConfigSchema.parse({
      embedding: {
        apiKey: "key",
        model: "gemini-embedding-2-preview",
        dimensions: 1536,
      },
    });
    expect(cfg.embedding.dimensions).toBe(1536);
  });

  it("requires explicit dimensions for unknown models", () => {
    expect(() =>
      ruvectorMemoryConfigSchema.parse({
        embedding: { apiKey: "key", model: "unknown-model" },
      }),
    ).toThrow("set embedding.dimensions explicitly");
  });

  it("parses sensitiveAgents list", () => {
    const cfg = ruvectorMemoryConfigSchema.parse({
      ...validConfig,
      sensitiveAgents: ["custom-agent", "another", "inv@lid"],
    });
    // Invalid agent ID filtered out
    expect(cfg.sensitiveAgents).toEqual(["custom-agent", "another"]);
  });

  it("clamps importanceDefault to 0-1", () => {
    const cfg = ruvectorMemoryConfigSchema.parse({
      ...validConfig,
      importanceDefault: 2.0,
    });
    expect(cfg.importanceDefault).toBe(1);
  });
});

describe("vectorDimsForModel", () => {
  it("returns known dimensions", () => {
    expect(vectorDimsForModel("gemini-embedding-2-preview")).toBe(3072);
    expect(vectorDimsForModel("text-embedding-3-small")).toBe(1536);
  });

  it("returns undefined for unknown models", () => {
    expect(vectorDimsForModel("unknown")).toBeUndefined();
  });
});
