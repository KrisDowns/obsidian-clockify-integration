import { get, Writable } from 'svelte/store';
import { Notice } from 'obsidian';

import { PluginSettings } from '../config/PluginSettings';
import { clients, projects, tags, currentTimer, dailySummary } from '../stores';
import { ApiManager } from './ApiManager';
import type { TimeEntry } from '../model/TimeEntry';
import type { Project } from '../model/Project';
import type { Tag } from '../model/Tag';
import type { ClockifyWorkspace } from '../model/ClockifyWorkspace';
import { millisecondsToTimeString } from '../util/millisecondsToTimeString';
import type { Client } from '../model/Client';

export class ClockifyService {
	private apiManager: ApiManager;
	private userId: string;
	private settings: Writable<PluginSettings>;

	constructor(settings: Writable<PluginSettings>) {
		this.settings = settings;
		this.apiManager = new ApiManager(settings);
		this.init();
	}

	async init() {
		const settingsValues = get(this.settings);
		if (settingsValues.clockifyApiKey && settingsValues.clockifyWorkspace) {
			try {
				const user = await this.apiManager.get<any>('/user');
				this.userId = user.id;
				await this.fetchData();
				await this.syncTimer();
			} catch (err) {
				console.error('Clockify: Error during initialization', err);
				new Notice('Clockify API error. Check your API key and workspace settings.');
			}
		}
	}

	async fetchData() {
		const workspaceId = get(this.settings).clockifyWorkspace;
		if (!workspaceId || !this.userId) return;

		try {
			const [projectsData, tagsData, clientsData] = await Promise.all([
				this.getProjects(workspaceId),
				this.getTags(workspaceId),
				this.getClients(workspaceId),
			]);

			projects.set(projectsData);
			tags.set(tagsData);
			clients.set(clientsData);
		} catch (err) {
			console.error('Clockify: Error fetching data', err);
			new Notice('Clockify API error while fetching data.');
		}
	}

	async syncTimer() {
		const workspaceId = get(this.settings).clockifyWorkspace;
		if (!workspaceId || !this.userId) return;

		const runningTimer = await this.getCurrentTimeEntry(workspaceId, this.userId);
		currentTimer.set(runningTimer);

		const summary = await this.getDailySummary(workspaceId, this.userId);
		dailySummary.set(summary);
	}

	async getWorkspaces(): Promise<ClockifyWorkspace[]> {
		return this.apiManager.get<ClockifyWorkspace[]>('/workspaces');
	}

	async getProjects(workspaceId: string): Promise<Project[]> {
		return this.apiManager.get<Project[]>(`/workspaces/${workspaceId}/projects`);
	}

	async getTags(workspaceId: string): Promise<Tag[]> {
		return this.apiManager.get<Tag[]>(`/workspaces/${workspaceId}/tags`);
	}
    
    async getClients(workspaceId: string): Promise<Client[]> {
        return this.apiManager.get<Client[]>(`/workspaces/${workspaceId}/clients`);
    }

	async getCurrentTimeEntry(workspaceId: string, userId: string): Promise<TimeEntry | null> {
		const runningEntries = await this.apiManager.get<TimeEntry[]>(
			`/workspaces/${workspaceId}/user/${userId}/time-entries?in-progress=true`
		);
		if (runningEntries.length > 0) {
			const entry = runningEntries[0];
			// Adapt Clockify's timeInterval to the TimeEntry model
			return {
				...entry,
				start: entry.timeInterval.start,
				duration: new Date().getTime() - new Date(entry.timeInterval.start).getTime(),
			};
		}
		return null;
	}

	async getDailySummary(workspaceId: string, userId: string): Promise<{ total: number; formated: string }> {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const start = today.toISOString();

		const entries = await this.apiManager.get<TimeEntry[]>(
			`/workspaces/${workspaceId}/user/${userId}/time-entries?start=${start}`
		);
		const total = entries.reduce((sum, entry) => {
			const duration = entry.timeInterval.end
				? new Date(entry.timeInterval.end).getTime() - new Date(entry.timeInterval.start).getTime()
				: 0;
			return sum + duration;
		}, 0);

		return {
			total,
			formated: millisecondsToTimeString(total),
		};
	}

	async stopCurrentTimeEntry(): Promise<void> {
		const runningTimer = get(currentTimer);
		if (!runningTimer) {
			new Notice('No timer is currently running.');
			return;
		}

		const workspaceId = get(this.settings).clockifyWorkspace;
		if (!workspaceId || !this.userId) return;

		try {
			await this.apiManager.patch(
				`/workspaces/${workspaceId}/user/${this.userId}/time-entries`,
				{
					end: new Date().toISOString(),
				}
			);
			new Notice('Timer stopped!');
			await this.syncTimer();
		} catch (err) {
			console.error('Clockify: Error stopping timer', err);
			new Notice('Error stopping Clockify timer.');
		}
	}

	async startTimeEntry(description: string, projectId?: string, tagIds?: string[]): Promise<void> {
		const workspaceId = get(this.settings).clockifyWorkspace;
		if (!workspaceId) {
			new Notice('Please select a Clockify workspace in the settings.');
			return;
		}

		try {
			await this.apiManager.post(`/workspaces/${workspaceId}/time-entries`, {
				description,
				projectId,
				tagIds,
				start: new Date().toISOString(),
			});
			new Notice(`Timer started: ${description}`);
			await this.syncTimer();
		} catch (err) {
			console.error('Clockify: Error starting timer', err);
			new Notice('Error starting Clockify timer.');
		}
	}

    async getReport(query: any): Promise<any> {
        // Reporting is complex and needs a separate implementation pass.
        // For now, we'll return an empty result.
        new Notice('Clockify reports are not yet implemented in this version.');
        return Promise.resolve({
            total_grand: 0,
            data: [],
        });
    }
}
