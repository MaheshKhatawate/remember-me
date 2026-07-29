import express from "express";
import { MessageSchema } from "../types/message.js";
import { processMessage } from "../services/assistant.js";

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
        const result = await processMessage(message);

        return res.status(200).json({
            message: result.message,
            result,
        });
    } catch (err) {
        return res.status(500).json({
            message: err instanceof Error ? err.message : "Error in processing the message"
        })
    }
});

export default router;