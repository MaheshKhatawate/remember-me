import express from "express";
import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import {bot} from "./services/bot.js";
import router from "./apis/reader.js";


configDotenv();
const PORT: number = Number(process.env.PORT) || 3000;

const app = express();

app.use(express.json());
app.use(cors());

app.get("/health",(req, res) => {
    return res.json({
        "message": "healthy"
    })
});

app.use("/api", router);

mongoose.connect(process.env.MONGODB_URI!).then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, ()=>{
        console.log(`Server running on http://localhost:${PORT}`);
        bot.launch();
        console.log(`Bot is running`);
    })
})