import { groqModel } from "./groq.js";
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
	{ pattern: /^(?:\/add|\/create|\/new|\/insert|add|create|insert|append|save|store|bookmark|remember|remind me to|note)\b/i, intent: "CREATE" },
	{ pattern: /^(?:\/get|\/search|\/find|\/query|search|find|show|get|look up|lookup)\b/i, intent: "READ" },
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
- Omit unused optional fields. Never supply null or empty URLs.
- CREATE means append a new link, note, or section entry to the README.
- READ means semantic lookup / search.
- UPDATE means modify an existing link, entry, or section.
- DELETE means remove an existing link, entry, or section.
- Keep the original facts, dates, names and URLs verbatim. Route reminders to Reminders, links to Links, other notes to Notes unless the user names a section. For updates, target identifies the old entry.
- If the message looks like a slash command, set type to command.
- If a user asks a question or wants to find information, prefer READ.
`;

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
		const start = argsText.indexOf(firstUrl);
		const beforeUrl = argsText.slice(0, start);
		const afterUrlRaw = argsText.slice(start + firstUrl.length);
		const title = beforeUrl?.trim().replace(/[-:]\s*$/, "").trim();
		const afterUrl = afterUrlRaw?.trim().replace(/^[-:]\s*/, "").trim();
		return {
			title: title && title.length > 0 ? title : undefined,
			content: afterUrl && afterUrl.length > 0 ? afterUrl : title ?? argsText,
		};
	}

	// A spaced dash separates an optional title from a plain-text note.
	const dashSplit = argsText.split(/\s+-\s+/);
	if (dashSplit.length > 1) {
		return { title: dashSplit[0]?.trim(), content: dashSplit.slice(1).join(" - ").trim() };
	}

	return { title: undefined, content: argsText };
};

const heuristicClassify = (message: string): Classification => {
	const input = message.trim().replace(/^(\/\w+)@\w+\b/, "$1");
	const direct = input.replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i, "");
	const cleaned = intentKeywords.some(({ pattern }) => pattern.test(direct)) ? direct : input;
	const command = cleaned.startsWith("/");
	const match = intentKeywords.find(({ pattern }) => pattern.test(cleaned));
	const urls = cleaned.match(/https?:\/\/[^\s<>]+/gi) ?? [];
	const rawArgs = match ? cleaned.replace(match.pattern, "").trim() : cleaned;
	const named = /^(?:CREATE|UPDATE)$/.test(match?.intent ?? "") ? rawArgs.match(/^\[([^\]\n]+)\]\s+/) : null;
	const args = named ? rawArgs.slice(named[0].length) : rawArgs;
	const question = /\?$|^(?:who|what|when|where|why|which|how|can|could|do|does|did|is|are|have|has|tell me|list|recall|any (?:links|notes|reminders)|remind me (?:what|when|where|how))\b/i.test(cleaned);
	const greeting = /^(?:hi|hey|hello|thanks?|thank you|ok|bye)[!. ]*$/i.test(cleaned);
	const intent = match?.intent ?? (command || question || greeting ? "READ" : "CREATE");
	const text = args.replace(/^(?:a note (?:that|about)|the (?:note|entry) (?:about|for)|that)\s+/i, "");
	const parsed = parseEntryArgs(text, urls);
	const target = parsed.title ?? text.replace(/^the\s+|\s+entry$/gi, "").trim();

	return {
		intent,
		type: command ? "command" : "normal",
		query: args,
		content: parsed.content,
		title: parsed.title,
		target,
		section: named?.[1] ?? (/^remind me\b|^reminder\b/i.test(args) || /^remind me\b/i.test(cleaned)
			? "Reminders" : urls.length ? "Links" : "Notes"),
		urls,
		confidence: match ? 0.92 : 0.5,
	};
};

export const categorise = async (message: string): Promise<Classification> => {
	const heuristic = heuristicClassify(message);
	if (heuristic.type === "command") {
		if (!intentKeywords.some(({ pattern }) => pattern.test(message.trim()))) throw new Error("Unknown command. Send /help for examples.");
		if (!heuristic.query) throw new Error("Include a topic or entry after the command.");
		return heuristic;
	}
	const explicitIntent = intentKeywords.some(({ pattern }) => pattern.test(message.trim()));
	const model = groqModel();

	if (!model) {
		return heuristic;
	}

	try {
		const structuredModel = model.withStructuredOutput(ClassificationSchema, { method: "jsonMode" });
		const response = await structuredModel.invoke([
			{ role: "system", content: masterPrompt },
			{ role: "user", content: message },
		]);

		const originalUrls = heuristic.urls ?? [];
		const verbatim = response.content?.trim();
		return {
			...heuristic,
			...response,
			intent: heuristic.intent === "READ" || explicitIntent ? heuristic.intent : response.intent,
			url: response.url && originalUrls.includes(response.url) ? response.url : originalUrls[0],
			urls: originalUrls,
			commands: response.commands ?? heuristic.commands,
			query: response.query ?? heuristic.query,
			content: response.intent !== "CREATE" || (verbatim && message.includes(verbatim))
				? response.content || heuristic.content : heuristic.content,
			confidence: response.confidence ?? heuristic.confidence,
		};
	} catch (error) {
		console.warn("Groq classification unavailable, using rules.", error instanceof Error ? error.name : "unknown error");
		return heuristic;
	}
};