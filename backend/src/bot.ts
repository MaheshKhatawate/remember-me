import { Telegraf } from "telegraf";
import axios from "axios";
import { configDotenv } from "dotenv";
configDotenv();

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.on("text", async (ctx) => {
    const content = ctx.update.message?.text;
    console.log("Received message:", content);
    await axios.post("http://127.0.0.1:3000/resources", { content }).catch((err) => {
        console.error("Failed to save resource", err);
    });
    await ctx.reply("Received");
});