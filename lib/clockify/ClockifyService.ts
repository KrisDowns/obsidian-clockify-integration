import { get, Writable } from 'svelte/store';
import { Notice } from 'obsidian';
import { moment } from 'obsidian';

import { PluginSettings } from '../config/PluginSettings';
import { clients, projects, tags } from '../stores';
import { ApiManager } from './ApiManager';
import type { Project } from '../model/Project';
import type { Tag } from '../model/Tag';
import type { ClockifyWorkspace } from '../model/ClockifyWorkspace';
import type { Client } from '../model/Client';
import type { ReportQuery } from '../reports/ReportQuery';
import type { Report } from '../model/Report';

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
		if (settingsValues.clockifyApiKey) {
			try {
				const user = await this.apiManager.get<any>('/user');
				this.userId = user.id;
			} catch (err) {
				console.error('Clockify: Error during initialization', err);
			}
		}
	}

	async fetchDataForWorkspace(workspaceId: string) {
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
			console.error(`Clockify: Error fetching data for workspace ${workspaceId}`, err);
			new Notice('Clockify API error while fetching data.');
		}
	}

	async getWorkspaces(): Promise<ClockifyWorkspace[]> {
		return this.apiManager.get<ClockifyWorkspace[]>('/workspaces');
	}

	async getProjects(workspaceId: string): Promise<Project[]> {
		const projects: Project[] = [];
		let page = 1;
		let hasMore = true;
		while (hasMore) {
			const pageOfProjects = await this.apiManager.get<Project[]>(
				`/workspaces/${workspaceId}/projects?page=${page}&page-size=50`
			);
			if (pageOfProjects.length > 0) {
				projects.push(...pageOfProjects);
				page++;
			} else {
				hasMore = false;
			}
		}
		return projects;
	}

	async getTags(workspaceId: string): Promise<Tag[]> {
		return this.apiManager.get<Tag[]>(`/workspaces/${workspaceId}/tags`);
	}

	async getClients(workspaceId: string): Promise<Client[]> {
		return this.apiManager.get<Client[]>(`/workspaces/${workspaceId}/clients`);
	}

	async getReport(query: ReportQuery, workspaceId: string): Promise<Report> {
		if (!workspaceId || !this.userId) {
			throw new Error('Workspace not configured or user not initialized.');
		}

        await this.fetchDataForWorkspace(workspaceId);

		const requestBody = {
			dateRangeStart: query.interval.start.toISOString(),
			dateRangeEnd: query.interval.end.toISOString(),
			summaryFilter: {
				groups: [this.mapGroupBy(query.groupBy)],
			},
			projects: query.selection.projects.include.length > 0 ? { ids: query.selection.projects.include, contains: 'CONTAINS', status: 'ALL' } : undefined,
			clients: query.selection.clients.include.length > 0 ? { ids: query.selection.clients.include, contains: 'CONTAINS', status: 'ALL' } : undefined,
			tags: query.selection.tags.include.length > 0 ? { ids: query.selection.tags.include, contains: 'CONTAINS', status: 'ALL' } : undefined,
			exportType: 'JSON',
		};

		const clockifyReport = await this.apiManager.post<any>(
			`/workspaces/${workspaceId}/reports/summary`,
			requestBody
		);

		return this.transformClockifyReport(clockifyReport);
	}

	private mapGroupBy(groupBy: string | null): string {
		switch (groupBy) {
			case 'project': return 'PROJECT';
			case 'client': return 'CLIENT';
			case 'entry': return 'TIMEENTRY';
			case 'date': return 'DATE';
			default: return 'PROJECT';
		}
	}

	private transformClockifyReport(clockifyReport: any): Report {
		const totalSeconds = clockifyReport.totals[0]?.totalTime ?? 0;
		const allProjects = get(projects);
		const allClients = get(clients);

		const data = clockifyReport.groupOne.map((group: any) => {
			const projectInfo = allProjects.find((p) => p.id === group._id);
            const clientInfo = projectInfo ? allClients.find(c => c.id === projectInfo.clientId) : undefined;

			return {
				id: group._id,
				title: {
					project: group.name,
					client: clientInfo?.name,
				},
				time: group.duration * 1000,
				color: projectInfo?.color,
			};
		});

		return {
			total_grand: totalSeconds * 1000,
			total_billable: (clockifyReport.totals[0]?.totalBillableTime ?? 0) * 1000,
			data: data,
		};
	}
}
