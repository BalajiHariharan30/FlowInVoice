/**
 * Workflow engine dispatcher.
 *
 * WORKFLOW_ENGINE=langgraph   → original LangGraph orchestrator (graph.ts)
 * WORKFLOW_ENGINE=deterministic → plain deterministic orchestrator (deterministic.ts)
 *
 * Default is "langgraph" until full parity is verified, then will flip to "deterministic".
 */
export * from "./graph.js";
export * from "./state.js";
export * from "./tools.js";
export * from "./rate-limiter.js";
export * from "./deterministic.js";

import { runOrchestrationWorkflow as runLangGraph, WorkflowExecutionOptions, WorkflowExecutionResult } from "./graph.js";
import { runDeterministicWorkflow } from "./deterministic.js";

const WORKFLOW_ENGINE = (process.env.WORKFLOW_ENGINE || "deterministic").toLowerCase();

/**
 * Dispatcher: routes runOrchestrationWorkflow to the active engine.
 * Over-rides the named export from graph.ts so all callers transparently
 * use the correct engine without any call-site changes.
 */
export async function runOrchestrationWorkflow(
  tenantId: string,
  poId: string,
  options?: WorkflowExecutionOptions
): Promise<WorkflowExecutionResult> {
  if (WORKFLOW_ENGINE === "langgraph") {
    return runLangGraph(tenantId, poId, options);
  }
  return runDeterministicWorkflow(tenantId, poId, options);
}
