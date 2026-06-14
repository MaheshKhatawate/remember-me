import mongoose from "mongoose";

const resourceSchema = new mongoose.Schema(
    {content: String},
    {timestamps: true}
);

export const Resource = mongoose.model("Resource", resourceSchema);