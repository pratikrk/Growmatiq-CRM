import { describe, expect, it } from "bun:test";
import { DEFAULT_WORKSPACE_NAME } from "@crm/auth/organization";
import { workspaceLabel } from "../lib/workspace-label";

describe("what the header calls this install", () => {
	it("says Growmatiq before anybody has named the workspace", () => {
		expect(workspaceLabel(DEFAULT_WORKSPACE_NAME)).toBe("Growmatiq");
	});

	it("falls back to Growmatiq while the workspace is still loading", () => {
		expect(workspaceLabel(undefined)).toBe("Growmatiq");
		expect(workspaceLabel("")).toBe("Growmatiq");
		expect(workspaceLabel("   ")).toBe("Growmatiq");
	});

	it("shows the workspace name as it is, without a suffix", () => {
		expect(workspaceLabel("Acme")).toBe("Acme");
		expect(workspaceLabel("  Acme  ")).toBe("Acme");
		expect(workspaceLabel("Acme CRM")).toBe("Acme CRM");
	});
});
