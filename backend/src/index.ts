import express from "express";
import { configDotenv } from "dotenv";

configDotenv();
const PORT: number = Number(process.env.PORT) || 3000;

const app = express();

app.use(express.json());

app.get("/health",(req, res) => {
    return res.json({
        "message": "healthy"
    })
});

app.listen(PORT, ()=>{
    console.log(`Server running on http://localhost:${PORT}`);
})