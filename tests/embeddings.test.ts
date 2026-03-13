/**
 * Tests for embedding providers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAICompatibleEmbedding } from "../embeddings.js";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockCreate };
    },
  };
});

describe("OpenAICompatibleEmbedding", () => {
  let embedding: OpenAICompatibleEmbedding;

  beforeEach(() => {
    mockCreate.mockReset();
    embedding = new OpenAICompatibleEmbedding(
      "test-key",
      "gemini-embedding-2-preview",
      "https://api.example.com",
      3072,
    );
  });

  it("returns embedding vector from API", async () => {
    const vector = Array.from({ length: 3072 }, (_, i) => i * 0.001);
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: vector }],
    });

    const result = await embedding.embed("hello world");
    expect(result).toEqual(vector);
    expect(result).toHaveLength(3072);
  });

  it("caches embedding for repeated calls", async () => {
    const vector = [0.1, 0.2, 0.3];
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: vector }],
    });

    const result1 = await embedding.embed("cached text");
    const result2 = await embedding.embed("cached text");

    expect(result1).toEqual(vector);
    expect(result2).toEqual(vector);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("reports cache size", async () => {
    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1] }],
    });

    expect(embedding.cacheSize).toBe(0);
    await embedding.embed("text1");
    expect(embedding.cacheSize).toBe(1);
    await embedding.embed("text2");
    expect(embedding.cacheSize).toBe(2);
  });

  it("throws on malformed API response", async () => {
    mockCreate.mockResolvedValueOnce({ data: [] });
    await expect(embedding.embed("bad")).rejects.toThrow("malformed response");
  });

  it("retries on transient errors", async () => {
    const transientErr = new Error("rate limit") as Error & { status: number };
    transientErr.status = 429;
    mockCreate
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({ data: [{ embedding: [0.1] }] });

    const result = await embedding.embed("retry me");
    expect(result).toEqual([0.1]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on transient errors", async () => {
    const transientErr = new Error("server error") as Error & { status: number };
    transientErr.status = 500;
    mockCreate.mockRejectedValue(transientErr);

    await expect(embedding.embed("fail")).rejects.toThrow("Embedding failed");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-transient errors", async () => {
    mockCreate.mockRejectedValueOnce(new Error("invalid_api_key"));
    await expect(embedding.embed("fail")).rejects.toThrow("Embedding failed");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("uses known dimensions for model", () => {
    const emb = new OpenAICompatibleEmbedding("key", "gemini-embedding-2-preview");
    expect(emb.dimensions).toBe(3072);
  });

  it("uses explicit dimensions over model default", () => {
    const emb = new OpenAICompatibleEmbedding("key", "gemini-embedding-2-preview", undefined, 1536);
    expect(emb.dimensions).toBe(1536);
  });

  describe("embedBatch()", () => {
    it("embeds multiple texts sequentially", async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }],
      });

      const results = await embedding.embedBatch(["text1", "text2", "text3"]);
      expect(results).toHaveLength(3);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
