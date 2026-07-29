import * as z from "zod";

export const IntentSchema = z.enum(["CREATE", "READ", "UPDATE", "DELETE"]);

export type Intent = z.infer<typeof IntentSchema>;

export const AssistantRequestSchema = z.object({
	message: z.string().min(1),
});

export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;

export type AssistantResult = {
	message: string;
	intent: Intent;
	classification: Record<string, unknown>;
	repoWrite?: {
		path: string;
		branch: string;
		commitMessage: string;
		htmlUrl?: string;
		sha?: string;
	};
	searchResults?: Array<{
		section?: string | undefined;
		title?: string | undefined;
		content: string;
		score: number;
	}>;
	updatedReadme?: string;
};