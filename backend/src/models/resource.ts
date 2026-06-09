import mongoose from "mongoose";

const resourceSchema = new mongoose.Schema({
    content: String,
    timestamp: Date
});

export const Resource = mongoose.model("Resource", resourceSchema);