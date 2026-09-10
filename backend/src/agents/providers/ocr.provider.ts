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
}

export class DocumentExtractorFactory {
  static getExtractor(): DocumentExtractor {
    return new MockOCRProvider();
  }
}
