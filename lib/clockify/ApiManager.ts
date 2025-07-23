import { requestUrl, RequestUrlParam } from 'obsidian';
import { get, Writable } from 'svelte/store';
import { CLOCKIFY_API_URL } from '../constants';
import { PluginSettings } from '../config/PluginSettings';

export class ApiManager {
	constructor(private settings: Writable<PluginSettings>) {}

	private getHeaders() {
		const { clockifyApiKey } = get(this.settings);
		if (!clockifyApiKey) {
			throw new Error('Clockify API Key is not set.');
		}
		return {
			'Content-Type': 'application/json',
			'X-Api-Key': clockifyApiKey,
		};
	}

	private async request(options: RequestUrlParam): Promise<any> {
		try {
			const response = await requestUrl(options);
			return response.json;
		} catch (error) {
			console.error(`Clockify API Error: ${options.method} ${options.url}`, error);
			// Throw the error so services can catch it and show notices.
			throw error;
		}
	}

	public async get<T>(endpoint: string): Promise<T> {
		return this.request({
			url: `${CLOCKIFY_API_URL}${endpoint}`,
			method: 'GET',
			headers: this.getHeaders(),
		}) as Promise<T>;
	}

	public async post<T>(endpoint: string, body: any): Promise<T> {
		return this.request({
			url: `${CLOCKIFY_API_URL}${endpoint}`,
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify(body),
		}) as Promise<T>;
	}

	public async patch<T>(endpoint: string, body: any): Promise<T> {
		return this.request({
			url: `${CLOCKIFY_API_URL}${endpoint}`,
			method: 'PATCH',
			headers: this.getHeaders(),
			body: JSON.stringify(body),
		}) as Promise<T>;
	}
}
