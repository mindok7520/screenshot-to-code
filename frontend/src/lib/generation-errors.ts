export const GENERATION_ERROR_MESSAGE =
  "Error generating code. Check the Developer Console AND the backend logs for details. Feel free to open a Github issue.";

export function resolveGenerationFailureMessage({
  closeReason,
  serverErrorMessage,
}: {
  closeReason?: string;
  serverErrorMessage?: string;
}): string {
  const trimmedCloseReason = closeReason?.trim();
  if (trimmedCloseReason) return trimmedCloseReason;

  const trimmedServerErrorMessage = serverErrorMessage?.trim();
  if (trimmedServerErrorMessage) return trimmedServerErrorMessage;

  return GENERATION_ERROR_MESSAGE;
}
