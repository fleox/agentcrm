import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Modal } from "./Overlay";

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
}

export function ConfirmDialog({ open, onConfirm, onCancel, title, description, confirmLabel, cancelLabel, danger, loading }: ConfirmOptions & { open: boolean; onConfirm(): void; onCancel(): void; loading?: boolean }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading} autoFocus>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-surface-600 dark:text-surface-300">{description}</div>}
    </Modal>
  );
}

// Imperative API: `if (await confirmDialog({ title, danger: true })) …`.
// Needs <ConfirmHost /> mounted once (App does it).
type Pending = ConfirmOptions & { resolve(ok: boolean): void };
let push: ((p: Pending) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) {
      resolve(typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(String(opts.title)) : false);
      return;
    }
    push({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    push = (p) => setPending(p);
    return () => {
      push = null;
    };
  }, []);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return <ConfirmDialog open={!!pending} {...(pending ?? { title: "" })} onConfirm={() => close(true)} onCancel={() => close(false)} />;
}
