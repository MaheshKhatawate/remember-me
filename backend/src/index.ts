import express from "express";
import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import * as z from "zod";
import { Resource } from "./models/resource.js";
import {bot} from "./bot.js";

configDotenv();
const PORT: number = Number(process.env.PORT) || 3000;

const app = express();

app.use(express.json());
app.use(cors());

const ResourceSchema = z.object({
    content:z.string()
});


app.get("/health",(req, res) => {
    return res.json({
        "message": "healthy"
    })
});

app.post("/resources", async (req, res) => {
    const {success, data} = ResourceSchema.safeParse(req.body);
    if(!success){
        return res.status(400).json({
            message: "Invalid request body"
        })
    }
    
    try{
        const content = data.content;
        const timestamp = new Date();
        const resource = new Resource({content, timestamp});
        await resource.save();
        return res.status(201).json({
            message: "Resource created successfully",
            resource
        })
    }catch(err){
        return res.status(500).json({
            message: "Error creating resource"
        })
    }
})

mongoose.connect(process.env.MONGODB_URI!).then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, ()=>{
        console.log(`Server running on http://localhost:${PORT}`);
        bot.launch();
        console.log(`Bot is running`);
    })
})