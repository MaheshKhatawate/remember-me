import { message } from "telegraf/filters";
import * as z from "zod";

export const MessageSchema = z.object({
    message: z.string()
})