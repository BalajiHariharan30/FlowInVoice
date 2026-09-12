import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { ReviewRepository } from "../repositories/review.repository.js";
import { isDbConnected } from "../repositories/base.js";
import { logger } from "../utils/logger.js";

export async function runMigration(tenantId?: string) {
  logger.info({ tenantId }, "Starting review queue duplicate collapsing migration");
  if (process.env.NODE_ENV !== "test" && !isDbConnected()) {
    try {
      await connectDatabase();
    } catch (err: any) {
      logger.warn({ err: err.message }, "Database connection skipped or already established");
    }
  }

  const result = await ReviewRepository.collapseDuplicates(tenantId);

  logger.info(
    {
      totalEvaluated: result.totalEvaluated,
      groupsEvaluated: result.groupsEvaluated,
      duplicatesDeleted: result.duplicatesDeleted,
      canonicalUpdated: result.canonicalUpdated
    },
    "Review queue duplicate collapsing migration completed successfully"
  );

  return result;
}

// Auto-run if executed directly via CLI (e.g., npx tsx src/scripts/collapse-duplicate-reviews.ts)
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("collapse-duplicate-reviews.ts") ||
    process.argv[1].endsWith("collapse-duplicate-reviews.js"));

if (isDirectExecution) {
  const tenantArg = process.argv[2];
  runMigration(tenantArg)
    .then(async () => {
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, "Migration failed with fatal error");
      await disconnectDatabase();
      process.exit(1);
    });
}
