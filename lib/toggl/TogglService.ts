import { ACTIVE_TIMER_POLLING_INTERVAL, STATUS_BAR_UPDATE_INTERVAL } from "lib/constants";
import type {
  ClientId,
  EnrichedWithClient,
  ProjectId,
  ProjectsResponseItem,
  SummaryReportResponse,
  SummaryTimeChart,
  TagId,
  TimeEntry,
  TimeEntryStart,
} from "lib/model/Report-v3";
import type { ClockifyWorkspace } from "lib/model/ClockifyWorkspace";
import { ISODate, Query, SelectionMode } from "lib/reports/ReportQuery";
import { getClientIds, setClients } from "lib/stores/clients";
import { setCurrentTimer } from "lib/stores/currentTimer";
import { setDailySummaryItems } from "lib/stores/dailySummary";
import {
  enrichObjectWithProject,
  getProjectIds,
  Projects,
  setProjects,
} from "lib/stores/projects";
import {
  enrichObjectWithTags,
  getTagIds,
  setTags,
  Tags,
} from "lib/stores/tags";
import { apiStatusStore, clockifyService } from "lib/util/stores";
import type MyPlugin from "main";
import moment from "moment";
import "moment-duration-format";
import { Notice } from "obsidian";
import { derived, get } from "svelte/store";

import ClockifyAPI from "./ApiManager";

export enum ApiStatus {
  AVAILABLE = "AVAILABLE",
  NO_TOKEN = "NO_TOKEN",
  UNREACHABLE = "UNREACHABLE",
  UNTESTED = "UNTESTED",
  DEGRADED = "DEGRADED",
}

export type SummaryReport = {
  projectSummary: (SummaryReportResponse["groups"][number] & {
    $project: EnrichedWithClient<ProjectsResponseItem>;
  })[];
  timeChart: Omit<SummaryTimeChart, "graph"> & {
    graph: {
      date: string;
      seconds: number;
    }[];
  };
};

export type EnrichedDetailedReportItem = Awaited<
  ReturnType<InstanceType<typeof ClockifyService>["getEnrichedDetailedReport"]>
>[number];

export type SummaryReportStore = Awaited<
  ReturnType<InstanceType<typeof ClockifyService>["getSummaryReport"]>
>;

export default class ClockifyService {
  private _plugin: MyPlugin;
  private _apiManager: ClockifyAPI;

  // UI references
  private _statusBarItem: HTMLElement;

  private _currentTimerInterval: number = null;
  private _statusBarInterval: number = null;
  private _currentTimeEntry: TimeEntry = null;
  private _ApiAvailable = ApiStatus.UNTESTED;

  constructor(plugin: MyPlugin) {
    this._plugin = plugin;
    this._statusBarItem = this._plugin.addStatusBarItem();
    this._statusBarItem.setText("Connecting to Clockify...");

    this._plugin.registerDomEvent(this._statusBarItem, "click", () => {
      this.refreshApiConnection(this._plugin.settings.apiToken);
    });
    // Store a reference to the manager in a svelte store to avoid passing
    // of references around the component trees.
    clockifyService.set(this);
    apiStatusStore.set(ApiStatus.UNTESTED);
  }

  private _setApiStatus(status: ApiStatus) {
    this._ApiAvailable = status;
    apiStatusStore.set(status);
  }

  /**
   * Creates a new clockify client object using the passed API key.
   * @param token the API key for the client.
   */
  public async refreshApiConnection(token: string) {
    this._setApiStatus(ApiStatus.UNTESTED);
    this._statusBarItem.setText("Connecting to Clockify...");
    if (this._apiManager != null) {
      new Notice("Reconnecting to Clockify...");
    }

    window.clearInterval(this._currentTimerInterval);
    window.clearInterval(this._statusBarInterval);
    if (token != null && token != "") {
      try {
        this._apiManager = new ClockifyAPI();
        await this._apiManager.setToken(token);
        this._setApiStatus(ApiStatus.AVAILABLE);
      } catch {
        console.error("Cannot connect to clockify API.");
        this._statusBarItem.setText("Cannot connect to Clockify API");
        this._setApiStatus(ApiStatus.UNREACHABLE);
        this.noticeAPINotAvailable();
        return;
      }
      // Cache the projects and tags.
      await this._preloadWorkspaceData();

      // Fetch daily summary data and start polling for current timers.
      this.startTimerInterval();
      this.startStatusBarInterval();
      this._apiManager
        .getDailySummary()
        .then((response) => setDailySummaryItems(response));
    } else {
      this._statusBarItem.setText("Open settings to add a Clockify API key.");
      this._setApiStatus(ApiStatus.NO_TOKEN);
      this.noticeAPINotAvailable();
    }
    apiStatusStore.set(this._ApiAvailable);
  }

  /** Throws an Error when the Clockify API cannot be reached. */
  public async testConnection() {
    await this._apiManager.testConnection();
  }

  /** @returns list of the user's workspaces. */
  public async getWorkspaces(): Promise<ClockifyWorkspace[]> {
    return this._apiManager.getWorkspaces();
  }

  /** Preloads data such as the user's projects. */
  private async _preloadWorkspaceData() {
    // Preload projects and tags.
    await Promise.all([
      this._apiManager.getProjects().then(setProjects),
      this._apiManager.getTags().then(setTags),
      this._apiManager.getClients().then(setClients),
    ]);
  }

  public async startTimer() {
    this.executeIfAPIAvailable(async () => {
      let selectedEntry: TimeEntryStart;

      const recentEntries = await this._apiManager.getRecentTimeEntries();
      const enrichedEntries = recentEntries.map((entry) =>
        enrichObjectWithProject(entry),
      );

      selectedEntry = await this._plugin.input.selectTimer(enrichedEntries);

      if (selectedEntry == null) {
        const project = await this._plugin.input.selectProject();
        selectedEntry = await this._plugin.input.enterTimerDetails();
        selectedEntry.project_id = project != null ? project.id : null;
      }

      this._apiManager.startTimer(selectedEntry).then((entry) => {
        this.updateCurrentTimer();
      });
    });
  }

  public async stopTimer() {
    this.executeIfAPIAvailable(() => {
      if (this._currentTimeEntry != null) {
        this._apiManager.stopTimer(this._currentTimeEntry).then(() => {
          this.updateCurrentTimer();
        });
      }
    });
  }

  /**
   * Start polling the Clockify API periodically to get the
   * currently running timer.
   */
  private startTimerInterval() {
    this.updateCurrentTimer();
    this._currentTimerInterval = window.setInterval(() => {
      this.updateCurrentTimer();
    }, ACTIVE_TIMER_POLLING_INTERVAL);
    this._plugin.registerInterval(this._currentTimerInterval);
  }

  /**
   * Start updating the status bar periodically.
   */
  private startStatusBarInterval() {
    this.updateStatusBarText();
    this._statusBarInterval = window.setInterval(() => {
      this.updateStatusBarText();
    }, STATUS_BAR_UPDATE_INTERVAL);
    this._plugin.registerInterval(this._statusBarInterval);
  }

  private async updateCurrentTimer() {
    if (!this.isApiAvailable) {
      return;
    }

    const prev = this._currentTimeEntry;
    let curr: TimeEntry;

    try {
      curr = await this._apiManager.getCurrentTimer();
      if (this._ApiAvailable === ApiStatus.DEGRADED) {
        this._setApiStatus(ApiStatus.AVAILABLE);
      }
    } catch (err) {
      console.error("Error reaching Clockify API");
      console.error(err);
      if (this._ApiAvailable !== ApiStatus.DEGRADED) {
        new Notice("Error updating active Clockify time entry. Retrying...");
        this._setApiStatus(ApiStatus.DEGRADED);
      }
      return;
    }

    // TODO properly handle multiple workspaces
    // Drop timers from different workspaces
    if (
      curr != null &&
      curr.workspace_id != this.workspaceId &&
      curr.project_id != undefined
    ) {
      curr = null;
    }

    let changed = false;

    if (curr != null) {
      if (prev == null) {
        // Case 1: no timer -> active timer
        changed = true;
        console.debug("Case 1: no timer -> active timer");
      } else {
        if (prev.id != curr.id) {
          // Case 2: old timer -> new timer (new ID)
          changed = true;
          console.debug("Case 2: old timer -> new timer (new ID)");
        } else {
          if (
            prev.description != curr.description ||
            prev.project_id != curr.project_id ||
            prev.start != curr.start ||
            isTagsChanged(prev.tag_ids, curr.tag_ids)
          ) {
            // Case 3: timer details update (same ID)
            changed = true;
            console.debug("Case 3: timer details update (same ID)");
          }
        }
      }
    } else if (prev != null) {
      // Case 4: active timer -> no timer
      changed = true;
      console.debug("Case 4: active timer -> no timer");
    }

    if (changed) {
      setCurrentTimer(curr);
      // fetch updated daily summary report
      this._apiManager
        .getDailySummary()
        .then((response) => setDailySummaryItems(response));
    }

    this._currentTimeEntry = curr;
  }

  /**
   * Updates the status bar text to reflect the current Clockify
   * state (e.g. details of current timer).
   */
  private updateStatusBarText() {
    if (this._ApiAvailable === ApiStatus.UNTESTED) {
      this._statusBarItem.setText("Connecting to Clockify...");
      return;
    }

    let timer_msg = null;
    if (this._currentTimeEntry == null) {
      timer_msg = this._plugin.settings.statusBarNoEntryMesssage;
    } else {
      let title: string =
        this._currentTimeEntry.description || "No description";
      if (title.length > this._plugin.settings.charLimitStatusBar) {
        title = `${title.slice(
          0,
          this._plugin.settings.charLimitStatusBar - 3,
        )}...`;
      }
      const duration = this.getTimerDuration(this._currentTimeEntry);
      const time_string = moment.duration(duration, 'seconds').format(
        this._plugin.settings.statusBarFormat,
        { trim: false, trunc: true },
      )
      if (this._plugin.settings.statusBarShowProject){
        const currentEnhanced = enrichObjectWithProject(this._currentTimeEntry)
        title += ` - ${currentEnhanced.$project?.name || "No project"}`
      }
      timer_msg = `${title} (${time_string})`;
    }
    this._statusBarItem.setText(`${this._plugin.settings.statusBarPrefix}${timer_msg}`);
  }

  /**
   * @param timeEntry TimeEntry object as returned by the Clockify API
   * @returns timer duration in seconds
   */
  private getTimerDuration(timeEntry: any): number {
    if (timeEntry.stop) {
      return timeEntry.duration;
    }
    // true_duration = epoch_time + duration
    const epoch_time = Math.round(new Date().getTime() / 1000);
    return epoch_time + timeEntry.duration;
  }

  /** Runs the passed function if the API is available, else emits a notice. */
  // eslint-disable-next-line @typescript-eslint/ban-types
  private executeIfAPIAvailable(func: Function) {
    if (this.isApiAvailable) {
      func();
    } else {
      this.noticeAPINotAvailable();
    }
  }

  private noticeAPINotAvailable() {
    switch (this._ApiAvailable) {
      case ApiStatus.NO_TOKEN:
        new Notice("No Clockify API key is set.");
        break;
      case ApiStatus.UNREACHABLE:
        new Notice(
          "The Clockify API is unreachable. Either the Clockify services are down, or your API key is incorrect.",
        );
        break;
    }
  }

  public async getSummaryReport(query: Query) {
    const filters = getObjectIdsFromQuery(query);
    const requestOptions = {
      ...filters,
      end_date: query.to,
      resolution: getTimeChartResolution(query.from, query.to),
      start_date: query.from,
    };

    const timeChartRequest =
      this._apiManager.getSummaryTimeChart(requestOptions);
    const projectSummaryRequest = this._apiManager.getSummary(requestOptions);

    const [timeChart, projectSummary] = await Promise.all([
      timeChartRequest,
      projectSummaryRequest,
    ]);

    // enrich the timeChart with dates
    const dates = getTimeChartDates(
      query.from,
      timeChart.resolution,
      timeChart.graph.length,
    );

    const enrichedTimeChart = {
      ...timeChart,
      graph: timeChart.graph.map((item, index) => ({
        ...item,
        date: dates[index],
      })),
    };

    // NOTE: we return a store so that reports will reactively
    //       re-render when the projects are refetched.
    const store = derived([Projects], (): SummaryReport => {
      // enrich the projectSummary
      const enrichedProjectSummary = projectSummary.groups.map((item) =>
        enrichObjectWithProject(item, "id"),
      );

      return {
        projectSummary: enrichedProjectSummary,
        timeChart: enrichedTimeChart,
      };
    });

    return store;
  }

  /**
   * Gets a Clockify Detailed report based on the query parameter.
   * Makes multiple HTTP requests until all pages of the paginated result are
   * gathered, then returns the combined report as a single object.
   * @param query query to be fullfilled.
   * @returns Summary report returned by Clockify API.
   */
  public async getEnrichedDetailedReport(query: Query) {
    const { client_ids, project_ids, tag_ids } = getObjectIdsFromQuery(query);

    const items = await this._apiManager.getDetailedReport({
      client_ids,
      end_date: query.to,
      project_ids,
      start_date: query.from,
      tag_ids,
    });

    return items
      .map((item) => enrichObjectWithProject(item))
      .map(enrichObjectWithTags);
  }

  /** True if API key is valid and Clockify API is responsive. */
  public get isApiAvailable(): boolean {
    if (this._ApiAvailable === ApiStatus.AVAILABLE) {
      return true;
    }
    return false;
  }

  /** User's projects as preloaded on plugin init. @deprecated */
  public get cachedProjects() {
    return get(Projects);
  }

  /**
   * User's workspace tags as preloaded on plugin init
   * @deprecated read from the store instead.
   *  */
  public get cachedTags() {
    return get(Tags);
  }

  // Get the current time entry
  public get currentTimeEntry(): any {
    return this._currentTimeEntry;
  }

  private get workspaceId(): string {
    return this._plugin.settings.workspace.id;
  }
}

function isTagsChanged(old_tag_ids: number[], new_tags_ids: number[]) {
  old_tag_ids = old_tag_ids || [];
  new_tags_ids = new_tags_ids || [];

  if (old_tag_ids.length != new_tags_ids.length) {
    return true;
  }
  for (const tag of old_tag_ids) {
    if (new_tags_ids.indexOf(tag) < 0) {
      return true;
    }
  }
  return false;
}

function getObjectIdsFromQuery(query: Query): {
  project_ids: ProjectId[];
  client_ids: ClientId[];
  tag_ids: TagId[];
} {
  const project_ids =
    query.projectSelection &&
    query.projectSelection.mode === SelectionMode.INCLUDE
      ? getProjectIds(query.projectSelection.list)
      : undefined;

  const client_ids =
    query.clientSelection &&
    query.clientSelection.mode === SelectionMode.INCLUDE
      ? getClientIds(query.clientSelection.list)
      : undefined;

  const tag_ids = query.includedTags
    ? getTagIds(query.includedTags)
    : undefined;

  return { client_ids, project_ids, tag_ids };
}

function getTimeChartResolution(
  from: ISODate,
  to: ISODate,
): SummaryTimeChart["resolution"] {
  const durationInDays = moment(to).diff(moment(from), "days");

  if (durationInDays <= 31) {
    return "day";
  }
  if (durationInDays <= 120) {
    return "week";
  }
  return "month";
}

function getTimeChartDates(
  from: ISODate,
  resolution: SummaryTimeChart["resolution"],
  count: number,
): ISODate[] {
  const startDate = moment(from);

  const dates = [];
  for (let i = 0; i < count; i++) {
    const date = startDate.clone().add(i, resolution);
    dates.push(date.format("YYYY-MM-DD"));
  }

  return dates;
}
