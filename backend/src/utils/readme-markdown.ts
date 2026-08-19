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

export const buildReadmeChunks = (content: string): ReadmeChunk[] => {
	const lines = content.split(/\r?\n/);
	const chunks: ReadmeChunk[] = [];
	let currentSection = "README";
	let sectionBuffer: string[] = [];

	const flushSection = () => {
		const sectionText = sectionBuffer.join("\n").trim();
		if (sectionText.length > 0) {
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

	for (const line of lines) {
		if (headingPattern.test(line)) {
			flushSection();
			currentSection = line.replace(headingPattern, "$2").trim();
			sectionBuffer.push(line);
			continue;
		}

		sectionBuffer.push(line);

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
	const level = headingLevel(lines[headingIndex] ?? "");
	for (let index = headingIndex + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!headingPattern.test(line)) {
			continue;
		}

		if (headingLevel(line) <= level) {
			return index;
		}
	}

	return lines.length;
};

const ensureSection = (lines: string[], title: string) => {
	const headingIndex = findHeadingIndex(lines, title);
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
	if (title && url) {
		const suffix = content && normalize(content) !== normalize(title) ? ` - ${content}` : "";
		return `- [${title}](${url})${suffix}`;
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
	const insertAt = findSectionEndIndex(lines, headingIndex);

	const sectionLines = lines.slice(headingIndex + 1, insertAt);
	const needsLeadingBlank = sectionLines.length > 0 && (sectionLines[sectionLines.length - 1]?.trim().length ?? 0) > 0;
	const insertion: string[] = [];

	if (needsLeadingBlank) {
		insertion.push("");
	}

	insertion.push(entryLine, "");
	lines.splice(insertAt, 0, ...insertion);

	return {
		content: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
		changed: true,
		message: `Inserted entry into ${section}`,
	};
};

const isContentLine = (line: string) => {
	const trimmed = line.trim();
	return trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed);
};

const matchesTokens = (line: string, tokens: string[]) => {
	const normalizedLine = normalize(line);
	return tokens.some((token) => token.length > 0 && normalizedLine.includes(normalize(token)));
};

export const replaceReadmeEntry = (
	content: string,
	tokens: string[],
	replacementLine: string,
): ReadmeMutation => {
	const lines = content.split(/\r?\n/);
	const entryIndex = lines.findIndex((line) => isContentLine(line) && matchesTokens(line, tokens));

	if (entryIndex < 0) {
		return {
			content,
			changed: false,
			message: "No matching README entry was found to update",
		};
	}

	lines[entryIndex] = replacementLine;
	return {
		content: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
		changed: true,
		message: "Updated the matching README entry",
	};
};

export const removeReadmeEntry = (content: string, tokens: string[]) => {
	const lines = content.split(/\r?\n/);
	const entryIndex = lines.findIndex((line) => isContentLine(line) && matchesTokens(line, tokens));

	if (entryIndex < 0) {
		return {
			content,
			changed: false,
			message: "No matching README entry was found to delete",
		};
	}

	lines.splice(entryIndex, 1);

	while (lines.length > 0 && lines[lines.length - 1]?.trim().length === 0) {
		lines.pop();
	}

	return {
		content: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
		changed: true,
		message: "Removed the matching README entry",
	};
};

export const compactReadmeText = (content: string) => content.replace(/\r\n/g, "\n").trim();