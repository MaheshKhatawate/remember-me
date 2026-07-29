import { Resource } from "../models/resource.js";
import { categorise } from "../utils/category.js";
import { readRepoFile } from "../utils/github-repo.js";
import { writeRepo } from "../utils/write-repo.js";
import {
	appendReadmeEntry,
	compactReadmeText,
	formatReadmeEntry,
	removeReadmeEntry,
	replaceReadmeEntry,
} from "../utils/readme-markdown.js";
import { answerWithContext, searchReadme, syncReadmeIndex } from "./rag.js";

const defaultSection = "Links";

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const pickTokens = (classification: Record<string, unknown>, fallback: string) => {
	const tokens = [
		toText(classification.title),
		toText(classification.target),
		toText(classification.section),
		toText(classification.url),
		toText(classification.query),
		fallback,
	].filter((token) => token.length > 0);

	const urls = Array.isArray(classification.urls) ? classification.urls.filter((token): token is string => typeof token === "string") : [];
	return [...tokens, ...urls];
};

const formatResultMessage = (intent: string, detail: string) => {
	switch (intent) {
		case "CREATE":
			return `README updated: ${detail}`;
		case "UPDATE":
			return `README entry updated: ${detail}`;
		case "DELETE":
			return `README entry removed: ${detail}`;
		default:
			return detail;
	}
};

export const processMessage = async (message: string) => {
	const classification = await categorise(message);
	const intent = toText(classification.intent) || "READ";
	const readmeFile = await readRepoFile({ path: "README.md" }).catch(() => ({ content: "", branch: process.env.GITHUB_BRANCH ?? "main", path: "README.md" }));
	const currentReadme = compactReadmeText(readmeFile.content ?? "");
	const section = toText(classification.section) || defaultSection;
	const title = toText(classification.title) || toText(classification.target) || undefined;
	const url = toText(classification.url) || (Array.isArray(classification.urls) ? classification.urls.find((value) => typeof value === "string" && value.length > 0) : undefined);
	const content = toText(classification.content) || toText(classification.query) || message;

	if (intent === "READ") {
		await syncReadmeIndex(currentReadme || readmeFile.content || "");
		const results = await searchReadme(content || message);
		const answer = await answerWithContext(content || message, results);

		await Resource.create({
			kind: "audit",
			sourcePath: "telegram",
			intent,
			content: message,
			metadata: { classification, results },
		});

		return {
			intent,
			classification,
			message: formatResultMessage(intent, answer),
			searchResults: results,
		};
	}

	let nextReadme = currentReadme || "# README\n";
	let mutationMessage = "";

	if (intent === "CREATE") {
		const entryLine = formatReadmeEntry({ title, url, content });
		const mutation = appendReadmeEntry(nextReadme, section, entryLine);
		nextReadme = mutation.content;
		mutationMessage = mutation.message;
	} else if (intent === "UPDATE") {
		const replacementLine = formatReadmeEntry({ title, url, content });
		const tokens = pickTokens(classification, message);
		const mutation = replaceReadmeEntry(nextReadme, tokens, replacementLine);

		if (!mutation.changed) {
			const fallbackMutation = appendReadmeEntry(nextReadme, section, replacementLine);
			nextReadme = fallbackMutation.content;
			mutationMessage = `${mutation.message}. Added the entry to ${section} instead.`;
		} else {
			nextReadme = mutation.content;
			mutationMessage = mutation.message;
		}
	} else if (intent === "DELETE") {
		const tokens = pickTokens(classification, message);
		const mutation = removeReadmeEntry(nextReadme, tokens);
		nextReadme = mutation.content;
		mutationMessage = mutation.message;
	} else {
		mutationMessage = "Unsupported intent; no README change was applied.";
	}

	const contentActuallyChanged = nextReadme !== currentReadme;

	let repoWrite = undefined;
	if ((intent === "CREATE" || intent === "UPDATE" || intent === "DELETE") && contentActuallyChanged) {
		repoWrite = await writeRepo({
			content: nextReadme,
			path: "README.md",
			commitMessage: `${intent} README entry from Telegram`,
		});
		await syncReadmeIndex(nextReadme);
	}

	await Resource.create({
		kind: "audit",
		sourcePath: "telegram",
		intent,
		content: message,
		metadata: { classification, mutationMessage, repoWrite },
	});

	return {
		intent,
		classification,
		message: formatResultMessage(intent, mutationMessage),
		repoWrite,
		updatedReadme: nextReadme,
	};
};