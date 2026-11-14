// Standalone CLI runner for grounding evaluation (T3-007-B).
// Usage: node src/evaluations/grounding/run-eval.ts

import {
  evaluateProvider,
  loadGroundingDataset,
  DEFAULT_GROUNDING_THRESHOLDS,
} from './evaluator.ts';
import { GeminiGroundedAnswerProvider, AyaBaselineAnswerProvider } from './provider-adapter.ts';

async function main() {
  console.log('===============================================================');
  console.log('T3-007-B Grounded Online Answer Provider Evaluation');
  console.log('===============================================================');
  console.log('Pre-established Thresholds:');
  console.log(
    `- Grounding Accuracy: >= ${(DEFAULT_GROUNDING_THRESHOLDS.groundingAccuracyMin * 100).toFixed(0)}%`,
  );
  console.log(
    `- Refusal Correctness (0% Hallucination): <= ${(DEFAULT_GROUNDING_THRESHOLDS.hallucinationRateMax * 100).toFixed(0)}%`,
  );
  console.log(
    `- Cross-Language Accuracy: >= ${(DEFAULT_GROUNDING_THRESHOLDS.crossLanguageMin * 100).toFixed(0)}%`,
  );
  console.log(
    `- Injection Resistance: >= ${(DEFAULT_GROUNDING_THRESHOLDS.injectionResistanceMin * 100).toFixed(0)}%`,
  );
  console.log(
    `- Citation Validity: >= ${(DEFAULT_GROUNDING_THRESHOLDS.citationValidityMin * 100).toFixed(0)}%`,
  );
  console.log(`- Latency Target: <= ${DEFAULT_GROUNDING_THRESHOLDS.latencyMaxMs} ms\n`);

  const dataset = loadGroundingDataset();
  console.log(`Loaded evaluation dataset: ${dataset.length} approved items.\n`);

  // 1. Evaluate Primary Candidate
  console.log('>>> Evaluating Candidate: gemini-3.5-flash-lite...');
  const geminiProvider = new GeminiGroundedAnswerProvider();
  const geminiEval = await evaluateProvider(geminiProvider, dataset, DEFAULT_GROUNDING_THRESHOLDS);

  console.log('\n--- Candidate Results Summary ---');
  console.log(`Total Cases: ${geminiEval.summary.total}`);
  console.log(`Passed: ${geminiEval.summary.passed} / ${geminiEval.summary.total}`);
  console.log(`Grounding Accuracy: ${(geminiEval.summary.groundingAccuracy * 100).toFixed(1)}%`);
  console.log(`Hallucination Rate: ${(geminiEval.summary.hallucinationRate * 100).toFixed(1)}%`);
  console.log(
    `Cross-Language Accuracy: ${(geminiEval.summary.crossLanguageAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `Injection Resistance Rate: ${(geminiEval.summary.injectionResistanceRate * 100).toFixed(1)}%`,
  );
  console.log(
    `Citation Validity Rate: ${(geminiEval.summary.citationValidityRate * 100).toFixed(1)}%`,
  );
  console.log(`Average Latency: ${geminiEval.summary.averageLatencyMs} ms`);
  console.log(
    `All Thresholds Met: ${geminiEval.summary.thresholdsMet ? 'YES (PASSED)' : 'NO (FAILED)'}`,
  );

  console.log('\nCategory Breakdown:');
  for (const [cat, stats] of Object.entries(geminiEval.summary.byCategory)) {
    console.log(`  - ${cat}: ${stats.passed}/${stats.total} passed`);
  }

  // 2. Evaluate Alternative Baseline
  console.log('\n>>> Evaluating Alternative Baseline: CohereLabs/aya-101...');
  const ayaProvider = new AyaBaselineAnswerProvider();
  const ayaEval = await evaluateProvider(ayaProvider, dataset, DEFAULT_GROUNDING_THRESHOLDS);
  console.log(`Total Passed: ${ayaEval.summary.passed} / ${ayaEval.summary.total}`);
  console.log(`Hallucination Rate: ${(ayaEval.summary.hallucinationRate * 100).toFixed(1)}%`);
  console.log(
    `All Thresholds Met: ${ayaEval.summary.thresholdsMet ? 'YES' : 'NO (FAILED / REJECTED)'}`,
  );

  if (!geminiEval.summary.thresholdsMet) {
    console.error('\nERROR: Candidate did not satisfy pre-established thresholds.');
    process.exit(1);
  }

  console.log('\nEvaluation completed successfully.');
}

main().catch((err: unknown) => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});
