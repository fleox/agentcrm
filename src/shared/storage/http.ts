import i18n from "../../i18n";
import { toast } from "../lib/toast";
import { StorageError, type StorageAction } from "./types";

// Shared HTTP error funnel for connectors. Every failure (HTTP non-2xx
// OR network/CORS) is surfaced via the global toast system in addition
// to throwing — so calling code can still react locally (inline error
// states, retry buttons) while the user gets an immediate visible alert.

export function actionLabel(action: StorageAction): string {
  return i18n.t(`storage.actions.${action}`);
}

// Tries to extract a human-readable message from an error body
// (JSON `{ "error": "..." }` / `{ "message": "..." }` or plain text).
// Truncates so a giant HTML 500 page doesn't blow up the toast.
function extractDetail(body: string | undefined): string {
  if (!body) return "";
  let text = body.trim();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    text = parsed.error ?? parsed.message ?? text;
  } catch {
    // Not JSON — keep the raw body.
  }
  if (text.length > 240) text = text.slice(0, 240) + "…";
  return text;
}

// Maps an HTTP failure to the most descriptive translated message we can
// produce. Used both for the toast UX and as the StorageError message.
function buildErrorMessage(action: StorageAction, status: number, body: string | undefined): string {
  const label = actionLabel(action);
  const detail = extractDetail(body);
  switch (status) {
    case 401:
    case 403:
      return i18n.t("storage.errors.auth", { action: label });
    case 404:
      return i18n.t("storage.errors.notFound", { action: label });
    case 413:
      return i18n.t("storage.errors.tooLarge", { action: label });
    case 429:
      return i18n.t("storage.errors.rateLimited", { action: label });
    case 500:
    case 502:
    case 503:
    case 504:
      return i18n.t("storage.errors.serverError", { action: label, status });
    default:
      return i18n.t("storage.errors.generic", {
        action: label,
        status,
        detail: detail ? `: ${detail}` : "",
      });
  }
}

// Wraps a fetch call so that:
//   - HTTP non-2xx → toast + StorageError thrown.
//   - Thrown fetch (network down, CORS, abort) → toast + rethrow as-is so
//     callers can still detect AbortError specifically.
// Returns the raw Response on success.
export async function performRequest(
  action: StorageAction,
  fetcher: () => Promise<Response>,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher();
  } catch (err) {
    // AbortError is an explicit user-initiated cancel — never toast it.
    if ((err as { name?: string })?.name === "AbortError") throw err;
    toast.error(i18n.t("storage.errors.network", { action: actionLabel(action) }));
    throw err;
  }
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  // 404 on delete is a "desired state already met" sentinel — callers
  // suppress it. Skip the toast there.
  const isSilenced = (action === "delete" || action === "deleteFolder") && res.status === 404;
  const message = buildErrorMessage(action, res.status, body);
  if (!isSilenced) toast.error(message);
  throw new StorageError(message, res.status, body);
}

// Thrown by the facade when the active connector can't perform an
// action and there is no emulation path for it.
export function unsupported(action: StorageAction, connectorId: string): StorageError {
  const message = i18n.t("storage.errors.unsupported", {
    action: actionLabel(action),
    connector: connectorId,
  });
  toast.error(message);
  return new StorageError(message, 501);
}
