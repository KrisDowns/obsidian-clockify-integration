import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { get } from 'svelte/store';
import type ClockifyPlugin from '../../main';
import type { ClockifyService } from '../clockify/ClockifyService';
import type { ClockifyWorkspace } from '../model/ClockifyWorkspace';
import { settings } from '../util/stores';

export class ClockifySettingsTab extends PluginSettingTab {
	private plugin: ClockifyPlugin;
	private clockifyService: ClockifyService;
	private workspaces: ClockifyWorkspace[] = [];

	constructor(app: App, plugin: ClockifyPlugin, clockifyService: ClockifyService) {
		super(app, plugin);
		this.plugin = plugin;
		this.clockifyService = clockifyService;
	}

	async display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Clockify Integration Settings' });

		new Setting(containerEl)
			.setName('Clockify API Key')
			.setDesc('Your personal API key for Clockify.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.clockifyApiKey)
					.onChange(async (value) => {
						this.plugin.settings.clockifyApiKey = value;
						await this.plugin.saveSettings();
						settings.set(this.plugin.settings);
					})
			);

		const workspaceSetting = new Setting(containerEl)
			.setName('Clockify Workspace')
			.setDesc('The workspace to use for time tracking.');

		// Add a connect button to fetch workspaces
		workspaceSetting.addButton((button) =>
			button.setButtonText('Connect and fetch workspaces').onClick(async () => {
				if (!this.plugin.settings.clockifyApiKey) {
					new Notice('Please enter your Clockify API key first.');
					return;
				}
				try {
					button.setButtonText('Connecting...').setDisabled(true);
					this.workspaces = await this.clockifyService.getWorkspaces();
					new Notice(`Found ${this.workspaces.length} workspaces!`);
					// Re-render the display to show the dropdown
					this.display();
				} catch (err) {
					new Notice('Failed to connect to Clockify. Check your API key.');
					this.workspaces = [];
				} finally {
					button.setButtonText('Connect and fetch workspaces').setDisabled(false);
				}
			})
		);

		// If workspaces are loaded, show the dropdown
		if (this.workspaces.length > 0) {
			const options = this.workspaces.reduce((acc, ws) => {
				acc[ws.id] = ws.name;
				return acc;
			}, {});

			workspaceSetting.addDropdown((dropdown) => {
				dropdown
					.addOptions(options)
					.setValue(this.plugin.settings.clockifyWorkspace)
					.onChange(async (value) => {
						this.plugin.settings.clockifyWorkspace = value;
						await this.plugin.saveSettings();
						settings.set(this.plugin.settings);
						// Re-initialize the service with the new workspace
						await this.clockifyService.init();
						new Notice(`Set active workspace to: ${options[value]}`);
					});
			});
		}

		new Setting(containerEl)
			.setName('Show "New Feature" notifications')
			.setDesc('Disable this to hide the notification about new features after an update.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showNewFeatureNotification).onChange(async (value) => {
					this.plugin.settings.showNewFeatureNotification = value;
					await this.plugin.saveSettings();
					settings.set(this.plugin.settings);
				})
			);
	}
}
