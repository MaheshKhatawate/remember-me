import express from "express";
import { Resource } from "../models/resource.js";
import { MessageSchema } from "../types/message.js";

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
            await Resource.create({
            content: message
        })
    } catch (err) {
        return res.json({
            message: "Error in storing the message"
        })
    }

    return res.status(200).json({
        message: "Message saved successfully"
    })
});

export default router;