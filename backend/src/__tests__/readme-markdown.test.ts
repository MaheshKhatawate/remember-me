import { describe, expect, it } from "vitest";
import {
	appendReadmeEntry,
	buildReadmeChunks,
	compactReadmeText,
	formatReadmeEntry,
	removeReadmeEntry,
	replaceReadmeEntry,
} from "../utils/readme-markdown.js";

describe("formatReadmeEntry", () => {
	it("formats a title + url + differing content as a markdown link with suffix", () => {
		expect(
			formatReadmeEntry({ title: "Docker", url: "https://docker.com", content: "Container platform" }),
		).toBe("- [Docker](https://docker.com) - Container platform");
	});

	it("omits the suffix when content duplicates the title", () => {
		expect(formatReadmeEntry({ title: "Docker", url: "https://docker.com", content: "Docker" })).toBe(
			"- [Docker](https://docker.com)",
		);
	});

	it("falls back to a plain bullet when there's no title or url", () => {
		expect(formatReadmeEntry({ content: "Just a note" })).toBe("- Just a note");
	});

	it("handles a bare url with description", () => {
		expect(formatReadmeEntry({ url: "https://example.com", content: "An example" })).toBe(
			"- https://example.com - An example",
		);
	});
});

describe("appendReadmeEntry", () => {
	it("creates a missing section and inserts the entry", () => {
		const result = appendReadmeEntry("# README\n", "Links", "- [Docker](https://docker.com)");
		expect(result.changed).toBe(true);
		expect(result.content).toContain("## Links");
		expect(result.content).toContain("- [Docker](https://docker.com)");
	});

	it("appends into an existing section without duplicating the heading", () => {
		const initial = "# README\n\n## Links\n\n- [Existing](https://existing.com)\n";
		const result = appendReadmeEntry(initial, "Links", "- [Docker](https://docker.com)");
		expect((result.content.match(/## Links/g) ?? []).length).toBe(1);
		expect(result.content).toContain("- [Existing](https://existing.com)");
		expect(result.content).toContain("- [Docker](https://docker.com)");
	});

	it("does not leave more than one consecutive blank line", () => {
		const initial = "# README\n\n## Links\n\n- [Existing](https://existing.com)\n";
		const result = appendReadmeEntry(initial, "Links", "- [Docker](https://docker.com)");
		expect(result.content).not.toMatch(/\n{3,}/);
	});
});

describe("replaceReadmeEntry", () => {
	it("replaces a matching bullet line in place", () => {
		const initial = "## Links\n\n- [Docker](https://docker.com) - old description\n";
		const result = replaceReadmeEntry(initial, ["Docker"], "- [Docker](https://docker.com) - new description");
		expect(result.changed).toBe(true);
		expect(result.content).toContain("new description");
		expect(result.content).not.toContain("old description");
	});

	it("reports no change when nothing matches", () => {
		const initial = "## Links\n\n- [Docker](https://docker.com)\n";
		const result = replaceReadmeEntry(initial, ["Kubernetes"], "- [Kubernetes](https://kubernetes.io)");
		expect(result.changed).toBe(false);
		expect(result.content).toBe(initial);
	});
});

describe("removeReadmeEntry", () => {
	it("removes a matching bullet line", () => {
		const initial = "## Links\n\n- [Docker](https://docker.com)\n- [Kubernetes](https://kubernetes.io)\n";
		const result = removeReadmeEntry(initial, ["Kubernetes"]);
		expect(result.changed).toBe(true);
		expect(result.content).toContain("Docker");
		expect(result.content).not.toContain("Kubernetes");
	});

	it("reports no change when nothing matches", () => {
		const initial = "## Links\n\n- [Docker](https://docker.com)\n";
		const result = removeReadmeEntry(initial, ["Nonexistent"]);
		expect(result.changed).toBe(false);
		expect(result.content).toBe(initial);
	});
});

describe("buildReadmeChunks", () => {
	it("splits sections and bullet lines into separate chunks", () => {
		const content = "# Title\n\n## Links\n\n- [Docker](https://docker.com) - platform\n- A plain note\n";
		const chunks = buildReadmeChunks(content);

		const sectionChunks = chunks.filter((chunk) => chunk.type === "section");
		const linkChunks = chunks.filter((chunk) => chunk.type === "link");
		const lineChunks = chunks.filter((chunk) => chunk.type === "line");

		expect(sectionChunks.length).toBeGreaterThan(0);
		expect(linkChunks.some((chunk) => chunk.text.includes("Docker"))).toBe(true);
		expect(lineChunks.some((chunk) => chunk.text.includes("plain note"))).toBe(true);
	});

	it("returns no chunks for empty content", () => {
		expect(buildReadmeChunks("")).toEqual([]);
	});
});

describe("compactReadmeText", () => {
	it("normalizes CRLF line endings and trims surrounding whitespace", () => {
		expect(compactReadmeText("\r\n# Title\r\n\r\nBody\r\n\r\n")).toBe("# Title\n\nBody");
	});
});
