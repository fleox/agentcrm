// Users & roles: list, add, change role, disable / enable, delete with
// reassignment of owned records. Engine rules (last admin…) surface as
// toasts.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, UserCheck, UserPlus, UserX } from "lucide-react";
import { Avatar, Badge, Button, FormField, IconButton, Input, Modal, Select, Table, TBody, THead, Td, Th, Tr } from "../../../components/ui";
import { useCan, useCurrentUser, useOps, useUsers } from "../../../app/CrmDataContext";
import { useAuth } from "../../../app/AuthContext";
import { USER_ROLES, type CrmUser, type UserRole } from "../../../core/types";
import { createUser, deleteUser, setUserRole, updateUser } from "../../../ops/users";
import { ReadOnlyNote, SectionHeader, runOp } from "../components/common";

export function UsersSection() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const me = useCurrentUser();
  const { backend } = useAuth();
  const users = useUsers({ includeDisabled: true });
  const canEdit = useCan("users.write");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CrmUser | null>(null);
  const roleOptions = USER_ROLES.map((r) => ({ value: r, label: tc(`roles.${r}`) }));

  return (
    <div className="max-w-4xl">
      <SectionHeader
        title={t("users.title")}
        description={t("users.description")}
        actions={
          canEdit && (
            <Button variant="primary" size="sm" icon={<UserPlus />} onClick={() => setAdding(true)}>
              {t("users.add")}
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote />}
      <p className="mb-3 text-xs text-surface-500">{t(`users.backendNote.${backend}`, { defaultValue: t("users.backendNote.default") })}</p>
      <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
        <Table>
          <THead>
            <tr>
              <Th>{t("users.name")}</Th>
              <Th>{t("users.email")}</Th>
              <Th className="w-36">{t("users.role")}</Th>
              <Th className="w-24">{t("users.status")}</Th>
              {canEdit && <Th className="w-20" />}
            </tr>
          </THead>
          <TBody>
            {users.map((u) => {
              const self = u.id === me.id;
              return (
                <Tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                      <span className="truncate font-medium">{u.name}</span>
                      {self && <Badge color="blue">{t("users.you")}</Badge>}
                    </span>
                  </Td>
                  <Td className="text-surface-600 dark:text-surface-300">{u.email}</Td>
                  <Td>
                    {canEdit ? (
                      <Select
                        aria-label={t("users.role")}
                        value={u.role}
                        options={roleOptions}
                        onChange={(e) => {
                          const role = e.target.value as UserRole;
                          void runOp(() => setUserRole(ops, u.id, role), (x) => t("users.roleChanged", { name: x.name, role: tc(`roles.${x.role}`) }));
                        }}
                      />
                    ) : (
                      <Badge color={u.role === "admin" ? "purple" : u.role === "member" ? "blue" : "gray"}>{tc(`roles.${u.role}`)}</Badge>
                    )}
                  </Td>
                  <Td>{u.disabled ? <Badge color="red">{t("users.disabled")}</Badge> : <Badge color="green">{t("users.active")}</Badge>}</Td>
                  {canEdit && (
                    <Td>
                      <span className="flex items-center justify-end gap-0.5">
                        <IconButton
                          size="xs"
                          label={u.disabled ? t("users.enable") : t("users.disable")}
                          icon={u.disabled ? <UserCheck /> : <UserX />}
                          onClick={() => void runOp(() => updateUser(ops, u.id, { disabled: !u.disabled }), (x) => (x.disabled ? t("users.disabledToast", { name: x.name }) : t("users.enabledToast", { name: x.name })))}
                        />
                        <IconButton size="xs" label={tc("common.delete")} icon={<Trash2 />} disabled={self} onClick={() => setDeleting(u)} />
                      </span>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-surface-500 sm:grid-cols-3">
        {USER_ROLES.map((r) => (
          <div key={r} className="rounded-md border border-surface-200 p-2 dark:border-surface-800">
            <dt className="font-medium text-surface-700 dark:text-surface-200">{tc(`roles.${r}`)}</dt>
            <dd>{t(`users.roleHelp.${r}`)}</dd>
          </div>
        ))}
      </dl>
      {adding && <AddUserModal onClose={() => setAdding(false)} />}
      {deleting && <DeleteUserModal user={deleting} users={users} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function AddUserModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} size="sm" title={t("users.add")} dismissible={false}>
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const res = await runOp(() => createUser(ops, { email, name, role }), (u) => t("users.added", { name: u.name }));
          setSaving(false);
          if (res) onClose();
        }}
      >
        <FormField label={t("users.email")} htmlFor="user-email">
          <Input id="user-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
        </FormField>
        <FormField label={t("users.name")} htmlFor="user-name">
          <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </FormField>
        <FormField label={t("users.role")} htmlFor="user-role">
          <Select id="user-role" value={role} options={USER_ROLES.map((r) => ({ value: r, label: tc(`roles.${r}`) }))} onChange={(e) => setRole(e.target.value as UserRole)} />
        </FormField>
        <p className="text-xs text-surface-500">{t("users.addHelp")}</p>
        <div className="flex justify-end gap-2 border-t border-surface-100 pt-3 dark:border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={<UserPlus />} loading={saving} disabled={!email.trim()}>
            {tc("common.add")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUserModal({ user, users, onClose }: { user: CrmUser; users: CrmUser[]; onClose(): void }) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const others = users.filter((u) => u.id !== user.id && !u.disabled);
  const [reassignTo, setReassignTo] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={tc("confirm.deleteTitle", { name: user.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await runOp(() => deleteUser(ops, user.id, reassignTo ? { reassignTo } : {}), (r) => t("users.deleted", { name: user.name, count: r.reassigned }));
              setBusy(false);
              if (res) onClose();
            }}
          >
            {tc("common.delete")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-surface-600 dark:text-surface-300">{t("users.deleteHelp")}</p>
      <FormField label={t("users.reassignTo")} htmlFor="user-reassign">
        <Select id="user-reassign" value={reassignTo} options={[{ value: "", label: t("users.unassign") }, ...others.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))]} onChange={(e) => setReassignTo(e.target.value)} />
      </FormField>
    </Modal>
  );
}
