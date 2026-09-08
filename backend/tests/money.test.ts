import { describe, it, expect } from "vitest";
import { MoneyUtil } from "../src/utils/money.js";

describe("MoneyUtil (Decimal.js Deterministic Arithmetic)", () => {
  it("avoids standard IEEE 754 floating point precision errors", () => {
    // 0.1 + 0.2 in JS float is 0.30000000000000004
    const floatResult = 0.1 + 0.2;
    expect(floatResult).not.toBe(0.3);

    // With MoneyUtil:
    const total = MoneyUtil.sum([0.1, 0.2]);
    expect(total.toNumber()).toBe(0.3);
    expect(MoneyUtil.equals(total, 0.3)).toBe(true);
  });

  it("accurately calculates line item totals: qty * unitPrice", () => {
    const lineTotal = MoneyUtil.multiply(3, 149.99);
    expect(lineTotal.toNumber()).toBe(449.97);
  });

  it("calculates accurate tax and total amount", () => {
    const subtotal = 1000.0;
    const taxRate = 18; // 18% GST
    const tax = MoneyUtil.calculateTax(subtotal, taxRate);
    expect(tax.toNumber()).toBe(180.0);

    const total = MoneyUtil.calculateTotal(subtotal, tax, 50.0); // with $50 discount
    expect(total.toNumber()).toBe(1130.0);
  });

  it("correctly calculates variance percentages against catalog prices", () => {
    // Actual 105 vs Expected 100 -> 5% variance
    const variance = MoneyUtil.calculateVariancePercentage(105, 100);
    expect(variance.toNumber()).toBe(5.0);

    // Actual 90 vs Expected 100 -> 10% variance
    const varNegative = MoneyUtil.calculateVariancePercentage(90, 100);
    expect(varNegative.toNumber()).toBe(10.0);
  });
});
