import type { PluginSettings } from "lib/config/PluginSettings";
import type ClockifyService from "lib/toggl/ClockifyService";
import type { ApiStatus } from "lib/toggl/ClockifyService";
import { writable } from "svelte/store";

export const settingsStore = writable<PluginSettings>(null);
export const versionLogDismissed = writable<boolean>(false);

export const ClockifyService = writable<ClockifyService>(null);
export const apiStatusStore = writable<ApiStatus>(null);
