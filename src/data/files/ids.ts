// Blob ids are path-safe: file ids from newId() and "<id>_t" thumbnails.
export const FILE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function assertFileId(id: string): void {
  if (!FILE_ID_RE.test(id)) throw new Error(`Invalid file id "${id}".`);
}
