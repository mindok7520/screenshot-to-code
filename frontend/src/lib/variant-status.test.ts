import {
  didAllVariantsFailAfterClose,
  getIncompleteVariantIndexes,
} from "./variant-status";

describe("variant status helpers", () => {
  test("finds variants that never reached a terminal status", () => {
    expect(
      getIncompleteVariantIndexes([
        { status: "complete" },
        { status: "generating" },
        {},
        { status: "error" },
      ])
    ).toEqual([1, 2]);
  });

  test("treats all failed or unfinished variants as failed after close", () => {
    expect(
      didAllVariantsFailAfterClose([
        { status: "error" },
        { status: "generating" },
        {},
      ])
    ).toBe(true);
  });

  test("does not treat a partially successful request as fully failed", () => {
    expect(
      didAllVariantsFailAfterClose([
        { status: "complete" },
        { status: "generating" },
      ])
    ).toBe(false);
  });
});
