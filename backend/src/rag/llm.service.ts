import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
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

    // 1. Try AWS Bedrock if configured (Priority 1)
    if (
      env.LLM_PROVIDER === "bedrock" ||
      (env.AWS_ACCESS_KEY_ID &&
        env.AWS_SECRET_ACCESS_KEY &&
        env.AWS_ACCESS_KEY_ID !== "mock-access-key")
    ) {
      try {
        const res = await this.callBedrock(messages);
        const jsonMatch = res.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = schema.parse(JSON.parse(jsonMatch[0]));
          return {
            data: parsed,
            model: "aws-bedrock/llama-3.1-70b",
            latencyMs: Date.now() - startTime,
            tokens: res.tokens
          };
        }
      } catch (err) {
        logger.warn({ err }, "AWS Bedrock call failed, falling back to Groq/Mistral");
      }
    }

    // 2. Try Mistral if configured
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

  private static async callBedrock(messages: LLMMessage[]): Promise<{ content: string; tokens: any }> {
    const accessKeyId =
      env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const region = env.AWS_REGION || process.env.AWS_REGION || "us-east-1";
    const modelId =
      env.BEDROCK_MODEL_ARN ||
      env.MODEL_ARN ||
      process.env.MODEL_ARN ||
      process.env.BEDROCK_MODEL_ARN ||
      "arn:aws:bedrock:us-east-1:325999881191:inference-profile/us.meta.llama3-1-70b-instruct-v1:0";

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!
      }
    });

    const bedrockMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: [{ text: m.content }]
      }));

    const systemPrompt = messages.find((m) => m.role === "system")?.content;

    const command = new ConverseCommand({
      modelId,
      system: systemPrompt ? [{ text: systemPrompt }] : undefined,
      messages: bedrockMessages,
      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.1
      }
    });

    const res = await client.send(command);
    const content = res.output?.message?.content?.[0]?.text || "";
    return {
      content,
      tokens: {
        promptTokens: res.usage?.inputTokens || 100,
        completionTokens: res.usage?.outputTokens || 50,
        totalTokens: res.usage?.totalTokens || 150
      }
    };
  }
}

