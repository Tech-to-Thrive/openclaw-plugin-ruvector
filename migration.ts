/**
 * Migration tool: Milvus Lite → RuVector
 *
 * Exports data from the Milvus Python bridge and imports into RuVector.
 * Can be run standalone via CLI or as part of plugin activation.
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { RuVectorClient } from "./client.js";
import type { RuVectorPoint } from "./types.js";

interface MilvusRecord {
  chunk_hash: string;
  content: string;
  source: string;
  heading: string;
  agent_id: string;
  embedding: number[];
  importance?: number;
  shared_scope?: string;
  shared_by?: string;
}

interface MigrationResult {
  exported: number;
  imported: number;
  errors: string[];
  agentCounts: Record<string, number>;
}

/**
 * Export all records from Milvus Lite via the Python bridge.
 * This requires the memory-milvus plugin's bridge to be available.
 */
async function exportFromMilvus(
  dbPath: string,
  collectionName: string,
): Promise<MilvusRecord[]> {
  const bridgePath = join(
    homedir(),
    ".openclaw",
    "extensions",
    "memory-milvus",
    "bridge",
    "memsearch_bridge.py",
  );

  if (!existsSync(bridgePath)) {
    throw new Error(`Milvus bridge not found at ${bridgePath}`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONWARNINGS: "ignore",
        PYTHONUNBUFFERED: "1",
        MEMSEARCH_DB_PATH: dbPath,
        MEMSEARCH_COLLECTION: collectionName,
      },
    });

    const rl = createInterface({ input: proc.stdout });
    let ready = false;
    const records: MilvusRecord[] = [];

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Migration export timed out after 60s"));
    }, 60_000);

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);

        if ("ready" in parsed && !ready) {
          ready = true;
          // Request full export
          proc.stdin.write(
            JSON.stringify({
              id: randomUUID(),
              action: "export_all",
              params: {
                db_path: dbPath,
                collection_name: collectionName,
              },
            }) + "\n",
          );
          return;
        }

        if (parsed.ok && parsed.result?.records) {
          records.push(...(parsed.result.records as MilvusRecord[]));
          clearTimeout(timer);
          proc.kill("SIGTERM");
          resolve(records);
        } else if (parsed.error) {
          clearTimeout(timer);
          proc.kill("SIGTERM");
          reject(new Error(`Bridge error: ${parsed.error}`));
        }
      } catch {
        // Ignore non-JSON lines
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (records.length === 0) {
        reject(new Error(`Bridge exited with code ${code} before export completed`));
      }
    });
  });
}

/**
 * Import records into RuVector collection.
 */
async function importToRuVector(
  client: RuVectorClient,
  collection: string,
  dimension: number,
  records: MilvusRecord[],
): Promise<{ imported: number; errors: string[] }> {
  // Ensure collection exists
  await client.ensureCollection(collection, dimension);

  const errors: string[] = [];
  let imported = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const points: RuVectorPoint[] = batch.map((r) => {
      const now = new Date().toISOString();
      return {
        id: randomUUID(),
        vector: r.embedding,
        metadata: {
          agent_id: r.agent_id ?? "unknown",
          text: r.content,
          category: r.heading ?? "other",
          chunk_hash: r.chunk_hash,
          importance: r.importance ?? 0.5,
          source: r.source ?? "migration",
          created_at: now,
          updated_at: now,
          ...(r.shared_scope ? { shared_scope: r.shared_scope } : {}),
          ...(r.shared_by ? { shared_by: r.shared_by } : {}),
        },
      };
    });

    try {
      await client.upsert(collection, points);
      imported += points.length;
    } catch (err) {
      errors.push(`Batch ${i / BATCH_SIZE}: ${String(err).slice(0, 100)}`);
    }
  }

  return { imported, errors };
}

/**
 * Full migration: export from Milvus → import to RuVector → verify counts.
 */
export async function migrate(options: {
  milvusDbPath?: string;
  collectionName?: string;
  ruvectorUri?: string;
  dimension?: number;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<MigrationResult> {
  const {
    milvusDbPath = join(homedir(), ".memsearch", "milvus.db"),
    collectionName = "fleet_memory",
    ruvectorUri = "http://localhost:6333",
    dimension = 3072,
    logger = { info: console.log, warn: console.warn },
  } = options;

  logger.info(`Migration: exporting from Milvus (${milvusDbPath})...`);
  const records = await exportFromMilvus(milvusDbPath, collectionName);
  logger.info(`Migration: exported ${records.length} records`);

  const client = new RuVectorClient(ruvectorUri, logger);

  logger.info(`Migration: importing to RuVector (${ruvectorUri})...`);
  const { imported, errors } = await importToRuVector(client, collectionName, dimension, records);
  logger.info(`Migration: imported ${imported}/${records.length} records`);

  // Count per agent
  const agentCounts: Record<string, number> = {};
  for (const r of records) {
    const agent = r.agent_id ?? "unknown";
    agentCounts[agent] = (agentCounts[agent] ?? 0) + 1;
  }

  // Verify
  const finalCount = await client.count(collectionName);
  if (finalCount < imported) {
    logger.warn(
      `Migration: count mismatch — imported ${imported} but collection has ${finalCount}`,
    );
  }

  return {
    exported: records.length,
    imported,
    errors,
    agentCounts,
  };
}
