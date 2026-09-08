import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, formatPercent } from "../src/lib/format";
import { ApiError } from "../src/lib/axios";

describe("Frontend Formatting & ApiError Handling", () => {
  it("formats currency accurately with locale and currency code", () => {
    const formatted = formatCurrency(1250.5, "USD", "en-US");
    expect(formatted).toBe("$1,250.50");

    const zero = formatCurrency(0, "USD", "en-US");
    expect(zero).toBe("$0.00");
  });

  it("formats dates gracefully and handles undefined/invalid dates", () => {
    const valid = formatDate("2026-09-08T12:00:00Z");
    expect(valid).toBe("Sep 8, 2026");

    const invalid = formatDate("invalid-date");
    expect(invalid).toBe("—");

    const empty = formatDate(undefined);
    expect(empty).toBe("—");
  });

  it("formats percentages with specified decimals", () => {
    expect(formatPercent(98.456, 1)).toBe("98.5%");
    expect(formatPercent(100, 0)).toBe("100%");
  });

  it("ApiError correctly preserves flat error attributes matching §B3/§C4", () => {
    const error = new ApiError(
      {
        code: "VALIDATION_ERROR",
        message: "Purchase order validation failed",
        details: { field: "gstNumber" },
        requestId: "req_xyz789"
      },
      422
    );

    expect(error.name).toBe("ApiError");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Purchase order validation failed");
    expect(error.details).toEqual({ field: "gstNumber" });
    expect(error.requestId).toBe("req_xyz789");
    expect(error.status).toBe(422);
  });
});
