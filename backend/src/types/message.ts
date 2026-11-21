import * as z from "zod";

export const MessageSchema = z.object({
	message: z.string().trim().min(1),
});
