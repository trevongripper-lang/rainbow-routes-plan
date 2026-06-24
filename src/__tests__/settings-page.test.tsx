import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const signOutMock = vi.fn().mockResolvedValue({ error: null });
const getSessionMock = vi.fn().mockResolvedValue({ data: { session: null } });
const rpcMock = vi.fn().mockResolvedValue({ data: false });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      signOut: () => signOutMock(),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ ...(options as Record<string, unknown>) }),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
    [k: string]: unknown;
  }) => React.createElement("a", { href: to, ...rest }, children),
}));

const cancelQueriesMock = vi.fn().mockResolvedValue(undefined);
const clearMock = vi.fn();

vi.mock("@tanstack/react-query", () => {
  const useQuery = ({ queryFn }: { queryFn: () => Promise<unknown> }) => {
    const [data, setData] = React.useState<unknown>(undefined);
    React.useEffect(() => {
      queryFn().then(setData);
    }, []);
    return { data };
  };
  return {
    useQuery,
    useQueryClient: () => ({ cancelQueries: cancelQueriesMock, clear: clearMock }),
  };
});

vi.mock("@/components/install-app-banner", () => ({
  InstallAppButton: () => React.createElement("button", null, "Install"),
}));

const originalAssign = window.location.assign;

beforeEach(() => {
  signOutMock.mockClear();
  cancelQueriesMock.mockClear();
  clearMock.mockClear();
  rpcMock.mockClear().mockResolvedValue({ data: false });
  getSessionMock.mockClear().mockResolvedValue({ data: { session: null } });
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign: vi.fn() },
    writable: true,
  });
  window.localStorage.clear();
});

afterAll(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign: originalAssign },
    writable: true,
  });
});

import { Route } from "@/routes/_authenticated/settings";
import { BETA_CONSENT_VERSION, BETA_CONSENT_KEY } from "@/lib/beta-consent";

function renderPage() {
  const Component = (Route as unknown as { component: React.FC }).component;
  return render(<Component />);
}

describe("Settings page", () => {
  it("shows the user-facing rows: install, profile, privacy, terms, support, sign out", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
    expect(screen.getByTestId("settings-link-profile")).toHaveAttribute("href", "/me");
    expect(screen.getByTestId("settings-link-privacy")).toHaveAttribute("href", "/privacy");
    expect(screen.getByTestId("settings-link-terms")).toHaveAttribute("href", "/terms");
    expect(screen.getByTestId("settings-sign-out")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /email support/i })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:hello@tgklabs\.io/),
    );
    expect(screen.getByRole("link", { name: /report a bug/i })).toHaveAttribute(
      "href",
      expect.stringContaining("bug%20report"),
    );
  });

  it("exposes the beta build/version label", () => {
    renderPage();
    expect(screen.getByText(new RegExp(`Beta build: ${BETA_CONSENT_VERSION}`))).toBeInTheDocument();
  });

  it("shows 'Consent on file' badge when local consent is cached", () => {
    window.localStorage.setItem(
      BETA_CONSENT_KEY,
      JSON.stringify({ v: BETA_CONSENT_VERSION, at: new Date().toISOString() }),
    );
    renderPage();
    expect(screen.getByText(/consent on file/i)).toBeInTheDocument();
  });

  it("hides the admin diagnostics link for non-admins", async () => {
    renderPage();
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
    expect(screen.queryByTestId("settings-link-diagnostics")).not.toBeInTheDocument();
  });

  it("shows the admin diagnostics link when has_role returns true", async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { user: { id: "admin-1" } } },
    });
    rpcMock.mockResolvedValueOnce({ data: true });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("settings-link-diagnostics")).toHaveAttribute(
        "href",
        "/console/diagnostics",
      ),
    );
  });

  it("signs out cleanly: cancels queries, clears cache, calls signOut, redirects to /auth", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("settings-sign-out"));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    expect(cancelQueriesMock).toHaveBeenCalled();
    expect(clearMock).toHaveBeenCalled();
    expect(window.location.assign).toHaveBeenCalledWith("/auth");
  });
});
