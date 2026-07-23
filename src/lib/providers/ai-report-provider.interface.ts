import type { NormalizedResearchResult, PemPreparation } from "@/lib/research/schemas";

export interface AiReportProvider {
  readonly key: string;
  readonly name: string;
  generateSummary(input: NormalizedResearchResult): Promise<string>;
  generatePemPreparation(input: NormalizedResearchResult): Promise<PemPreparation>;
}
