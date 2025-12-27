// tokenUsageTracker.ts
// Tracks cumulative token usage + estimated cost for an OpenAI Realtime session.

export interface TokenUsage {
  inputText: number;
  inputAudio: number;
  outputText: number;
  outputAudio: number;
  cachedInput?: number;
}

export interface TokenTotals extends TokenUsage {
  cachedInput: number; // Make non-optional in totals since we always initialize it
  totalUSD: number;
}

type Model = "gpt-realtime" | "gpt-realtime-mini";

interface PriceStructure {
  inputText: number;
  cachedInput: number;
  outputText: number;
  inputAudio: number;
  outputAudio: number;
}

const PRICES: Record<Model, PriceStructure> = {
  "gpt-realtime": {
    inputText: 4.0 / 1_000_000,
    cachedInput: 0.4 / 1_000_000,
    outputText: 16.0 / 1_000_000,
    inputAudio: 32.0 / 1_000_000,
    outputAudio: 64.0 / 1_000_000,
  },
  "gpt-realtime-mini": {
    inputText: 0.6 / 1_000_000,
    cachedInput: 0.06 / 1_000_000,
    outputText: 2.4 / 1_000_000,
    inputAudio: 10.0 / 1_000_000,
    outputAudio: 20.0 / 1_000_000,
  },
};

export class TokenUsageTracker {
  private model: Model;
  private totals: TokenTotals;

  constructor(model: Model = "gpt-realtime") {
    this.model = model;
    this.totals = {
      inputText: 0,
      inputAudio: 0,
      outputText: 0,
      outputAudio: 0,
      cachedInput: 0,
      totalUSD: 0,
    };
  }

  /** Call this with each onTokenUsage event payload */
  addUsage(usage: TokenUsage): TokenTotals {
    // Increment totals
    for (const key of Object.keys(this.totals) as (keyof TokenTotals)[]) {
      if (key !== "totalUSD" && typeof usage[key] === "number") {
        this.totals[key] += usage[key]!;
      }
    }

    // Recalculate cost
    const p = PRICES[this.model]!;
    const cost =
      this.totals.inputText * p.inputText +
      this.totals.cachedInput * p.cachedInput +
      this.totals.outputText * p.outputText +
      this.totals.inputAudio * p.inputAudio +
      this.totals.outputAudio * p.outputAudio;

    this.totals.totalUSD = parseFloat(cost.toFixed(6));
    return { ...this.totals };
  }

  /** Reset totals — call at start of a new WebRTC session */
  reset() {
    this.totals = {
      inputText: 0,
      inputAudio: 0,
      outputText: 0,
      outputAudio: 0,
      cachedInput: 0,
      totalUSD: 0,
    };
  }
}
