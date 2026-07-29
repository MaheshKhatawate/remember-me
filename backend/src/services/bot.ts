import { Telegraf } from "telegraf";
import axios from "axios";
import { configDotenv } from "dotenv";

configDotenv({ quiet: true });

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const backendUrl = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const apiSecret = process.env.BACKEND_API_SECRET;

const client = axios.create({
	baseURL: backendUrl,
	headers: apiSecret ? { "x-api-key": apiSecret } : {},
	timeout: 30000, // 30 s — enough for first-time RAG warm-up without re-indexing on every read
});

// Optional access control: if TELEGRAM_ALLOWED_USER_IDS is set, only those
// numeric Telegram user IDs (comma-separated) may use the bot. Anyone else's
// messages are politely rejected. Leave unset to allow anyone who can find
// the bot (fine for a private/test bot, NOT recommended once shared).
const allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
	.split(",")
	.map((id) => id.trim())
	.filter((id) => id.length > 0);

const isAllowed = (userId: number | undefined) => {
	if (allowedUserIds.length === 0) {
		return true;
	}
	return userId !== undefined && allowedUserIds.includes(String(userId));
};

bot.use(async (ctx, next) => {
	const userId = ctx.from?.id;
	if (!isAllowed(userId)) {
		console.warn(`Rejected message from unauthorized Telegram user id=${userId ?? "unknown"}`);
		await ctx.reply("You're not authorized to use this bot. Ask the owner to add your Telegram user ID to TELEGRAM_ALLOWED_USER_IDS.");
		return;
	}
	return next();
});

const helpText = [
	"*README Knowledge Assistant*",
	"",
	"I manage your GitHub README through chat — create, search, update, and delete entries using plain English or slash commands.",
	"",
	"*Natural language (just type it)*",
	"\"What links do I have about Docker?\" — searches semantically",
	"\"Add a note about React\" — creates an entry",
	"\"Remove the Kubernetes entry\" — deletes a matching entry",
	"Any plain-text message (no `/`) is treated as a smart search or instruction.",
	"",
	"*CRUD slash commands*",
	"`/add <topic> [url] [description]` – append a new entry",
	"  _Example:_ `/add Docker https://docker.com Container platform`",
	"`/update <topic> [url] [description]` – update a matching entry in place",
	"`/delete <topic>` – remove a matching entry",
	"`/get <topic>` (or `/find`, `/search`) – search for an entry",
	"_Aliases:_ `/create`, `/new` → add; `/edit` → update; `/remove` → delete",
	"",
	"*Control commands*",
	"`/status` – health of MongoDB, GitHub, RAG service, and Groq LLM",
	"`/sync` – re-fetch README from GitHub and rebuild the search index",
	"`/reset` – shows a safety warning (nothing changes)",
	"`/reset CONFIRM` – wipe the entire README (requires typing CONFIRM)",
	"`/reset CONFIRM <content>` – replace the README with new content",
	"`/help` – show this message",
].join("\n");

// Forwards a raw message to the backend's classifier/CRUD pipeline and
// relays the result back to the user. Shared by both the free-form text
// handler and every CRUD slash command below.
const forwardToBackend = async (ctx: { reply: (text: string) => Promise<unknown> }, content: string) => {
	const response = await client
		.post<{ message: string; result?: unknown }>("/api/reader", { message: content })
		.catch((err) => {
			console.error("Failed to process message", err instanceof Error ? err.message : err);
			return null;
		});

	if (!response) {
		await ctx.reply("Sorry, something went wrong while processing that. Try /status to check the backend.");
		return;
	}

	await ctx.reply(response.data.message);
};

// Register commands with Telegram so they appear in the "/" autocomplete menu.
// This is fire-and-forget — if it fails (e.g. no network at startup) the bot
// still works fine; the menu just won't show the command list.
void bot.telegram
	.setMyCommands([
		{ command: "help", description: "Show command reference" },
		{ command: "start", description: "Show command reference" },
		{ command: "status", description: "Health: MongoDB, GitHub, RAG service, Groq" },
		{ command: "sync", description: "Re-fetch README from GitHub and rebuild search index" },
		{ command: "reset", description: "Wipe/replace the entire README (requires CONFIRM)" },
		{ command: "add", description: "Append a new entry: /add <topic> [url] [description]" },
		{ command: "update", description: "Update a matching entry: /update <topic> [url] [description]" },
		{ command: "delete", description: "Remove a matching entry: /delete <topic>" },
		{ command: "get", description: "Semantic search: /get <topic>" },
		{ command: "find", description: "Semantic search: /find <topic>" },
		{ command: "search", description: "Semantic search: /search <topic>" },
	])
	.catch((err: unknown) =>
		console.warn("Could not register bot commands with Telegram:", err instanceof Error ? err.message : err),
	);

bot.command("help", async (ctx) => {
	await ctx.replyWithMarkdown(helpText);
});

bot.command("start", async (ctx) => {
	await ctx.replyWithMarkdown(helpText);
});

bot.command("status", async (ctx) => {
	try {
		const response = await client.get("/api/status");
		const data = response.data;
		const lines = [
			"*Status*",
			`Uptime: ${data.uptimeSeconds}s`,
			`MongoDB: ${data.mongo?.connected ? "connected" : `not connected (${data.mongo?.state})`}`,
			`GitHub: ${data.github?.configured ? `configured (${data.github.owner}/${data.github.repo}@${data.github.branch})` : "not configured"}`,
			`RAG service: ${
				data.ragService?.configured
					? data.ragService.reachable
						? "reachable"
						: `configured but unreachable (${data.ragService.detail ?? "unknown error"})`
					: "not configured (using local fallback index)"
			}`,
			`Groq LLM: ${data.groqConfigured ? "configured" : "not configured (using heuristic classifier / raw context)"}`,
		];
		await ctx.replyWithMarkdown(lines.join("\n"));
	} catch (err) {
		await ctx.reply(`Failed to fetch status: ${err instanceof Error ? err.message : "unknown error"}`);
	}
});

bot.command("sync", async (ctx) => {
	await ctx.reply("Syncing README from GitHub and rebuilding the search index...");
	try {
		const response = await client.post("/api/sync");
		await ctx.reply(response.data?.message ?? "Sync complete.");
	} catch (err) {
		await ctx.reply(`Sync failed: ${err instanceof Error ? err.message : "unknown error"}`);
	}
});

/**
 * Parses a `/reset ...` command's text into whether the user confirmed the
 * destructive action, and what replacement content (if any) to use.
 * Exported so it can be unit tested without spinning up Telegraf.
 */
export const parseResetCommand = (text: string) => {
	const args = text.replace(/^\/reset(?:@\S+)?\s*/i, "");
	const confirmed = /^CONFIRM\b/i.test(args.trim());
	const replacementContent = confirmed ? args.replace(/^CONFIRM\b\s*/i, "") : "";
	return { confirmed, replacementContent };
};

bot.command("reset", async (ctx) => {
	const text = ctx.update.message?.text ?? "";
	const { confirmed, replacementContent } = parseResetCommand(text);

	if (!confirmed) {
		await ctx.reply(
			"This will *permanently wipe your entire README* (a new commit replaces the current content).\n\n" +
				"To proceed, send:\n`/reset CONFIRM`\n\n" +
				"Or, to replace it with specific new content instead of leaving it empty:\n" +
				"`/reset CONFIRM <new README content>`\n\n" +
				"The previous content will still be recoverable from GitHub's commit history, but not from this bot.",
			{ parse_mode: "Markdown" },
		);
		return;
	}

	await ctx.reply("Resetting README...");
	try {
		const response = await client.post("/api/reset", { content: replacementContent });
		await ctx.reply(response.data?.message ?? "README has been reset.");
	} catch (err) {
		await ctx.reply(`Reset failed: ${err instanceof Error ? err.message : "unknown error"}`);
	}
});

// IMPORTANT: these CRUD command handlers must be registered *before* the
// generic bot.on("text", ...) handler further down. Telegraf runs middleware
// in registration order and stops at the first one that doesn't call
// next() — a catch-all text handler registered earlier would otherwise
// intercept every /add, /update, /delete, etc. message before these ever run.
for (const command of ["add", "create", "new", "update", "edit", "delete", "remove", "get", "find", "search"]) {
	bot.command(command, async (ctx) => {
		const content = ctx.update.message?.text;
		if (!content) return;
		await forwardToBackend(ctx, content);
	});
}

bot.on("text", async (ctx) => {
	const content = ctx.update.message?.text;

	if (!content) {
		return;
	}

	if (content.startsWith("/")) {
		// Reaches here only for slash commands that don't match any handler above.
		await ctx.reply("Unknown command. Send /help to see what I can do.");
		return;
	}

	await forwardToBackend(ctx, content);
});
