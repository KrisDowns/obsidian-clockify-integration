export interface PluginSettings {
	// Single API Key for your Clockify account
	clockifyApiKey: string;

	// ID for your "Work" workspace
	workWorkspace: string;

	// ID for your "Learning" workspace
	learningWorkspace: string;

	// General Settings
	showNewFeatureNotification: boolean;
	lastUsedVersion: string;
}
