// Record header avatar / logo: click or drop an image → square crop
// (zoom + pan) → setRecordImage; menu to replace / remove. Initials when
// the object has no image (or no image field).

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import type { CrmRecord, ObjectDef } from "../../../core/types";
import { Dropdown, FileAvatar, hasFiles, ImageCropModal, filesFromDataTransfer, useFilesBridge, type PreparedUpload } from "../../../components/ui";
import { useCan, useOps } from "../../../app/CrmDataContext";
import { clearRecordImage, setRecordImage } from "../../../ops/files";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";

export function RecordAvatarEditor({ record, object, name, disabled }: { record: CrmRecord; object: ObjectDef; name: string; disabled?: boolean }) {
  const { t } = useTranslation("records");
  const ops = useOps();
  const bridge = useFilesBridge();
  const canWrite = useCan("records.write") && !disabled;
  const field = object.imageField ? object.fields.find((f) => f.id === object.imageField && f.type === "image") : undefined;
  const value = field ? record.fields[field.id] : undefined;
  const imageId = typeof value === "string" ? value : undefined;
  const square = object.id === "companies";
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const editable = canWrite && !!field && !!bridge;

  const pick = (files: File[]) => {
    const img = files.find((f) => f.type.startsWith("image/"));
    if (!img) return toast.error(t("avatar.notImage"));
    if (img.type === "image/svg+xml" || img.type === "image/gif") return void save(null, img);
    setFile(img);
  };
  const save = async (prepared: PreparedUpload | null, raw?: File) => {
    try {
      const upload = prepared ?? { name: raw!.name, mime: raw!.type, bytes: new Uint8Array(await raw!.arrayBuffer()) };
      await setRecordImage(ops, record.id, field!.id, upload);
      setFile(null);
      toast.success(square ? t("avatar.logoSaved") : t("avatar.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const remove = async () => {
    try {
      await clearRecordImage(ops, record.id, field!.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const avatar = <FileAvatar fileId={imageId} name={name} size="lg" square={square} className="h-11 w-11 text-base" />;
  if (!editable) return <span data-testid="record-avatar">{avatar}</span>;

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="record-avatar-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) pick(files);
        }}
      />
      <Dropdown
        align="start"
        trigger={({ ref, onClick }) => (
          <button
            ref={ref as never}
            type="button"
            data-testid="record-avatar"
            title={imageId ? t("avatar.change") : t("avatar.add")}
            aria-label={imageId ? t("avatar.change") : t("avatar.add")}
            onClick={() => (imageId ? onClick() : input.current?.click())}
            onDragOver={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setOver(false);
              pick(filesFromDataTransfer(e.dataTransfer));
            }}
            className={cn("group/avatar relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-accent-500", square ? "rounded" : "rounded-full", over && "ring-2 ring-accent-500 ring-offset-2 dark:ring-offset-surface-950")}
          >
            {avatar}
            <span className={cn("absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover/avatar:flex", square ? "rounded" : "rounded-full", over && "flex")}>
              <Camera className="h-4 w-4" />
            </span>
          </button>
        )}
        items={[
          { id: "replace", label: square ? t("avatar.replaceLogo") : t("avatar.replace"), icon: <ImagePlus />, onSelect: () => input.current?.click() },
          { id: "remove", label: t("avatar.remove"), icon: <Trash2 />, danger: true, separator: true, onSelect: () => void remove() },
        ]}
      />
      <ImageCropModal open={!!file} file={file} round={!square} title={square ? t("avatar.cropLogo") : t("avatar.crop")} onClose={() => setFile(null)} onConfirm={(p) => save(p)} />
    </>
  );
}
