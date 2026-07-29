import { ChatGroq } from "@langchain/groq";
import * as z from "zod";

export const ClassificationSchema = z.object({
	intent: z.enum(["CREATE", "READ", "UPDATE", "DELETE"]),
	type: z.enum(["normal", "command"]),
	query: z.string().optional(),
	title: z.string().optional(),
	section: z.string().optional(),
	content: z.string().optional(),
	target: z.string().optional(),
	url: z.string().url().optional(),
	urls: z.array(z.string().url()).optional(),
	commands: z.array(z.string()).optional(),
	confidence: z.number().min(0).max(1).optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

const intentKeywords: Array<{ pattern: RegExp; intent: "CREATE" | "READ" | "UPDATE" | "DELETE" }> = [
	{ pattern: /^(?:\/add|\/create|\/new|\/insert|add|create|insert|append)\b/i, intent: "CREATE" },
	{ pattern: /^(?:\/search|\/find|\/query|search|find|show|get|look up|lookup)\b/i, intent: "READ" },
	{ pattern: /^(?:\/update|\/edit|\/replace|update|edit|replace|change)\b/i, intent: "UPDATE" },
	{ pattern: /^(?:\/delete|\/remove|delete|remove|drop|erase)\b/i, intent: "DELETE" },
];

const masterPrompt = `You classify messages for a Telegram knowledge assistant backed by a README knowledge base.

Return only JSON matching this shape:
{
  "intent": "CREATE" | "READ" | "UPDATE" | "DELETE",
  "type": "normal" | "command",
  "query"?: string,
  "title"?: string,
  "section"?: string,
  "content"?: string,
  "target"?: string,
  "url"?: string,
  "urls"?: string[],
  "commands"?: string[],
  "confidence"?: number
}

Rules:
- CREATE means append a new link, note, or section entry to the README.
- READ means semantic lookup / search.
- UPDATE means modify an existing link, entry, or section.
- DELETE means remove an existing link, entry, or section.
- Extract URLs when present.
- If the message looks like a slash command, set type to command.
- If a user asks a question or wants to find information, prefer READ.
`;

/** Strips a leading `/command` or bare keyword (add, update, ...) off a message, returning the remaining argument text. */
const stripLeadingToken = (value: string) => {
	const match = value.match(/^\s*(?:\/)?[a-zA-Z]+\s*/);
	if (!match) {
		return value.trim();
	}

	return value.slice(match[0].length).trim();
};

/**
 * Best-effort parse of `<title> <url?> [- ]<description...>` style arguments,
 * e.g. `/add Docker https://docker.com Containerization platform`.
 */
const parseEntryArgs = (argsText: string, urls: string[]) => {
	if (argsText.length === 0) {
		return { title: undefined as string | undefined, content: argsText };
	}

	const firstUrl = urls[0];
	if (firstUrl && argsText.includes(firstUrl)) {
		const [beforeUrl, afterUrlRaw] = argsText.split(firstUrl);
		const title = beforeUrl?.trim().replace(/[-:]\s*$/, "").trim();
		const afterUrl = afterUrlRaw?.trim().replace(/^[-:]\s*/, "").trim();
		return {
			title: title && title.length > 0 ? title : undefined,
			content: afterUrl && afterUrl.length > 0 ? afterUrl : title ?? argsText,
		};
	}

	// No URL: treat text before the first " - " (or first few words) as the title.
	const dashSplit = argsText.split(/\s+-\s+/);
	if (dashSplit.length > 1) {
		return { title: dashSplit[0]?.trim(), content: dashSplit.slice(1).join(" - ").trim() };
	}

	return { title: undefined, content: argsText };
};

const heuristicClassify = (message: string): Classification => {
	const cleaned = message.trim();
	const lower = cleaned.toLowerCase();
	const matchedIntent = intentKeywords.find(({ pattern }) => pattern.test(cleaned))?.intent;
	const extractedUrls = Array.from(cleaned.matchAll(/https?:\/\/[^\s)]+/g)).map(([value]) => value);

	if (matchedIntent) {
		const argsText = stripLeadingToken(cleaned);
		const parsed = parseEntryArgs(argsText, extractedUrls);

		return {
			intent: matchedIntent,
			type: cleaned.startsWith("/") ? "command" : "normal",
			query: argsText || cleaned,
			content: parsed.content || argsText || cleaned,
			title: parsed.title,
			target: parsed.title ?? argsText,
			urls: extractedUrls.length > 0 ? extractedUrls : undefined,
			commands: cleaned.startsWith("/") ? [cleaned.split(/\s+/)[0] ?? cleaned] : undefined,
			confidence: 0.92,
		};
	}

	if (/\?|find|search|show|get|details|related|similar|about/i.test(lower)) {
		return {
			intent: "READ" as const,
			type: "normal" as const,
			query: cleaned,
			content: cleaned,
			urls: extractedUrls.length > 0 ? extractedUrls : undefined,
			confidence: 0.7,
		};
	}

	return {
		intent: "CREATE" as const,
		type: "normal" as const,
		query: cleaned,
		content: cleaned,
		urls: extractedUrls.length > 0 ? extractedUrls : undefined,
		confidence: 0.5,
	};
};

const buildModel = () => {
	const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_API;

	if (!apiKey) {
		return null;
	}

	return new ChatGroq({
		apiKey,
		model: "llama-3.3-70b-versatile",
		temperature: 0,
});
};

export const categorise = async (message: string): Promise<Classification> => {
	const heuristic = heuristicClassify(message);
	const model = buildModel();

	if (!model) {
		return heuristic;
	}

	try {
		const structuredModel = model.withStructuredOutput(ClassificationSchema);
		const response = await structuredModel.invoke([
			{ role: "system", content: masterPrompt },
			{ role: "user", content: message },
		]);

		return {
			...heuristic,
			...response,
			urls: response.urls ?? heuristic.urls,
			commands: response.commands ?? heuristic.commands,
			query: response.query ?? heuristic.query,
			content: response.content ?? heuristic.content,
			confidence: response.confidence ?? heuristic.confidence,
		};
	} catch {
		return heuristic;
	}
};