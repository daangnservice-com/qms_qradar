export interface Silence { startSec: number; endSec: number; durationSec: number; }
export interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number; }
export interface Threshold { minSilenceSec: number; noiseDb: number; }
export interface ScoreDetail { score: number; comment: string; }
export interface TranscriptSegment { atSec: number; speaker: string; text: string; }
export interface Evaluation {
  scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail };
  overallSummary: string;
  silenceComments: { atSec: number; note: string }[];
  transcript: TranscriptSegment[];
  error: string | null;
}
export interface EvaluationResult {
  durationSec: number;
  threshold: Threshold;
  silences: Silence[];
  silenceSummary: SilenceSummary;
  evaluation: Evaluation;
}

export type DamageVerdict = "파손됨" | "정상" | "불확실";
export interface BoundingBox { ymin: number; xmin: number; ymax: number; xmax: number; }
export interface DamageFinding {
  location: string;
  type: string;
  description: string;
  photoIndex: number;
  box: BoundingBox | null;
}
export interface PerPhotoNote { index: number; note: string; }
export interface DamageResult {
  verdict: DamageVerdict;
  confidence: number;
  summary: string;
  findings: DamageFinding[];
  perPhoto: PerPhotoNote[];
}
