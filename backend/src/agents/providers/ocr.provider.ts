import { z } from "zod";
import { logger } from "../../utils/logger.js";

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
}

export class MockOCRProvider implements DocumentExtractor {
  async extract(input: DocumentInput): Promise<ExtractedPOData> {
    logger.info({ fileName: input.fileName }, "Running OCR extraction");
    // Parse sample text or generate realistic extracted PO structure
    const fileName = input.fileName.toLowerCase();

    // Support testing low confidence or invalid files
    const isLowConfidence = fileName.includes("low_confidence") || fileName.includes("blurry");
    const isDuplicate = fileName.includes("duplicate");

    const poNumber = isDuplicate
      ? "PO-DUP-9999"
      : `PO-${Math.floor(100000 + Math.random() * 900000)}`;

    return {
      poNumber,
      customerName: "Acme Global Industries",
      gstNumber: "27AABCU9603R1ZM",
      issueDate: new Date().toISOString().split("T")[0],
      deliveryDate: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
      currency: "INR",
      paymentTerms: "NET_30",
      lineItems: [
        {
          lineNumber: 1,
          productCode: "PROD-CLOUD-01",
          description: "Enterprise Cloud Hosting Subscription",
          quantity: 2,
          unitPrice: 1200.0,
          lineTotal: 2400.0,
          taxRate: 18,
          gstNumber: "27AABCU9603R1ZM"
        },
        {
          lineNumber: 2,
          productCode: "PROD-SUPP-02",
          description: "24/7 Dedicated Support Add-on",
          quantity: 1,
          unitPrice: 600.0,
          lineTotal: 600.0,
          taxRate: 18,
          gstNumber: "27AABCU9603R1ZM"
        }
      ],
      subtotal: 3000.0,
      tax: 540.0,
      discount: 0.0,
      totalAmount: 3540.0,
      confidence: isLowConfidence ? 0.62 : 0.98
    };
  }
}

export class DocumentExtractorFactory {
  static getExtractor(): DocumentExtractor {
    return new MockOCRProvider();
  }
}
