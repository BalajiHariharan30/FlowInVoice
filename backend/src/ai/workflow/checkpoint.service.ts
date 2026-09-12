import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  CheckpointListOptions,
  PendingWrite
} from "@langchain/langgraph-checkpoint";
import { RunnableConfig } from "@langchain/core/runnables";
import { WorkflowCheckpoint } from "../../models/index.js";
import { inMemory, isDbConnected } from "../../repositories/base.js";
import { logger } from "../../utils/logger.js";

/**
 * Resilient, multi-tenant MongoDB-backed CheckpointSaver for LangGraph.
 *
 * Persists intermediate workflow checkpoints to MongoDB (`workflow_checkpoints` collection)
 * synchronously before nodes pause or return control (e.g. on HUMAN_REVIEW pause).
 * Seamlessly survives process restarts, redeployments, and worker crashes.
 */
export class MongoCheckpointSaver extends BaseCheckpointSaver {
  constructor(public readonly tenantId: string) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;

    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const checkpointId = config.configurable?.checkpoint_id;

    if (isDbConnected()) {
      const query: any = {
        tenantId: this.tenantId,
        threadId,
        checkpointNs
      };
      if (checkpointId) {
        query.checkpointId = checkpointId;
      }

      const doc = await WorkflowCheckpoint.findOne(query).sort({ checkpointId: -1, createdAt: -1 });
      if (!doc) return undefined;

      return this.docToTuple(doc);
    }

    // In-Memory Mode (for offline/unit testing)
    const matching: any[] = [];
    for (const cp of inMemory.checkpoints.values()) {
      if (
        cp.tenantId === this.tenantId &&
        cp.threadId === threadId &&
        cp.checkpointNs === checkpointNs
      ) {
        if (!checkpointId || cp.checkpointId === checkpointId) {
          matching.push(cp);
        }
      }
    }

    if (matching.length === 0) return undefined;

    matching.sort((a, b) => (b.checkpointId > a.checkpointId ? 1 : -1));
    return this.docToTuple(matching[0]);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const checkpointNs = config.configurable?.checkpoint_ns || "";

    if (isDbConnected()) {
      const query: any = {
        tenantId: this.tenantId,
        threadId
      };
      if (checkpointNs) query.checkpointNs = checkpointNs;
      if (options?.before) {
        query.checkpointId = { $lt: options.before.configurable?.checkpoint_id };
      }

      const cursor = WorkflowCheckpoint.find(query).sort({ checkpointId: -1 });
      if (options?.limit) {
        cursor.limit(options.limit);
      }

      const docs = await cursor.exec();
      for (const doc of docs) {
        yield this.docToTuple(doc);
      }
      return;
    }

    // In-Memory Mode
    const matching: any[] = [];
    for (const cp of inMemory.checkpoints.values()) {
      if (cp.tenantId === this.tenantId && cp.threadId === threadId) {
        if (!checkpointNs || cp.checkpointNs === checkpointNs) {
          if (!options?.before || cp.checkpointId < options.before.configurable?.checkpoint_id) {
            matching.push(cp);
          }
        }
      }
    }

    matching.sort((a, b) => (b.checkpointId > a.checkpointId ? 1 : -1));
    const limited = options?.limit ? matching.slice(0, options.limit) : matching;
    for (const cp of limited) {
      yield this.docToTuple(cp);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Record<string, string | number>
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error("MongoCheckpointSaver.put: thread_id is required in configurable");
    }

    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const checkpointId = checkpoint.id;
    const parentCheckpointId = config.configurable?.checkpoint_id;

    logger.debug(
      { tenantId: this.tenantId, threadId, checkpointId, checkpointNs },
      "MongoCheckpointSaver: Synchronously saving checkpoint"
    );

    if (isDbConnected()) {
      await WorkflowCheckpoint.findOneAndUpdate(
        {
          tenantId: this.tenantId,
          threadId,
          checkpointNs,
          checkpointId
        },
        {
          $set: {
            parentCheckpointId,
            checkpoint,
            metadata,
            newVersions,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date(),
            pendingWrites: []
          }
        },
        { upsert: true, new: true }
      );
    } else {
      // In-Memory Mode
      const key = `${this.tenantId}:${threadId}:${checkpointNs}:${checkpointId}`;
      const existing = inMemory.checkpoints.get(key);
      inMemory.checkpoints.set(key, {
        tenantId: this.tenantId,
        threadId,
        checkpointNs,
        checkpointId,
        parentCheckpointId,
        checkpoint,
        metadata,
        newVersions,
        pendingWrites: existing?.pendingWrites || [],
        createdAt: existing?.createdAt || new Date(),
        updatedAt: new Date()
      });
    }

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId
      }
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId || !checkpointId) return;

    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const formattedWrites = writes.map(([channel, value]) => [taskId, channel, value]);

    if (isDbConnected()) {
      await WorkflowCheckpoint.findOneAndUpdate(
        {
          tenantId: this.tenantId,
          threadId,
          checkpointNs,
          checkpointId
        },
        {
          $push: { pendingWrites: { $each: formattedWrites } },
          $set: { updatedAt: new Date() }
        }
      );
    } else {
      const key = `${this.tenantId}:${threadId}:${checkpointNs}:${checkpointId}`;
      const cp = inMemory.checkpoints.get(key);
      if (cp) {
        cp.pendingWrites = cp.pendingWrites || [];
        cp.pendingWrites.push(...formattedWrites);
        cp.updatedAt = new Date();
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (isDbConnected()) {
      await WorkflowCheckpoint.deleteMany({
        tenantId: this.tenantId,
        threadId
      });
    } else {
      for (const [key, cp] of inMemory.checkpoints.entries()) {
        if (cp.tenantId === this.tenantId && cp.threadId === threadId) {
          inMemory.checkpoints.delete(key);
        }
      }
    }
  }

  private docToTuple(doc: any): CheckpointTuple {
    const threadId = doc.threadId;
    const checkpointNs = doc.checkpointNs || "";
    const checkpointId = doc.checkpointId;

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId
        }
      },
      checkpoint: doc.checkpoint,
      metadata: doc.metadata || {},
      parentConfig: doc.parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: doc.parentCheckpointId
            }
          }
        : undefined,
      pendingWrites: doc.pendingWrites || []
    };

    return tuple;
  }
}
