import express from "express";
import { Resource } from "../models/resource.js";
import { MessageSchema } from "../types/message.js";
import { categorise } from "../utils/category.js";
import { writeRepo } from "../utils/write-repo.js";

const router = express.Router();

router.post("/reader", async (req, res) => {
    const { success, data } = MessageSchema.safeParse(req.body);

    if (!success) {
        return res.status(401).json({
            message: "Error in request body"
        })
    }

    const message = data.message;

    try {
        // Here I am processing the message
        const processed = await categorise(message);

        const markdown = [
            "# Processed Message",
            "",
            `- Message: ${message}`,
            `- Type: ${processed.type}`,
            `- URLs: ${processed.urls?.join(", ") ?? "None"}`,
            `- Commands: ${processed.commands?.join(", ") ?? "None"}`,
            "",
            "```json",
            JSON.stringify({ message, processed }, null, 2),
            "```",
            "",
        ].join("\n");


        // Storing the processed data
        const repoWrite = await writeRepo({
            content: markdown,
            path: "README.md",
            commitMessage: "Update README with processed message",
        });

        await Resource.create({
            content: message
        });

        return res.status(200).json({
            message: "Message processed successfully",
            processed,
            repoWrite,
        });
    } catch (err) {
        return res.status(500).json({
            message: "Error in processing the message"
        })
    }
});

export default router;