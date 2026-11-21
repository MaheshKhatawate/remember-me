export type ReadmeChunk = {
	id: string;
	section: string;
	heading?: string;
	text: string;
	type: "section" | "line" | "link";
};

export type ReadmeMutation = {
	content: string;
	changed: boolean;
	message: string;
};

const headingPattern = /^(#{1,6})\s+(.*)$/;
const bulletPattern = /^\s*[-*+]\s+(.*)$/;
const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/;

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const sectionHeading = (title: string) => `## ${title.trim()}`;

const headingLevel = (line: string) => line.match(headingPattern)?.[1]?.length ?? 0;

// A heading or bullet inside a fenced example is literal text.
const markdownLines = (lines: string[]) => {
	let fence = "";
	return lines.map((line) => {
		const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (!fence && marker?.[1]) {
			fence = marker[1];
			return "";
		}
		if (!fence) return line;
		if (marker?.[1]?.startsWith(fence) && !marker[2]?.trim()) fence = "";
		return "";
	});
};

export const buildReadmeChunks = (content: string): ReadmeChunk[] => {
	const lines = content.split(/\r?\n/);
	const chunks: ReadmeChunk[] = [];
	let currentSection = "README";
	let sectionBuffer: string[] = [];

	const flushSection = () => {
		const sectionText = sectionBuffer.join("\n").trim();
		if (sectionBuffer.some((line) => line.trim() && !headingPattern.test(line))) {
			chunks.push({
				id: `section-${chunks.length}`,
				section: currentSection,
				heading: currentSection,
				text: sectionText,
				type: "section",
			});
		}
		sectionBuffer = [];
	};

	const structuralLines = markdownLines(lines);
	for (const [index, raw] of lines.entries()) {
		const line = structuralLines[index] ?? "";
		if (headingPattern.test(line)) {
			flushSection();
			currentSection = line.replace(headingPattern, "$2").trim();
			sectionBuffer.push(line);
			continue;
		}

		sectionBuffer.push(raw);

		if (bulletPattern.test(line)) {
			const bulletText = line.replace(bulletPattern, "$1").trim();
			chunks.push({
				id: `line-${chunks.length}`,
				section: currentSection,
				heading: currentSection,
				text: bulletText,
				type: linkPattern.test(bulletText) ? "link" : "line",
			});
		}
	}

	flushSection();

	return chunks.filter((chunk) => chunk.text.trim().length > 0);
};

const findHeadingIndex = (lines: string[], title: string) => {
	const normalizedTitle = normalize(title);
	return lines.findIndex((line) => {
		const match = line.match(headingPattern);
		if (!match) {
			return false;
		}

		return normalize(match[2] ?? "") === normalizedTitle;
	});
};

const findSectionEndIndex = (lines: string[], headingIndex: number) => {
	for (let index = headingIndex + 1; index < lines.length; index += 1) {
		if (headingLevel(lines[index] ?? "")) return index;
	}
	return lines.length;
};

const ensureSection = (lines: string[], title: string) => {
	const headingIndex = findHeadingIndex(markdownLines(lines), title);
	if (headingIndex >= 0) {
		return { lines, headingIndex, created: false };
	}

	const nextLines = [...lines];
	if (nextLines.length > 0 && (nextLines[nextLines.length - 1] ?? "").trim().length > 0) {
		nextLines.push("");
	}

	nextLines.push(sectionHeading(title), "");
	return { lines: nextLines, headingIndex: nextLines.length - 2, created: true };
};

export const formatReadmeEntry = ({
	title,
	url,
	content,
}: {
	title?: string | undefined;
	url?: string | undefined;
	content: string;
}) => {
	content = content.replace(/\s+/g, " ").trim();
	title = title?.replace(/\s+/g, " ").trim();
	if (title && url) {
		const suffix = content && normalize(content) !== normalize(title) ? ` - ${content}` : "";
		return `- [${title.replace(/[\[\]]/g, "\\$&")}](${url.replace(/\(/g, "%28").replace(/\)/g, "%29")})${suffix}`;
	}

	if (url) {
		const suffix = content && normalize(content) !== normalize(url) ? ` - ${content}` : "";
		return `- ${url}${suffix}`;
	}

	if (title) {
		const suffix = content && normalize(content) !== normalize(title) ? ` - ${content}` : "";
		return `- ${title}${suffix}`;
	}

	return `- ${content}`;
};

export const appendReadmeEntry = (
	content: string,
	section: string,
	entryLine: string,
): ReadmeMutation => {
	const initialLines = content.split(/\r?\n/);
	const ensured = ensureSection(initialLines, section);
	const lines = [...ensured.lines];
	const headingIndex = ensured.headingIndex;
	const structural = markdownLines(lines);
	let insertAt = findSectionEndIndex(structural, headingIndex);
	if (structural.slice(headingIndex + 1, insertAt).includes(entryLine)) {
		return { content, changed: false, message: `Entry already saved in ${section}` };
	}
	while (insertAt > headingIndex + 1 && !lines[insertAt - 1]?.trim()) insertAt--;
	const leading = bulletPattern.test(lines[insertAt - 1] ?? "") ? [] : [""];
	const needsBlank = insertAt === lines.length || Boolean(lines[insertAt]?.trim());
	lines.splice(insertAt, 0, ...leading, entryLine, ...(needsBlank ? [""] : []));
	if (lines[lines.length - 1] !== "") lines.push("");

	return {
		content: lines.join(content.includes("\r\n") ? "\r\n" : "\n"),
		changed: true,
		message: `Inserted entry into ${section}`,
	};
};

const words = (value: string): string[] => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];

const findEntry = (lines: string[], tokens: string[]) => {
	const bullets = markdownLines(lines).map((line) => line.match(bulletPattern)?.[1]);
	for (const token of tokens.filter((value) => value.trim())) {
		const target = words(token);
		if (!target.length) continue;
		const exact: number[] = [];
		const partial: number[] = [];
		bullets.forEach((body, index) => {
			if (!body) return;
			const title = body.match(linkPattern)?.[1] ?? body.split(" - ")[0] ?? body;
			if (normalize(title) === normalize(token)) exact.push(index);
			else if (target.every((word) => words(body).includes(word))) partial.push(index);
		});
		const matches = exact.length ? exact : partial;
		if (matches.length > 1) throw new Error("Several README entries match. Use a more specific title or URL.");
		if (matches[0] !== undefined) return matches[0];
	}
	return -1;
};

export const replaceReadmeEntry = (
	content: string,
	tokens: string[],
	replacementLine: string,
): ReadmeMutation => {
	const lines = content.split(/\r?\n/);
	const entryIndex = findEntry(lines, tokens);

	if (entryIndex < 0) {
		return {
			content,
			changed: false,
			message: "No matching README entry was found to update",
		};
	}

	lines[entryIndex] = replacementLine;
	return {
		content: lines.join(content.includes("\r\n") ? "\r\n" : "\n"),
		changed: true,
		message: "Updated the matching README entry",
	};
};

export const removeReadmeEntry = (content: string, tokens: string[]) => {
	const lines = content.split(/\r?\n/);
	const entryIndex = findEntry(lines, tokens);

	if (entryIndex < 0) {
		return {
			content,
			changed: false,
			message: "No matching README entry was found to delete",
		};
	}

	lines.splice(entryIndex, 1);

	return {
		content: lines.join(content.includes("\r\n") ? "\r\n" : "\n"),
		changed: true,
		message: "Removed the matching README entry",
	};
};

export const compactReadmeText = (content: string) => content.replace(/\r\n/g, "\n").trim();