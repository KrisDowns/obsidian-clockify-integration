import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { get } from 'svelte/store';

import { ClockifyService } from './lib/clockify/ClockifyService';
import { VIEW_TYPE_TOGGL_REPORTS } from './lib/constants';
import { DefaultSettings } from './lib/config/DefaultSettings';
import { PluginSettings } from './lib/config/PluginSettings';
import { reportBlockHandler } from './lib/reports/reportBlockHandler';
import { settings } from './lib/util/stores';
import { ClockifySettingsTab } from './lib/ui/ClockifySettingsTab';
import { StartTimerModal } from './lib/ui/modals/StartTimerModal';
import { TogglReportView } from './lib/ui/views/TogglReportView';
import TogglSidebarPane from './lib/ui/views/TogglSidebarPane.svelte';
import { checkVersion } from './lib/util/checkVersion';
import NewFeatureNotification from './lib/ui/views/NewFeatureNotification.svelte';
import { clients, projects, tags } from './lib/stores';

export default class ClockifyPlugin extends Plugin {
	public settings: PluginSettings;
	private clockifyService: ClockifyService;
	private view: TogglReportView;

	async onload() {
		console.log('loading clockify-integration plugin');

		await this.loadSettings();

		settings.set(this.settings);
		settings.subscribe(async (value) => {
			this.settings = value;
			await this.saveSettings();
		});

		this.clockifyService = new ClockifyService(settings);

		this.addSettingTab(new ClockifySettingsTab(this.app, this, this.clockifyService));

		this.addCommand({
			id: 'start-timer',
			name: 'Clockify: Start timer',
			callback: () => {
				new StartTimerModal(this.app, this.clockifyService).open();
			},
		});

		this.addCommand({
			id: 'stop-timer',
			name: 'Clockify: Stop timer',
			callback: async () => {
				await this.clockifyService.stopCurrentTimeEntry();
			},
		});

        this.addCommand({
            id: 'refresh-data',
            name: 'Clockify: Refresh projects, tags, and clients',
            callback: async () => {
                new Notice('Refreshing Clockify data...');
                await this.clockifyService.fetchData();
                new Notice('Clockify data refreshed!');
            }
        })

		this.registerView(VIEW_TYPE_TOGGL_REPORTS, (leaf) => (this.view = new TogglReportView(leaf, this.settings)));

		this.app.workspace.onLayoutReady(async () => {
			this.addSidebar();

			if (this.settings.showNewFeatureNotification) {
				const versionCheck = checkVersion(this.manifest.version, this.settings.lastUsedVersion);
				if (versionCheck.isNew) {
					const n = new NewFeatureNotification(this.app, this.manifest.version, () => {
						this.settings.lastUsedVersion = this.manifest.version;
						this.settings.showNewFeatureNotification = false;
						this.saveSettings();
						n.hide();
					});
					n.show();
				}
			}
		});

		this.registerMarkdownCodeBlockProcessor('toggl', reportBlockHandler(this.clockifyService));
	}

	onunload() {
		console.log('unloading clockify-integration plugin');
		this.app.workspace
			.getLeavesOfType('toggl-sidebar')
			.forEach((leaf: WorkspaceLeaf) => leaf.detach());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DefaultSettings, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addSidebar() {
		this.addRibbonIcon('clock', 'Clockify', () => {
			// This creates a new leaf if one doesn't exist
			this.app.workspace.getRightLeaf(false).setViewState({
				type: 'toggl-sidebar',
			});
		});

		this.registerView('toggl-sidebar', (leaf: WorkspaceLeaf) => {
			const pane = new TogglSidebarPane({
				target: leaf.view.contentEl,
				props: {
					plugin: this,
                    clockifyService: this.clockifyService,
				},
			});
			return pane;
		});

		this.app.workspace.getRightLeaf(false).setViewState({
			type: 'toggl-sidebar',
		});
	}
}
