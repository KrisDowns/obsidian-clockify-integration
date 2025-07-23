import { DEFAULT_SETTINGS } from "lib/config/DefaultSettings";
import type { PluginSettings } from "lib/config/PluginSettings";
import { CODEBLOCK_LANG } from "lib/constants";
import reportBlockHandler from "lib/reports/reportBlockHandler";
import ClockifyService from "lib/clockify/ClockifyService";
import ClockifySettingsTab from "lib/ui/ClockifySettingsTab";
import ClockifyReportView, {
  VIEW_TYPE_REPORT,
} from "lib/ui/views/ClockifyReportView";
import UserInputHelper from "lib/util/UserInputHelper";
import { settingsStore, versionLogDismissed } from "lib/util/stores";
import { Plugin, WorkspaceLeaf } from "obsidian";

export default class MyPlugin extends Plugin {
  public settings: PluginSettings;
  public clockify: ClockifyService;
  public input: UserInputHelper;
  public reportView: ClockifyReportView;

  async onload() {
    console.log(`Loading obsidian-clockify-integration ${this.manifest.version}`);

    await this.loadSettings();

    this.addSettingTab(new ClockifySettingsTab(this.app, this));

    // instantiate clockify class and set the API key if set in settings.
    this.clockify = new ClockifyService(this);
    if (this.settings.apiToken != null || this.settings.apiToken != "") {
      this.clockify.refreshApiConnection(this.settings.apiToken);
      this.input = new UserInputHelper(this);
    }

    // Register commands
    // start timer command
    this.addCommand({
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.clockify.startTimer();
        } else {
          return true;
        }
      },
      icon: "clock",
      id: "start-timer",
      name: "Start Clockify Timer",
    });

    // stop timer command
    this.addCommand({
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.clockify.stopTimer();
        } else {
          return this.clockify.currentTimeEntry != null;
        }
      },
      icon: "clock",
      id: "stop-timer",
      name: "Stop Clockify Timer",
    });

    // Register the timer report view
    this.registerView(
      VIEW_TYPE_REPORT,
      (leaf: WorkspaceLeaf) =>
        (this.reportView = new ClockifyReportView(leaf, this)),
    );

    // Add the view to the right sidebar
    if (this.app.workspace.layoutReady) {
      this.initLeaf();
    } else {
      this.app.workspace.onLayoutReady(this.initLeaf.bind(this));
    }

    this.addCommand({
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_REPORT);
        if (existing.length) {
          this.app.workspace.revealLeaf(existing[0]);
          return;
        }
        await this.app.workspace.getRightLeaf(false).setViewState({
          active: true,
          type: VIEW_TYPE_REPORT,
        });
        this.app.workspace.revealLeaf(
          this.app.workspace.getLeavesOfType(VIEW_TYPE_REPORT)[0],
        );
      },
      id: "show-report-view",
      name: "Open report view",
    });

    this.addCommand({
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.clockify.refreshApiConnection(this.settings.apiToken);
        } else {
          return this.settings.apiToken != null || this.settings.apiToken != "";
        }
      },
      id: "refresh-api",
      name: "Refresh API Connection",
    });

    // Enable processing codeblocks for rendering in-note reports
    this.registerCodeBlockProcessor();
  }

  initLeaf(): void {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_REPORT).length) {
      return;
    }
    this.app.workspace.getRightLeaf(false).setViewState({
      type: VIEW_TYPE_REPORT,
    });
  }

  /**
   * Registeres the MarkdownPostProcessor for rendering reports from
   * codeblock queries.
   */
  registerCodeBlockProcessor() {
    this.registerMarkdownCodeBlockProcessor("clockify", reportBlockHandler);
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.hasDismissedAlert) {
      this.settings.hasDismissedAlert = false;
    }
    settingsStore.set(this.settings);

    versionLogDismissed.set(this.settings.hasDismissedAlert);
    versionLogDismissed.subscribe((bool) => {
      this.settings.hasDismissedAlert = bool;
      this.saveSettings();
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
    settingsStore.set(this.settings);
  }
}
