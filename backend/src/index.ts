import express from "express";
import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import { bot, registerCommands } from "./services/bot.js";
import reader from "./apis/reader.js";
import status from "./apis/status.js";
import sync from "./apis/sync.js";
import reset from "./apis/reset.js";
import { requireApiKey } from "./middleware/auth.js";

configDotenv({ quiet: true });
const PORT: number = Number(process.env.PORT) || 3000;

const app = express();

app.use(express.json());
app.use(cors());

// Public health check (used by Docker healthchecks / load balancers).
app.get("/health", (_req, res) => {
	return res.json({ message: "healthy" });
});

// Everything under /api requires the shared secret when BACKEND_API_SECRET is set.
app.use("/api", requireApiKey, reader);
app.use("/api", requireApiKey, status);
app.use("/api", requireApiKey, sync);
app.use("/api", requireApiKey, reset);

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
	console.error("MONGODB_URI is not set. Please configure your .env file.");
	process.exit(1);
}

let server: ReturnType<typeof app.listen> | undefined;

mongoose
	.connect(mongoUri)
	.then(() => {
		console.log("Connected to MongoDB");
		server = app.listen(PORT, () => {
			console.log(`Server running on http://localhost:${PORT}`);
			void registerCommands();
			void bot.launch(() => console.log("Telegram bot is running")).catch((error: unknown) => {
				console.error("Telegram polling failed", error instanceof Error ? error.name : "unknown error");
				void shutdown("Telegram stopped", 1);
			});
		});
	})
	.catch((error) => {
		console.error("Failed to connect to MongoDB", error);
		process.exit(1);
	});

const shutdown = async (signal: string, exitCode = 0) => {
	console.log(`Received ${signal}, shutting down gracefully...`);
	try { bot.stop(signal); } catch { /* Polling may still be starting. */ }
	if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
	await mongoose.connection.close().catch(() => undefined);
	process.exit(exitCode);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
