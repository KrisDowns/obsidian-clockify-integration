import type { PluginSettings } from "lib/config/PluginSettings";
import type {
  SearchTimeEntriesResponseItem,
  TimeEntryStart,
  TimeEntry,
  ProjectsSummaryResponseItem,
  ProjectsResponseItem,
  TagsResponseItem,
  SummaryReportResponse,
  DetailedReportResponseItem,
  ClientsResponseItem,
  ProjectId,
  TagId,
  ClientId,
  SummaryTimeChart,
} from "lib/model/Report-v3";
import type { ClockifyWorkspace } from "lib/model/ClockifyWorkspace";
import type { ISODate } from "lib/reports/ReportQuery";
import { settingsStore } from "lib/util/stores";
import moment from "moment";
import { Notice, requestUrl } from "obsidian";

import { ApiQueue } from "./ApiQueue";

type ReportOptions = {
  start_date: ISODate;
  end_date: ISODate;
  project_ids?: ProjectId[];
  tag_ids?: TagId[];
  client_ids?: ClientId[];
};

/** Wrapper class for performing common operations on the Clockify API. */
export default class ClockifyAPI {
  private _apiKey: string;
  private _settings: PluginSettings;
  private _queue = new ApiQueue();
  private _baseUrl = "https://api.clockify.me/api/v1";

  constructor() {
    settingsStore.subscribe((val: PluginSettings) => (this._settings = val));
  }

  /**
   * Must be called after constructor and before use of the API.
   */
  public async setToken(apiKey: string) {
    this._apiKey = apiKey;
    try {
      await this.testConnection();
    } catch {
      throw "Cannot connect to Clockify API.";
    }
  }

  /**
   * @throws an Error when the Clockify API cannot be reached.
   */
  public async testConnection() {
    await this._makeRequest(`${this._baseUrl}/workspaces`);
  }

  /** @returns list of the user's workspaces. */
  public async getWorkspaces(): Promise<ClockifyWorkspace[]> {
    const response = await this._makeRequest(`${this._baseUrl}/workspaces`);

    return response.map(
      (w: any) =>
        ({
          id: w.id,
          name: w.name,
        } as ClockifyWorkspace),
    );
  }

  /** @returns list of the user's clients. */
  public async getClients(): Promise<ClientsResponseItem[]> {
    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/clients`
    );

    return response.map((client: any) => ({
      archived: !client.archived,
      at: client.workspaceSettings?.timeFormat || "24h",
      color: "#000000",
      id: parseInt(client.id, 36), // Convert string ID to number for compatibility
      name: client.name,
      notes: client.note || "",
      permissions: [],
      updated_at: client.updatedAt || new Date().toISOString(),
      wid: parseInt(this._settings.workspace.id, 36),
    }));
  }

  /**
   * @returns list of the user's projects for the configured Clockify workspace.
   */
  public async getProjects(): Promise<ProjectsResponseItem[]> {
    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/projects`
    );

    return response
      .filter((p: any) => !p.archived)
      .map((project: any) => ({
        active: !project.archived,
        actual_hours: 0,
        at: project.createdAt || new Date().toISOString(),
        auto_estimates: false,
        billable: project.billable || false,
        cid: project.clientId ? parseInt(project.clientId, 36) : null,
        color: project.color || "#000000",
        created_at: project.createdAt || new Date().toISOString(),
        currency: "USD",
        current_period: null,
        default_hourly_rate: 0,
        estimate: null,
        estimated_hours: project.estimate?.estimate ? parseFloat(project.estimate.estimate) / 3600 : null,
        hex_color: project.color || "#000000",
        hourly_rate: 0,
        id: parseInt(project.id, 36), // Convert string ID to number for compatibility
        is_private: !project.public,
        name: project.name,
        permissions: [],
        rate: 0,
        rate_last_updated: null,
        recurring: false,
        recurring_parameters: null,
        status: project.archived ? "archived" : "active",
        template: false,
        template_id: null,
        updated_at: project.updatedAt || new Date().toISOString(),
        wid: parseInt(this._settings.workspace.id, 36),
      }));
  }

  /**
   * @returns list of the user's tags for the configured Clockify workspace.
   */
  public async getTags(): Promise<TagsResponseItem[]> {
    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/tags`
    );

    return response.map((tag: any) => ({
      at: tag.createdAt || new Date().toISOString(),
      id: parseInt(tag.id, 36), // Convert string ID to number for compatibility
      name: tag.name,
      permissions: [],
      wid: parseInt(this._settings.workspace.id, 36),
    }));
  }

  /**
   * @returns list of recent time entries for the user's workspace.
   */
  public async getRecentTimeEntries(): Promise<SearchTimeEntriesResponseItem[]> {
    const userId = await this._getCurrentUserId();
    const endDate = moment().format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";
    const startDate = moment().subtract(9, "day").format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?start=${startDate}&end=${endDate}`
    );

    // Group by date for compatibility with Toggl format
    const groupedByDate: { [key: string]: any[] } = {};
    
    response.forEach((entry: any) => {
      const date = moment(entry.timeInterval.start).format("YYYY-MM-DD");
      if (!groupedByDate[date]) {
        groupedByDate[date] = [];
      }
      groupedByDate[date].push(this._convertToTogglTimeEntry(entry));
    });

    return Object.entries(groupedByDate).map(([date, entries]) => ({
      time_entries: entries,
      title_data: entries[0], // Use first entry for title data
    }));
  }

  /**
   * Fetches a report for the current day according to the Clockify API.
   */
  public async getDailySummary(): Promise<ProjectsSummaryResponseItem[]> {
    const userId = await this._getCurrentUserId();
    const startDate = moment().startOf('day').format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";
    const endDate = moment().endOf('day').format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?start=${startDate}&end=${endDate}`
    );

    // Group by project for summary
    const projectSummary: { [key: string]: any } = {};
    
    response.forEach((entry: any) => {
      const projectId = entry.projectId || "no-project";
      const duration = this._calculateDuration(entry.timeInterval);
      
      if (!projectSummary[projectId]) {
        projectSummary[projectId] = {
          id: parseInt(projectId === "no-project" ? "0" : projectId, 36),
          title_data: this._convertToTogglTimeEntry(entry),
          time: 0,
        };
      }
      
      projectSummary[projectId].time += duration;
    });

    return Object.values(projectSummary);
  }

  /**
   * Gets a Clockify Summary Report between start_date and end_date.
   */
  public async getSummary(options: ReportOptions): Promise<SummaryReportResponse> {
    const userId = await this._getCurrentUserId();
    const startDate = moment(options.start_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";
    const endDate = moment(options.end_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?start=${startDate}&end=${endDate}`
    );

    // Convert to Toggl format
    const groups: { [key: string]: any } = {};
    
    response.forEach((entry: any) => {
      const projectId = entry.projectId || "no-project";
      const duration = this._calculateDuration(entry.timeInterval);
      
      if (!groups[projectId]) {
        groups[projectId] = {
          id: parseInt(projectId === "no-project" ? "0" : projectId, 36),
          sub_groups: [],
          time: 0,
          title: {
            project: entry.project?.name || "No Project",
          },
        };
      }
      
      groups[projectId].time += duration;
      groups[projectId].sub_groups.push({
        id: parseInt(entry.id, 36),
        time: duration,
        title: {
          time_entry: entry.description || "No description",
        },
      });
    });

    return {
      groups: Object.values(groups),
      resolution: "day",
      total_billable: 0,
      total_count: response.length,
      total_currencies: [],
      total_grand: Object.values(groups).reduce((sum: number, group: any) => sum + group.time, 0),
    };
  }

  public async getSummaryTimeChart(options: ReportOptions): Promise<SummaryTimeChart> {
    const userId = await this._getCurrentUserId();
    const startDate = moment(options.start_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";
    const endDate = moment(options.end_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?start=${startDate}&end=${endDate}`
    );

    // Group by date for time chart
    const dailyTotals: { [key: string]: number } = {};
    
    response.forEach((entry: any) => {
      const date = moment(entry.timeInterval.start).format("YYYY-MM-DD");
      const duration = this._calculateDuration(entry.timeInterval);
      
      if (!dailyTotals[date]) {
        dailyTotals[date] = 0;
      }
      dailyTotals[date] += duration;
    });

    const graph = Object.entries(dailyTotals).map(([date, seconds]) => ({ seconds }));

    return {
      graph,
      resolution: "day",
    };
  }

  /**
   * Gets a Clockify Detailed Report between start_date and end_date.
   */
  public async getDetailedReport(options: ReportOptions): Promise<DetailedReportResponseItem[]> {
    const userId = await this._getCurrentUserId();
    const startDate = moment(options.start_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";
    const endDate = moment(options.end_date).format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z";

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?start=${startDate}&end=${endDate}`
    );

    return response.map((entry: any) => ({
      time_entries: [this._convertToTogglTimeEntry(entry)],
      title_data: this._convertToTogglTimeEntry(entry),
    }));
  }

  /**
   * Starts a new timer on Clockify with the given description and project.
   */
  public async startTimer(entry: TimeEntryStart): Promise<TimeEntry> {
    const userId = await this._getCurrentUserId();
    
    const clockifyEntry = {
      start: moment().format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z",
      billable: entry.billable || false,
      description: entry.description || "",
      projectId: entry.project_id ? this._convertToClockifyId(entry.project_id) : null,
      taskId: null,
      tagIds: entry.tag_ids ? entry.tag_ids.map(id => this._convertToClockifyId(id)) : [],
    };

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/time-entries`,
      "POST",
      clockifyEntry
    );

    return this._convertToTogglTimeEntry(response);
  }

  /**
   * Stops the currently running timer.
   */
  public async stopTimer(entry: TimeEntry): Promise<TimeEntry> {
    const userId = await this._getCurrentUserId();
    const clockifyId = this._convertToClockifyId(entry.id);
    
    const stopData = {
      end: moment().format("YYYY-MM-DDTHH:mm:ss.SSS") + "Z",
    };

    const response = await this._makeRequest(
      `${this._baseUrl}/workspaces/${this._settings.workspace.id}/time-entries/${clockifyId}`,
      "PATCH",
      stopData
    );

    return this._convertToTogglTimeEntry(response);
  }

  /**
   * Returns the currently running timer, if any.
   */
  public async getCurrentTimer(): Promise<TimeEntry | null> {
    const userId = await this._getCurrentUserId();
    
    try {
      const response = await this._makeRequest(
        `${this._baseUrl}/workspaces/${this._settings.workspace.id}/user/${userId}/time-entries?in-progress=true`
      );

      if (response && response.length > 0) {
        return this._convertToTogglTimeEntry(response[0]);
      }
      
      return null;
    } catch (error) {
      console.error("Error getting current timer:", error);
      return null;
    }
  }

  // Helper methods

  private async _getCurrentUserId(): Promise<string> {
    const response = await this._makeRequest(`${this._baseUrl}/user`);
    return response.id;
  }

  private async _makeRequest(url: string, method: string = "GET", body?: any): Promise<any> {
    const options: any = {
      url,
      method,
      headers: {
        "X-Api-Key": this._apiKey,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await requestUrl(options);
      return response.json;
    } catch (error) {
      console.error("Clockify API error:", error);
      throw error;
    }
  }

  private _convertToTogglTimeEntry(clockifyEntry: any): TimeEntry {
    const start = moment(clockifyEntry.timeInterval.start);
    const end = clockifyEntry.timeInterval.end ? moment(clockifyEntry.timeInterval.end) : null;
    const duration = end ? end.diff(start, 'seconds') : -start.unix();

    return {
      at: clockifyEntry.timeInterval.start,
      billable: clockifyEntry.billable || false,
      created_with: "Clockify Integration for Obsidian",
      description: clockifyEntry.description || "",
      duration,
      duronly: false,
      id: parseInt(clockifyEntry.id, 36), // Convert string ID to number
      permissions: [],
      project_id: clockifyEntry.projectId ? parseInt(clockifyEntry.projectId, 36) : null,
      server_deleted_at: null,
      start: clockifyEntry.timeInterval.start,
      stop: clockifyEntry.timeInterval.end,
      tag_ids: clockifyEntry.tagIds ? clockifyEntry.tagIds.map((id: string) => parseInt(id, 36)) : [],
      tags: [],
      task_id: clockifyEntry.taskId ? parseInt(clockifyEntry.taskId, 36) : null,
      uid: parseInt(clockifyEntry.userId, 36),
      updated_at: clockifyEntry.timeInterval.start,
      user_id: parseInt(clockifyEntry.userId, 36),
      wid: parseInt(this._settings.workspace.id, 36),
      workspace_id: parseInt(this._settings.workspace.id, 36),
    };
  }

  private _convertToClockifyId(togglId: number): string {
    return togglId.toString(36); // Convert number back to string
  }

  private _calculateDuration(timeInterval: any): number {
    const start = moment(timeInterval.start);
    const end = timeInterval.end ? moment(timeInterval.end) : moment();
    return end.diff(start, 'seconds');
  }
}

const handleError = (error: unknown) => {
  console.error("Clockify API error: ", error);
  new Notice("Error communicating with Clockify API: " + error);
};
