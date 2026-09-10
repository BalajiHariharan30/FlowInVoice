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

    // Generate unique PO number from file fingerprint + current timestamp tail
    const poNumSuffix = isDuplicate ? "DUP-9999" : `${seed.toString().slice(0, 3)}-${Date.now().toString().slice(-5)}`;
    const poNumber = `PO-${poNumSuffix}`;

    // Pick customer from a realistic enterprise roster, deterministically from seed
    const CUSTOMERS = [
      { name: "Acme Global Industries",         gst: "27AABCU9603R1ZM", state: "27" },
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
    const customer = CUSTOMERS[rand(CUSTOMERS.length)];

    // Pick 2–4 realistic product line items from a catalog seeded by file
    const CATALOG = [
      { code: "PROD-CLOUD-01", desc: "Enterprise Cloud Hosting Subscription",    min: 800,  max: 2500, qty: [1, 2, 3] },
      { code: "PROD-SUPP-02",  desc: "24/7 Dedicated Support Add-on",            min: 400,  max: 900,  qty: [1] },
      { code: "PROD-DATA-03",  desc: "AI/ML Data Analytics Platform License",    min: 3000, max: 8000, qty: [1, 2] },
      { code: "PROD-NET-04",   desc: "SD-WAN Networking Infrastructure Module",  min: 1500, max: 4000, qty: [1, 2, 5] },
      { code: "PROD-SEC-05",   desc: "Cybersecurity Compliance Suite (Annual)",  min: 2000, max: 6000, qty: [1] },
      { code: "PROD-MOB-06",   desc: "Enterprise Mobile Device Management",      min: 120,  max: 450,  qty: [10, 20, 50, 100] },
      { code: "PROD-IOT-07",   desc: "Industrial IoT Sensor Array (Per Unit)",   min: 75,   max: 300,  qty: [5, 10, 25, 50] },
      { code: "PROD-ERP-08",   desc: "SAP ERP Integration Connector License",    min: 5000, max: 12000, qty: [1] },
      { code: "PROD-STOR-09",  desc: "Distributed Block Storage (TB/month)",     min: 200,  max: 800,  qty: [5, 10, 20] },
      { code: "PROD-RPA-10",   desc: "Robotic Process Automation Workflow Bot",  min: 1800, max: 5500, qty: [1, 2, 3] }
    ];

    const itemCount = 2 + (seed % 3); // 2, 3, or 4 items
    const chosenItems: typeof CATALOG = [];
    const usedIndices = new Set<number>();
    for (let i = 0; i < itemCount; i++) {
      let idx = (seed * (i + 7)) % CATALOG.length;
      while (usedIndices.has(idx)) idx = (idx + 1) % CATALOG.length;
      usedIndices.add(idx);
      chosenItems.push(CATALOG[idx]);
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
}

export class DocumentExtractorFactory {
  static getExtractor(): DocumentExtractor {
    return new MockOCRProvider();
  }
}
