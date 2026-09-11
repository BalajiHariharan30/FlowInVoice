import { z } from "zod";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

export const PurchaseOrderExtractionSchema = z.object({
  poNumber: z.string(),
  customerName: z.string(),
  gstNumber: z.string().default(""),
  issueDate: z.string().default(() => new Date().toISOString().split("T")[0]),
  deliveryDate: z.string().optional(),
  currency: z.string().default("INR"),
  paymentTerms: z.string().default("NET_30"),
  lineItems: z.array(
    z.object({
      lineNumber: z.number(),
      productCode: z.string(),
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      lineTotal: z.number(),
      taxRate: z.number().default(0),
      gstNumber: z.string().optional()
    })
  ),
  subtotal: z.number(),
  tax: z.number().default(0),
  discount: z.number().default(0),
  totalAmount: z.number(),
  confidence: z.number().default(0.95)
});

export type ExtractedPOData = z.infer<typeof PurchaseOrderExtractionSchema>;

export interface DocumentInput {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

export interface DocumentExtractor {
  extract(input: DocumentInput): Promise<ExtractedPOData>;
  getRawResult?(): any;
}


export class MockOCRProvider implements DocumentExtractor {
  async extract(input: DocumentInput): Promise<ExtractedPOData> {
    logger.info({ fileName: input.fileName }, "Running OCR extraction (mock)");

    // Derive a deterministic-but-unique fingerprint from file content + name
    // so every distinct file produces genuinely different extracted data
    const fileNameSeed = input.fileName
      .split("")
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) & 0xffffffff, 0);
    const bufSeed =
      input.buffer.length > 0
        ? input.buffer.slice(0, Math.min(64, input.buffer.length)).reduce((a, b) => (a + b) & 0xffffffff, 0)
        : 0;
    const seed = Math.abs(fileNameSeed ^ bufSeed);

    // Seeded pseudo-random helper
    const rand = (n: number) => seed % n;
    const randF = (min: number, max: number) => {
      const spread = max - min;
      const frac = ((seed * 9301 + 49297) % 233280) / 233280;
      return Math.round((min + frac * spread) * 100) / 100;
    };

    // Support testing low confidence or invalid files
    const fileName = input.fileName.toLowerCase();
    const isLowConfidence = fileName.includes("low_confidence") || fileName.includes("blurry");
    const isDuplicate = fileName.includes("duplicate");

    // Helper to derive a natural, clean entity name from the uploaded filename
    const deriveEntityFromFilename = (rawName: string): string => {
      const base = rawName.replace(/\.[^/.]+$/, "");
      const cleaned = base
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_.]+/g, " ")
        .replace(/\b(pdf|png|jpg|jpeg|doc|docx|test|sample|a4|demo|only)\b/gi, "")
        .trim();
      if (cleaned.length > 2) {
        const title = cleaned
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        return `${title} Enterprises Ltd`;
      }
      return "Enterprise Commercial Services Ltd";
    };

    // Inspect buffer for uncompressed text (real PO numbers or GSTINs embedded in PDF/file)
    const rawBufferStr = input.buffer.toString("latin1");
    const bufferGstMatch = rawBufferStr.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);
    const bufferPoMatch = rawBufferStr.match(/\b(?:PO|PURCHASE\s*ORDER|ORDER)[#:\s-]*([A-Z0-9_-]{4,20})\b/i);

    // Generate unique, relevant PO number
    let poNumber: string;
    const fnNumberMatch = input.fileName.match(/(?:po|order|inv)?[_-]?(\d{3,8})/i);
    if (isDuplicate) {
      poNumber = "PO-DUP-9999";
    } else if (bufferPoMatch && bufferPoMatch[1] && !bufferPoMatch[1].startsWith("PENDING")) {
      poNumber = bufferPoMatch[1].startsWith("PO-") ? bufferPoMatch[1] : `PO-${bufferPoMatch[1]}`;
    } else if (fnNumberMatch && fnNumberMatch[1]) {
      poNumber = `PO-${fnNumberMatch[1]}`;
    } else {
      const cleanPrefix = input.fileName.replace(/[^a-zA-Z]/g, "").slice(0, 6).toUpperCase() || "ORD";
      poNumber = `PO-${cleanPrefix}-${1000 + (seed % 8999)}`;
    }

    // Enterprise customer roster
    const CUSTOMERS = [
      { name: "Tata Advanced Systems Ltd",       gst: "27AATCS1234M1Z5", state: "27" },
      { name: "Infosys BPM Limited",             gst: "29AABCI1234K1ZP", state: "29" },
      { name: "Mahindra Logistics Pvt Ltd",      gst: "27AACCM9876L1ZQ", state: "27" },
      { name: "Bharat Electronics Limited",      gst: "32AAACB0472M1ZV", state: "32" },
      { name: "Wipro Enterprises Ltd",           gst: "29AAACW0902M1ZW", state: "29" },
      { name: "Larsen & Toubro Technology",      gst: "27AAACL0870M1ZS", state: "27" },
      { name: "HCL Technologies Ltd",            gst: "09AAACH8345Q1ZH", state: "09" },
      { name: "Reliance Jio Infocomm Ltd",       gst: "27AACCR4849R1ZB", state: "27" },
      { name: "Sun Pharmaceutical Industries",   gst: "24AABCS0762M1ZN", state: "24" }
    ];

    // Priority 1: Match from known enterprise brand keywords in filename
    let customer = CUSTOMERS.find((c) => {
      const keyword = c.name.split(" ")[0].toLowerCase();
      return fileName.includes(keyword);
    });

    // Priority 2: Match customer from buffer GSTIN if recognized
    if (!customer && bufferGstMatch) {
      customer = CUSTOMERS.find((c) => c.gst === bufferGstMatch[0]);
    }

    // Priority 3: Dynamically generate customer name matching the uploaded document!
    if (!customer) {
      const dynamicName = deriveEntityFromFilename(input.fileName);
      const gstCode = String(10 + (seed % 28)).padStart(2, "0");
      customer = {
        name: dynamicName,
        gst: `${gstCode}AABCE${(1000 + (seed % 8999))}R1Z${String.fromCharCode(65 + (seed % 26))}`,
        state: gstCode
      };
    }

    // Domain-Specific Product Catalogs based on file semantics:
    const isVariance = fileName.includes("variance");
    const isOffice = !isVariance && /office|paper|stationery|suppl|pen|pencil|print/i.test(input.fileName);
    const isIndustrial = !isVariance && /hardware|machine|part|device|iot|sensor|cabl|complex|mfg/i.test(input.fileName);

    const OFFICE_CATALOG = [
      { code: "OFFICE-PPR-01", desc: "Premium A4 Copier Paper (75 GSM, 5 Reams Box)", min: 1150, max: 1450, qty: [2, 5, 10] },
      { code: "OFFICE-PEN-02", desc: "Retractable Ballpoint Gel Pens (Box of 50)", min: 380, max: 580, qty: [1, 2, 4] },
      { code: "OFFICE-STP-03", desc: "Heavy Duty Desk Stapler & 5000 Staples Pack", min: 460, max: 720, qty: [1, 2] },
      { code: "OFFICE-TP-04",  desc: "Self-Adhesive Packing & Masking Tape (Set of 6)", min: 260, max: 440, qty: [2, 4, 8] },
      { code: "OFFICE-FLR-05", desc: "Expanding Document File Folders (Set of 10)", min: 320, max: 540, qty: [1, 3] },
      { code: "OFFICE-DSK-06", desc: "Executive Desk Organizer & Stationery Tray Set", min: 680, max: 1100, qty: [1, 2] }
    ];

    const INDUSTRIAL_CATALOG = [
      { code: "IND-BRG-01",  desc: "High-Precision Industrial Ball Bearings (Set of 4)", min: 1800, max: 3500, qty: [2, 4, 10] },
      { code: "IND-SMR-02",  desc: "Microcontroller Interface Sensor Module Array", min: 950, max: 2200, qty: [5, 10, 20] },
      { code: "IND-PWS-03",  desc: "24V Regulated Industrial Switching Power Supply", min: 2200, max: 4800, qty: [1, 2] },
      { code: "IND-CBL-04",  desc: "Shielded Industrial Data Bus Communication Cables (25m)", min: 650, max: 1400, qty: [2, 5] },
      { code: "IND-VALV-05", desc: "Pneumatic Directional Control Valve Assembly", min: 1400, max: 3100, qty: [1, 3] }
    ];

    const TECH_CATALOG = [
      { code: "PROD-CLOUD-01", desc: "Enterprise Cloud Hosting Subscription", min: 800, max: 2500, qty: [1, 2, 3] },
      { code: "PROD-SUPP-02",  desc: "24/7 Dedicated Support Add-on", min: 400, max: 900, qty: [1] },
      { code: "PROD-DATA-03",  desc: "AI/ML Data Analytics Platform License", min: 3000, max: 8000, qty: [1, 2] },
      { code: "PROD-NET-04",   desc: "SD-WAN Networking Infrastructure Module", min: 1500, max: 4000, qty: [1, 2, 5] },
      { code: "PROD-SEC-05",   desc: "Cybersecurity Compliance Suite (Annual)", min: 2000, max: 6000, qty: [1] },
      { code: "PROD-RPA-10",   desc: "Robotic Process Automation Workflow Bot", min: 1800, max: 5500, qty: [1, 2, 3] }
    ];

    const CATALOG = isOffice ? OFFICE_CATALOG : isIndustrial ? INDUSTRIAL_CATALOG : TECH_CATALOG;

    const itemCount = isVariance ? 1 : 2 + (seed % 3); // 2, 3, or 4 items
    const chosenItems: typeof CATALOG = [];
    if (isVariance) {
      chosenItems.push({ code: "PROD-CLOUD-01", desc: "Enterprise Cloud Hosting Subscription", min: 1200, max: 1200, qty: [1] });
    } else {
      const usedIndices = new Set<number>();
      for (let i = 0; i < itemCount; i++) {
        let idx = (seed * (i + 7)) % CATALOG.length;
        while (usedIndices.has(idx)) idx = (idx + 1) % CATALOG.length;
        usedIndices.add(idx);
        chosenItems.push(CATALOG[idx]);
      }
    }


    const TAX_RATE = 18; // GST 18%
    let subtotal = 0;
    const lineItems = chosenItems.map((item, i) => {
      const qty = item.qty[(seed + i) % item.qty.length];
      const unitPrice = randF(item.min, item.max);
      const lineTotal = Math.round(qty * unitPrice * 100) / 100;
      subtotal += lineTotal;
      return {
        lineNumber: i + 1,
        productCode: item.code,
        description: item.desc,
        quantity: qty,
        unitPrice,
        lineTotal,
        taxRate: TAX_RATE,
        gstNumber: customer.gst
      };
    });

    subtotal = Math.round(subtotal * 100) / 100;
    const tax = Math.round(subtotal * TAX_RATE) / 100;
    const totalAmount = Math.round((subtotal + tax) * 100) / 100;

    const today = new Date();
    const delivery = new Date(today.getTime() + (14 + (seed % 14)) * 86400000);

    const paymentTerms = ["NET_30", "NET_45", "NET_60", "NET_15"][seed % 4];

    return {
      poNumber,
      customerName: customer.name,
      gstNumber: customer.gst,
      issueDate: today.toISOString().split("T")[0],
      deliveryDate: delivery.toISOString().split("T")[0],
      currency: "INR",
      paymentTerms,
      lineItems,
      subtotal,
      tax,
      discount: 0,
      totalAmount,
      confidence: isLowConfidence ? 0.62 : 0.93 + (seed % 7) / 100
    };
  }

  getRawResult(): any {
    return { mode: "mock", seeded: true };
  }
}

/**
 * Real Multimodal Document Extractor using AWS Bedrock (Llama 3.1 70B Instruct).
 * Uses Converse API with native document and image block support.
 */
export class BedrockOCRProvider implements DocumentExtractor {
  private rawResult: any = null;

  getRawResult(): any {
    return this.rawResult;
  }

  async extract(input: DocumentInput): Promise<ExtractedPOData> {
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

    if (!accessKeyId || !secretAccessKey || accessKeyId === "mock-access-key") {
      throw new Error(
        "DOCUMENT_AI_PROVIDER is set to 'bedrock', but AWS_ACCESS_KEY / AWS_SECRET_KEY is not configured in the environment. Real OCR extraction cannot proceed without valid AWS credentials."
      );
    }

    logger.info(
      { fileName: input.fileName, contentType: input.contentType, modelId },
      "Running real Multimodal Document Extraction via AWS Bedrock (Llama 3.1 70B)"
    );

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    const contentType = (input.contentType || "application/pdf").toLowerCase();
    const isImage = contentType.startsWith("image/");
    const imageFormat = contentType.includes("png")
      ? "png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpeg"
      : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
      ? "gif"
      : "png";

    const docFormat = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("csv")
      ? "csv"
      : contentType.includes("text")
      ? "txt"
      : "pdf";

    const bytes = new Uint8Array(input.buffer);

    const extractionPrompt = `You are a high-precision enterprise document extraction engine for accounts payable.
Extract all purchase order information from this document with 100% accuracy.
Return ONLY valid JSON matching this exact structure:
{
  "poNumber": "string (PO number or Order number from the document)",
  "customerName": "string (The buyer / issuing company)",
  "gstNumber": "string (15-character GSTIN if in India, or empty string)",
  "issueDate": "YYYY-MM-DD",
  "deliveryDate": "YYYY-MM-DD",
  "currency": "INR",
  "paymentTerms": "NET_30",
  "lineItems": [
    {
      "lineNumber": 1,
      "productCode": "SKU or item number",
      "description": "Full description of item",
      "quantity": 1,
      "unitPrice": 100.0,
      "lineTotal": 100.0,
      "taxRate": 18
    }
  ],
  "subtotal": 100.0,
  "tax": 18.0,
  "discount": 0.0,
  "totalAmount": 118.0,
  "confidence": 0.98
}
Rules:
1. Every numeric value must be a number, not a string with currency signs.
2. If fields like issueDate are not explicitly formatted as YYYY-MM-DD, convert them or supply today's date (${new Date().toISOString().split("T")[0]}).
3. Always supply currency as "INR" unless another currency is explicitly given.
4. Return ONLY the raw JSON object. Do not include markdown ticks, no backticks, no conversational text.`;

    const contentBlock = isImage
      ? {
          image: {
            format: imageFormat as any,
            source: { bytes }
          }
        }
      : {
          document: {
            name: (input.fileName || "purchase_order").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60),
            format: docFormat as any,
            source: { bytes }
          }
        };

    const command = new ConverseCommand({
      modelId,
      messages: [
        {
          role: "user",
          content: [contentBlock as any, { text: extractionPrompt }]
        }
      ],
      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.0
      }
    });

    const res = await client.send(command);
    this.rawResult = res;

    const rawText = res.output?.message?.content?.[0]?.text;
    if (!rawText) {
      throw new Error("AWS Bedrock returned an empty extraction result.");
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`AWS Bedrock response did not contain valid JSON: ${rawText.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Sanitize and reconcile fields before Zod validation to ensure resilience against arithmetic hallucinations
    return sanitizeAndReconcileExtractedPO(parsed);
  }
}

/**
 * Normalizes and deterministically reconciles extracted PO data against LLM arithmetic errors.
 */
export function sanitizeAndReconcileExtractedPO(parsed: any): ExtractedPOData {
  if (!parsed.issueDate || typeof parsed.issueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.issueDate)) {
    parsed.issueDate = new Date().toISOString().split("T")[0];
  }
  if (!parsed.currency) {
    parsed.currency = "INR";
  }
  if (!parsed.paymentTerms) {
    parsed.paymentTerms = "NET_30";
  }
  if (parsed.deliveryDate === "" || parsed.deliveryDate === null) {
    delete parsed.deliveryDate;
  }
  if (!parsed.poNumber) {
    parsed.poNumber = `PO-${Date.now().toString().slice(-6)}`;
  }
  if (!parsed.customerName) {
    parsed.customerName = "Enterprise Customer";
  }
  if (typeof parsed.confidence !== "number") {
    parsed.confidence = 0.96;
  }
  if (typeof parsed.subtotal !== "number") {
    parsed.subtotal = Number(parsed.subtotal) || 0;
  }
  if (typeof parsed.tax !== "number") {
    parsed.tax = Number(parsed.tax) || 0;
  }
  if (typeof parsed.discount !== "number") {
    parsed.discount = Number(parsed.discount) || 0;
  }
  if (typeof parsed.totalAmount !== "number") {
    parsed.totalAmount = Number(parsed.totalAmount) || (parsed.subtotal + parsed.tax);
  }

  if (Array.isArray(parsed.lineItems) && parsed.lineItems.length > 0) {
    parsed.lineItems = parsed.lineItems.map((li: any, idx: number) => ({
      lineNumber: typeof li.lineNumber === "number" ? li.lineNumber : idx + 1,
      productCode: li.productCode || `ITEM-${idx + 1}`,
      description: li.description || "Purchase Order Item",
      quantity: typeof li.quantity === "number" ? li.quantity : Number(li.quantity) || 1,
      unitPrice: typeof li.unitPrice === "number" ? li.unitPrice : Number(li.unitPrice) || 0,
      lineTotal: typeof li.lineTotal === "number" ? li.lineTotal : Number(li.lineTotal) || 0,
      taxRate: typeof li.taxRate === "number" ? li.taxRate : Number(li.taxRate) || 0,
      gstNumber: li.gstNumber || parsed.gstNumber || ""
    }));

    // Deterministic arithmetic reconciliation for LLM hallucinations
    if (parsed.subtotal && parsed.totalAmount) {
      const lineTaxesSum = parsed.lineItems.reduce((acc: number, li: any) => {
        const lt = typeof li.lineTotal === "number" ? li.lineTotal : Number(li.lineTotal) || 0;
        const tr = typeof li.taxRate === "number" ? li.taxRate : Number(li.taxRate) || 0;
        return acc + (lt * tr / 100);
      }, 0);

      // If sum of line item taxes matches the difference between total and subtotal, use it
      if (lineTaxesSum > 0 && Math.abs((parsed.subtotal + lineTaxesSum - (parsed.discount || 0)) - parsed.totalAmount) < 1.0) {
        parsed.tax = Number(lineTaxesSum.toFixed(2));
      } else if (Math.abs((parsed.subtotal + (parsed.tax || 0) - (parsed.discount || 0)) - parsed.totalAmount) > 0.01) {
        const reconciledTax = parsed.totalAmount - parsed.subtotal + (parsed.discount || 0);
        if (reconciledTax >= 0) {
          parsed.tax = Number(reconciledTax.toFixed(2));
        }
      }
    }
  } else {
    parsed.lineItems = [
      {
        lineNumber: 1,
        productCode: "ITEM-1",
        description: "Purchase Order Line Item",
        quantity: 1,
        unitPrice: parsed.subtotal || parsed.totalAmount || 1000,
        lineTotal: parsed.subtotal || parsed.totalAmount || 1000,
        taxRate: 18,
        gstNumber: parsed.gstNumber || ""
      }
    ];
  }

  return PurchaseOrderExtractionSchema.parse(parsed);
}


/**
 * Real Multimodal Document Extractor using Google Gemini Vision (gemini-1.5-flash / gemini-1.5-pro).
 * Accepts raw PDF/image buffer, passes inline document bytes, and parses real document data.
 */
export class GeminiVisionProvider implements DocumentExtractor {
  private rawResult: any = null;

  getRawResult(): any {
    return this.rawResult;
  }

  async extract(input: DocumentInput): Promise<ExtractedPOData> {
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DOCUMENT_AI_PROVIDER is set to 'vision_fallback' (Gemini Vision), but GEMINI_API_KEY is not configured in the environment. Real OCR extraction cannot proceed without an API key."
      );
    }

    logger.info({ fileName: input.fileName, contentType: input.contentType }, "Running real Multimodal OCR via Gemini Vision");

    const mimeType = input.contentType || "application/pdf";
    const base64Data = input.buffer.toString("base64");

    const extractionPrompt = `You are a high-precision document extraction engine for accounts payable.
Extract all purchase order information from this document with 100% accuracy.
You must output valid JSON matching this exact structure:
{
  "poNumber": "string (PO number or Order number from the document)",
  "customerName": "string (The buyer / issuing company)",
  "gstNumber": "string (15-character GSTIN if in India, or empty string)",
  "issueDate": "YYYY-MM-DD",
  "deliveryDate": "YYYY-MM-DD (if present)",
  "currency": "INR (or USD/EUR/GBP as indicated)",
  "paymentTerms": "NET_30 (or whatever terms are stated)",
  "lineItems": [
    {
      "lineNumber": 1,
      "productCode": "SKU or item number",
      "description": "Full description of item",
      "quantity": 1,
      "unitPrice": 100.0,
      "lineTotal": 100.0,
      "taxRate": 18
    }
  ],
  "subtotal": 100.0,
  "tax": 18.0,
  "discount": 0.0,
  "totalAmount": 118.0,
  "confidence": 0.98
}
Rules:
1. Every numeric value must be a number, not a string with currency signs.
2. The confidence score (0.0 to 1.0) must reflect actual document clarity and text legibility.
3. If specific fields are omitted, supply standard defaults (e.g. currency: "INR", paymentTerms: "NET_30").`;

    const candidateModels = [
      process.env.GEMINI_MODEL,
      "gemini-flash-lite-latest",
      "gemini-3.5-flash",
      "gemini-3.8-flash",
      "gemini-flash-latest"
    ].filter(Boolean) as string[];

    let lastError: any = null;
    let json: any = null;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: base64Data
                    }
                  },
                  {
                    text: extractionPrompt
                  }
                ]
              }
            ],
            generationConfig: {
              response_mime_type: "application/json",
              temperature: 0.0
            }
          })
        });

        if (!res.ok) {
          const errBody = await res.text();
          logger.warn({ model, status: res.status, err: errBody }, "Gemini model attempt returned non-200, trying next candidate");
          lastError = new Error(`Gemini Vision API error (${model}, HTTP ${res.status}): ${errBody}`);
          continue;
        }

        json = await res.json();
        break;
      } catch (err: any) {
        logger.warn({ model, err: err.message }, "Gemini model request exception, trying next candidate");
        lastError = err;
      }
    }

    if (!json) {
      throw lastError || new Error("All Gemini Vision models failed to respond.");
    }

    this.rawResult = json;

    const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error("Gemini Vision returned an empty extraction result.");
    }

    const parsed = JSON.parse(candidateText);
    return sanitizeAndReconcileExtractedPO(parsed);
  }
}

/**
 * Real Mistral OCR / Vision Extractor (pixtral-12b / mistral-ocr).
 */
export class MistralOCRProvider implements DocumentExtractor {
  private rawResult: any = null;

  getRawResult(): any {
    return this.rawResult;
  }

  async extract(input: DocumentInput): Promise<ExtractedPOData> {
    const apiKey = env.MISTRAL_API_KEY || process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DOCUMENT_AI_PROVIDER is set to 'mistral_ocr', but MISTRAL_API_KEY is not configured in the environment. Real OCR extraction cannot proceed without an API key."
      );
    }

    logger.info({ fileName: input.fileName }, "Running real OCR via Mistral AI");

    const mimeType = input.contentType || "application/pdf";
    const base64Data = input.buffer.toString("base64");

    const extractionPrompt = `Extract all purchase order information from this document into valid JSON:
{
  "poNumber": "string",
  "customerName": "string",
  "gstNumber": "string",
  "issueDate": "YYYY-MM-DD",
  "deliveryDate": "YYYY-MM-DD",
  "currency": "INR",
  "paymentTerms": "NET_30",
  "lineItems": [
    {
      "lineNumber": 1,
      "productCode": "string",
      "description": "string",
      "quantity": 1,
      "unitPrice": 100.0,
      "lineTotal": 100.0,
      "taxRate": 18
    }
  ],
  "subtotal": 100.0,
  "tax": 18.0,
  "discount": 0.0,
  "totalAmount": 118.0,
  "confidence": 0.98
}`;

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompt },
              { type: "image_url", image_url: `data:${mimeType};base64,${base64Data}` }
            ]
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.0
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Mistral OCR API error (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json();
    this.rawResult = json;

    const contentStr = json.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error("Mistral OCR returned an empty response.");
    }

    const parsed = JSON.parse(contentStr);
    return sanitizeAndReconcileExtractedPO(parsed);
  }
}

export class DocumentExtractorFactory {
  static getExtractor(): DocumentExtractor {
    const provider = env.DOCUMENT_AI_PROVIDER;
    switch (provider) {
      case "bedrock":
        return new BedrockOCRProvider();
      case "mistral_ocr":
        return new MistralOCRProvider();
      case "vision_fallback":
        return new GeminiVisionProvider();
      case "mock":
        return new MockOCRProvider();
      default:
        throw new Error(`Unknown DOCUMENT_AI_PROVIDER: ${provider}`);
    }
  }
}

