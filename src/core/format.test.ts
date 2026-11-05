import { describe, expect, it } from "vitest";
import { formatEditable, formatLength } from "./format";

describe("measurement formatting", () => {
  it("shows whole millimetres without a decimal and otherwise one", () => {
    expect(formatLength(60)).toBe("60");
    expect(formatLength(60.5)).toBe("60.5");
    expect(formatLength(56.2499)).toBe("56.2");
  });

  it("shows up to two decimals in editable fields, without trailing zeros", () => {
    expect(formatEditable(60)).toBe("60");
    expect(formatEditable(56.25)).toBe("56.25");
    expect(formatEditable(56.2499)).toBe("56.25");
    expect(formatEditable(56.2)).toBe("56.2");
  });

  it("rounds once, not twice", () => {
    // The old reference editor formatted the measurement to two decimals and
    // then formatted that string to one: 56.2499 -> "56.25" -> "56.3", while
    // the sketch label showed 56.2. The editor now keeps the measurement
    // numeric, so both surfaces see the same 56.2499.
    const measured = 56.2499;
    expect(formatLength(measured)).toBe("56.2");
    expect(formatLength(Number(formatEditable(measured)))).toBe("56.3");
  });
});
