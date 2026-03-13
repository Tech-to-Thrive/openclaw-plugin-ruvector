/**
 * Tests for RuVectorClient HTTP wrapper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuVectorClient } from "../client.js";

const logger = { info: vi.fn(), warn: vi.fn() };

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function errorResponse(body: string, status: number) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  };
}

describe("RuVectorClient", () => {
  let client: RuVectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RuVectorClient("http://localhost:6333", logger);
  });

  describe("health()", () => {
    it("returns true when server is healthy", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }));
      expect(await client.health()).toBe(true);
    });

    it("returns false when server is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      expect(await client.health()).toBe(false);
    });
  });

  describe("createCollection()", () => {
    it("sends correct POST request", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await client.createCollection("test_col", 3072);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:6333/collections",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "test_col", dimension: 3072, metric: "cosine" }),
        }),
      );
    });
  });

  describe("ensureCollection()", () => {
    it("skips creation if collection exists", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ count: 42, dimension: 3072 }));
      await client.ensureCollection("test_col", 3072);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("creates collection if not found", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse("not found", 404))
        .mockResolvedValueOnce(jsonResponse({}));
      await client.ensureCollection("test_col", 3072);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("created collection"));
    });
  });

  describe("upsert()", () => {
    it("sends points and returns IDs", async () => {
      const points = [
        { id: "id-1", vector: [0.1, 0.2], metadata: { text: "hello" } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ ids: ["id-1"] }));
      const ids = await client.upsert("col", points);
      expect(ids).toEqual(["id-1"]);
    });

    it("falls back to point IDs when response has no ids", async () => {
      const points = [
        { id: "id-1", vector: [0.1, 0.2], metadata: { text: "hello" } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      const ids = await client.upsert("col", points);
      expect(ids).toEqual(["id-1"]);
    });
  });

  describe("search()", () => {
    it("returns search results", async () => {
      const mockResults = [
        { id: "id-1", score: 0.95, metadata: { text: "hello", agent_id: "test" } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: mockResults }));

      const results = await client.search("col", { vector: [0.1], k: 5 });
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
    });

    it("sends filter in search body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      await client.search("col", {
        vector: [0.1],
        k: 5,
        filter: { agent_id: "test" },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.filter).toEqual({ agent_id: "test" });
    });
  });

  describe("get()", () => {
    it("returns point by ID", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: "id-1", score: 1, metadata: { text: "hello" } }),
      );
      const result = await client.get("col", "id-1");
      expect(result).not.toBeNull();
      expect(result?.metadata.text).toBe("hello");
    });

    it("returns null for 404", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("not found", 404));
      const result = await client.get("col", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("delete()", () => {
    it("sends delete request with IDs", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await client.delete("col", ["id-1", "id-2"]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ids).toEqual(["id-1", "id-2"]);
    });
  });

  describe("deleteByFilter()", () => {
    it("sends delete request with filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await client.deleteByFilter("col", { chunk_hash: "abc123" });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.filter).toEqual({ chunk_hash: "abc123" });
    });
  });

  describe("error handling", () => {
    it("throws on server errors with status and body", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse("internal error", 500));
      await expect(client.createCollection("col", 3072)).rejects.toThrow("RuVector 500");
    });

    it("handles timeout via AbortController", async () => {
      mockFetch.mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error("aborted")), 100);
        }),
      );
      // health() has 3s timeout but we mock immediate abort
      const result = await client.health();
      expect(result).toBe(false);
    });
  });

  describe("listCollections()", () => {
    it("returns collection names", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ collections: ["col1", "col2"] }));
      const result = await client.listCollections();
      expect(result).toEqual(["col1", "col2"]);
    });
  });
});
