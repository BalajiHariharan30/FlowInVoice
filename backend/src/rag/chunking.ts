export interface DocumentChunk {
  chunkId: string;
  tenantId: string;
  documentId: string;
  documentName: string;
  documentType: "CONTRACT" | "POLICY";
  customerId?: string;
  section: string;
  pageNumber: number;
  content: string;
}

export class DocumentChunker {
  /**
   * Structure-aware chunking based on sections, clauses, and page delimiters
   */
  static chunkContractOrPolicy(
    tenantId: string,
    documentId: string,
    documentName: string,
    documentType: "CONTRACT" | "POLICY",
    text: string,
    customerId?: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = text.split("\n");

    let currentSection = "General Terms";
    let currentPage = 1;
    let currentBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect page markers e.g. [Page 2] or --- Page 2 ---
      const pageMatch = line.match(/(?:\[Page\s*(\d+)\]|---\s*Page\s*(\d+)\s*---)/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1] || pageMatch[2], 10);
      }

      // Detect section headers e.g. Section 4. Pricing & Discounts
      const sectionMatch = line.match(/^(?:Section|Article|Clause|\d+\.)\s*([0-9A-Za-z\s\-_:]{3,50})/i);
      if (sectionMatch && currentBuffer.length > 0) {
        chunks.push({
          chunkId: `${documentId}-chunk-${chunks.length + 1}`,
          tenantId,
          documentId,
          documentName,
          documentType,
          customerId,
          section: currentSection,
          pageNumber: currentPage,
          content: currentBuffer.join("\n").trim()
        });
        currentBuffer = [];
        currentSection = line;
      }

      if (line.length > 0) {
        currentBuffer.push(line);
      }

      // Flush if buffer is sufficiently sized
      if (currentBuffer.join(" ").length > 800) {
        chunks.push({
          chunkId: `${documentId}-chunk-${chunks.length + 1}`,
          tenantId,
          documentId,
          documentName,
          documentType,
          customerId,
          section: currentSection,
          pageNumber: currentPage,
          content: currentBuffer.join("\n").trim()
        });
        currentBuffer = [];
      }
    }

    if (currentBuffer.length > 0) {
      chunks.push({
        chunkId: `${documentId}-chunk-${chunks.length + 1}`,
        tenantId,
        documentId,
        documentName,
        documentType,
        customerId,
        section: currentSection,
        pageNumber: currentPage,
        content: currentBuffer.join("\n").trim()
      });
    }

    return chunks;
  }
}
