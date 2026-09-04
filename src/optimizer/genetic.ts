/** @deprecated Use cmaes.ts. Re-export so older imports keep working. */
export {
  evaluatePlan,
  CMAESOptimizer,
  CMAESOptimizer as GeneticOptimizer,
  NETWORK_GENE_COUNT,
  JUNCTION_GENE_COUNT,
  planToX,
  xToPlan,
  junctionPlanToX,
  xToJunctionPlan,
  type EvalResult,
  type OptimizerState,
  type CMAESOptions,
  type CMAESScope,
} from './cmaes';
