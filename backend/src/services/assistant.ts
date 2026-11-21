import { Resource } from "../models/resource.js";
import { categorise, type Classification } from "../utils/category.js";
import { readRepoFile } from "../utils/github-repo.js";
import { writeRepo } from "../utils/write-repo.js";
import { appendReadmeEntry, formatReadmeEntry, removeReadmeEntry, replaceReadmeEntry } from "../utils/readme-markdown.js";
import { answerWithContext, markReadmeIndexDirty, searchReadme, syncReadmeIndex } from "./rag.js";
import { withReadme } from "./readme-queue.js";

const mutate = async (item: Classification) => {
	const file = await readRepoFile({ allowMissing: item.intent === "CREATE" || item.intent === "UPDATE" });
	const url = item.url || item.urls?.[0];
	const section = item.section?.replace(/\s+/g, " ").trim() || (url ? "Links" : "Notes");
	const content = item.content?.trim() || item.title || url;
	const targets = [item.target || item.title, url].filter((value): value is string => Boolean(value));
	const current = file.content;
	let mutation;
	if (item.intent === "DELETE") {
		mutation = removeReadmeEntry(current, targets);
	} else {
		if (!content) throw new Error("Include the note, reminder or link you want to save.");
		const entry = formatReadmeEntry({ title: item.title, url, content });
		const initial = current || "# Second Brain\n";
		if (item.intent === "UPDATE") {
			mutation = replaceReadmeEntry(initial, targets, entry);
			if (!mutation.changed) {
				mutation = appendReadmeEntry(initial, section, entry);
				mutation.message = `No entry matched. Added the entry to ${section} instead.`;
			}
		} else {
			mutation = appendReadmeEntry(initial, section, entry);
		}
	}
	const updatedReadme = mutation.content;
	if (updatedReadme === current) {
		const message = item.intent === "UPDATE" && mutation.changed ? "The matching README entry is already up to date." : mutation.message;
		return { message, updatedReadme };
	}
	await markReadmeIndexDirty();
	const repoWrite = await writeRepo({
		content: updatedReadme, path: file.path, branch: file.branch, sha: file.sha,
		commitMessage: `${item.intent} README entry from Telegram`,
	});
	try {
		await syncReadmeIndex(updatedReadme);
	} catch {
		mutation.message += ". Saved to GitHub, but indexing failed. Run /sync to rebuild search.";
	}
	const labels = { CREATE: "README updated", UPDATE: "README entry updated", DELETE: "README entry removed", READ: "" };
	return { message: `${labels[item.intent]}: ${mutation.message}`, repoWrite, updatedReadme };
};

export const processMessage = async (message: string) => {
	let classification: Classification | undefined;
	let detail;
	try {
		const item = await categorise(message);
		classification = item;
		if (item.intent === "READ") {
			const query = item.type === "command" ? item.query?.trim() || message : message;
			const searchResults = await searchReadme(query);
			detail = { message: await answerWithContext(query, searchResults), searchResults };
		} else {
			detail = await withReadme(() => mutate(item));
		}
	} catch (error) {
		await Resource.create({ kind: "audit", sourcePath: "telegram", intent: classification?.intent ?? "INVALID", content: message,
			metadata: { classification, error: error instanceof Error ? error.message : "Processing failed" } }).catch(() => console.error("Could not record failed message in audit log"));
		throw error;
	}
	const { intent } = classification;
	try {
		await Resource.create({ kind: "audit", sourcePath: "telegram", intent, content: message,
			metadata: { classification, message: detail.message } });
	} catch {
		console.error("Could not record processed message in audit log");
		detail.message += " (Audit log unavailable.)";
	}
	return { intent, classification, ...detail };
};
