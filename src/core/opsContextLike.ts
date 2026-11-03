// Structural view of src/ops/context.ts OpsContext, so core/ (which must
// not import ops/) can type plugin action callbacks. ops/context.ts's
// OpsContext is assignable to it.
import type { CrmUser } from "./types";

export interface OpsContextLike {
  user: CrmUser | null;
  now(): number;
  log?: (msg: string) => void;
}
