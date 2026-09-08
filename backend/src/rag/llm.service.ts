import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { z } from "zod";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse<T = any> {
  data: T;
  model: string;
  latencyMs: number;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class LLMService {
  /**
   * Generates a structured response validated by a Zod schema.
   * Tries primary provider -> fallback 1 -> fallback 2 -> mock provider.
   */
  static async generateStructured<T>(
    messages: LLMMessage[],
    schema: z.ZodSchema<T>,
    fallbackData?: T
  ): Promise<LLMResponse<T>> {
    const startTime = Date.now();

    // 1. Try Mistral if configured
    if (env.LLM_PROVIDER === "mistral" && env.MISTRAL_API_KEY) {
      try {
        const res = await this.callMistral(messages);
        const parsed = schema.parse(JSON.parse(res.content));
        return {
          data: parsed,
          model: "mistral-small-latest",
          latencyMs: Date.now() - startTime,
          tokens: res.tokens
        };
      } catch (err) {
        logger.warn({ err }, "Mistral call failed, falling back to Groq");
      }
    }

    // 2. Try Groq if configured
    if ((env.LLM_PROVIDER === "groq" || env.LLM_PROVIDER === "mistral") && env.GROQ_API_KEY) {
      try {
        const res = await this.callGroq(messages);
        const parsed = schema.parse(JSON.parse(res.content));
        return {
          data: parsed,
          model: "openai/gpt-oss-120b",
          latencyMs: Date.now() - startTime,
          tokens: res.tokens
        };
      } catch (err) {
        logger.warn({ err }, "Groq call failed, falling back to OpenRouter");
      }
    }

    // 3. Try OpenRouter if configured
    if (env.OPENROUTER_API_KEY) {
      try {
        const res = await this.callOpenRouter(messages);
        const parsed = schema.parse(JSON.parse(res.content));
        return {
          data: parsed,
          model: "openrouter/auto",
          latencyMs: Date.now() - startTime,
          tokens: res.tokens
        };
      } catch (err) {
        logger.warn({ err }, "OpenRouter call failed, falling back to mock provider");
      }
    }

    // 4. Fallback to mock / deterministic response
    if (fallbackData) {
      return {
        data: fallbackData,
        model: "mock-llm-engine",
        latencyMs: Date.now() - startTime,
        tokens: { promptTokens: 120, completionTokens: 80, totalTokens: 200 }
      };
    }

    throw new Error("No LLM provider was able to successfully respond and no fallback was provided");
  }

  private static async callMistral(messages: LLMMessage[]): Promise<{ content: string; tokens: any }> {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages,
        response_format: { type: "json_object" }
      })
    });
    const json: any = await res.json();
    return {
      content: json.choices[0].message.content,
      tokens: {
        promptTokens: json.usage?.prompt_tokens || 0,
        completionTokens: json.usage?.completion_tokens || 0,
        totalTokens: json.usage?.total_tokens || 0
      }
    };
  }

  private static async callGroq(messages: LLMMessage[]): Promise<{ content: string; tokens: any }> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages,
        response_format: { type: "json_object" }
      })
    });
    const json: any = await res.json();
    return {
      content: json.choices[0].message.content,
      tokens: {
        promptTokens: json.usage?.prompt_tokens || 0,
        completionTokens: json.usage?.completion_tokens || 0,
        totalTokens: json.usage?.total_tokens || 0
      }
    };
  }

  private static async callOpenRouter(messages: LLMMessage[]): Promise<{ content: string; tokens: any }> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct",
        messages,
        response_format: { type: "json_object" }
      })
    });
    const json: any = await res.json();
    return {
      content: json.choices[0].message.content,
      tokens: {
        promptTokens: json.usage?.prompt_tokens || 0,
        completionTokens: json.usage?.completion_tokens || 0,
        totalTokens: json.usage?.total_tokens || 0
      }
    };
  }
}
