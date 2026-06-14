import { Telegraf } from "telegraf";
import axios from "axios";
import { configDotenv } from "dotenv";

configDotenv();

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.on("text", async (ctx) => {
    const content = ctx.update.message?.text;
    
    const response = await axios.post<{ message: string }>("http://127.0.0.1:3000/api/reader", { message: content }).catch((err) => {
        console.error("Failed to save resource", err);
    });

    if (!response) {
        return;
    }
    
    await ctx.reply(response.data.message);
});