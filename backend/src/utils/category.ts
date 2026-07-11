import { ChatGroq } from "@langchain/groq";
import * as z from "zod";

export const ClassificationSchema = z.object({
    urls: z.array(z.string().url()).optional(),
    commands: z.array(z.string()).optional(),
    type: z.enum(["normal", "command"]),
});

const masterPrompt =
	`You are specialised in classifying text into the segment it belongs to. Decide whether the input is text, a command to execute, having urls in the message which needs to be saved. Only return me the json no other extra. 
    json should be, types so the type should be normal if there are no commands suggested me its just a normal conversation. Meaning greating or other things.
    {
        urls: [array of urls if any],
        commands: [array of commands if any],
        type: "normal" | "command"
    }
    `;

export const categorise = async (message: string) => {
	const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_API;

	if (!apiKey) {
		throw new Error("GROQ_API_KEY or GROQ_API is not configured");
	}

	const model = new ChatGroq({
		apiKey,
		model: "llama-3.3-70b-versatile",
		temperature: 0,
	});

	const structuredModel = model.withStructuredOutput(ClassificationSchema);

	const response = await structuredModel.invoke([
		{ role: "system", content: masterPrompt },
		{ role: "user", content: message },
	]);

    return response;
};