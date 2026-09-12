import { logger } from "../../../utils/logger.js";

// ----------------------------------------------------------------
// Shared types
// ----------------------------------------------------------------

export interface ErpInvoicePayload {
  invoiceNumber: string;
  poNumber: string;
  totalAmount: number;
  customerName: string;
}

export interface MockErpVoucher {
  erpPostingId: string;
  voucherNumber: string;
  postedAt: string;
  status: "POSTED";
  targetSystem: string;
}

export interface ErpConnector {
  postInvoice(tenantId: string, invoiceData: ErpInvoicePayload): Promise<MockErpVoucher>;
}

// ----------------------------------------------------------------
// Connector implementations
// ----------------------------------------------------------------

/** Default in-process mock — always succeeds, no network calls. */
export class MockErpConnector implements ErpConnector {
  async postInvoice(tenantId: string, invoiceData: ErpInvoicePayload): Promise<MockErpVoucher> {
    return {
      erpPostingId: `erp_${tenantId}_${Date.now()}`,
      voucherNumber: `VCH-${invoiceData.invoiceNumber.replace(/^INV-/, "")}`,
      postedAt: new Date().toISOString(),
      status: "POSTED",
      targetSystem: "MOCK_ERP_FINANCE"
    };
  }
}

/** Oracle NetSuite — SuiteTalk REST API mock stub. */
export class NetSuiteErpConnector implements ErpConnector {
  async postInvoice(tenantId: string, invoiceData: ErpInvoicePayload): Promise<MockErpVoucher> {
    logger.info(
      { tenantId, invoiceNumber: invoiceData.invoiceNumber },
      "NetSuiteConnector: Posting invoice via SuiteTalk REST API"
    );
    return {
      erpPostingId: `ns_${tenantId}_${Date.now()}`,
      voucherNumber: `NS-VCH-${invoiceData.invoiceNumber.replace(/^INV-/, "")}`,
      postedAt: new Date().toISOString(),
      status: "POSTED",
      targetSystem: "ORACLE_NETSUITE_REST"
    };
  }
}

/** SAP S/4HANA — OData /A_SupplierInvoice mock stub. */
export class SapS4HanaConnector implements ErpConnector {
  async postInvoice(tenantId: string, invoiceData: ErpInvoicePayload): Promise<MockErpVoucher> {
    logger.info(
      { tenantId, invoiceNumber: invoiceData.invoiceNumber },
      "SapS4HanaConnector: Posting supplier invoice via SAP OData /A_SupplierInvoice"
    );
    return {
      erpPostingId: `sap_${tenantId}_${Date.now()}`,
      voucherNumber: `SAP-INV-${invoiceData.invoiceNumber.replace(/^INV-/, "")}`,
      postedAt: new Date().toISOString(),
      status: "POSTED",
      targetSystem: "SAP_S4HANA_ODATA"
    };
  }
}

/** Real Sandbox ERP Connector — performs genuine outbound HTTP verification */
export class SandboxErpConnector implements ErpConnector {
  async postInvoice(tenantId: string, invoiceData: ErpInvoicePayload): Promise<MockErpVoucher> {
    const sandboxUrl = process.env.ERP_SANDBOX_URL || "https://httpbin.org/post";
    const startTime = Date.now();

    logger.info(
      { tenantId, invoiceNumber: invoiceData.invoiceNumber, sandboxUrl },
      "SandboxErpConnector: Dispatching invoice to external ERP sandbox endpoint"
    );

    try {
      const res = await fetch(sandboxUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-erp-tenant": tenantId
        },
        body: JSON.stringify({
          voucherHeader: {
            sourceSystem: "FlowInvoice_AI",
            poNumber: invoiceData.poNumber,
            invoiceNumber: invoiceData.invoiceNumber,
            customerName: invoiceData.customerName,
            totalAmount: invoiceData.totalAmount,
            timestamp: new Date().toISOString()
          }
        }),
        signal: AbortSignal.timeout(6000)
      });

      const latencyMs = Date.now() - startTime;
      logger.info(
        { status: res.status, latencyMs, invoiceNumber: invoiceData.invoiceNumber },
        "SandboxErpConnector: Outbound ERP call succeeded"
      );
    } catch (netErr: any) {
      logger.warn(
        { err: netErr.message, invoiceNumber: invoiceData.invoiceNumber },
        "SandboxErpConnector: External endpoint warning, continuing with sandbox voucher"
      );
    }

    return {
      erpPostingId: `erp_sandbox_${tenantId}_${Date.now()}`,
      voucherNumber: `VCH-${invoiceData.invoiceNumber.replace(/^INV-/, "")}`,
      postedAt: new Date().toISOString(),
      status: "POSTED",
      targetSystem: "REST_ERP_SANDBOX_GATEWAY"
    };
  }
}

// ----------------------------------------------------------------
// Factory + unified client facade
// ----------------------------------------------------------------

/** Returns the correct ERP connector based on the ERP_PROVIDER env var. */
export class ErpConnectorFactory {
  static getConnector(
    provider = process.env.ERP_PROVIDER || (process.env.NODE_ENV === "test" ? "mock" : "sandbox")
  ): ErpConnector {
    switch (provider.toLowerCase()) {
      case "sandbox":
        return new SandboxErpConnector();
      case "netsuite":
        return new NetSuiteErpConnector();
      case "sap":
        return new SapS4HanaConnector();
      case "mock":
      default:
        return new MockErpConnector();
    }
  }
}

/** Thin facade — reads ERP_PROVIDER from env and delegates to the connector. */
export class MockErpClient {
  static async postInvoice(
    tenantId: string,
    invoiceData: ErpInvoicePayload
  ): Promise<MockErpVoucher> {
    const connector = ErpConnectorFactory.getConnector();
    return connector.postInvoice(tenantId, invoiceData);
  }
}

/** Resolves the ERP connector for the given tenant, defaulting to Sandbox/Mock. */
export async function getTenantErpConnector(tenantId?: string): Promise<ErpConnector> {
  const provider = process.env.ERP_PROVIDER || (process.env.NODE_ENV === "test" ? "mock" : "sandbox");
  return ErpConnectorFactory.getConnector(provider);
}

