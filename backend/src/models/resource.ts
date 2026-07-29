import mongoose from "mongoose";

export interface IResource {
	kind: string;
	sourcePath?: string;
	section?: string;
	title?: string;
	url?: string;
	intent?: string;
	content?: string;
	metadata?: unknown;
	embedding?: number[];
	createdAt?: Date;
	updatedAt?: Date;
}

const resourceSchema = new mongoose.Schema<IResource>(
	{
		kind: {
			type: String,
			required: true,
			default: "audit",
		},
		sourcePath: {
			type: String,
			required: false,
		},
		section: {
			type: String,
			required: false,
		},
		title: {
			type: String,
			required: false,
		},
		url: {
			type: String,
			required: false,
		},
		intent: {
			type: String,
			required: false,
		},
		content: {
			type: String,
			required: false,
		},
		metadata: {
			type: mongoose.Schema.Types.Mixed,
			required: false,
		},
		embedding: {
			type: [Number],
			required: false,
		},
	},
	{ timestamps: true },
);

export const Resource: mongoose.Model<IResource> =
	(mongoose.models.Resource as mongoose.Model<IResource> | undefined) ??
	mongoose.model<IResource>("Resource", resourceSchema);
