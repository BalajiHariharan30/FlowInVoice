import { Decimal } from "decimal.js";

// Configure Decimal.js for financial accuracy
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export class MoneyUtil {
  static from(value: string | number | Decimal): Decimal {
    return new Decimal(value);
  }

  static multiply(qty: string | number | Decimal, price: string | number | Decimal): Decimal {
    return new Decimal(qty).times(new Decimal(price));
  }

  static sum(values: (string | number | Decimal)[]): Decimal {
    return values.reduce<Decimal>((acc, val) => acc.plus(new Decimal(val)), new Decimal(0));
  }

  static calculateTax(subtotal: string | number | Decimal, ratePercentage: string | number | Decimal): Decimal {
    return new Decimal(subtotal).times(new Decimal(ratePercentage)).dividedBy(100);
  }

  static calculateTotal(
    subtotal: string | number | Decimal,
    tax: string | number | Decimal,
    discount: string | number | Decimal = 0
  ): Decimal {
    return new Decimal(subtotal).plus(new Decimal(tax)).minus(new Decimal(discount));
  }

  static calculateVariancePercentage(
    actual: string | number | Decimal,
    expected: string | number | Decimal
  ): Decimal {
    const act = new Decimal(actual);
    const exp = new Decimal(expected);
    if (exp.isZero()) return new Decimal(0);
    return act.minus(exp).abs().dividedBy(exp).times(100);
  }

  static equals(a: string | number | Decimal, b: string | number | Decimal, tolerance = 0.01): boolean {
    const diff = new Decimal(a).minus(new Decimal(b)).abs();
    return diff.lessThanOrEqualTo(tolerance);
  }

  static format(val: string | number | Decimal, decimals = 2): string {
    return new Decimal(val).toFixed(decimals);
  }

  static toNumber(val: string | number | Decimal): number {
    return new Decimal(val).toNumber();
  }
}
