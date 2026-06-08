import { Variant } from "../components/commits/types";

export const INCOMPLETE_VARIANT_MESSAGE =
  "Generation ended before this option completed. Retry to run it again.";

export function getIncompleteVariantIndexes(
  variants: Array<Pick<Variant, "status">>
): number[] {
  return variants.flatMap((variant, index) =>
    variant.status === undefined || variant.status === "generating"
      ? [index]
      : []
  );
}

export function didAllVariantsFailAfterClose(
  variants: Array<Pick<Variant, "status">>
): boolean {
  return (
    variants.length > 0 &&
    variants.every(
      (variant) =>
        variant.status === undefined ||
        variant.status === "generating" ||
        variant.status === "error" ||
        variant.status === "cancelled"
    )
  );
}
