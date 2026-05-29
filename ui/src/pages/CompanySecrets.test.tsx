// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanySecrets } from "./CompanySecrets";

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  providers: vi.fn(),
  create: vi.fn(),
  rotate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockProjectsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/api/secrets", () => ({
  secretsApi: mockSecretsApi,
}));

vi.mock("@/api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("@/api/projects", () => ({
  projectsApi: mockProjectsApi,
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "OpenTrain" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("CompanySecrets", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSecretsApi.providers.mockResolvedValue([
      { id: "local_encrypted", label: "Local encrypted (default)", requiresExternalRef: false },
    ]);
    mockSecretsApi.list.mockResolvedValue([
      {
        id: "secret-1",
        companyId: "company-1",
        name: "OPENAI_API_KEY",
        provider: "local_encrypted",
        externalRef: null,
        latestVersion: 2,
        description: "OpenAI key",
        createdByAgentId: null,
        createdByUserId: null,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-21T12:00:00.000Z",
      },
      {
        id: "secret-2",
        companyId: "company-1",
        name: "CLICKUP_API_TOKEN",
        provider: "local_encrypted",
        externalRef: null,
        latestVersion: 1,
        description: null,
        createdByAgentId: null,
        createdByUserId: null,
        createdAt: "2026-05-19T12:00:00.000Z",
        updatedAt: "2026-05-19T12:00:00.000Z",
      },
    ]);
    mockAgentsApi.list.mockResolvedValue([
      {
        id: "agent-1",
        companyId: "company-1",
        name: "Engineer",
        urlKey: "engineer",
        adapterConfig: {
          env: {
            OPENAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
          },
        },
      },
    ]);
    mockProjectsApi.list.mockResolvedValue([
      {
        id: "project-1",
        companyId: "company-1",
        name: "Growth",
        urlKey: "growth",
        env: {
          CLICKUP_API_TOKEN: { type: "secret_ref", secretId: "secret-2", version: "latest" },
        },
      },
    ]);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders company secrets with computed agent and project references", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanySecrets />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.textContent).toContain("Secrets");
    expect(container.textContent).toContain("Provider vaults");
    expect(container.textContent).toContain("OPENAI_API_KEY");
    expect(container.textContent).toContain("CLICKUP_API_TOKEN");
    expect(container.textContent).toContain("Local encrypted (default)");
    expect(container.textContent).toContain("v2");
    expect(container.textContent).toContain("Paperclip-managed");

    const referenceCells = Array.from(container.querySelectorAll("td")).filter((cell) => cell.textContent === "1");
    expect(referenceCells.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("filters the table by search text", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanySecrets />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "clickup");
      input!.dispatchEvent(new InputEvent("input", { bubbles: true, data: "clickup" }));
    });

    expect(container.textContent).not.toContain("OPENAI_API_KEY");
    expect(container.textContent).toContain("CLICKUP_API_TOKEN");

    await act(async () => {
      root.unmount();
    });
  });
});
