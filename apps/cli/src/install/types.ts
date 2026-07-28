export type SupportedClient = "codex" | "claude-code";
export type SessionIntegrationMode = "enable" | "skip" | "remove";

export type InstallOptions = {
  client: SupportedClient;
  repositoryRoot?: string;
  clientRoot?: string;
  dryRun?: boolean;
  force?: boolean;
  preferCopy?: boolean;
  nodePath?: string;
  sessionIntegration?: SessionIntegrationMode;
};

export type InstallChange = {
  path: string;
  action: "created" | "updated" | "unchanged" | "backup" | "linked" | "copied";
};

export type InstallResult = {
  client: SupportedClient;
  configPath: string;
  skillsPath: string;
  changes: InstallChange[];
};

export type NormalizedInstallOptions = InstallOptions & {
  repositoryRoot: string;
  nodePath: string;
};

export type ClientInstallInput = {
  options: NormalizedInstallOptions;
  configPath: string;
  changes: InstallChange[];
  mcpEntry: string;
  writeConfig: (contents: string, action: "created" | "updated") => void;
};

export type ClientAdapter = {
  configPath(options: NormalizedInstallOptions): string;
  skillsPath(options: NormalizedInstallOptions): string;
  installConfig(input: ClientInstallInput): void;
  installSessionIntegration?(input: ClientInstallInput): void;
};
