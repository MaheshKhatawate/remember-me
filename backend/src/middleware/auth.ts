import type { NextFunction, Request, Response } from "express";

/**
 * Simple shared-secret authentication for the internal HTTP API.
 *
 * If BACKEND_API_SECRET is not set, auth is skipped entirely (useful for
 * local development). When set, every request must include a matching
 * `x-api-key` header. The Telegram bot service automatically attaches this
 * header when it calls the backend (see services/bot.ts).
 */
export const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
	const expected = process.env.BACKEND_API_SECRET;

	if (!expected) {
		return next();
	}

	const provided = req.header("x-api-key");
	if (provided !== expected) {
		return res.status(401).json({ message: "Unauthorized: missing or invalid x-api-key" });
	}

	return next();
};
