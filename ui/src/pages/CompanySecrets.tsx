import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Agent,
  type CompanySecret,
  type Project,
  type SecretProvider,
} from "@paperclipai/shared";
import { Copy, Info, KeyRound, Plus, Search, Trash2 } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { secretsApi } from "@/api/secrets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/context/ToastContext";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";

type SecretReference = {
  id: string;
  surface: "Agent" | "Project";
  name: string;
  envKey: string;
  href: string;
  version: string;
};

type SecretFormState = {
  name: string;
  value: string;
  description: string;
  provider: SecretProvider;
};

const EMPTY_SECRET_FORM: SecretFormState = {
  name: "",
  value: "",
  description: "",
  provider: "local_encrypted",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getSecretBinding(binding: unknown): { secretId: string; version: string } | null {
  const record = asRecord(binding);
  if (!record || record.type !== "secret_ref" || typeof record.secretId !== "string") return null;
  const version = typeof record.version === "number" ? `v${record.version}` : "latest";
  return { secretId: record.secretId, version };
}

function readAgentEnv(agent: Agent): Record<string, unknown> | null {
  return asRecord(agent.adapterConfig?.env);
}

function collectSecretReferences(agents: Agent[], projects: Project[]) {
  const references = new Map<string, SecretReference[]>();

  function add(secretId: string, reference: SecretReference) {
    const current = references.get(secretId) ?? [];
    references.set(secretId, [...current, reference]);
  }

  for (const agent of agents) {
    const env = readAgentEnv(agent);
    if (!env) continue;
    for (const [envKey, binding] of Object.entries(env)) {
      const secret = getSecretBinding(binding);
      if (!secret) continue;
      add(secret.secretId, {
        id: `agent:${agent.id}:${envKey}`,
        surface: "Agent",
        name: agent.name,
        envKey,
        href: `/agents/${agent.urlKey || agent.id}`,
        version: secret.version,
      });
    }
  }

  for (const project of projects) {
    const env = asRecord(project.env);
    if (!env) continue;
    for (const [envKey, binding] of Object.entries(env)) {
      const secret = getSecretBinding(binding);
      if (!secret) continue;
      add(secret.secretId, {
        id: `project:${project.id}:${envKey}`,
        surface: "Project",
        name: project.name,
        envKey,
        href: `/projects/${project.urlKey || project.id}/configuration`,
        version: secret.version,
      });
    }
  }

  return references;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Not tracked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not tracked";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeDate(value: Date | string | null | undefined) {
  if (!value) return "Not tracked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not tracked";
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return "just now";
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return rtf.format(Math.round(diffMs / day), "day");
}

function providerFallbackLabel(provider: SecretProvider) {
  return provider
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function envReferenceJson(secret: CompanySecret) {
  return JSON.stringify(
    {
      type: "secret_ref",
      secretId: secret.id,
      version: "latest",
    },
    null,
    2,
  );
}

function SecretStatusBadge() {
  return (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
      active
    </Badge>
  );
}

function EmptySecretsState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-border px-4 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border">
        <KeyRound className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No secrets stored yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Add API keys or tokens here, then bind them from agent or project environment variables.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        New secret
      </Button>
    </div>
  );
}

export function CompanySecrets() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"secrets" | "providers">("secrets");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<SecretFormState>(EMPTY_SECRET_FORM);
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [rotateValue, setRotateValue] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings", href: "/company/settings" },
      { label: "Secrets" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const secretsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const providersQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.providers(selectedCompanyId) : ["secret-providers", "none"],
    queryFn: () => secretsApi.providers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const providerLabels = useMemo(() => {
    return new Map((providersQuery.data ?? []).map((provider) => [provider.id, provider.label]));
  }, [providersQuery.data]);

  const referencesBySecret = useMemo(
    () => collectSecretReferences(agentsQuery.data ?? [], projectsQuery.data ?? []),
    [agentsQuery.data, projectsQuery.data],
  );

  const secrets = secretsQuery.data ?? [];
  const filteredSecrets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return secrets;
    return secrets.filter((secret) => {
      const providerLabel = providerLabels.get(secret.provider) ?? providerFallbackLabel(secret.provider);
      return [
        secret.name,
        secret.description ?? "",
        secret.externalRef ?? "",
        secret.provider,
        providerLabel,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [providerLabels, query, secrets]);

  const selectedSecret = useMemo(
    () => secrets.find((secret) => secret.id === selectedSecretId) ?? null,
    [secrets, selectedSecretId],
  );
  const selectedReferences = selectedSecret ? referencesBySecret.get(selectedSecret.id) ?? [] : [];

  useEffect(() => {
    if (!selectedSecret) {
      setEditName("");
      setEditDescription("");
      setRotateValue("");
      return;
    }
    setEditName(selectedSecret.name);
    setEditDescription(selectedSecret.description ?? "");
    setRotateValue("");
  }, [selectedSecret?.id, selectedSecret?.name, selectedSecret?.description]);

  const refreshSecrets = async () => {
    if (!selectedCompanyId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId) });
  };

  const createMutation = useMutation({
    mutationFn: (form: SecretFormState) =>
      secretsApi.create(selectedCompanyId!, {
        name: form.name.trim(),
        value: form.value,
        description: form.description.trim() || null,
        provider: form.provider,
      }),
    onSuccess: async (secret) => {
      setCreateOpen(false);
      setCreateForm(EMPTY_SECRET_FORM);
      await refreshSecrets();
      setSelectedSecretId(secret.id);
      pushToast({ title: "Secret created", body: `${secret.name} is ready.`, tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create secret",
        body: error instanceof Error ? error.message : "Secret creation failed.",
        tone: "error",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (secret: CompanySecret) =>
      secretsApi.update(secret.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      }),
    onSuccess: async (secret) => {
      await refreshSecrets();
      pushToast({ title: "Secret updated", body: `${secret.name} metadata saved.`, tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update secret",
        body: error instanceof Error ? error.message : "Secret update failed.",
        tone: "error",
      });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (secret: CompanySecret) => secretsApi.rotate(secret.id, { value: rotateValue }),
    onSuccess: async (secret) => {
      setRotateValue("");
      await refreshSecrets();
      pushToast({ title: "Secret rotated", body: `${secret.name} is now v${secret.latestVersion}.`, tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to rotate secret",
        body: error instanceof Error ? error.message : "Secret rotation failed.",
        tone: "error",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (secret: CompanySecret) => secretsApi.remove(secret.id),
    onSuccess: async () => {
      setSelectedSecretId(null);
      await refreshSecrets();
      pushToast({ title: "Secret deleted", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to delete secret",
        body: error instanceof Error ? error.message : "Secret deletion failed.",
        tone: "error",
      });
    },
  });

  async function copyReference(secret: CompanySecret) {
    try {
      await navigator.clipboard.writeText(envReferenceJson(secret));
      pushToast({ title: "Secret reference copied", tone: "success" });
    } catch {
      pushToast({ title: "Clipboard unavailable", body: "Open the secret details and copy the JSON manually.", tone: "warn" });
    }
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.name.trim() || !createForm.value) return;
    createMutation.mutate(createForm);
  }

  function confirmDelete(secret: CompanySecret) {
    const referenceCount = referencesBySecret.get(secret.id)?.length ?? 0;
    const message =
      referenceCount > 0
        ? `${secret.name} is referenced ${referenceCount} time(s). Delete it anyway? Runs using this secret reference may fail.`
        : `Delete ${secret.name}?`;
    if (window.confirm(message)) {
      deleteMutation.mutate(secret);
    }
  }

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">Select a company to manage secrets.</div>;
  }

  if (secretsQuery.error) {
    const message =
      secretsQuery.error instanceof ApiError && secretsQuery.error.status === 403
        ? "You do not have permission to manage company secrets."
        : secretsQuery.error instanceof Error
          ? secretsQuery.error.message
          : "Failed to load secrets.";
    return <div className="text-sm text-destructive">{message}</div>;
  }

  return (
    <div className="max-w-none space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Secrets</h1>
        </div>
        <div className="flex gap-5 border-b border-border text-sm">
          <button
            type="button"
            className={cn(
              "border-b-2 px-0 pb-2 text-sm transition-colors",
              activeTab === "secrets"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("secrets")}
          >
            Secrets
          </button>
          <button
            type="button"
            className={cn(
              "border-b-2 px-0 pb-2 text-sm transition-colors",
              activeTab === "providers"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("providers")}
          >
            Provider vaults
          </button>
        </div>
      </div>

      {activeTab === "secrets" ? (
        <>
          <section className="flex gap-3 rounded-md border border-border px-3 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Use secrets by binding them to runtime environment variables.</p>
              <p className="text-muted-foreground">
                Create a secret here, then open an agent or project Environment variables field, choose Secret, and select it.
              </p>
            </div>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-md sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, provider, ref"
              />
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New secret
            </Button>
          </div>

          <section className="overflow-hidden rounded-md border border-border">
            {secretsQuery.isLoading ? (
              <div className="px-4 py-10 text-sm text-muted-foreground">Loading secrets...</div>
            ) : filteredSecrets.length === 0 ? (
              secrets.length === 0 ? (
                <EmptySecretsState onCreate={() => setCreateOpen(true)} />
              ) : (
                <div className="px-4 py-10 text-sm text-muted-foreground">No secrets match the current search.</div>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Mode</th>
                      <th className="px-4 py-3 font-medium">Provider</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Version</th>
                      <th className="px-4 py-3 font-medium">Last rotated</th>
                      <th className="px-4 py-3 font-medium">References</th>
                      <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSecrets.map((secret) => {
                      const referenceCount = referencesBySecret.get(secret.id)?.length ?? 0;
                      return (
                        <tr key={secret.id} className="border-b border-border last:border-0">
                          <td className="max-w-sm px-4 py-3">
                            <div className="truncate font-medium">{secret.name}</div>
                            {secret.description ? (
                              <div className="mt-1 truncate text-xs text-muted-foreground">{secret.description}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">Paperclip-managed</td>
                          <td className="px-4 py-3">
                            {providerLabels.get(secret.provider) ?? providerFallbackLabel(secret.provider)}
                          </td>
                          <td className="px-4 py-3">
                            <SecretStatusBadge />
                          </td>
                          <td className="px-4 py-3">v{secret.latestVersion}</td>
                          <td className="px-4 py-3">
                            <span title={formatDate(secret.updatedAt)}>{formatRelativeDate(secret.updatedAt)}</span>
                          </td>
                          <td className="px-4 py-3">{referenceCount}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1.5">
                              <Button variant="ghost" size="xs" onClick={() => copyReference(secret)}>
                                <Copy className="h-3.5 w-3.5" />
                                Copy ref
                              </Button>
                              <Button variant="ghost" size="xs" onClick={() => setSelectedSecretId(secret.id)}>
                                Open
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="overflow-hidden rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Provider vaults</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Local encrypted storage is active. External vault providers are registered but require deployment support.
            </p>
          </div>
          <div className="divide-y divide-border">
            {(providersQuery.data ?? []).map((provider) => (
              <div key={provider.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="text-xs text-muted-foreground">{provider.id}</p>
                </div>
                <Badge variant="outline">
                  {provider.id === "local_encrypted" ? "Active" : provider.requiresExternalRef ? "External ref required" : "Available"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New secret</DialogTitle>
            <DialogDescription>Create an encrypted company secret for agent or project env bindings.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={createForm.name}
                onChange={(event) => setCreateForm((form) => ({ ...form, name: event.target.value }))}
                placeholder="OPENAI_API_KEY"
                autoFocus
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Provider</span>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                value={createForm.provider}
                onChange={(event) => setCreateForm((form) => ({ ...form, provider: event.target.value as SecretProvider }))}
              >
                {(providersQuery.data ?? [{ id: "local_encrypted" as SecretProvider, label: "Local encrypted (default)", requiresExternalRef: false }]).map((provider) => (
                  <option key={provider.id} value={provider.id} disabled={provider.requiresExternalRef}>
                    {provider.requiresExternalRef ? `${provider.label} (not configured)` : provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Value</span>
              <Input
                type="password"
                value={createForm.value}
                onChange={(event) => setCreateForm((form) => ({ ...form, value: event.target.value }))}
                placeholder="Paste secret value"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Description</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                value={createForm.description}
                onChange={(event) => setCreateForm((form) => ({ ...form, description: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!createForm.name.trim() || !createForm.value || createMutation.isPending}>
                Create secret
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSecret} onOpenChange={(open) => { if (!open) setSelectedSecretId(null); }}>
        <DialogContent className="sm:max-w-2xl">
          {selectedSecret ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedSecret.name}</DialogTitle>
                <DialogDescription>
                  {providerLabels.get(selectedSecret.provider) ?? providerFallbackLabel(selectedSecret.provider)} · v{selectedSecret.latestVersion}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
                <section className="space-y-3">
                  <div className="space-y-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Name</span>
                      <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Description</span>
                      <textarea
                        className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                      />
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => updateMutation.mutate(selectedSecret)}
                      disabled={!editName.trim() || updateMutation.isPending}
                    >
                      Save metadata
                    </Button>
                  </div>

                  <div className="space-y-2 border-t border-border pt-3">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Rotate value</span>
                      <Input
                        type="password"
                        value={rotateValue}
                        onChange={(event) => setRotateValue(event.target.value)}
                        placeholder="New secret value"
                      />
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => rotateMutation.mutate(selectedSecret)}
                      disabled={!rotateValue || rotateMutation.isPending}
                    >
                      Rotate to v{selectedSecret.latestVersion + 1}
                    </Button>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Environment reference</p>
                        <p className="text-xs text-muted-foreground">Use this as the env binding value.</p>
                      </div>
                      <Button variant="outline" size="xs" onClick={() => copyReference(selectedSecret)}>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                    </div>
                    <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-muted px-3 py-2 text-xs">
                      {envReferenceJson(selectedSecret)}
                    </pre>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">References ({selectedReferences.length})</p>
                    {selectedReferences.length === 0 ? (
                      <p className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
                        No agents or projects use this secret yet.
                      </p>
                    ) : (
                      <div className="max-h-48 divide-y divide-border overflow-auto rounded-md border border-border">
                        {selectedReferences.map((reference) => (
                          <Link
                            key={reference.id}
                            to={reference.href}
                            className="block px-3 py-2 text-sm hover:bg-accent/50"
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{reference.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {reference.surface} · {reference.envKey} · {reference.version}
                                </span>
                              </span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedSecretId(null)}>
                  Close
                </Button>
                <Button variant="destructive" onClick={() => confirmDelete(selectedSecret)} disabled={deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
