import type { Project } from './Project';
import type { Tag } from './Tag';

// This model is adapted for Clockify's API response.
export interface TimeEntry {
	id: string;
	description: string;
	projectId: string;
	tagIds: string[];
	userId: string;
	workspaceId: string;
	timeInterval: {
		start: string;
		end: string | null;
		duration: number | null;
	};

	// These are for internal use after processing
	start?: string;
	duration?: number;
	project?: Project;
	tags?: Tag[];
}
